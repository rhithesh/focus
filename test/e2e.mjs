// End-to-end test with the real extension in real Chrome.
// Serves test/fixtures/*.html as www.youtube.com, x.com and www.linkedin.com over
// local HTTPS, loads the unpacked extension over CDP, then checks what gets
// blurred, that hover clears it, and that reloading the extension leaves no errors.
//
//   node test/e2e.mjs                         no key: the free tier, served by a local mock
//                                              (rate-limits the first call, then answers)
//   OPENROUTER_API_KEY=sk-or-... node test/e2e.mjs   your own key: live Jev verdicts
//
// Needs openssl on PATH for the throwaway certificate. Set CHROME=... to override the binary.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const KEY = process.env.OPENROUTER_API_KEY || "";
const PORT = 8443;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HOSTS = {
  "www.youtube.com": "youtube.html",
  "x.com": "x.html",
  "www.linkedin.com": "linkedin.html",
};

// What each fixture item should end up as. Items not listed must not be judged at all.
// Note: picture checks are on by default, so the YouTube "clean" video's bait
// thumbnail blurs it through the image pass.
const EXPECT = {
  "www.youtube.com": { bait: true, clean: true },
  "x.com": { bait: true, spam: true, clean: false, media: true, baitN: true, cleanN: false, quoteN: false, quoteInner: false },
  "www.linkedin.com": { bait: true, spam: true, clean: false },
};

const FREE_HOST = "feed-filter-two.vercel.app";
const freeCalls = [];
// The image pass loads pictures from these; here they get a 128px PNG, which the extension
// has to scale up to Jev's 280px minimum and re-encode as JPEG.
const IMAGE_HOSTS = ["i.ytimg.com", "pbs.twimg.com"];
const imageGets = [];
const lookCalls = [];
// Failure switches for the "blur until judged" checks.
let freeHangs = false;
let lookDelayMs = 0;

// Width and height from a baseline or progressive JPEG's SOF marker.
function jpegSize(buf) {
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// Stand-in for landing/src/app/api/jev/look: the clean video's thumbnail is bait, and the
// picture-only X post is a scam graphic.
async function freeLook(req, res, raw) {
  if (lookDelayMs) await sleep(lookDelayMs);
  const body = JSON.parse(raw);
  const answers = {};
  const sizes = [];
  for (const [k, item] of Object.entries(body.state.items)) {
    const url = item.image?.image_url?.url || "";
    sizes.push(url.startsWith("data:image/jpeg;base64,") ? jpegSize(Buffer.from(url.split(",")[1], "base64")) : null);
    answers[k + "_look"] = { score: /URL Shortener/.test(item.title || item.text || "") ? 2.9 : 0.3, confidence: 0.92 };
    answers[k + "_scam"] = { noul: item.text === "" ? 0.97 : 0.02 };
    if (k + "_goal" in body.questions) answers[k + "_goal"] = { score: 0.5, confidence: 0.9 };
  }
  lookCalls.push({ install: req.headers["x-feed-filter-install"], auth: req.headers.authorization, raw, sizes, body });
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ answers, model: "jev-look-mock" }));
}

// Stand-in for landing/src/app/api/jev: the first call doesn't fit in what's left (1 post),
// the rest get answers.
function freeTier(req, res, raw) {
  if (freeHangs) return; // accept the request and never answer
  const body = JSON.parse(raw);
  freeCalls.push({ install: req.headers["x-feed-filter-install"], auth: req.headers.authorization, items: Object.keys(body.state.items).length });
  if (freeCalls.length === 1) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "2" }).end(JSON.stringify({ error: "limit", scope: "install", limit: 300, remaining: 1, retryAfter: 2 }));
    return;
  }
  const answers = {};
  for (const [k, item] of Object.entries(body.state.items)) {
    const t = JSON.stringify(item);
    answers[k + "_bait"] = { score: /believe|99% of|fired my best/i.test(t) ? 3 : 0.2, confidence: 0.95 };
    answers[k + "_goal"] = { score: 0.5, confidence: 0.9 };
    answers[k + "_junk"] = { noul: /airdrop|passive income/i.test(t) ? 0.97 : 0.03 };
  }
  // Like the live server: no per-install allowance, so no allowance headers.
  res.writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ answers, model: "jev-free-mock" }));
}

const tmp = mkdtempSync(join(tmpdir(), "ygf-e2e-"));
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-keyout", join(tmp, "key.pem"), "-out", join(tmp, "cert.pem"),
  "-subj", "/CN=feed-filter-test", "-addext", "subjectAltName=" + [...Object.keys(HOSTS), FREE_HOST, ...IMAGE_HOSTS].map((h) => "DNS:" + h).join(","),
], { stdio: "ignore" });

const server = createServer({ key: readFileSync(join(tmp, "key.pem")), cert: readFileSync(join(tmp, "cert.pem")) }, async (req, res) => {
  if ((req.headers.host || "").startsWith(FREE_HOST) && req.url === "/api/jev" && req.method === "POST") {
    let raw = "";
    for await (const c of req) raw += c;
    return freeTier(req, res, raw);
  }
  if ((req.headers.host || "").startsWith(FREE_HOST) && req.url === "/api/jev/look" && req.method === "POST") {
    let raw = "";
    for await (const c of req) raw += c;
    return freeLook(req, res, raw);
  }
  if (IMAGE_HOSTS.some((h) => (req.headers.host || "").startsWith(h))) {
    // The page's own <img> loads land here too; only the extension's fetches carry its origin.
    if ((req.headers.origin || "").startsWith("chrome-extension://")) imageGets.push((req.headers.host || "").split(":")[0] + req.url);
    res.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" }).end(readFileSync(join(EXT, "icons", "icon128.png")));
    return;
  }
  const file = HOSTS[(req.headers.host || "").split(":")[0]];
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(join(HERE, "fixtures", file)));
}).listen(PORT, "127.0.0.1");

const chrome = spawn(CHROME, [
  "--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  // The test keeps several tabs open and hidden tabs must keep scanning on time.
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  "--user-data-dir=" + join(tmp, "profile"), "--no-first-run", "--window-size=1200,900",
  "--host-resolver-rules=" + [...Object.keys(HOSTS), FREE_HOST, ...IMAGE_HOSTS].map((h) => `MAP ${h}:443 127.0.0.1:${PORT}`).join(","),
  "--ignore-certificate-errors", "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

// CDP over the pipe: NUL-delimited JSON, flattened sessions.
const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
let nextId = 1, buf = "";
const waiters = new Map();
const events = [];
fromChrome.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\0")) >= 0) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id);
      waiters.delete(m.id);
      m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
    } else events.push(m);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = nextId++;
    waiters.set(id, { res, rej });
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }) + "\0");
  });
const evaluate = async (expression, sessionId) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

let fails = 0;
const check = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fails++;
};

async function openPage(url) {
  const { targetId } = await send("Target.createTarget", { url });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  return sessionId;
}

async function waitFor(expression, sessionId, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression, sessionId).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}

try {
  const { id: extId } = await send("Extensions.loadUnpacked", { path: EXT });
  await sleep(1000);

  const { targetInfos } = await send("Target.getTargets");
  const sw = targetInfos.find((t) => t.type === "service_worker" && t.url.includes(extId));
  const { sessionId: swSession } = await send("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
  await evaluate(`(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, apiKey: ${JSON.stringify(KEY)},
      goals: "Crack Google interview LeetCode, system design, programming and real tech news." } });
  })()`, swSession);
  console.log(KEY ? "mode: live Jev via OpenRouter" : "mode: free tier (local mock) — set OPENROUTER_API_KEY for live Jev");

  const pages = {};
  for (const [host, expected] of Object.entries(EXPECT)) {
    console.log("\n-- " + host + " --");
    const s = await openPage("https://" + host + "/");
    pages[host] = s;
    const flaggedIds = Object.entries(expected).filter(([, v]) => v).map(([k]) => k);
    const settled = await waitFor(
      `${JSON.stringify(flaggedIds)}.every((id) => document.querySelector("#" + id + " > .ygf-veil, #" + id + ".ygf-host > .ygf-veil"))`,
      s,
      KEY ? 20000 : 8000
    );
    if (!settled) console.log("  (timed out waiting for every expected blur)");
    for (const [id, shouldBlur] of Object.entries(expected)) {
      const blurred = await evaluate(`!!document.querySelector("#${id}").querySelector(".ygf-veil")`, s);
      check(blurred === shouldBlur, `${id}: ${shouldBlur ? "blurred" : "left alone"}`);
    }
    const siteClass = { "www.youtube.com": "ygf-host--youtube", "x.com": "ygf-host--x", "www.linkedin.com": "ygf-host--linkedin" }[host];
    check(await evaluate(`!!document.querySelector(".${siteClass}")`, s), `blurred items carry ${siteClass}`);
  }

  if (!KEY) {
    console.log("\n-- free tier (no key) --");
    check(freeCalls.length > 0, `the extension called the free tier (${freeCalls.length} calls)`);
    check(freeCalls.every((c) => /^[0-9a-f-]{36}$/.test(c.install || "")), "every call carries this install's id");
    check(freeCalls.every((c) => !c.auth), "no Authorization header is sent to the free tier");
    // First call was a 429: those items got keyword-rule stand-ins, then were asked again after Retry-After.
    const judged = await waitFor(`(async () => {
      const all = await chrome.storage.local.get(null);
      return Object.entries(all).filter(([k, v]) => k.startsWith("v:") && v.d?.source === "jev-free-mock").length >= 8;
    })()`, swSession, 15000);
    check(judged, "after the 429 and its Retry-After, all judged items were re-asked and cached from the free tier (11 items)");
    const st = await evaluate(`chrome.storage.local.get(["freeUsage", "freePausedUntil"])`, swSession);
    check(st.freePausedUntil > 0, "the 429 paused free calls (freePausedUntil was set)");
    check(!st.freeUsage, "once answers come back with no allowance headers (no daily limit), no allowance is tracked");
    check(freeCalls[0].items > 1 && freeCalls[1]?.items === 1,
      `after a batch didn't fit in the 1 post left, the next one asked about only 1 (${freeCalls[0].items} → ${freeCalls[1]?.items})`);
  }

  console.log("\n-- hover on x.com --");
  const xs = pages["x.com"];
  await send("Target.activateTarget", { targetId: (await send("Target.getTargets")).targetInfos.find((t) => t.url.startsWith("https://x.com")).targetId });
  const pt = await evaluate(`(() => { const b = document.querySelector("#bait").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`, xs);
  const veilOpacity = `getComputedStyle(document.querySelector("#bait > .ygf-veil")).opacity`;
  check((await evaluate(veilOpacity, xs)) === "1", "blur is on before hover");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, xs);
  await sleep(400);
  check((await evaluate(veilOpacity, xs)) === "0", "real mouse hover clears the blur");
  check((await evaluate(`getComputedStyle(document.querySelector("#bait > .ygf-veil")).pointerEvents`, xs)) === "none", "cleared blur lets clicks through");

  console.log("\n-- on-page switch --");
  const pillInfo = `(() => { const h = document.querySelector("[data-ygf-pill]"); if (!h) return null;
    const r = h.shadowRoot, b = r.querySelector("button").getBoundingClientRect();
    return { label: r.querySelector(".label").textContent, x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`;
  for (const [host, s] of Object.entries(pages)) {
    const p = await evaluate(pillInfo, s);
    check(p?.label === "Filter on", `${host}: switch is on the page and reads "${p?.label}"`);
  }
  const li = pages["www.linkedin.com"];
  await send("Target.activateTarget", { targetId: (await send("Target.getTargets")).targetInfos.find((t) => t.url.startsWith("https://www.linkedin.com")).targetId });
  const { data: pillShot } = await send("Page.captureScreenshot", { format: "png" }, li);
  writeFileSync("/tmp/ygf-pill-linkedin.png", Buffer.from(pillShot, "base64"));
  const lp = await evaluate(pillInfo, li);
  const clickAt = async (x, y, s) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }, s);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }, s);
  };
  await clickAt(lp.x, lp.y, li);
  await sleep(800);
  check((await evaluate(`document.querySelectorAll(".ygf-veil").length`, li)) === 0, "clicking it on LinkedIn clears LinkedIn's blur");
  check((await evaluate(`document.querySelectorAll(".ygf-veil").length`, xs)) === 0, "...and the X tab's too (one shared setting)");
  check((await evaluate(pillInfo, xs))?.label === "Filter off", "the X tab's switch now reads Filter off");
  check((await evaluate(`chrome.storage.local.get("settings").then((r) => r.settings.enabled)`, swSession)) === false, "enabled=false is what's stored");
  const lp2 = await evaluate(pillInfo, li);
  check(Math.abs(lp2.x - lp.x) < 1, "the switch doesn't move when it flips");
  await clickAt(lp2.x, lp2.y, li);
  check(await waitFor(`document.querySelectorAll(".ygf-veil").length > 0`, li, KEY ? 15000 : 6000), "clicking it again brings the blur back");

  if (!KEY) {
    console.log("\n-- image pass (thumbnails and post pictures) --");
    check(lookCalls.length > 0 && imageGets.length > 0, "picture checks are on by default, so pictures were loaded and judged");
    await evaluate(`chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, enabled: true, lookAtImages: true } }))`, swSession);
    const yt = pages["www.youtube.com"];
    check(await waitFor(`!!document.querySelector("#clean > .ygf-veil")`, yt, 15000), "YouTube: a clean title with a bait thumbnail gets blurred once its picture is judged");
    check(await evaluate(`!!document.querySelector("#bait > .ygf-veil")`, yt), "YouTube: the text-bait video stays blurred");
    check(await waitFor(`!!document.querySelector("#media > .ygf-veil")`, xs, 15000), "X: a picture-only post is now judged, and its scam graphic blurred");
    check(imageGets.some((u) => u === "i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg"), "YouTube thumbnails come from i.ytimg.com by video id");
    check(imageGets.some((u) => u.startsWith("pbs.twimg.com/media/") && u.includes("format=jpg") && u.includes("name=small")), "X pictures are asked for as small JPEGs (" + imageGets.find((u) => u.startsWith("pbs")) + ")");
    check(imageGets.length === new Set(imageGets).size, "each picture is loaded once");
    const sizes = lookCalls.flatMap((c) => c.sizes);
    check(sizes.length > 0 && sizes.every((d) => d && d.w >= 280 && d.h >= 280 && d.w <= 1568 && d.h <= 1568), "every picture reaches Jev as a JPEG within 280-1568px (" + sizes.map((d) => d && d.w + "x" + d.h).join(", ") + ")");
    check(lookCalls.every((c) => !/https?:\/\//.test(c.raw)), "no picture URL is sent, only the picture");
    check(lookCalls.every((c) => /^[0-9a-f-]{36}$/.test(c.install || "") && !c.auth), "image calls carry the install id and no Authorization header");
    check(lookCalls.every((c) => Object.keys(c.body.state.items).length <= 10), "at most 10 pictures per request");
    const cachedLooks = await evaluate(`chrome.storage.local.get(null).then((all) => Object.keys(all).filter((k) => k.startsWith("i:")))`, swSession);
    check(cachedLooks.includes("i:bbbbbbbbbbb") && cachedLooks.includes("i:x:1790000000000000004"), "picture verdicts are cached (" + cachedLooks.length + ")");
    const calls = lookCalls.length;
    await send("Page.reload", {}, yt);
    check(await waitFor(`!!document.querySelector("#clean > .ygf-veil")`, yt, 8000), "after a reload the cached picture verdict blurs straight away");
    check(lookCalls.length === calls, "...without asking Jev again");
  }

  if (!KEY) {
    console.log("\n-- blur until judged --");
    await send("Target.activateTarget", { targetId: (await send("Target.getTargets")).targetInfos.find((t) => t.url.startsWith("https://x.com")).targetId });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 }, xs);
    check((await evaluate(`chrome.storage.local.get("settings").then((r) => r.settings.hideUntilChecked)`, swSession)) === true, "blur until judged is on by default");

    // Adds a post and reports its blur in the same task, before anything could paint. Also records
    // whether the post is ever settled with no veil while it should only ever end up flagged.
    let nextPost = 1790000000000000100n;
    const addPost = (id, inner, testid) => evaluate(`(() => {
      const el = document.createElement("article");
      el.id = ${JSON.stringify(id)};
      ${testid ? `el.setAttribute("data-testid", "tweet");` : ""}
      el.innerHTML = ${JSON.stringify(inner)};
      window.__shownBare ||= {};
      new MutationObserver(() => {
        if (el.classList.contains("ygf-settled") && !el.querySelector(":scope > .ygf-veil")) window.__shownBare[el.id] = true;
      }).observe(el, { attributes: true, attributeFilter: ["class"], childList: true });
      document.querySelector("main").append(el);
      return getComputedStyle(el, "::after").backdropFilter;
    })()`, xs);
    const textPost = (text, extra = "") => `<a href="/author"><span>Some Author</span></a><a href="/author/status/${++nextPost}"><span>1h</span></a><div><span>${text}</span></div>${extra}`;
    const settled = (id) => `document.querySelector("#${id}").classList.contains("ygf-settled")`;
    const pendingBlur = (id) => evaluate(`getComputedStyle(document.querySelector("#${id}"), "::after").backdropFilter`, xs);
    const hasVeil = (id) => evaluate(`!!document.querySelector("#${id} > .ygf-veil")`, xs);

    const first = await addPost("p1", textPost("Notes on how we tune the Postgres vacuum."));
    check(first.includes("blur(16px)"), "a new post is blurred before anything could paint it (" + first + ")");
    check(await waitFor(settled("p1"), xs, 8000), "a clean post clears once it's judged");
    check((await pendingBlur("p1")) === "none" && !(await hasVeil("p1")), "...and nothing is left on it");

    const recycled = await evaluate(`(async () => {
      const el = document.querySelector("#p1");
      el.querySelector('a[href*="/status/"]').setAttribute("href", "/author/status/${++nextPost}");
      await Promise.resolve(); // past the observer's microtask, still before any paint
      return { settled: el.classList.contains("ygf-settled"), blur: getComputedStyle(el, "::after").backdropFilter };
    })()`, xs);
    check(!recycled.settled && recycled.blur.includes("blur"), "a recycled node showing a new post is blurred again before it paints");

    lookDelayMs = 4000;
    const picture = (name) => `<img alt="" src="https://pbs.twimg.com/media/${name}?format=webp" style="height:40px">`;
    await addPost("p2", textPost("Notes on the cache rollout.", picture("PendingClean")));
    await addPost("p3", textPost("Design a URL Shortener, my write-up.", picture("PendingBait")));
    await addPost("p4", `<div data-testid="User-Name"><a href="/author"><span>Some Author</span></a><a href="/author/status/${++nextPost}"><time>1h</time></a></div><div data-testid="tweetPhoto">${picture("PendingScam")}</div>`, true);
    const textDone = await waitFor(`(async () => {
      const all = await chrome.storage.local.get(null);
      return Object.values(all).filter((e) => /jev-free-mock$/.test(e?.d?.source || "")).length >= 12;
    })()`, swSession, 3000);
    await sleep(800);
    check(textDone && !(await evaluate(settled("p2"), xs)), "a clean title stays blurred while its picture is being judged");
    check(!(await evaluate(settled("p4"), xs)) && (await pendingBlur("p4")).includes("blur"), "a picture-only post stays blurred while its picture is being judged");
    check(await waitFor(settled("p2"), xs, 10000) && !(await hasVeil("p2")), "...and the clean picture then clears it");
    check(await waitFor(`${settled("p3")} && ${settled("p4")}`, xs, 10000) && (await hasVeil("p3")) && (await hasVeil("p4")), "bait and scam pictures end up flagged");
    const bare = await evaluate(`window.__shownBare`, xs);
    check(!bare.p3 && !bare.p4, "...without ever showing unblurred on the way (" + JSON.stringify(bare) + ")");
    lookDelayMs = 0;

    await addPost("p5", `<div><span>Promoted, with no permalink</span></div>`);
    check((await pendingBlur("p5")).includes("blur") && !(await evaluate(settled("p5"), xs)), "a post with nothing to judge starts out blurred");
    check(await waitFor(settled("p5"), xs, 6000), "...and is let through after a few seconds");

    freeHangs = true;
    const hungAt = Date.now();
    await addPost("p6", textPost("Plain notes while the model hangs."));
    await sleep(4000);
    check(!(await evaluate(settled("p6"), xs)), "a hung model request keeps the post blurred for now");
    check(await waitFor(settled("p6"), xs, 16000), `...then times out and keyword rules clear it (${Math.round((Date.now() - hungAt) / 1000)}s)`);
    freeHangs = false;
  }

  console.log("\n-- extension reloaded under open tabs --");
  send("Runtime.evaluate", { expression: "chrome.runtime.reload()" }, swSession).catch(() => {});
  await sleep(3000);
  for (const [host, s] of Object.entries(pages)) {
    const left = await evaluate(`document.querySelectorAll(".ygf-veil").length`, s);
    check(left === 0, `${host}: orphaned tab clears its blur (${left} left)`);
    check(!(await evaluate(`!!document.querySelector("[data-ygf-pill]")`, s)), `${host}: orphaned tab removes its switch`);
    check(!(await evaluate(`document.documentElement.classList.contains("ygf-guard")`, s)), `${host}: orphaned tab drops the pending blur`);
  }
  const pageSessions = new Set(Object.values(pages));
  const errors = events.filter((e) => e.method === "Runtime.exceptionThrown" && pageSessions.has(e.sessionId));
  check(errors.length === 0, "no uncaught errors in any tab" + (errors.length ? ": " + errors[0].params.exceptionDetails.exception?.description : ""));
} catch (e) {
  console.error("e2e failed:", e.message);
  fails++;
} finally {
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await Promise.race([exited, sleep(3000)]);
  server.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
