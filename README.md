# Feed Filter — goal-aligned feeds

A Chrome extension that blurs YouTube videos, X posts and LinkedIn posts that are
clickbait, spam, or irrelevant to goals you write yourself. Hover one and the blur lifts so you can read
it and click through. Judgement comes from
[TypeSafe's **Jev**](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
a System One model: you hand it state plus typed questions, and it hands back
typed answers with calibrated probabilities instead of prose.

## Install

1. Add it from the [Chrome Web Store](https://chromewebstore.google.com/detail/mfcjcbmgdedipgjenjcalfmmdnoejaik).
2. Onboarding opens first: pick a goal (or write your own) and it drops you onto
   YouTube with the filter live — one click, no settings wall.
3. Reload any open YouTube, X or LinkedIn tab.

To run from source instead: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → pick this folder. In Firefox (140 or later): `about:debugging` → **This
Firefox** → **Load Temporary Add-on** → pick `manifest.json`. The same files and manifest
work in both browsers.

The toolbar popup also shows the week's tally — how many items the filter has hidden
Mon–Mon — plus the all-time total and this page's count. The toolbar badge mirrors
this page's count.

Turn filtering on or off from the toolbar popup, or from the small switch that floats
on YouTube, X and LinkedIn pages (drag it anywhere; it remembers where). Hide that
switch under **Where to filter → Show the on/off switch on the page**.

## Free tier or your own key

With no key set, the extension sends the same request to Feed Filter's free tier
(`landing/src/app/api/jev/route.ts`, deployed with the site), which forwards it to Jev
with the project's own key. It only accepts the exact request shape the extension builds,
and is free with no per-user daily limit. What's left guards against abuse and caps the
spend on the project's key: 20,000 posts per IP per day (high, because mobile carriers put
many people behind one IP), 60 requests per IP per minute, and 100,000 posts across
everyone per day, about $3 of Jev at most. All are overridable with `FREE_*` env vars,
and setting `FREE_INSTALL_ITEMS_PER_DAY` brings back a per-install allowance.
Rejected or failed requests aren't charged. When a limit is hit, keyword rules stand in
and the tab asks again once `Retry-After` has passed. Pictures go to
`landing/src/app/api/jev/look/route.ts`, which takes only the image pass's request
(JPEG data URLs, at most 10 per request) and is counted separately: 3,000 pictures per
IP per day and 25,000 across everyone, about $1 at most. With your own key, requests go
straight to OpenRouter or TypeSafe and never touch Feed Filter's server.

Server setup (Vercel project env vars):

| Variable | |
| --- | --- |
| `OPENROUTER_API_KEY` | required; without it the free tier answers 503 and the extension falls back to keyword rules |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) | Upstash Redis, so limits hold across serverless instances; without it counters are per instance |
| `FREE_INSTALL_ITEMS_PER_DAY`, `FREE_IP_ITEMS_PER_DAY`, `FREE_IP_REQUESTS_PER_MINUTE`, `FREE_GLOBAL_ITEMS_PER_DAY` | limits |
| `FREE_INSTALL_IMAGES_PER_DAY`, `FREE_IP_IMAGES_PER_DAY`, `FREE_GLOBAL_IMAGES_PER_DAY` | picture limits |
| `RATE_LIMIT_SALT` | salt for the hashed IPs and install ids in the counters |

`node test/free-tier.mjs` builds the site and exercises the endpoint against a mock Jev.

## How it judges

Every item in view is reduced to its text — for a video: title, channel, duration,
views, whether it's a Short; for an X or LinkedIn post: the post text (first 700
characters, emoji kept), author and engagement line — and a whole page of them goes
out as **one** request to
`POST /v1/systemone`. Jev reads the state once and answers every question against it
in parallel, so a page costs one round trip.

Measured against OpenRouter, 10 listings (30 questions, 6.4k input tokens) came back
in **~950ms for $0.00027**. Output tokens are free. A 20-listing batch runs about
$0.0005, so a heavy day of scrolling costs a few cents. A mixed batch of 10 X, LinkedIn
and YouTube items measured 7.1k input tokens, ~1s and $0.0003.

Each item gets three questions:

| Key | Primitive | What it asks |
| --- | --- | --- |
| `vN_bait` | `score`, 4 levels | plain and accurate → pure engagement bait (incl. "Agree?" comment farming, broetry, rage-bait) |
| `vN_goal` | `score`, 4 levels | directly advances your goals → unrelated distraction |
| `vN_junk` | `noul` | probability this is spam, a scam, or mass-produced slop |

Your code — not the model — decides what to do with those numbers. Thresholds live
in settings, `SPAM` outranks `CLICK-BAIT` outranks `OFF-GOAL`, and every block is
**confidence-gated**: Jev reports certainty separately from the answer, so a high
score it isn't sure about leaves the item alone. Raise *Minimum confidence* if you
see false blocks; lower the score thresholds to get stricter.

The spam threshold defaults to **0.85** rather than something lower, for a reason
found by testing: clickbait titles score 0.45–0.75 on the spam question because
"low-effort filler" genuinely overlaps with bait, while real scams score 0.9+. A
lower gate makes bait get tagged `SPAM`, which is the right call for the wrong
reason. The displayed confidence is always the one belonging to the signal that
decided — a `SPAM` verdict shows none, because nouls don't carry a confidence field.

## Pictures (experimental)

Turn on **Also judge thumbnails and post pictures** in settings (off by default) and a
second pass looks at each item's picture: the YouTube thumbnail (`i.ytimg.com/vi/<id>/hqdefault.jpg`),
or the first photo, video poster or link card on an X or LinkedIn post. It uses
[Jev's image input](https://docs.typesafe.ai/images), new in Jev 1.14 and still marked
experimental by TypeSafe.

- **A separate request.** Any request with an image runs in Jev's long-context mode,
  which TypeSafe says is slower and less accurate, so pictures never ride along with the
  text batch. Text verdicts come back first; picture verdicts are pushed to the tab
  when they land (up to 10 pictures per request) and cached under `i:<id>`.
- **It can only add a blur.** The picture pass asks `vN_look` (a 4-level visual-bait
  score: shocked faces, red arrows, huge overlay text, fake screenshots) and `vN_scam`
  (a noul for scam graphics), gated by the same thresholds and minimum confidence.
  A text verdict is never lifted by a picture.
- **Picture-only posts.** X and LinkedIn posts with no text, skipped before, are judged
  from the picture, with a `vN_goal` question added since the text pass never saw them.
- **No new permissions.** The three image CDNs send `Access-Control-Allow-Origin: *`,
  so the service worker loads pictures without extra host permissions. Each one is
  re-encoded as a baseline JPEG, scaled to 280-768px a side (Jev takes 280-1568), and
  only the picture is sent, never its URL.
- **Where it goes.** OpenRouter takes images on its Decisions route
  (`/api/alpha/decisions`) as `image_url` data-URL parts; TypeSafe direct takes them on
  `/v1/systemone` as an `assets` map with the `TypeSafe-Danger-Zone-Images: true` header;
  the free tier relays to OpenRouter's Decisions route. **Run a test call** in settings
  sends one real thumbnail through whichever route you've picked.

## What a blocked item does

A flagged item gets a frosted veil (`backdrop-filter`, 80% strength = a 16px blur).
No label is shown — the blur itself is the signal, and a tag sitting on top of a
video you haven't looked at yet doesn't tell you anything a title can't.

Move the pointer onto it and the veil fades out over 0.18s and stops taking pointer
events, so the thumbnail and title are readable and the click lands on YouTube's own
link exactly as it normally would. Nothing is permanently dismissed and nothing is
removed from the layout. Blur strength is a slider in settings — drop it to 0 to
turn the frosting off entirely.

## Providers

Both speak the identical TypeSafe request/response shape:

- **OpenRouter** — `https://openrouter.ai/api/v1/systemone`, key from
  [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). `jev-latest`
  routes to `~typesafe/jev-latest`.
- **TypeSafe direct** — `https://api.typesafe.ai/v1/systemone`, key from
  [console.typesafe.ai/keys](https://console.typesafe.ai/keys) (early access).

Your key is stored in `chrome.storage.local` and sent only to the endpoint you pick.
With no key set, the extension falls back to keyword heuristics for obvious bait and
scams — far blunter, and it can't do goal-alignment at all.

## Verdict caching

Verdicts are cached per video id in `chrome.storage.local` for 7 days, stamped with a
hash of your goals, model and thresholds. Change any of those and the cache
invalidates itself. **Clear cached verdicts** in settings forces a re-judge.

## Layout

```
manifest.json     MV3 manifest
background.js     batching, Jev calls, verdict logic, cache
content.js        per-site adapters (YouTube, X, LinkedIn), extraction, blur, on-page switch
content.css       the blur veil
options.*         goals, key, surfaces, thresholds, test call
popup.*           on/off, per-page counts, errors
test/validate.mjs offline schema + threshold checks (node test/validate.mjs)
test/browser.mjs   real content.js + real pointer input (node test/browser.mjs)
test/dom.html      the fake-YouTube page browser.mjs drives
test/e2e.mjs       real extension on fixture youtube.com / x.com / linkedin.com pages, free
                   tier mocked (node test/e2e.mjs; OPENROUTER_API_KEY=... for live Jev)
test/free-tier.mjs the free-tier endpoint, built and served by next start against mocks
icons/             see below
```

### Icons

`icons/no_spam_badge.svg` is the supplied source lockup (badge + "No spam" wordmark,
680x200). Manifest icons have to be square and the wordmark is unreadable at 16px, so
`icon.svg` is a square derivative of just the badge glyph, keeping the source's exact
colours (`#1D6FE0`, white) and proportions (circle r = 0.3125x height, stroke =
0.0625x, corner radius = 0.25x).

`icon-small.svg` is a chunkier variant used only for the 16px slot — scaled down from
128, the 1px curved stroke antialiases to pale blue and the ring all but vanishes.

`./icons/build.sh` rasterises both to `icon{16,32,48,128}.png` via headless Chrome.
Re-run it after editing either SVG.

Run both before trusting a change to the veil behaviour or the question rubrics.
`browser.mjs` talks to Chrome over CDP with no dependencies (Node 24's global
`WebSocket`), dispatches a real `mouseMoved`, and leaves before/after screenshots in
`/tmp/ygf-before.png` and `/tmp/ygf-after.png` so you can eyeball the blur.

## Known limits

- Unless picture checks are on, thumbnails are never examined — a clean title over a
  screaming thumbnail gets through. With them on, a picture's blur can land a beat
  after the text verdicts, and Jev's image input is still experimental.
- Hover-to-clear needs a pointer. On a touchscreen there is no hover state, so a
  tap goes straight through to the video.
- Shorts are filtered as tiles in feeds and shelves. The immersive `/shorts/`
  swipe player is not covered.
- X and LinkedIn posts with no text (photo or video only) are judged only with
  picture checks on.
- The X and LinkedIn adapters are written against those sites' current markup
  (`data-testid="tweet"`, `update-components-text`, …) and tested on fixture pages that
  copy it, not on a logged-in live feed. All three sites change their DOM often; if items
  stop being blurred, the selectors in the site adapters at the top of `content.js` are
  the place to look.
