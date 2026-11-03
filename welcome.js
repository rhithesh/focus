// Feed Filter — first-run page. One decision, then straight to a real feed.
// Presets exist because a blank textarea is where installs die: nobody writes
// a good goal cold, and without a goal the product only half-shows up.

const PRESETS = [
  {
    key: "code",
    title: "Learning to code",
    desc: "Deep technical videos — language internals, systems, real projects.",
    goals:
      "I'm teaching myself software engineering. I want deep, technical videos: language internals, databases, distributed systems, and real projects I can follow along with. I do NOT want 'learn X in 24 hours' bait, crypto pitches, hustle-bro productivity content, drama, or reaction videos.",
  },
  {
    key: "career",
    title: "Interview & career prep",
    desc: "Algorithms, system design, real engineering culture.",
    goals:
      "I'm preparing for engineering interviews and growing my career: algorithms, system design, salary negotiation, and honest looks at engineering culture. I do NOT want 1%-mindset grind content, fake recruiter tips, vague motivation loops, or AI-written career filler.",
  },
  {
    key: "fitness",
    title: "Getting strong",
    desc: "Lifting technique, programming, evidence-based nutrition.",
    goals:
      "I train for strength. I want lifting technique, sensible programming, evidence-based nutrition and mobility work. I do NOT want miracle supplements, 'one weird trick' transformation bait, fake-natty outrage, or fitness drama.",
  },
  {
    key: "cooking",
    title: "Cooking, seriously",
    desc: "Technique breakdowns and weeknight-proof recipes.",
    goals:
      "I want to actually cook better: technique breakdowns, recipes I can make on a weeknight, food science done honestly. I do NOT want reaction videos, mukbangs, restaurant outrage bait, or 'celebrity chef loses it' gossip.",
  },
  {
    key: "ai",
    title: "AI & ML, not the hype",
    desc: "Papers, model internals, real implementations.",
    goals:
      "I follow AI research and engineering seriously: paper walkthroughs, model internals, benchmarks done right, and real implementations. I do NOT want hype thinkpieces, 'AGI is imminent' slop, influencer commentary, or generated filler about models neither of us has run.",
  },
  {
    key: "music",
    title: "Music practice",
    desc: "Technique lessons and real gear demos.",
    goals:
      "I play an instrument and I'm working to get better: technique lessons, full songs at practice tempo, and gear demos that actually demo the gear. I do NOT want 'top 10 shredders' lists, band drama, reaction compilations, or clickbait covers.",
  },
];

const $ = (s) => document.querySelector(s);

let selected = null; // preset key, or "custom" once the textarea is open
const state = { goals: "" };

function refresh() {
  for (const btn of document.querySelectorAll(".preset")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.key === selected));
  }

  // Custom text beats a preset when it has something in it.
  const custom = $("#goals").value.trim();
  state.goals = custom || (selected !== "custom" ? PRESETS.find((p) => p.key === selected)?.goals || "" : "");
  $("#go").disabled = !state.goals;
}

for (const p of PRESETS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "preset";
  btn.dataset.key = p.key;
  btn.append(Object.assign(document.createElement("b"), { textContent: p.title }),
             Object.assign(document.createElement("span"), { textContent: p.desc }));
  btn.addEventListener("click", () => { selected = p.key; refresh(); });
  $("#presets").append(btn);
}

$("#customToggle").addEventListener("click", () => {
  const on = $("#customBody").hidden;
  $("#customBody").hidden = !on;
  $("#customToggle").textContent = on ? "Use a preset instead ←" : "Or write your own →";
  if (on) { $("#goals").focus(); selected = "custom"; }
  refresh();
});

$("#goals").addEventListener("input", () => { selected = "custom"; refresh(); });

// Save and jump to a live feed — closing this tab so the user lands in one clean window.
// The skip path (#skip) just pre-fills "no goals", so one handler serves both.
async function go() {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: { ...(settings || {}), goals: state.goals, onboarded: true },
  });
  chrome.tabs.create({ url: "https://www.youtube.com/" });
  window.close();
}
$("#go").addEventListener("click", go);
$("#skip").addEventListener("click", async () => {
  state.goals = "";
  $("#goals").value = "";
  selected = null;
  refresh();
  $("#go").disabled = false;
  $("#go").textContent = "Hide the obvious slop only";
  $("#advanced").textContent = "Change my mind — pick a goal";
});

// Power-user exit: the full options page. Nothing here changes the saved goals.
$("#advanced").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
