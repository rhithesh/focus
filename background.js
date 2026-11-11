// Feed Filter — service worker.
// Batches feed items (YouTube videos, X posts, LinkedIn posts) into a single
// TypeSafe System One (Jev) call and turns the typed answers into block/allow verdicts.

const ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/v1/systemone",
  typesafe: "https://api.typesafe.ai/v1/systemone",
};

// No key? The same request goes to Feed Filter's rate-limited free tier instead,
// which forwards it to Jev with the project's own key. (Also listed in host_permissions.)
const FREE_ENDPOINT = "https://feed-filter-two.vercel.app/api/jev";

// Requests with images. OpenRouter takes them on its Decisions route as data-URL image
// parts; TypeSafe direct takes them on System One as an assets map behind an opt-in header.
const DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const FREE_LOOK_ENDPOINT = FREE_ENDPOINT + "/look";

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: "openrouter",
  apiKey: "",
  model: "jev-latest",
  goals: "",
  onboarded: false,
  surfaces: { home: true, search: true, sidebar: true, shorts: true, x: true, linkedin: true },
  baitThreshold: 2.0,
  offGoalThreshold: 2.6,
  junkThreshold: 0.85, // clickbait reads 0.45-0.75 on this question; real scams read 0.9+
  minConfidence: 0.5,
  hideUntilChecked: true, // nothing shows until its verdict is in; content.js caps the wait
  blurStrength: 80, // percent; 100% renders as a 20px blur
  fallbackHeuristics: true,
  freeTier: true, // use the free tier when no key is set
  showPagePill: true, // the on/off switch floating on YouTube, X and LinkedIn
  lookAtImages: true, // also judge thumbnails and post images (Jev's image input is new)
};

// Jev evaluates every question against the state in one parallel pass, so a whole
// feed page fits in one request. 20 items = 60 questions, ~5k input tokens.
const BATCH_SIZE = 20;
const MAX_PARALLEL = 3;
// A hung request must not hold the feed blurred: time out and let the keyword rules stand in.
const MODEL_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 6000;

const BAIT_LEVELS = [
  "Plain and accurate. It says what it actually contains — no exaggeration, nothing withheld, no emotional hook.",
  "Mildly promotional. Slightly punchy or curiosity-driven phrasing, but it still describes the real content honestly.",
  "Clear bait. Manufactured curiosity or outrage: withheld payoff, shock claims, ALL-CAPS or emoji spam, fake urgency, inflated stakes, misleading superlatives, '#1 thing nobody tells you', one-line-per-sentence 'broetry' built to force a 'see more' click, or a closing 'Agree?' / 'Thoughts?' that exists to farm comments.",
  "Pure engagement bait. It exists only to force a click or reaction and almost certainly misrepresents itself: 'you won't believe', invented drama, fabricated stories or numbers, rage-bait, fake reveals, 'comment YES and I'll DM you', 'repost if you agree'.",
];

const GOAL_LEVELS = [
  "Directly advances the stated goals. Substantive content someone pursuing these goals would deliberately seek out.",
  "Useful and adjacent. Clearly related to the goals and plausibly worth the time, though not core to them.",
  "Tangential. Same broad subject area, but mostly commentary, news-of-the-week or entertainment rather than substance.",
  "Unrelated distraction. Nothing to do with the stated goals — pure entertainment, drama, or time-filler.",
];

const JUNK_TRUE =
  "Spam, a scam, or mass-produced filler: crypto and get-rich-quick pitches, fake giveaways, engagement farming, generic AI-written filler, stolen or re-uploaded content, misleading medical or financial claims, or an account pumping out near-identical posts or videos.";
const JUNK_FALSE =
  "A genuine post or video from a real person or channel, whatever its quality or subject.";

// The image pass asks about the picture, with the title or text alongside for context.
const LOOK_LEVELS = [
  "A plain picture. It shows what the video or post is about, with no attention tricks.",
  "Styled to stand out: bright colours, a big face or a few bold words, but it honestly matches the title or text.",
  "Clear visual bait: exaggerated shocked or crying faces, red arrows and circles, huge ALL-CAPS overlay text, blurred or censored 'reveals', fake urgency, or a promise the title doesn't deliver.",
  "Pure visual bait or a lie: fake or doctored screenshots, invented drama, sexualised or gory bait, or a picture that has nothing to do with the actual content.",
];

const SCAM_IMAGE_TRUE =
  "The picture pushes a scam or spam: fake giveaways, crypto or get-rich-quick promises, screenshots of fake earnings or payouts, fake celebrity endorsements, or 'DM me' and 'link in bio' lead-generation graphics.";
const SCAM_IMAGE_FALSE =
  "An ordinary picture: a photo, chart, screenshot, product shot, slide or video thumbnail, whatever its quality.";

const PLATFORM = { youtube: "YouTube", x: "X (Twitter)", linkedin: "LinkedIn" };

/* ---------------------------------------------------------------- settings */

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  s.surfaces = { ...DEFAULT_SETTINGS.surfaces, ...(settings?.surfaces || {}) };
  return s;
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// Every cached verdict is stamped with the goals + thresholds it was judged under,
// so editing either one invalidates the cache instead of serving stale blocks.
// Bump when the question wording changes so verdicts from the old wording are re-judged.
const RUBRIC_VERSION = 2;

function rubricStamp(s) {
  return hash32(
    [RUBRIC_VERSION, s.goals, s.model, s.baitThreshold, s.offGoalThreshold, s.junkThreshold, s.minConfidence].join("|")
  );
}

/* ------------------------------------------------------------------- cache */

// "v:" holds text verdicts, "i:" image-pass verdicts.
async function readCache(ids, stamp, prefix = "v:") {
  const keys = ids.map((id) => prefix + id);
  const got = await chrome.storage.local.get(keys);
  const hits = {};
  const now = Date.now();
  for (const id of ids) {
    const e = got[prefix + id];
    if (e && e.s === stamp && now - e.t < CACHE_TTL_MS) hits[id] = e.d;
  }
  return hits;
}

async function writeCache(verdicts, stamp, prefix = "v:") {
  const patch = {};
  const t = Date.now();
  for (const [id, d] of Object.entries(verdicts)) patch[prefix + id] = { d, s: stamp, t };
  await chrome.storage.local.set(patch);
  maybePrune();
}

const isVerdictKey = (k) => k.startsWith("v:") || k.startsWith("i:");

let pruning = false;
async function maybePrune() {
  if (pruning) return;
  pruning = true;
  try {
    const all = await chrome.storage.local.get(null);
    const entries = Object.entries(all).filter(([k]) => isVerdictKey(k));
    if (entries.length <= CACHE_LIMIT) return;
    entries.sort((a, b) => (a[1]?.t || 0) - (b[1]?.t || 0));
    const drop = entries.slice(0, entries.length - Math.floor(CACHE_LIMIT * 0.8)).map(([k]) => k);
    await chrome.storage.local.remove(drop);
  } catch {
    /* pruning is best-effort */
  } finally {
    pruning = false;
  }
}

/* ------------------------------------------------------------ jev requests */

function describe(v) {
  if (v.platform === "x" || v.platform === "linkedin") {
    return {
      platform: PLATFORM[v.platform],
      format: "feed post",
      text: v.title,
      author: v.author || "unknown",
      metadata: v.meta || "",
    };
  }
  return {
    platform: PLATFORM.youtube,
    format: v.isShort ? "YouTube Short (vertical, under 60s)" : "regular video",
    title: v.title,
    channel: v.author || v.channel || "unknown",
    duration: v.duration || "unknown",
    metadata: v.meta || "",
  };
}

function buildRequest(videos, s) {
  const state = {
    my_goals: s.goals?.trim() || "(the viewer has not stated any goals)",
    items: {},
  };
  const questions = {};

  videos.forEach((v, i) => {
    const k = "v" + i;
    state.items[k] = describe(v);

    questions[k + "_bait"] = {
      type: "score",
      instructions: {
        item: "items." + k,
        question:
          "Rate how much the feed item at `items." + k +
          "` relies on clickbait or engagement bait. Judge it exactly as someone scrolling past sees it, before they click or expand it.",
      },
      criteria: BAIT_LEVELS,
    };

    questions[k + "_goal"] = {
      type: "score",
      instructions: {
        item: "items." + k,
        question:
          "The viewer's own goals are in `my_goals`. Rate how far the feed item at `items." + k +
          "` sits from those goals. Judge the subject matter, not the production quality.",
      },
      criteria: GOAL_LEVELS,
    };

    questions[k + "_junk"] = {
      type: "noul",
      instructions: {
        item: "items." + k,
        question: "The feed item at `items." + k + "` is spam, a scam, or mass-produced low-effort filler.",
      },
      criteria: { true: JUNK_TRUE, false: JUNK_FALSE },
    };
  });

  return { model: s.model, state, questions };
}

/* ----------------------------------------------------------- image pass */

// Jev reads images in long-context mode, which TypeSafe says is slower and less accurate,
// so pictures go in a request of their own and the text verdicts keep full accuracy.
// The pass can add a blur (thumbnail bait, a scam graphic) but never lifts one.
const LOOK_BATCH = 10;
const LOOK_VERSION = 1;
const IMAGE_HOSTS = /^https:\/\/(i\.ytimg\.com|pbs\.twimg\.com|media\.licdn\.com)\//;
const IMG_MIN = 280; // Jev takes 280-1568 px a side
const IMG_MAX = 768; // and bills images as input tokens, so keep them small

function lookStamp(s) {
  return hash32(["look", LOOK_VERSION, s.goals, s.model, s.baitThreshold, s.offGoalThreshold, s.junkThreshold, s.minConfidence].join("|"));
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// These CDNs answer with Access-Control-Allow-Origin: *, so no extra host permission is needed.
// Every picture is re-encoded as a baseline JPEG inside Jev's size limits (WebP, tiny avatars
// and banners would otherwise be rejected), and the URL itself is never sent anywhere.
async function loadImage(url) {
  if (!IMAGE_HOSTS.test(url || "")) return null;
  try {
    const res = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const scale = Math.max(Math.min(1, IMG_MAX / Math.max(bmp.width, bmp.height)), IMG_MIN / Math.min(bmp.width, bmp.height));
    const w = Math.max(IMG_MIN, Math.round(bmp.width * scale));
    const h = Math.max(IMG_MIN, Math.round(bmp.height * scale));
    if (Math.max(w, h) > 1568) return bmp.close(), null; // a long, thin banner: nothing worth judging
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    return toBase64(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

// Images are written as reference strings here; toWire() swaps them for whatever the
// destination expects. A reference has to be text that can't occur by accident.
function buildLookRequest(items, s) {
  const state = {
    my_goals: s.goals?.trim() || "(the viewer has not stated any goals)",
    items: {},
  };
  const questions = {};
  const images = {};

  items.forEach((v, i) => {
    const k = "v" + i;
    const ref = "img-" + crypto.randomUUID();
    images[ref] = v.imageData;
    state.items[k] = { ...describe(v), image: ref };

    questions[k + "_look"] = {
      type: "score",
      instructions: {
        item: "items." + k,
        question:
          "Rate how much the picture at `items." + k + ".image` relies on visual clickbait to win the click. " +
          "Judge the picture together with the item's title or text, as someone scrolling past sees it.",
      },
      criteria: LOOK_LEVELS,
    };

    questions[k + "_scam"] = {
      type: "noul",
      instructions: {
        item: "items." + k,
        question: "The picture at `items." + k + ".image` is part of a scam or spam.",
      },
      criteria: { true: SCAM_IMAGE_TRUE, false: SCAM_IMAGE_FALSE },
    };

    // A post that is only a picture never went through the text pass, so judge its subject here.
    if (!v.title) {
      questions[k + "_goal"] = {
        type: "score",
        instructions: {
          item: "items." + k,
          question:
            "The viewer's own goals are in `my_goals`. Rate how far the picture at `items." + k +
            ".image` sits from those goals. Judge the subject matter, not the production quality.",
        },
        criteria: GOAL_LEVELS,
      };
    }
  });

  return { model: s.model, state, questions, images };
}

// "jev-latest" and "jev-1.14.0" are System One names; the Decisions route wants OpenRouter's.
function decisionsModel(m) {
  if (m.includes("/")) return m;
  if (m === "jev-latest") return "~typesafe/jev-latest";
  return "typesafe/" + m.replace(/^(jev-\d+\.\d+)\.\d+$/, "$1");
}

function toWire({ model, state, questions, images }, format) {
  if (format === "assets") {
    const assets = {};
    for (const [ref, data] of Object.entries(images)) assets[ref] = { type: "image", format: "jpg", data_base64: data };
    return { model, state, questions, assets };
  }
  // Decisions: the image part goes where the reference was.
  const items = {};
  for (const [k, it] of Object.entries(state.items)) {
    items[k] = { ...it, image: { type: "image_url", image_url: { url: "data:image/jpeg;base64," + images[it.image] } } };
  }
  return { model: decisionsModel(model), state: { ...state, items }, questions };
}

async function callLook(body, s) {
  if (!s.apiKey) return callFree(toWire(body, "decisions"), FREE_LOOK_ENDPOINT);
  if (s.provider === "typesafe") {
    return callJev(toWire(body, "assets"), s, 0, ENDPOINTS.typesafe, { "TypeSafe-Danger-Zone-Images": "true" });
  }
  return callJev(toWire(body, "decisions"), s, 0, DECISIONS_ENDPOINT);
}

function lookVerdictFrom(answers, k, s, source) {
  const look = answers[k + "_look"] || {};
  const scam = answers[k + "_scam"] || {};
  const goal = answers[k + "_goal"];

  const l = Number(look.score ?? 0);
  const lc = Number(look.confidence ?? 0);
  const j = Number(scam.noul ?? 0);
  const scores = { look: round2(l), lookConf: round2(lc), scam: round2(j) };
  if (goal) Object.assign(scores, { goal: round2(Number(goal.score ?? 0)), goalConf: round2(Number(goal.confidence ?? 0)) });

  if (j >= s.junkThreshold) return { tag: "SPAM", why: "scam image " + pct(j), scores, source };
  if (l >= s.baitThreshold && lc >= s.minConfidence)
    return { tag: "CLICK-BAIT", why: "thumbnail bait " + scores.look + "/3 · " + pct(lc) + " conf", scores, source };
  if (goal && s.goals?.trim() && scores.goal >= s.offGoalThreshold && scores.goalConf >= s.minConfidence)
    return { tag: "OFF-GOAL", why: "off-goal " + scores.goal + "/3 · " + pct(scores.goalConf) + " conf", scores, source };
  return { tag: null, why: "", scores, source };
}

// The text verdict decides first; the picture can only add a reason to blur.
function combine(text, look) {
  if (!look) return text;
  if (!text) return look;
  const scores = { ...text.scores, ...look.scores };
  if (text.tag || !look.tag) return { ...text, scores };
  return { ...look, scores };
}

class FreeTierError extends Error {
  constructor(message, retryAfterSec) {
    super(message);
    this.retryAfterSec = retryAfterSec;
  }
}

async function installId() {
  const { installId } = await chrome.storage.local.get("installId");
  if (installId) return installId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ installId: id });
  return id;
}

// The free tier's day, like its counters, runs midnight to midnight UTC.
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const nextUtcMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

/** Posts this install can still send today, or Infinity when not known yet. */
async function freeLeftToday() {
  const { freeUsage } = await chrome.storage.local.get("freeUsage");
  if (!freeUsage || utcDay(freeUsage.at) !== utcDay(Date.now()) || !Number.isFinite(freeUsage.remaining)) return Infinity;
  return Math.max(0, freeUsage.remaining);
}

// The free tier's own limits are final: no retrying a 429 from it, just back off until it resets.
async function callFree(body, endpoint = FREE_ENDPOINT) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Feed-Filter-Install": await installId() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
  } catch (e) {
    throw new FreeTierError("Free tier unreachable: " + (e.message || e), 60);
  }

  const retryAfter = Number(res.headers.get("retry-after")) || 60;
  if (res.status === 429) {
    const info = await res.json().catch(() => ({}));
    // Over this install's allowance: note what's left. If the batch just didn't fit, try a
    // smaller one in a few seconds instead of waiting for the reset.
    if (info.scope === "install" && Number.isFinite(info.remaining) && endpoint === FREE_ENDPOINT) {
      await chrome.storage.local.set({ freeUsage: { limit: info.limit, remaining: info.remaining, at: Date.now() } });
      if (info.remaining > 0) throw new FreeTierError(`Free tier: only ${info.remaining} posts left today, asking about fewer at a time.`, 5);
    }
    const msg = {
      burst: "Free tier: too many requests, slowing down for a minute.",
      install: "Free tier: today's limit is used up. Keyword rules until it resets.",
      ip: "Free tier: too many posts from your network today. Keyword rules until it resets.",
      global: "Free tier: at capacity for today. Keyword rules until it resets.",
    }[info.scope] || "Free tier: limit reached. Keyword rules until it resets.";
    throw new FreeTierError(msg, retryAfter);
  }
  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    const msg = info.error === "free-tier-off" ? "The free tier is switched off right now. Add your own key to keep filtering." : "Free tier error " + res.status + ".";
    throw new FreeTierError(msg, res.status === 503 ? retryAfter : 60);
  }

  // The free tier has no per-install allowance by default, and then sends no allowance headers.
  if (endpoint === FREE_ENDPOINT) {
    const header = (name) => (res.headers.has(name) ? Number(res.headers.get(name)) : NaN);
    const limit = header("x-ratelimit-limit");
    const remaining = header("x-ratelimit-remaining");
    if (Number.isFinite(limit) && Number.isFinite(remaining)) await chrome.storage.local.set({ freeUsage: { limit, remaining, at: Date.now() } });
    else await chrome.storage.local.remove("freeUsage");
  }
  return res.json();
}

async function callJev(body, s, attempt = 0, url = ENDPOINTS[s.provider] || ENDPOINTS.openrouter, extraHeaders = {}) {
  if (!s.apiKey) return callFree(body);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + s.apiKey,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error("Network error reaching " + url + ": " + (e.message || e));
  }

  // 429 / 529 are the documented backoff cases.
  if ((res.status === 429 || res.status === 529) && attempt < 2) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, waitMs));
    return callJev(body, s, attempt + 1, url, extraHeaders);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("401 — API key rejected. Check the key and provider in options.");
    if (res.status === 422) throw new Error("422 — request rejected: " + text.slice(0, 300));
    throw new Error(res.status + " — " + (text.slice(0, 300) || res.statusText));
  }

  return res.json();
}

function verdictFrom(answers, k, s, source) {
  const bait = answers[k + "_bait"] || {};
  const goal = answers[k + "_goal"] || {};
  const junk = answers[k + "_junk"] || {};

  const b = Number(bait.score ?? 0);
  const bc = Number(bait.confidence ?? 0);
  const g = Number(goal.score ?? 0);
  const gc = Number(goal.confidence ?? 0);
  const j = Number(junk.noul ?? 0);

  // conf is the confidence of whichever signal decides, not a blend of both —
  // otherwise a tile can show a number below the gate it actually passed.
  // Nouls carry no confidence field, so a SPAM verdict reports null.
  const scores = {
    bait: round2(b), goal: round2(g), junk: round2(j),
    baitConf: round2(bc), goalConf: round2(gc), conf: round2(Math.min(bc, gc)),
  };

  // Confidence-gated: a high score the model isn't sure about does not block.
  if (j >= s.junkThreshold)
    return { tag: "SPAM", why: "spam " + pct(j), scores: { ...scores, conf: null }, source };
  if (b >= s.baitThreshold && bc >= s.minConfidence)
    return { tag: "CLICK-BAIT", why: "bait " + scores.bait + "/3 · " + pct(bc) + " conf", scores: { ...scores, conf: round2(bc) }, source };
  if (s.goals?.trim() && g >= s.offGoalThreshold && gc >= s.minConfidence)
    return { tag: "OFF-GOAL", why: "off-goal " + scores.goal + "/3 · " + pct(gc) + " conf", scores: { ...scores, conf: round2(gc) }, source };

  return { tag: null, why: "", scores, source };
}

const round2 = (n) => Math.round(n * 100) / 100;
const pct = (n) => Math.round(n * 100) + "%";

/* ------------------------------------------------------- heuristic fallback */

const BAIT_PATTERNS = [
  /you won'?t believe/i, /gone (wrong|sexual)/i, /\bshocking\b/i, /\bexposed\b/i,
  /this changes everything/i, /\bis (officially )?(dead|over|finished)\b/i,
  /nobody (is )?talk(ing|s) about/i, /they don'?t want you to/i, /\bthe truth about\b/i,
  /\bsecret[s]?\b/i, /\binsane\b/i, /\bcrazy\b/i, /\b(i|we) tried\b.*\bfor \d+ days\b/i,
  /\$\d+[km]?\b.{0,24}\bin \d+ (day|hour|minute|week)/i, /!{2,}/, /\?{2,}/,
  /\b(must|need to) (watch|see)\b/i, /\bdon'?t (do|buy|watch|make) (this|these)\b/i,
];
// Post-style bait on X and LinkedIn.
const POST_BAIT_PATTERNS = [
  /\b(agree|thoughts)\?\s*$/i, /\bcomment ["'“]?\w+["'”]? (below|and i[’']?ll)/i, /\brepost if\b/i,
  /\bfollow (me )?for more\b/i, /\bhere[’']?s what happened( next)?\b/i, /\b(99|90)% of (people|developers|founders)\b/i,
  /\bwill blow your mind\b/i, /\bdestroy(ed|s)\b/i,
];
const JUNK_PATTERNS = [
  /\bfree (robux|v-?bucks|giveaway|crypto|bitcoin)\b/i, /\bairdrop\b/i,
  /\bmake \$?\d+ *(a|per) (day|week|month)\b/i, /\bpassive income\b/i,
  /\b(elon|musk)\b.*\b(giveaway|bitcoin|btc)\b/i, /\bcure[sd]? (cancer|diabetes)\b/i,
];

function heuristicVerdict(v, s) {
  const title = v.title || "";
  const letters = title.replace(/[^A-Za-z]/g, "");
  const caps = letters ? (title.match(/[A-Z]/g) || []).length / letters.length : 0;
  const emoji = Array.from(title).filter((c) => c.codePointAt(0) > 0x2100).length;

  let bait = 0;
  bait += Math.min(2, [...BAIT_PATTERNS, ...POST_BAIT_PATTERNS].filter((r) => r.test(title)).length);
  if (caps > 0.6 && letters.length > 8 && letters.length < 200) bait += 1;
  if (emoji >= 2) bait += 1;
  bait = Math.min(3, bait);

  const junk = JUNK_PATTERNS.some((r) => r.test(title)) ? 0.9 : 0.05;
  const scores = { bait: round2(bait), goal: 0, junk, baitConf: null, goalConf: null, conf: null };

  if (junk >= s.junkThreshold) return { tag: "SPAM", why: "keyword match", scores, source: "heuristic" };
  if (bait >= s.baitThreshold) return { tag: "CLICK-BAIT", why: "keyword match", scores, source: "heuristic" };
  return { tag: null, why: "", scores, source: "heuristic" };
}

/* ----------------------------------------------------------------- judging */

async function handleJudge(videos, tabId) {
  const s = await getSettings();
  if (!s.enabled) return { verdicts: {}, settings: s };

  // Picture-only posts are sent only while the image pass is on, and skip the text pass.
  const res = await judgeText(videos.filter((v) => v.title), s, tabId);
  const pictures = s.lookAtImages ? videos.filter((v) => v.image) : [];
  if (!pictures.length) return res;
  return { ...res, verdicts: await withLooks(pictures, s, res.verdicts, tabId) };
}

function pushVerdicts(tabId, verdicts) {
  if (tabId == null || !Object.keys(verdicts).length) return;
  return chrome.tabs.sendMessage(tabId, { type: "verdicts", verdicts }).catch(() => {});
}

// The tab keeps an item blurred while this is true of it: its picture is still to be judged.
const looksPending = (v, s) => s.lookAtImages && !!v.image && Date.now() >= lookPausedUntil;

async function judgeText(videos, s, tabId) {
  if (!videos.length) return { verdicts: {}, settings: s };
  const stamp = rubricStamp(s);
  const ids = videos.map((v) => v.id);
  const cached = await readCache(ids, stamp);
  const todo = videos.filter((v) => !(v.id in cached));

  if (!todo.length) return { verdicts: cached, settings: s };

  // Keyword rules stand in whenever the model can't be used. Those verdicts aren't cached
  // and, when a model is available at all, carry a retryAt so the tab asks again later.
  const modelAvailable = !!s.apiKey || s.freeTier;
  const heuristicsFor = (items, extra = {}, retryAt = Date.now() + 60_000) => {
    const out = { ...cached, ...extra };
    // With keyword rules off an item still gets an answer, so the tab stops waiting on it.
    const standIn = (v) => (s.fallbackHeuristics ? heuristicVerdict(v, s) : { tag: null, why: "", scores: {}, source: "none" });
    for (const v of items) {
      if (v.id in out) continue;
      out[v.id] = modelAvailable ? { ...standIn(v), provisional: true, retryAt } : standIn(v);
    }
    return out;
  };

  if (!s.apiKey) {
    if (!s.freeTier) return { verdicts: heuristicsFor(todo), settings: s, degraded: "no-key" };
    const { freePausedUntil } = await chrome.storage.local.get("freePausedUntil");
    if (freePausedUntil && Date.now() < freePausedUntil)
      return { verdicts: heuristicsFor(todo, {}, freePausedUntil), settings: s, degraded: "free-paused" };
  }

  // The free tier refuses a whole batch that doesn't fit in what's left today, so near the
  // limit ask about only as many posts as remain; the rest get keyword rules for now.
  let ask = todo;
  if (!s.apiKey) {
    const left = await freeLeftToday();
    if (left === 0) {
      const reset = nextUtcMidnight();
      await chrome.storage.local.set({ freePausedUntil: reset });
      return { verdicts: heuristicsFor(todo, {}, reset), settings: s, degraded: "free-paused" };
    }
    if (left < todo.length) ask = todo.slice(0, left);
  }

  const chunks = [];
  for (let i = 0; i < ask.length; i += BATCH_SIZE) chunks.push(ask.slice(i, i + BATCH_SIZE));

  const fresh = {};
  let error = null;
  // Posts left out above are asked about again soon: by then the allowance is either known
  // to be 0 (and the free tier pauses until the reset) or turned out to be larger.
  let retryAt = Date.now() + (ask.length < todo.length ? 5_000 : 60_000);

  for (let i = 0; i < chunks.length; i += MAX_PARALLEL) {
    const slice = chunks.slice(i, i + MAX_PARALLEL);
    const results = await Promise.allSettled(
      slice.map(async (chunk) => {
        const data = await callJev(buildRequest(chunk, s), s);
        const answers = data.answers || {};
        const done = {};
        chunk.forEach((v, idx) => {
          fresh[v.id] = verdictFrom(answers, "v" + idx, s, data.model || s.model);
          done[v.id] = looksPending(v, s) ? { ...fresh[v.id], awaitingLook: true } : fresh[v.id];
        });
        // Clear each batch as it lands rather than holding them all for the slowest.
        if (chunks.length > 1) pushVerdicts(tabId, done);
      })
    );
    for (const r of results) {
      if (r.status !== "rejected") continue;
      error = String(r.reason?.message || r.reason);
      if (r.reason instanceof FreeTierError) {
        retryAt = Date.now() + r.reason.retryAfterSec * 1000;
        await chrome.storage.local.set({ freePausedUntil: retryAt });
      }
    }
  }

  if (Object.keys(fresh).length) await writeCache(fresh, stamp);
  if (error) await chrome.storage.local.set({ lastError: { msg: error, at: Date.now() } });
  else await chrome.storage.local.remove("lastError");

  return { verdicts: heuristicsFor(todo, fresh, retryAt), settings: s, error };
}

/* ------------------------------------------------------- judging pictures */

const lookInFlight = new Set();
let lookPausedUntil = 0;

// Cached picture verdicts are merged in straight away. The rest are judged in the
// background and pushed to the tab when they land, since image requests are slower.
async function withLooks(items, s, verdicts, tabId) {
  const stamp = lookStamp(s);
  const cached = await readCache(items.map((v) => v.id), stamp, "i:");
  const out = { ...verdicts };
  const retryAt = Math.max(lookPausedUntil, Date.now() + 60_000);
  for (const v of items) {
    if (v.id in cached) {
      out[v.id] = combine(verdicts[v.id], cached[v.id]);
      continue;
    }
    // A picture-only post has nothing to show until its picture is judged; ask again later
    // in case the result never arrives (the tab reloaded, the worker restarted).
    const base = out[v.id] || { tag: null, why: "", scores: {}, source: "image", provisional: true, retryAt };
    out[v.id] = looksPending(v, s) ? { ...base, awaitingLook: true } : base;
  }

  const todo = items.filter((v) => !(v.id in cached) && !lookInFlight.has(v.id));
  if (todo.length && Date.now() >= lookPausedUntil) judgePictures(todo, s, stamp, verdicts, tabId);
  return out;
}

async function judgePictures(items, s, stamp, textVerdicts, tabId) {
  items.forEach((v) => lookInFlight.add(v.id));
  const fresh = {};
  let loaded = items;
  try {
    loaded = await Promise.all(items.map(async (v) => ({ ...v, imageData: await loadImage(v.image) })));
    const ready = loaded.filter((v) => v.imageData);
    const chunks = [];
    for (let i = 0; i < ready.length; i += LOOK_BATCH) chunks.push(ready.slice(i, i + LOOK_BATCH));

    let error = null;
    const results = await Promise.allSettled(
      chunks.map(async (chunk) => {
        const data = await callLook(buildLookRequest(chunk, s), s);
        const answers = data.answers || {};
        chunk.forEach((v, idx) => {
          fresh[v.id] = lookVerdictFrom(answers, "v" + idx, s, (data.model || s.model) + " · image");
        });
      })
    );
    for (const r of results) {
      if (r.status !== "rejected") continue;
      error = String(r.reason?.message || r.reason);
      if (r.reason instanceof FreeTierError) lookPausedUntil = Date.now() + r.reason.retryAfterSec * 1000;
    }
    if (Object.keys(fresh).length) await writeCache(fresh, stamp, "i:");
    if (error) await chrome.storage.local.set({ lastError: { msg: "Images: " + error, at: Date.now() } });
  } catch (e) {
    console.warn("picture pass failed", e);
  } finally {
    items.forEach((v) => lookInFlight.delete(v.id));
  }

  // Every item gets an answer, since the tab is holding it blurred until it does. No picture
  // verdict falls back to the text one; a picture-only post whose request failed is let
  // through for now and asked about again later, and one with no usable picture just passes.
  const retryAt = Math.max(lookPausedUntil, Date.now() + 60_000);
  const push = {};
  for (const v of loaded) {
    const text = textVerdicts[v.id];
    if (fresh[v.id]) push[v.id] = combine(text, fresh[v.id]);
    else if (text) push[v.id] = text;
    else if (!v.imageData) push[v.id] = { tag: null, why: "", scores: {}, source: "image" };
    else push[v.id] = { tag: null, why: "", scores: {}, source: "image", provisional: true, retryAt };
  }
  await pushVerdicts(tabId, push);
}

/* -------------------------------------------------------------- test call */

async function handleTest(goals) {
  const s = await getSettings();
  if (goals !== undefined) s.goals = goals;
  if (!s.apiKey && !s.freeTier) return { ok: false, error: "No API key set, and the free tier is switched off." };

  const samples = [
    { id: "t0", platform: "youtube", title: "You WON'T BELIEVE what happened next 😱😱 (GONE WRONG)", author: "DramaDaily", duration: "18:02", meta: "2.1M views · 3 days ago" },
    { id: "t1", platform: "youtube", title: "Rust's ownership model explained with memory diagrams", author: "Systems Weekly", duration: "41:15", meta: "84K views · 1 month ago" },
    { id: "t2", platform: "youtube", title: "Make $5,000 a day with this FREE crypto airdrop bot", author: "Wealth Signals", duration: "6:44", meta: "12K views · 2 days ago" },
    { id: "t3", platform: "x", title: "99% of developers don't know these 7 VS Code tricks.\n\nThe 4th one will blow your mind 🤯🧵", author: "Dev Tips Daily @devtipsdaily · 3h", meta: "" },
    { id: "t4", platform: "linkedin", title: "I fired my best employee.\n\nHe was talented.\n\nBut he taught me something.\n\nHere's what happened next 👇\n\nAgree?", author: "Growth Coach", meta: "Helping founders 10x their mindset" },
  ];

  const t0 = Date.now();
  try {
    const data = await callJev(buildRequest(samples, s), s);
    const answers = data.answers || {};
    return {
      ok: true,
      ms: Date.now() - t0,
      model: data.model,
      usage: data.usage,
      rows: samples.map((v, i) => ({ title: v.title, ...verdictFrom(answers, "v" + i, s, data.model) })),
      look: s.lookAtImages ? await testLook(s) : undefined,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), ms: Date.now() - t0 };
  }
}

// One real thumbnail through the same route the feed uses, so a provider that can't take
// images shows up here rather than as silence on the page.
async function testLook(s) {
  const t0 = Date.now();
  const sample = {
    id: "t-img", platform: "youtube", title: "Rick Astley - Never Gonna Give You Up (Official Video)",
    author: "Rick Astley", duration: "3:33", meta: "1.6B views · 16 years ago",
    image: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  };
  const imageData = await loadImage(sample.image);
  if (!imageData) return { ok: false, error: "Couldn't load the sample thumbnail from i.ytimg.com." };
  try {
    const data = await callLook(buildLookRequest([{ ...sample, imageData }], s), s);
    return { ok: true, ms: Date.now() - t0, model: data.model, usage: data.usage, row: { title: sample.title, ...lookVerdictFrom(data.answers || {}, "v0", s, data.model) } };
  } catch (e) {
    return { ok: false, error: String(e.message || e), ms: Date.now() - t0 };
  }
}

/* ---------------------------------------------------- badge + habit loop */

// The badge counts what the filter is hiding on the tab it's shown for — product
// feedback in the one place the user already looks when they wonder about it.
function setBadge(tabId, n) {
  try {
    chrome.action.setBadgeText({ tabId, text: n > 0 ? String(Math.min(n, 999)) : "" });
  } catch { /* tab may have closed mid-flight */ }
}

try {
  chrome.action.setBadgeBackgroundColor({ color: "#16150f" });
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: "#c9f25d" });
  // A navigation resets the page count; the content script files a fresh one within a second.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "loading") setBadge(tabId, 0);
  });
} catch { /* no action badge in some embedders */ }

// Rolling tally of what got hidden, Monday to Monday UTC, plus an all-time total.
// The popup shows both; the toast and the badge make the filtering felt.
async function addHidden(n) {
  if (!n) return;
  const { stats } = await chrome.storage.local.get("stats");
  const monday = new Date(Date.now() - ((new Date().getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const cur = stats?.week === monday ? stats : { week: monday, hidden: 0, total: 0 };
  cur.hidden += n;
  cur.total = (cur.total || 0) + n;
  await chrome.storage.local.set({ stats: cur });
}

function openWelcome() {
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
}

/* ---------------------------------------------------------------- plumbing */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "judge") {
    handleJudge(msg.videos || [], sender.tab?.id)
      .then(sendResponse)
      .catch((e) => sendResponse({ verdicts: {}, error: String(e.message || e) }));
    return true;
  }
  if (msg?.type === "settings") {
    getSettings().then(sendResponse);
    return true;
  }
  if (msg?.type === "page") {
    // Content script's per-scan report: how many tiles are hidden on this tab right now,
    // and how many newly hidden ones should join the week's tally.
    if (sender.tab?.id != null) setBadge(sender.tab.id, msg.badge || 0);
    addHidden(msg.hidden || 0).catch(() => {});
    return false;
  }
  if (msg?.type === "openWelcome") {
    openWelcome();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "test") {
    handleTest(msg.goals).then(sendResponse);
    return true;
  }
  if (msg?.type === "clearCache") {
    chrome.storage.local
      .get(null)
      .then((all) => chrome.storage.local.remove(Object.keys(all).filter(isVerdictKey)))
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// "Blur until judged" became the default after installs had already saved it as off. Move
// them over once; the flag keeps a later "off" from being undone by the next update.
async function migrateBlurUntilJudged() {
  const { settings, blurUntilJudgedMigrated } = await chrome.storage.local.get(["settings", "blurUntilJudgedMigrated"]);
  if (blurUntilJudgedMigrated) return;
  await chrome.storage.local.set({
    blurUntilJudgedMigrated: true,
    ...(settings && { settings: { ...settings, hideUntilChecked: true } }),
  });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await migrateBlurUntilJudged();
  // The free tier no longer has a per-install daily limit: drop any pause or count left behind.
  if (reason === "update") await chrome.storage.local.remove(["freePausedUntil", "freeUsage"]);
  if (reason !== "install") return;
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
  // Onboarding, not a settings wall: pick a goal, then watch it work on a real feed.
  openWelcome();
});

// Exported for the offline shape test in test/validate.mjs. Unused at runtime.
export { buildRequest, verdictFrom, heuristicVerdict, buildLookRequest, toWire, lookVerdictFrom, combine, decisionsModel, migrateBlurUntilJudged, DEFAULT_SETTINGS };
