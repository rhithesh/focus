const $ = (s) => document.querySelector(s);

let settings = null;

async function init() {
  settings = (await chrome.storage.local.get("settings")).settings || {};
  $("#enabled").checked = !!settings.enabled;
  showState(!!settings.enabled);

  if (!settings.onboarded) {
    $("#goals").textContent = "Pick a goal so the filter knows what your feeds are for.";
    $("#open").textContent = "Pick your goal →";
  } else {
    $("#goals").textContent = settings.goals?.trim() || "No goals — hiding obvious bait, spam and slop.";
  }

  const { lastError, freeUsage, freePausedUntil } = await chrome.storage.local.get(["lastError", "freeUsage", "freePausedUntil"]);
  const recentError = lastError && Date.now() - lastError.at < 10 * 60 * 1000;
  if (!settings.apiKey && settings.freeTier === false) {
    show(settings.fallbackHeuristics
      ? "No API key and the free tier is off: keyword rules only."
      : "No API key and the free tier is off. Nothing is being filtered.");
  } else if (!settings.apiKey) {
    const today = new Date().toISOString().slice(0, 10);
    const usedToday = freeUsage && new Date(freeUsage.at).toISOString().slice(0, 10) === today;
    const reset = new Date(today + "T00:00:00Z").getTime() + 864e5;
    const at = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (usedToday && freeUsage.remaining === 0)
      show(`Free tier used up for today: keyword rules only until ${at(reset)}.`);
    else if (freePausedUntil && Date.now() < freePausedUntil && recentError) show(lastError.msg);
    else if (usedToday)
      showNote(`Free tier · ${freeUsage.remaining} of ${freeUsage.limit} posts left today.`);
    else showNote("Free · no daily limit.");
  } else if (recentError) {
    show(lastError.msg);
  }

  const week = (await chrome.storage.local.get("stats")).stats;
  const n = week?.hidden || 0;
  $("#weekN").textContent = n.toLocaleString();
  if (week?.total > 0) {
    const t = $("#totalN");
    t.hidden = false;
    t.textContent = "all time " + week.total.toLocaleString();
  }

  // tab.url is hidden without the "tabs" permission, so ask the tab directly;
  // only a YouTube, X or LinkedIn tab has a content script to answer.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "stats" }, (res) => {
    if (chrome.runtime.lastError || !res) {
      show("Not filtering this tab. On YouTube, X or LinkedIn? Reload the page.");
      return;
    }
    $("#blocked").textContent = res.blocked;
    $("#judged").textContent = res.judged;
  });
}

function showState(on) {
  const em = document.createElement("em");
  em.textContent = on ? "on" : "off";
  $("#state").replaceChildren("Filter ", em);
}

function showNote(msg) {
  const el = $("#note");
  el.hidden = false;
  el.textContent = msg;
}

function show(msg) {
  const el = $("#warn");
  el.hidden = false;
  el.textContent = el.textContent ? el.textContent + " " + msg : msg;
}

// Single hop, no preceding await: the popup gets torn down the instant it loses
// focus, so a change handler that awaits anything before writing can lose the
// write entirely if the user clicks away right after toggling.
$("#enabled").addEventListener("change", (e) => {
  settings.enabled = e.target.checked;
  chrome.storage.local.set({ settings });
  showState(e.target.checked);
});

// Un-onboarded installs land on the welcome page; everyone else gets the full settings.
$("#open").addEventListener("click", () => {
  if (!settings?.onboarded) {
    try { chrome.runtime.sendMessage({ type: "openWelcome" }); } catch {}
    return;
  }
  chrome.runtime.openOptionsPage();
});

init();
