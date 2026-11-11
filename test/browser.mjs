// Browser test. Loads the real content.js against fake YouTube tiles, then drives
// real pointer input over the Chrome DevTools Protocol to verify that hovering a
// flagged tile clears the blur and lets the click reach the video.
// Node 24 ships a global WebSocket, so this needs no dependencies.
//   node test/browser.mjs   (set CHROME=... to override the binary)

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const PAGE = "file://" + join(HERE, "dom.html");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/ygf-cdp-profile",
  "--window-size=1100,760", PAGE,
], { stdio: "ignore" });

let ws, nextId = 1;
const waiters = new Map();
const uncaught = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => waiters.set(id, { res, rej }));
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
}

async function shot(path) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path, Buffer.from(data, "base64"));
}

try {
  // wait for the debugging endpoint, then find our page target
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(100);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.url.startsWith("file://"));
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Chrome never exposed a page target on :" + PORT);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id); waiters.delete(m.id);
      m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      uncaught.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");

  // let content.js scan and the in-page structural checks finish. On a cold start the
  // target shows up before the page's scripts have run, so wait for them to exist first.
  for (let i = 0; i < 100 && !(await evaluate("!!window.__ready")); i++) await sleep(100);
  await evaluate("window.__ready");

  const rect = await evaluate(`(() => {
    const r = document.querySelector("#tileA .thumb").getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  const read = () => evaluate(`(() => {
    const v = document.querySelector("#tileA .ygf-veil");
    const s = getComputedStyle(v);
    return {
      opacity: s.opacity,
      pointerEvents: s.pointerEvents,
      hovered: document.querySelector("#tileA").matches(":hover"),
      navigated: window.__navigated,
      topEl: (document.elementFromPoint(${rect.x}, ${rect.y}) || {}).className || "",
    };
  })()`);

  const before = await read();
  await shot("/tmp/ygf-before.png");

  // real pointer movement
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, buttons: 0 });
  await sleep(400); // let the 0.18s transition settle
  const after = await read();
  await shot("/tmp/ygf-after.png");

  // and a real click at the same spot
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(150);
  const clicked = await read();

  const checks = [
    [before.opacity === "1", "before hover: veil is opaque"],
    [before.pointerEvents === "auto", "before hover: veil takes pointer events"],
    [before.topEl.includes("ygf-veil"), "before hover: veil is the topmost element over the thumbnail"],
    [after.hovered === true, "real mouse move puts the tile in :hover"],
    [after.opacity === "0", "on hover: veil fades to transparent (blur gone)"],
    [after.pointerEvents === "none", "on hover: veil stops taking pointer events"],
    [!after.topEl.includes("ygf-veil"), "on hover: the video link is topmost again"],
    [clicked.navigated === "/watch?v=aaaaaaaaaaa", "clicking a hovered tile reaches the video link"],
  ];

  // toggle the extension off the way the popup does (a storage write + onChanged)
  // and confirm every veil actually clears, not just stops re-applying.
  await evaluate("window.__setEnabled(false)");
  await sleep(200);
  const offState = await evaluate(`(() => ({
    veils: document.querySelectorAll(".ygf-veil").length,
    hosts: document.querySelectorAll(".ygf-host").length,
  }))()`);

  const toggleChecks = [
    [offState.veils === 0, "turning the toggle off clears every veil — got " + offState.veils + " remaining"],
    [offState.hosts === 0, "turning the toggle off clears the ygf-host marker — got " + offState.hosts + " remaining"],
  ];

  // The on-page switch: a real mouse click on it must do what the popup does.
  const pillState = () => evaluate(`(() => {
    const h = document.querySelector("[data-ygf-pill]");
    if (!h) return null;
    const r = h.shadowRoot, btn = r.querySelector("button"), b = btn.getBoundingClientRect();
    const l = r.querySelector(".label").getBoundingClientRect(), p = h.getBoundingClientRect();
    const count = r.querySelector(".count");
    return { label: r.querySelector(".label").textContent, count: count.hidden ? "" : count.textContent,
      checked: btn.getAttribute("aria-checked"), bx: b.x + b.width / 2, by: b.y + b.height / 2,
      lx: l.x + 8, ly: l.y + l.height / 2, px: Math.round(p.x), py: Math.round(p.y),
      enabled: window.__settings().enabled, veils: document.querySelectorAll(".ygf-veil").length };
  })()`);
  const click = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  };

  await evaluate("window.__setEnabled(true)");
  await sleep(700);
  const pOn = await pillState();
  await click(pOn.bx, pOn.by);
  await sleep(300);
  const pOff = await pillState();
  await click(pOff.bx, pOff.by);
  await sleep(700);
  const pBack = await pillState();

  // drag it by the label: it should move, remember where, and not flip the filter
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pBack.lx, y: pBack.ly, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pBack.lx + i * 25, y: pBack.ly - i * 20, button: "left", buttons: 1 });
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pBack.lx + 200, y: pBack.ly - 160, button: "left", buttons: 0, clickCount: 1 });
  await sleep(300);
  const pMoved = await pillState();
  const savedPos = await evaluate("chrome.storage.local._store.pillPos || null");

  await evaluate(`window.__setSetting("showPagePill", false)`);
  await sleep(300);
  const pHidden = await pillState();
  await evaluate(`window.__setSetting("showPagePill", true)`);
  await sleep(300);
  const pShown = await pillState();

  const pillChecks = [
    [pOn && pOn.checked === "true" && pOn.label === "Filter on", "switch is on the page and reads Filter on"],
    [pOn && /^\d+ blurred$/.test(pOn.count) && pOn.count !== "0 blurred", "switch shows the blurred count — got " + pOn?.count],
    [pOff.checked === "false" && pOff.label === "Filter off", "clicking the switch flips it off"],
    [pOff.enabled === false, "clicking it writes enabled=false to storage, like the popup"],
    [pOff.veils === 0, "clicking it off clears every veil — got " + pOff.veils],
    [pBack.enabled === true && pBack.veils > 0, "clicking it on again brings the blur back — got " + pBack.veils + " veils"],
    [Math.abs(pMoved.px - pBack.px) > 100 && pMoved.py < pBack.py - 80, `dragging moves it (${pBack.px},${pBack.py} → ${pMoved.px},${pMoved.py})`],
    [pMoved.enabled === true && pMoved.checked === "true", "a drag does not flip the filter"],
    [savedPos && savedPos.fx > 0 && savedPos.fy < 1, "the dragged position is saved — got " + JSON.stringify(savedPos)],
    [pHidden === null, "turning the option off removes the switch from the page"],
    [pShown && Math.abs(pShown.px - pMoved.px) <= 1, "turning it back on restores it where it was dragged"],
  ];

  // Blur until judged, against a service worker that fails and one that never answers.
  const addTile = (id) => evaluate(`(() => {
    const el = document.createElement("ytd-rich-item-renderer");
    el.id = "t${id}";
    el.innerHTML = '<a id="thumbnail" href="/watch?v=${id}"><span class="thumb"></span></a><h3><a id="video-title-link" href="/watch?v=${id}"><span id="video-title">Another video</span></a></h3>';
    document.querySelector("#tiles").appendChild(el);
    return getComputedStyle(el, "::after").backdropFilter;
  })()`);
  const isSettled = (id) => evaluate(`document.querySelector("#t${id}").classList.contains("ygf-settled")`);
  const calls = () => evaluate("window.__judgeCalls");

  // The worker fails first, so tiles are still waiting when the toast is looked at.
  await evaluate(`window.__judgeCallsBefore = window.__judgeCalls; window.__judgeMode = "fail"`);
  await evaluate(`window.__setSetting("hideUntilChecked", true)`);
  await sleep(1000);
  const toasts = await evaluate(`[...document.querySelectorAll("[data-ygf-toast]")].filter((h) => h.shadowRoot.querySelector(".toast.in")).map((h) => h.shadowRoot.textContent.includes("Checking"))`);
  const failBlur = await addTile("eeeeeeeeeee");
  const failStart = await evaluate("window.__judgeCallsBefore");
  await sleep(1400);
  const failFirst = await calls();
  const failHeld = !(await isSettled("eeeeeeeeeee"));
  await sleep(1400);
  const failSame = await calls();
  await sleep(3000);
  const failRetried = await calls();
  await evaluate(`window.__judgeMode = "normal"`);
  await sleep(6000);
  const failRecovered = await isSettled("eeeeeeeeeee");

  await evaluate(`window.__judgeMode = "hang"`);
  await addTile("fffffffffff");
  await sleep(4000);
  const hangHeld = !(await isSettled("fffffffffff"));
  await sleep(19500); // 20s deadline, noticed by a scan up to 1.5s later
  const hangReleased = await isSettled("fffffffffff");
  await evaluate(`window.__judgeMode = "normal"`);

  await evaluate("window.__setEnabled(false)");
  await sleep(300);
  await addTile("ggggggggggg");
  const offBlur = await evaluate(`getComputedStyle(document.querySelector("#tggggggggggg"), "::after").backdropFilter`);
  await evaluate("window.__setEnabled(true)");
  await sleep(700);
  await evaluate(`window.__setSetting("hideUntilChecked", false)`);
  await sleep(300);
  await addTile("hhhhhhhhhhh");
  const optionOffBlur = await evaluate(`getComputedStyle(document.querySelector("#thhhhhhhhhhh"), "::after").backdropFilter`);

  const guardChecks = [
    [failBlur.includes("blur(16px)"), "a new tile is blurred before anything could paint it — got " + failBlur],
    [toasts.length === 1 && toasts[0], "only the checking toast is showing — got " + JSON.stringify(toasts)],
    [failFirst > failStart && failHeld, "a failed request leaves the tile blurred for now"],
    [failSame === failFirst, `...and doesn't re-ask on every scan (${failFirst} → ${failSame})`],
    [failRetried > failSame, `...then asks again (${failSame} → ${failRetried})`],
    [failRecovered, "once the worker is back, the tile clears"],
    [hangHeld, "a request that never returns holds the tile blurred for now"],
    [hangReleased, "...and the deadline lets it through"],
    [offBlur === "none", "with the filter off, new tiles aren't blurred — got " + offBlur],
    [optionOffBlur === "none", "with the option off, new tiles aren't blurred — got " + optionOffBlur],
  ];
  for (const [c] of guardChecks) if (!c) process.exitCode = 1;

  // Simulate the extension being reloaded/updated out from under this already-open
  // tab, then feed it a brand-new tile so it tries (and fails) to reach the
  // now-severed background. The old bug: this threw "Extension context
  // invalidated" as an uncaught error instead of failing quietly.
  await evaluate("window.__invalidate()");
  await evaluate(`(() => {
    const el = document.createElement("ytd-rich-item-renderer");
    el.innerHTML =
      '<a id="thumbnail" href="/watch?v=ddddddddddd"><span class="thumb"></span></a>' +
      '<h3><a id="video-title-link" href="/watch?v=ddddddddddd"><span id="video-title">A video that appears after reload</span></a></h3>' +
      '<ytd-channel-name><a href="#">Some Channel</a></ytd-channel-name>';
    document.querySelector("#tiles").appendChild(el);
  })()`);
  await sleep(2200); // past the 1.5s safety-net interval + 400ms flush debounce

  const orphanVeils = await evaluate(`document.querySelectorAll(".ygf-veil").length`);
  const orphanPill = await evaluate(`!!document.querySelector("[data-ygf-pill]")`);
  const invalidationChecks = [
    [uncaught.length === 0, "no uncaught errors after the extension is invalidated — got: " + JSON.stringify(uncaught)],
    [orphanVeils === 0, "an orphaned tab clears its own blur — got " + orphanVeils + " veils left"],
    [!orphanPill, "an orphaned tab removes the on-page switch too"],
  ];

  const extra = ["", "-- real pointer input over CDP --",
    ...checks.map(([c, m]) => (c ? "  PASS  " : "  FAIL  ") + m),
    "", "-- toggling off --",
    ...toggleChecks.map(([c, m]) => (c ? "  PASS  " : "  FAIL  ") + m),
    "", "-- on-page switch --",
    ...pillChecks.map(([c, m]) => (c ? "  PASS  " : "  FAIL  ") + m),
    "", "-- blur until judged --",
    ...guardChecks.map(([c, m]) => (c ? "  PASS  " : "  FAIL  ") + m),
    "", "-- extension invalidated mid-session --",
    ...invalidationChecks.map(([c, m]) => (c ? "  PASS  " : "  FAIL  ") + m)];
  for (const [c, m] of checks) if (!c) process.exitCode = 1;
  for (const [c, m] of toggleChecks) if (!c) process.exitCode = 1;
  for (const [c, m] of invalidationChecks) if (!c) process.exitCode = 1;
  for (const [c, m] of pillChecks) if (!c) process.exitCode = 1;

  const fails = await evaluate(`window.__report(${JSON.stringify(extra)})`);
  console.log(await evaluate(`document.getElementById("results").textContent`));
  if (fails) process.exitCode = 1;
  console.log("\nscreenshots: /tmp/ygf-before.png (blurred)  /tmp/ygf-after.png (hovered)");
} catch (e) {
  console.error("hover test failed:", e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
}
