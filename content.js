// Feed Filter — content script.
// Finds items in a YouTube, X or LinkedIn feed, ships the text of each one to the
// service worker for a Jev verdict, and blurs whatever comes back flagged. Items stay
// blurred until that verdict is in, unless that option is off.

(() => {
  /* ------------------------------------------------------------- helpers */

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function text(el) {
    if (!el) return "";
    return clean(el.getAttribute?.("title") || el.textContent);
  }

  // Like textContent, but keeps emoji that sites render as <img alt="😂"> —
  // emoji spam is one of the stronger bait signals.
  function richText(el) {
    if (!el) return "";
    let out = "";
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
      else if (n.nodeName === "IMG") out += n.getAttribute("alt") || "";
      else if (n.nodeName === "BR") out += "\n";
      else for (const c of n.childNodes) walk(c);
    };
    walk(el);
    return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function firstText(root, selectors, read = text) {
    for (const sel of selectors) {
      const t = read(root.querySelector(sel));
      if (t) return t;
    }
    return "";
  }

  const MAX_POST_CHARS = 700;
  const clip = (s) => (s.length > MAX_POST_CHARS ? s.slice(0, MAX_POST_CHARS) + "…" : s);

  // The item's picture, for the image pass. Only its address is collected here; the service
  // worker loads it from the site's image server.
  function mediaUrl(root, selectors) {
    const m = root.querySelector(selectors);
    const url = m?.getAttribute("poster") || m?.currentSrc || m?.getAttribute("src") || "";
    return url.startsWith("https://") ? url : "";
  }
  const lookingAtImages = () => !!settings?.lookAtImages;

  /* ------------------------------------------------------------- sites */

  const youtube = {
    name: "youtube",
    selector: [
      "ytd-rich-item-renderer",
      "ytd-video-renderer",
      "ytd-compact-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-playlist-video-renderer",
      "ytm-shorts-lockup-view-model",
      "ytd-reel-item-renderer",
      "yt-lockup-view-model",
    ].join(","),

    extract(el) {
      const link = el.querySelector(
        'a#thumbnail[href], a#video-title-link[href], a.yt-lockup-view-model__content-image[href], a[href^="/watch"], a[href^="/shorts/"]'
      );
      const href = link?.getAttribute("href") || "";
      const m = href.match(/[?&]v=([\w-]{11})/) || href.match(/\/shorts\/([\w-]{11})/);
      if (!m) return null;

      const title = firstText(el, [
        "#video-title",
        "a#video-title-link",
        "yt-formatted-string#video-title",
        "h3.yt-lockup-metadata-view-model__heading-reset",
        ".yt-lockup-metadata-view-model__title",
        ".shortsLockupViewModelHostMetadataTitle span",
        "h3 a span",
        "h3 span",
      ]);
      if (title.length < 2) return null; // not hydrated yet — retry on the next scan

      const isShort = /\/shorts\//.test(href) || /shorts|reel/i.test(el.tagName);
      return {
        id: m[1],
        platform: "youtube",
        title,
        author: firstText(el, [
          "ytd-channel-name a",
          "ytd-channel-name #text",
          "#channel-name a",
          ".yt-content-metadata-view-model__metadata-row:first-child span",
        ]),
        duration: firstText(el, [
          "ytd-thumbnail-overlay-time-status-renderer #text",
          "ytd-thumbnail-overlay-time-status-renderer",
          ".badge-shape-wiz__text",
          "#time-status span",
        ]),
        meta: [...el.querySelectorAll("#metadata-line span, .inline-metadata-item, .yt-content-metadata-view-model__metadata-text")]
          .map(text).filter(Boolean).slice(0, 4).join(" · "),
        isShort,
        image: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`, // 480x360 JPEG, there for every video
        surface: youtubeSurface(el, isShort),
      };
    },
  };

  function youtubeSurface(el, isShort) {
    if (isShort) return "shorts";
    if (el.closest("#related, ytd-watch-next-secondary-results-renderer, #secondary")) return "sidebar";
    const path = location.pathname;
    if (path.startsWith("/results")) return "search";
    if (path.startsWith("/watch")) return "sidebar";
    return "home";
  }

  const x = {
    name: "x",
    // X's current markup renders no data-testid attributes — posts are plain
    // <article>s inside <main>. The testid selector keeps older builds matching.
    selector: 'main article, article[data-testid="tweet"]',

    extract(el) {
      // The post's own permalink is the first plain /user/status/<id> link: the
      // one on its timestamp or reply button, which sits before any quoted post's.
      const hrefs = [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute("href"));
      const m =
        hrefs.find((h) => /^\/[^/]+\/status\/\d+$/.test(h))?.match(/\/status\/(\d+)/) ||
        el.querySelector('a[href*="in_reply_to="]')?.getAttribute("href")?.match(/in_reply_to=(\d+)/);
      if (!m) return null; // sponsored posts carry no permalink — out of reach, as before

      // Post text: the testid body when the old UI renders it, otherwise the link
      // card, else — on the current testid-less markup — the article's text with
      // the quoted post inside dropped. The old markup's media-only posts get no
      // text at all, so the image pass judges them.
      const own = el.querySelector('[data-testid="tweetText"]');
      const card = text(el.querySelector('[data-testid="card.wrapper"]'));
      const content = own ? richText(own) : card || (testidPost(el) ? "" : richText(outerPost(el)));
      const image = xImage(el);
      if (!content && !(image && lookingAtImages())) return null; // media-only post, and pictures aren't being judged

      const counts = el.querySelector('[role="group"][aria-label]')?.getAttribute("aria-label") || "";
      return {
        id: "x:" + m[1],
        platform: "x",
        title: clip(content),
        image,
        author: xName(el),
        meta: [text(el.querySelector('[data-testid="socialContext"]')), counts].filter(Boolean).join(" · "),
        surface: "x",
      };
    },
  };

  // Posts of the pre-2026 markup carry the tweet testids; the current one renders none.
  const testidPost = (el) => el.matches('article[data-testid="tweet"]') && !!el.querySelector('[data-testid="User-Name"], [data-testid="tweetText"], [data-testid="tweetPhoto"]');

  // The display name: the testid block if the old UI renders it, else the first
  // profile link (/handle) that carries visible text.
  function xName(el) {
    const named = el.querySelector('[data-testid="User-Name"]');
    if (named) return text(named);
    const a = [...el.querySelectorAll("a[href]")].find(
      (n) => /^\/[A-Za-z0-9_]{1,20}$/.test(n.getAttribute("href") || "") && clean(n.textContent).length > 1
    );
    return clean(a?.textContent);
  }

  // A detached copy of the post with quoted articles and the reply/action buttons
  // removed, so quote text and bare counts aren't judged as part of the post.
  function outerPost(el) {
    const copy = el.cloneNode(true);
    copy.querySelectorAll("article, button").forEach((n) => n.remove());
    copy.querySelectorAll('a[href*="in_reply_to="]').forEach((n) => n.remove());
    return copy;
  };

  function xImage(el) {
    const url = mediaUrl(el, '[data-testid="tweetPhoto"] img, [data-testid="videoPlayer"] video[poster], [data-testid="card.wrapper"] img, img[src*="pbs.twimg.com/media/"]');
    // Ask X's image server for a small JPEG rather than WebP.
    if (!url.startsWith("https://pbs.twimg.com/media/")) return url;
    const u = new URL(url);
    u.searchParams.set("format", "jpg");
    u.searchParams.set("name", "small");
    return u.href;
  }

  const linkedin = {
    name: "linkedin",
    selector: 'div.feed-shared-update-v2, div[data-urn^="urn:li:activity:"], div[data-id^="urn:li:activity:"]',

    extract(el) {
      const urn =
        el.getAttribute("data-urn") ||
        el.getAttribute("data-id") ||
        el.querySelector('[data-urn^="urn:li:activity:"]')?.getAttribute("data-urn");
      if (!urn) return null;

      const body = firstText(
        el,
        [".update-components-text", ".feed-shared-update-v2__description", ".feed-shared-inline-show-more-text", ".feed-shared-text"],
        richText
      ).replace(/…\s*(see )?more$/i, "");
      const article = text(el.querySelector(".update-components-article__title"));
      const content = body || article;
      const image = mediaUrl(
        el,
        ".update-components-image img, img.update-components-article__image, .update-components-article img, .update-components-linkedin-video video[poster], .update-components-document__container img"
      );
      if (!content && !(image && lookingAtImages())) return null;

      return {
        id: "li:" + urn,
        platform: "linkedin",
        title: clip(content),
        image,
        author: firstText(el, [".update-components-actor__title", ".update-components-actor__name", ".feed-shared-actor__name"])
          .split(/ • | · /)[0],
        meta: [
          text(el.querySelector(".update-components-actor__description")),
          text(el.querySelector(".update-components-header__text-view")),
        ].filter(Boolean).join(" · "),
        surface: "linkedin",
      };
    },
  };

  function pickSite(host) {
    if (/(^|\.)youtube\.com$/.test(host)) return youtube;
    if (/(^|\.)(x|twitter)\.com$/.test(host)) return x;
    if (/(^|\.)linkedin\.com$/.test(host)) return linkedin;
    return youtube; // file:// test pages
  }

  const site = pickSite(location.hostname);

  /* --------------------------------------------------------------- state */

  const verdicts = new Map(); // item id -> verdict
  const inFlight = new Set(); // item id
  const pending = new Map(); // item id -> payload

  let settings = null;
  let flushTimer = null;
  let scanTimer = null;
  let blockedCount = 0;
  let counted = new Set(); // item ids already filed into the week tally this session
  let badgeSent = -1; // last page count reported to the badge, to skip duplicate messages
  let toastSeen = null; // storage key not read yet: null. true/false once known.
  let toastShown = false;
  let dead = false; // true once the extension is reloaded/updated out from under this tab
  let observer = null;
  let intervalId = null;
  let guardOn = false; // items are held blurred until judged
  let guardStyle = null;
  let resetAt = 0; // when verdicts were last thrown out; deadlines restart from here
  let askPausedUntil = 0; // the worker or model didn't answer: don't re-ask on every scan
  let checkingSeen = null; // like toastSeen, for the "checking this feed" toast
  let hideCheckingToast = null;
  let hideActiveToast = null; // both toasts sit in the same spot, so one at a time

  // After an extension reload, any chrome.runtime.* access here throws "Extension context invalidated".
  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function die() {
    if (dead) return;
    dead = true;
    clearTimeout(scanTimer);
    clearTimeout(flushTimer);
    if (intervalId) clearInterval(intervalId);
    observer?.disconnect();
    // Nothing can toggle this tab's blur off any more, so don't leave it (or the switch) behind.
    resetAll();
    setGuard(null);
    guardStyle?.remove();
    pill.remove();
  }

  function safeSend(msg, cb, onFail) {
    if (dead || !alive()) { die(); return; }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        try {
          if (chrome.runtime.lastError || !res) {
            if (!alive()) die();
            else onFail?.();
            return;
          }
          cb(res);
        } catch {
          die();
        }
      });
    } catch {
      die();
    }
  }

  function surfaceEnabled(surface) {
    return settings?.surfaces?.[surface] !== false;
  }

  /* --------------------------------------------------------------- masking */

  function clearBlock(el) {
    if (!el.classList.contains("ygf-host")) return;
    el.classList.remove("ygf-host", "ygf-host--" + site.name);
    el.querySelector(":scope > .ygf-veil")?.remove();
  }

  // The options slider is a percentage; 100% is a 20px blur.
  function blurPx(s = settings) {
    const pct = Number(s?.blurStrength ?? 80);
    return Math.max(0, Math.round(pct * 0.2));
  }

  function applyBlock(el) {
    el.classList.add("ygf-host", "ygf-host--" + site.name);

    let veil = el.querySelector(":scope > .ygf-veil");
    if (!veil) {
      veil = document.createElement("div");
      veil.className = "ygf-veil";
      el.appendChild(veil);
    }
    veil.style.setProperty("--ygf-blur", blurPx() + "px");
  }

  /* ---------------------------------------------------------- pending blur */

  // Scans are too late to stop a flash, so the blur on unjudged items is a stylesheet rule:
  // an item matches it from its first paint until a scan marks it .ygf-settled. A flagged item
  // then swaps to its real veil in the same step. Looks the same as .ygf-veil in content.css.
  // The same rule spins a small ring on every pending item, so waiting on the model is
  // visible; it dies with the rule the moment the item settles.
  const SITE_STYLE = {
    youtube: { surfaces: ["home", "search", "sidebar", "shorts"], radius: 12 },
    x: { surfaces: ["x"], radius: 0 },
    linkedin: { surfaces: ["linkedin"], radius: 8 },
  };
  const PENDING_DEADLINE_MS = 20_000; // past this an unjudged item shows; a late verdict can still blur it
  const NOTHING_TO_JUDGE_MS = 3_000; // an item that never yields anything to judge, e.g. a media-only post
  const ASK_AGAIN_MS = 5_000;

  function setGuard(s) {
    const { surfaces, radius } = SITE_STYLE[site.name];
    guardOn = !dead && !!s && s.enabled !== false && s.hideUntilChecked !== false && surfaces.some((k) => s.surfaces?.[k] !== false);
    document.documentElement.classList.toggle("ygf-guard", guardOn);
    if (!guardOn) return;

    // Only the outermost item, like scan(): several of these selectors nest.
    const any = `:is(${site.selector})`;
    const item = `html.ygf-guard ${any}:not(${any} *):not(.ygf-settled)`;
    const blur = `blur(${blurPx(s)}px) saturate(0.5)`;
    const css = `
      ${item} { position: relative !important; }
      ${item}::after {
        content: ""; position: absolute; inset: 0; z-index: 900; border-radius: ${radius}px;
        background: rgba(236, 243, 255, 0.42);
        -webkit-backdrop-filter: ${blur}; backdrop-filter: ${blur};
        transition: opacity 0.18s ease;
      }
      ${item}:hover::after { opacity: 0; pointer-events: none; }
      ${item}::before {
        content: ""; position: absolute; top: 50%; left: 50%; z-index: 901;
        width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        border: 2px solid rgba(22, 21, 15, 0.3); border-top-color: #c9f25d;
        transition: opacity 0.18s ease;
        animation: ygf-spin 0.9s linear infinite;
      }
      ${item}:hover::before { opacity: 0; pointer-events: none; }
      @keyframes ygf-spin { to { transform: rotate(1turn); } }
      @media (prefers-reduced-motion: reduce) {
        ${item}::before { animation: none; border-color: rgba(22, 21, 15, 0.35); }
      }
    `;
    if (!guardStyle) {
      guardStyle = document.createElement("style");
      guardStyle.setAttribute("data-ygf-guard", "");
      (document.head || document.documentElement).appendChild(guardStyle);
    }
    if (guardStyle.textContent !== css) guardStyle.textContent = css;
  }

  const settle = (el) => el.classList.add("ygf-settled");

  // The element no longer shows the item it was judged as: back to pending.
  function forgetItem(el) {
    clearBlock(el);
    el.classList.remove("ygf-settled");
    el.__ygfId = null;
  }

  // Feeds recycle nodes while scrolling. Observer callbacks run before the next paint, so
  // catching the new content here keeps the last item's "clear" from showing on it.
  function recheckSettled(records) {
    if (!guardOn) return;
    const seen = new Set();
    for (const { target } of records) {
      let item = target.closest?.(site.selector);
      for (let up = item; up; up = up.parentElement?.closest(site.selector)) item = up;
      if (!item || seen.has(item)) continue;
      seen.add(item);
      if (!item.classList.contains("ygf-settled")) continue;
      if ((site.extract(item)?.id ?? null) !== (item.__ygfId ?? null)) forgetItem(item);
    }
  }

  /* --------------------------------------------------------- on-page switch */

  // A small draggable pill so the filter can be flipped without opening the popup.
  // It lives in a shadow root so the host page's CSS can't touch it (and vice versa).
  const pill = (() => {
    const MARGIN = 16;
    let host = null;
    let els = null;
    let pos = { fx: 0, fy: 1 }; // 0..1 across the free space; default bottom-left
    let posLoaded = false;

    const CSS = `
      :host { all: initial; position: fixed; left: 0; top: 0; z-index: 2147483646; }
      .pill {
        display: flex; align-items: center; gap: 9px;
        padding: 5px 12px 5px 5px;
        background: #16150f; color: #f3f0e8;
        border-radius: 999px;
        font: 500 13px/1 "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        letter-spacing: 0;
        box-shadow: 0 10px 30px -10px rgba(0,0,0,.5), 0 0 0 1px rgba(243,240,232,.1);
        cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
        transition: opacity .2s, transform .2s;
      }
      .pill.off { opacity: .82; }
      .pill:hover { opacity: 1; }
      .pill.dragging { cursor: grabbing; transform: scale(1.04); }
      .logo { display: block; width: 26px; height: 26px; flex: none; }
      .label { white-space: nowrap; min-width: 58px; }
      .count {
        padding: 3px 7px; border-radius: 999px;
        background: rgba(243,240,232,.12); color: #c9f25d;
        font-variant-numeric: tabular-nums;
      }
      .count[hidden] { display: none; }
      .spin {
        width: 12px; height: 12px; flex: none; box-sizing: border-box;
        border: 2px solid rgba(243,240,232,.22); border-top-color: #c9f25d;
        border-radius: 50%; animation: ygf-spin .7s linear infinite;
      }
      .spin[hidden] { display: none; }
      @keyframes ygf-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2s; } }
      button {
        all: unset; position: relative; flex: none;
        width: 34px; height: 20px; border-radius: 999px;
        background: rgba(243,240,232,.22); cursor: pointer;
        transition: background .2s;
      }
      button::after {
        content: ""; position: absolute; top: 3px; left: 3px;
        width: 14px; height: 14px; border-radius: 50%;
        background: #f3f0e8; transition: transform .25s cubic-bezier(.3,1.4,.5,1), background .2s;
      }
      button[aria-checked="true"] { background: #c9f25d; }
      button[aria-checked="true"]::after { transform: translateX(14px); background: #16150f; }
      button:focus-visible { outline: 2px solid #c9f25d; outline-offset: 2px; }
    `;

    // Built with DOM calls rather than markup strings, so no HTML is ever parsed into the page.
    function el(tag, attrs = {}, kids = [], ns) {
      const n = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      n.append(...kids);
      return n;
    }

    function logo() {
      const SVG = "http://www.w3.org/2000/svg";
      const bracket = (d) =>
        el("path", { d, fill: "none", stroke: "#ffffff", "stroke-width": "1.9", "stroke-linecap": "round" }, [], SVG);
      return el("svg", { class: "logo", viewBox: "0 0 24 24", "aria-hidden": "true" }, [
        el("rect", { width: "24", height: "24", rx: "12", fill: "#2a2920" }, [], SVG),
        el("circle", { cx: "12", cy: "12", r: "5.5", fill: "#ffffff", opacity: ".16" }, [], SVG),
        el("circle", { cx: "12", cy: "12", r: "3", fill: "#ffffff" }, [], SVG),
        bracket("M9.75 5.5H7.4Q5.5 5.5 5.5 7.4v2.35"),
        bracket("M14.25 5.5h2.35Q18.5 5.5 18.5 7.4v2.35"),
        bracket("M9.75 18.5H7.4Q5.5 18.5 5.5 16.6v-2.35"),
        bracket("M14.25 18.5h2.35Q18.5 18.5 18.5 16.6v-2.35"),
      ], SVG);
    }

    function build() {
      host = document.createElement("div");
      host.setAttribute("data-ygf-pill", "");
      const root = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CSS;
      root.append(style, el("div", { class: "pill", title: "Focus · drag to move" }, [
        logo(),
        el("button", { role: "switch", "aria-label": "Focus" }),
        el("span", { class: "label" }),
        el("span", { class: "count", hidden: "" }),
        el("span", { class: "spin", hidden: "", role: "status", "aria-label": "Checking posts" }),
      ]));
      els = {
        pill: root.querySelector(".pill"),
        label: root.querySelector(".label"),
        count: root.querySelector(".count"),
        button: root.querySelector("button"),
        spin: root.querySelector(".spin"),
      };

      let drag = null;
      let justDragged = false;

      // Move/up are tracked on the window: the pointer leaves a 36px pill almost at once.
      const move = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
        if (!drag.moved) {
          drag.moved = true;
          els.pill.classList.add("dragging");
        }
        e.preventDefault();
        const { w, h } = free();
        pos = {
          fx: w > 0 ? clamp01((e.clientX - drag.dx - MARGIN) / w) : 0,
          fy: h > 0 ? clamp01((e.clientY - drag.dy - MARGIN) / h) : 1,
        };
        place();
      };
      const end = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", end, true);
        window.removeEventListener("pointercancel", end, true);
        if (drag.moved) {
          els.pill.classList.remove("dragging");
          // A drag that ends over the switch must not also flip it; the click fires right after pointerup.
          justDragged = true;
          setTimeout(() => { justDragged = false; }, 0);
          try { chrome.storage.local.set({ pillPos: pos }); } catch { if (!alive()) die(); }
        }
        drag = null;
      };
      els.pill.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const r = host.getBoundingClientRect();
        drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", end, true);
        window.addEventListener("pointercancel", end, true);
      });

      els.button.addEventListener("click", () => {
        if (!justDragged) setEnabled(!settings?.enabled);
      });
      window.addEventListener("resize", place);
    }

    const clamp01 = (n) => Math.min(1, Math.max(0, n));

    function free() {
      const r = host.getBoundingClientRect();
      return { w: innerWidth - r.width - 2 * MARGIN, h: innerHeight - r.height - 2 * MARGIN };
    }

    function place() {
      if (!host?.isConnected) return;
      const { w, h } = free();
      host.style.transform = `translate(${Math.round(MARGIN + pos.fx * Math.max(0, w))}px, ${Math.round(MARGIN + pos.fy * Math.max(0, h))}px)`;
    }

    function loadPos() {
      if (posLoaded) return;
      posLoaded = true;
      try {
        chrome.storage.local.get("pillPos", (r) => {
          try {
            if (chrome.runtime.lastError) return;
            if (r?.pillPos) pos = { fx: clamp01(+r.pillPos.fx || 0), fy: clamp01(+r.pillPos.fy || 0) };
            place();
          } catch { if (!alive()) die(); }
        });
      } catch { if (!alive()) die(); }
    }

    function render() {
      const want = !dead && settings && settings.showPagePill !== false && !document.fullscreenElement;
      if (!want) { host?.remove(); return; }
      if (!document.body) return;
      if (!host) build();
      if (!host.isConnected) {
        document.body.appendChild(host);
        loadPos();
        place();
      }
      const on = !!settings.enabled;
      els.pill.classList.toggle("off", !on);
      els.button.setAttribute("aria-checked", String(on));
      els.label.textContent = on ? "Filter on" : "Filter off";
      els.count.hidden = !on || !blockedCount;
      els.count.textContent = blockedCount + " blurred";
      // Spins while posts are queued for or waiting on the model.
      els.spin.hidden = !on || !(pending.size || inFlight.size);
    }

    return { render, remove: () => host?.remove() };
  })();

  // Same single write the popup does: everything else reacts to storage.onChanged.
  function setEnabled(on) {
    if (dead || !alive()) { die(); return; }
    settings = { ...settings, enabled: on };
    setGuard(settings);
    if (!on) {
      resetAll();
      blockedCount = 0;
    }
    pill.render();
    try {
      chrome.storage.local.get("settings", (r) => {
        try {
          if (chrome.runtime.lastError) return;
          chrome.storage.local.set({ settings: { ...(r?.settings || {}), enabled: on } });
        } catch { if (!alive()) die(); }
      });
    } catch { if (!alive()) die(); }
  }

  /* ---------------------------------------------------------------- scanning */

  function scan() {
    if (dead) return;
    if (!alive()) { die(); return; }
    if (!settings || !settings.enabled) {
      blockedCount = 0;
      if (badgeSent !== 0) {
        badgeSent = 0;
        safeSend({ type: "page", badge: 0, hidden: 0 }, () => {});
      }
      pill.render();
      return;
    }

    let blocked = 0;
    let freshHidden = 0;
    let waiting = 0;
    const now = Date.now();
    for (const el of document.querySelectorAll(site.selector)) {
      // Take only the outermost item — several of these selectors nest.
      if (el.parentElement?.closest(site.selector)) continue;

      const info = site.extract(el);
      if (!info) {
        // Still loading, or nothing to judge. Give it a moment, then stop holding it back.
        if (guardOn && el.__ygfId) forgetItem(el);
        el.__ygfEmptySince ??= now;
        if (now - Math.max(el.__ygfEmptySince, resetAt) >= NOTHING_TO_JUDGE_MS) settle(el);
        continue;
      }
      el.__ygfEmptySince = null;

      // Feeds recycle nodes while scrolling; reset when the item changes.
      if (el.__ygfId !== info.id) {
        forgetItem(el);
        el.__ygfId = info.id;
        el.__ygfSince = now;
      }

      if (!surfaceEnabled(info.surface)) {
        clearBlock(el);
        settle(el);
        continue;
      }

      const overdue = now - Math.max(el.__ygfSince, resetAt) >= PENDING_DEADLINE_MS;

      let verdict = verdicts.get(info.id);
      // A keyword-rule stand-in (the model was rate-limited or unreachable): ask again once it may be back.
      if (verdict?.provisional && Date.now() >= (verdict.retryAt || 0)) {
        verdicts.delete(info.id);
        verdict = null;
      }
      if (verdict) {
        if (verdict.tag) {
          applyBlock(el);
          blocked++;
          // File each hidden item into the week's tally once per tab session.
          if (!counted.has(info.id)) { counted.add(info.id); freshHidden++; }
          settle(el);
        } else {
          clearBlock(el);
          // A clean title doesn't clear it while its picture is still being judged.
          if (!verdict.awaitingLook || overdue) settle(el);
          else waiting++;
        }
        continue;
      }

      if (!inFlight.has(info.id) && !pending.has(info.id) && now >= askPausedUntil) pending.set(info.id, info);
      if (overdue) settle(el);
      else waiting++;
    }

    blockedCount = blocked;
    pill.render();
    if (freshHidden || blocked !== badgeSent) {
      badgeSent = blocked;
      safeSend({ type: "page", badge: blocked, hidden: freshHidden }, () => {});
    }
    maybeToast(blocked);
    maybeCheckingToast(waiting);
    if (pending.size) scheduleFlush();
  }

  function scheduleScan(delay = 250) {
    if (dead || scanTimer) return; // not a debounce: a busy page must not keep pushing the scan back
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, delay);
  }

  function scheduleFlush() {
    if (dead || flushTimer) return;
    flushTimer = setTimeout(flush, 400);
  }

  function flush() {
    flushTimer = null;
    if (dead || !pending.size) return;

    const batch = [...pending.values()];
    pending.clear();
    batch.forEach((v) => inFlight.add(v.id));
    pill.render();

    const release = () => batch.forEach((v) => inFlight.delete(v.id));
    safeSend({ type: "judge", videos: batch }, (res) => {
      release();
      if (res.settings) {
        settings = res.settings;
        setGuard(settings);
      }
      for (const [id, v] of Object.entries(res.verdicts || {})) {
        // The picture's verdict can get here first; don't go back to waiting for it.
        const known = verdicts.get(id);
        if (v.awaitingLook && known && !known.awaitingLook) continue;
        verdicts.set(id, v);
      }
      if (batch.some((v) => !verdicts.has(v.id))) askPausedUntil = Date.now() + ASK_AGAIN_MS;
      scan();
    }, () => {
      release();
      askPausedUntil = Date.now() + ASK_AGAIN_MS;
      pill.render();
    });
  }

  /* ------------------------------------------------------- first-run toast */

  // The one moment the product is visible without opening the popup: the first
  // scan that hides something, once per install. Without a goal set, it doubles
  // as a nudge to the welcome page — that's the reactivation path for old installs.
  function maybeToast(blocked) {
    if (toastShown || toastSeen !== false || !settings || dead || !document.body) return;
    const goalless = !settings.goals?.trim();
    // With no goal the keyword rules alone hide less; wait for a count that means something.
    if (blocked < (goalless ? 3 : 1)) return;
    toastShown = true;
    showToast((span, hide) => fillHiddenToast(span, hide, blocked, goalless));
    try { chrome.storage.local.set({ toastDone: Date.now() }); } catch { if (!alive()) die(); }
  }

  // A feed that opens fully blurred needs saying why, once per install.
  function maybeCheckingToast(waiting) {
    if (!waiting) {
      hideCheckingToast?.();
      return;
    }
    if (checkingSeen !== false || !guardOn || dead || !document.body) return;
    checkingSeen = true;
    hideCheckingToast = showToast((span) => span.append("Checking this feed. Posts clear as soon as they\u2019re judged."));
    try { chrome.storage.local.set({ checkingToastDone: Date.now() }); } catch { if (!alive()) die(); }
  }

  function fillHiddenToast(span, hide, n, goalless) {
    if (goalless) {
      const b = document.createElement("b");
      b.textContent = String(n);
      span.append("Feed Filter is hiding ", b, " things here. ");
      const link = document.createElement("a");
      link.textContent = "Pick a goal";
      link.className = "link";
      link.addEventListener("click", () => { safeSend({ type: "openWelcome" }, () => {}); hide(); });
      span.append(link, " to tune what stays hidden.");
    } else {
      const b = document.createElement("b");
      b.textContent = String(n);
      span.append("Feed Filter hid ", b, " things on this feed");
      const em = document.createElement("em");
      em.textContent = "\u2014 hover one to see through.";
      span.append(" ", em);
    }
  }

  function showToast(fill) {
    hideActiveToast?.();
    const host = document.createElement("div");
    host.setAttribute("data-ygf-toast", "");
    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; position: fixed; top: 18px; left: 50%; z-index: 2147483645; }
      .toast {
        transform: translateX(-50%) translateY(-16px); opacity: 0;
        transition: transform .35s cubic-bezier(.2,1,.3,1), opacity .35s;
      }
      .in { transform: translateX(-50%) translateY(0); opacity: 1; }
      .card {
        display: flex; align-items: center; gap: 10px;
        max-width: min(480px, 92vw);
        padding: 12px 14px;
        background: #16150f; color: #f3f0e8;
        border-radius: 14px;
        box-shadow: 0 16px 44px -14px rgba(0,0,0,.55), 0 0 0 1px rgba(243,240,232,.1);
        font: 400 13.5px/1.45 "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      .logo { display: block; width: 22px; height: 22px; flex: none; }
      b { color: #c9f25d; font-weight: 500; font-variant-numeric: tabular-nums; }
      em { font-style: italic; }
      .link { text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
      .close {
        all: unset; cursor: pointer; flex: none;
        width: 22px; height: 22px; border-radius: 50%;
        color: rgba(243,240,232,.55); text-align: center; line-height: 22px;
      }
      .close:hover { color: #f3f0e8; background: rgba(243,240,232,.12); }
    `;

    const svgNS = "http://www.w3.org/2000/svg";
    const logo = document.createElementNS(svgNS, "svg");
    logo.setAttribute("viewBox", "0 0 24 24");
    logo.setAttribute("class", "logo");
    logo.setAttribute("aria-hidden", "true");
    for (const [y, w, f] of [["6.5", "12", "#c9f25d"], ["10.8", "12", "#f3f0e8"], ["15.1", "8", "#c9f25d"]]) {
      const r = document.createElementNS(svgNS, "rect");
      for (const [k, v] of Object.entries({ x: "6", y, width: w, height: "2.4", rx: "1.2", fill: f })) r.setAttribute(k, v);
      logo.append(r);
    }

    const span = document.createElement("span");
    span.innerHTML = ""; // built with DOM calls; no page HTML ever parsed
    fill(span, hide);

    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", hide);

    const card = document.createElement("div");
    card.className = "card";
    card.append(logo, span, close);

    const outer = document.createElement("div");
    outer.className = "toast";
    outer.append(card);
    root.append(style, outer);

    let gone = false;
    function hide() {
      if (gone) return;
      gone = true;
      outer.classList.remove("in");
      setTimeout(() => host.remove(), 400);
    }

    document.body.appendChild(host);
    requestAnimationFrame(() => outer.classList.add("in"));
    setTimeout(hide, 14_000);
    hideActiveToast = hide;
    return hide;
  }

  /* ----------------------------------------------------------------- boot */

  function resetAll() {
    verdicts.clear();
    pending.clear();
    inFlight.clear();
    askPausedUntil = 0;
    resetAt = Date.now();
    for (const el of document.querySelectorAll(".ygf-host, .ygf-settled")) forgetItem(el);
  }

  function start() {
    observer = new MutationObserver((records) => {
      recheckSettled(records);
      scheduleScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

    // Safety net for virtualised lists that mutate outside the observed subtree.
    intervalId = setInterval(scan, 1500);
    window.addEventListener("yt-navigate-finish", () => scheduleScan(120));
    document.addEventListener("fullscreenchange", () => pill.render());
    document.addEventListener("scroll", () => scheduleScan(300), { passive: true });
    scan();
  }

  // Storage answers without waking the service worker, so the pending blur is on before the
  // feed renders. What's stored can predate a default, hence setGuard treating unset as on.
  try {
    chrome.storage.local.get("settings", (r) => {
      try {
        if (!settings && !dead) setGuard(r?.settings || {});
      } catch { if (!alive()) die(); }
    });
  } catch {
    die();
  }

  safeSend({ type: "settings" }, (s) => {
    settings = s || { enabled: false };
    setGuard(settings);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }, () => setGuard(null)); // no worker means no scans, so nothing could ever clear the blur

  // Whether the one-per-install toasts have already been spent.
  try {
    chrome.storage.local.get(["toastDone", "checkingToastDone"], (r) => {
      try {
        toastSeen = !!r?.toastDone;
        checkingSeen = !!r?.checkingToastDone;
        scan(); // the flag may have arrived after a scan that passed the threshold
      } catch { if (!alive()) die(); }
    });
  } catch {
    die();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (dead || area !== "local" || !changes.settings) return;
      safeSend({ type: "settings" }, (s) => {
        settings = s;
        setGuard(settings);
        resetAll();
        scan();
      });
    });
  } catch {
    die();
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "stats") {
        sendResponse({ blocked: blockedCount, judged: verdicts.size });
        return true;
      }
      // Picture verdicts arrive after the text ones, once the image pass finishes.
      if (msg?.type === "verdicts") {
        for (const [id, v] of Object.entries(msg.verdicts || {})) verdicts.set(id, v);
        scan();
        return false;
      }
      return false;
    });
  } catch {
    die();
  }
})();
