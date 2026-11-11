// Offline checks: request body matches the documented System One schema and
// verdict thresholds behave. No network, no API key.
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
  runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} }, openOptionsPage() {} },
};

const { buildRequest, verdictFrom, heuristicVerdict, buildLookRequest, toWire, lookVerdictFrom, combine, decisionsModel, migrateBlurUntilJudged, DEFAULT_SETTINGS } =
  await import("../background.js");

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) fails++; };

const s = { ...DEFAULT_SETTINGS, goals: "Systems programming and AI research. No drama, no reactions." };
const videos = [
  { id: "aaaaaaaaaaa", platform: "youtube", title: "You WON'T BELIEVE this 😱😱", author: "Drama", duration: "18:02", meta: "2.1M views", isShort: false },
  { id: "bbbbbbbbbbb", platform: "youtube", title: "Rust ownership, explained", author: "Systems Weekly", duration: "41:15", meta: "84K views", isShort: false },
  { id: "x:1790000000000000001", platform: "x", title: "Wrote up how we shard Postgres by tenant.", author: "Priya @priya_builds", meta: "" },
  { id: "li:urn:li:activity:7200000000000000001", platform: "linkedin", title: "I fired my best employee.\n\nHere's what happened next.\n\nAgree?", author: "Growth Coach", meta: "" },
];
const body = buildRequest(videos, s);

console.log("\n-- request shape --");
ok(typeof body.model === "string", "model is a string");
ok(body.state && typeof body.state === "object", "state is an object");
ok(Object.keys(body.state.items).join() === "v0,v1,v2,v3", "state.items keyed v0..vN");
ok(Object.keys(body.questions).length === videos.length * 3, "3 questions per item (" + Object.keys(body.questions).length + ")");
ok(body.state.items.v0.platform === "YouTube" && body.state.items.v0.title && body.state.items.v0.channel === "Drama", "YouTube item carries title + channel");
ok(body.state.items.v2.platform === "X (Twitter)" && body.state.items.v2.text && !body.state.items.v2.duration, "X item carries post text, no video fields");
ok(body.state.items.v3.platform === "LinkedIn" && body.state.items.v3.text.includes("Agree?"), "LinkedIn item carries post text");

for (const [key, q] of Object.entries(body.questions)) {
  const t = q.type;
  ok(["noul", "choice", "score"].includes(t), key + ": type is a documented primitive (" + t + ")");
  ok(q.instructions !== undefined, key + ": has instructions");
  if (t === "score") ok(Array.isArray(q.criteria) && q.criteria.length >= 2 && q.criteria.length <= 10, key + ": score criteria is an ordered array of 2-10 levels");
  if (t === "noul") ok(q.criteria && "true" in q.criteria && "false" in q.criteria, key + ": noul criteria has true/false");
  const ref = q.instructions.question.match(/`(items\.v\d+)`/);
  ok(!!ref && body.state[ref[1].split(".")[0]][ref[1].split(".")[1]], key + ": backtick ref resolves into state");
}

const tokens = Math.round(JSON.stringify(body).length / 4);
console.log("\n  ~" + tokens + " est. input tokens for " + videos.length + " listings" +
  " (~" + Math.round((tokens / videos.length) * 20) + " for a 20-listing batch, $" +
  ((tokens / videos.length) * 20 * 0.042 / 1e6).toFixed(6) + ")");

console.log("\n-- verdicts --");
const answers = {
  v0_bait: { type: "score", score: 2.8, confidence: 0.94 },
  v0_goal: { type: "score", score: 3.0, confidence: 0.9 },
  v0_junk: { type: "noul", noul: 0.2 },
  v1_bait: { type: "score", score: 0.2, confidence: 0.97 },
  v1_goal: { type: "score", score: 0.1, confidence: 0.95 },
  v1_junk: { type: "noul", noul: 0.01 },
};
ok(verdictFrom(answers, "v0", s, "m").tag === "CLICK-BAIT", "high bait + high confidence -> CLICK-BAIT");
ok(verdictFrom(answers, "v1", s, "m").tag === null, "clean listing -> allowed");

const lowConf = { ...answers, v0_bait: { score: 2.8, confidence: 0.2 }, v0_goal: { score: 3.0, confidence: 0.2 } };
ok(verdictFrom(lowConf, "v0", s, "m").tag === null, "high score + low confidence -> fails open");

const spam = { v0_bait: { score: 1, confidence: 0.9 }, v0_goal: { score: 1, confidence: 0.9 }, v0_junk: { noul: 0.93 } };
ok(verdictFrom(spam, "v0", s, "m").tag === "SPAM", "high spam probability -> SPAM (outranks bait)");

const noGoals = { ...s, goals: "" };
const offGoalOnly = { v0_bait: { score: 0.1, confidence: 0.9 }, v0_goal: { score: 3.0, confidence: 0.9 }, v0_junk: { noul: 0 } };
ok(verdictFrom(offGoalOnly, "v0", noGoals, "m").tag === null, "no goals written -> off-goal never fires");
ok(verdictFrom(offGoalOnly, "v0", s, "m").tag === "OFF-GOAL", "goals written -> off-goal fires");

console.log("\n-- heuristic fallback --");
ok(heuristicVerdict(videos[0], s).tag === "CLICK-BAIT", "keyword+emoji title -> CLICK-BAIT");
ok(heuristicVerdict(videos[1], s).tag === null, "clean title -> allowed");
ok(heuristicVerdict({ title: "Make $5000 a day with this FREE crypto airdrop" }, s).tag === "SPAM", "scam title -> SPAM");

ok(heuristicVerdict(videos[3], s).tag === "CLICK-BAIT", "LinkedIn broetry ending in 'Agree?' -> CLICK-BAIT");
ok(heuristicVerdict(videos[2], s).tag === null, "plain technical X post -> allowed");
ok(heuristicVerdict({ title: "99% of developers don't know these VS Code tricks. The 4th one will blow your mind 🤯🧵" }, s).tag === "CLICK-BAIT", "X thread bait -> CLICK-BAIT");

console.log("\n-- blur until judged --");
ok(DEFAULT_SETTINGS.hideUntilChecked === true, "on by default");
{
  const store = { settings: { goals: "keep me", hideUntilChecked: false } };
  const realLocal = chrome.storage.local;
  chrome.storage.local = {
    get: async (keys) => Object.fromEntries(keys.map((k) => [k, store[k]])),
    set: async (patch) => void Object.assign(store, patch),
  };
  await migrateBlurUntilJudged();
  ok(store.settings.hideUntilChecked === true && store.settings.goals === "keep me", "an install that saved it as off is moved over, other settings intact");
  store.settings.hideUntilChecked = false;
  await migrateBlurUntilJudged();
  ok(store.settings.hideUntilChecked === false, "turning it off afterwards survives the next update");
  delete store.settings;
  delete store.blurUntilJudgedMigrated;
  await migrateBlurUntilJudged();
  ok(store.blurUntilJudgedMigrated === true && !store.settings, "a fresh install is marked, with no settings written");
  chrome.storage.local = realLocal;
}

console.log("\n-- image pass --");
ok(DEFAULT_SETTINGS.lookAtImages === true, "image pass is on by default (picture judging catches bait thumbnails and scam graphics)");
const pics = [
  { ...videos[0], imageData: "AAAA" },
  { id: "x:1790000000000000009", platform: "x", title: "", author: "Photo Account", meta: "", imageData: "BBBB" },
];
const look = buildLookRequest(pics, s);
const refs = Object.keys(look.images);
ok(refs.length === 2 && refs.every((r) => /^img-[0-9a-f-]{36}$/.test(r)), "one fresh UUID reference per picture");
ok(look.state.items.v0.image === refs[0] && look.state.items.v0.title === videos[0].title, "picture sits next to the item's own title");
ok(look.questions.v0_look?.type === "score" && look.questions.v0_scam?.type === "noul" && !look.questions.v0_goal, "titled item: look + scam, no goal question (text pass covers it)");
ok(look.questions.v1_goal?.type === "score", "picture-only post also gets a goal question");
ok(!JSON.stringify(look).includes("https://"), "no image URL leaves the browser");

const assets = toWire(look, "assets");
ok(assets.assets[refs[0]].data_base64 === "AAAA" && assets.assets[refs[0]].format === "jpg" && assets.state.items.v0.image === refs[0], "TypeSafe direct: assets map keyed by the reference in state");
ok(!("images" in assets), "TypeSafe direct: no stray images field");
const dec = toWire(look, "decisions");
ok(dec.state.items.v1.image.type === "image_url" && dec.state.items.v1.image.image_url.url === "data:image/jpeg;base64,BBBB", "OpenRouter Decisions: data-URL image part in place of the reference");
ok(!("images" in dec) && !("assets" in dec) && !JSON.stringify(dec).includes("img-"), "OpenRouter Decisions: no references or assets left over");
ok(look.state.items.v0.image === refs[0], "toWire leaves the built request untouched");
ok(decisionsModel("jev-latest") === "~typesafe/jev-latest" && decisionsModel("jev-1.14.0") === "typesafe/jev-1.14" && decisionsModel("typesafe/jev-1.13") === "typesafe/jev-1.13", "model names mapped for the Decisions route");

const lookAns = {
  v0_look: { score: 2.6, confidence: 0.8 }, v0_scam: { noul: 0.1 },
  v1_look: { score: 0.3, confidence: 0.9 }, v1_scam: { noul: 0.95 }, v1_goal: { score: 0.2, confidence: 0.9 },
  v2_look: { score: 2.9, confidence: 0.2 }, v2_scam: { noul: 0.1 },
};
ok(lookVerdictFrom(lookAns, "v0", s, "m").tag === "CLICK-BAIT", "bait thumbnail + confidence -> CLICK-BAIT");
ok(lookVerdictFrom(lookAns, "v1", s, "m").tag === "SPAM", "scam graphic -> SPAM");
ok(lookVerdictFrom(lookAns, "v2", s, "m").tag === null, "bait thumbnail, low confidence -> fails open");

const textOk = { tag: null, why: "", scores: { bait: 0.2 }, source: "jev" };
const textBait = { tag: "CLICK-BAIT", why: "bait", scores: { bait: 2.8 }, source: "jev" };
const picBait = lookVerdictFrom(lookAns, "v0", s, "m");
const picOk = { tag: null, why: "", scores: { look: 0.1 }, source: "m" };
ok(combine(textOk, picBait).tag === "CLICK-BAIT" && combine(textOk, picBait).scores.bait === 0.2, "picture can add a blur, and keeps the text scores");
ok(combine(textBait, picOk).tag === "CLICK-BAIT" && combine(textBait, picOk).why === "bait", "picture never lifts a text blur");
ok(combine(undefined, picBait) === picBait && combine(textOk, undefined) === textOk, "either side missing -> the other stands");

console.log(fails ? "\n" + fails + " FAILED\n" : "\nall checks passed\n");
process.exit(fails ? 1 : 0);
