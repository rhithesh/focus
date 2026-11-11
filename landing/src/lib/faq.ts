// Shared by the FAQ section and the FAQPage structured data in page.tsx.
export const FAQS = [
  {
    q: "Does it delete or hide anything?",
    a: "No. Flagged posts are blurred where they are. Hover one and the blur lifts so you can read it and click through. Switch the filter off from the toolbar and every blur is gone at once.",
  },
  {
    q: "Where does it work?",
    a: "YouTube (home, search, the watch-next sidebar and Shorts), your X timeline and your LinkedIn feed. You can switch each one off separately in settings.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. Without a key, Focus judges your posts for free, with no daily limit. You can also bring your own OpenRouter key, so your posts go straight to the model instead of through Focus’s server: about $0.0003 for a page of ten posts. If the free tier is ever too busy, keyword rules keep catching the obvious bait until it’s back.",
  },
  {
    q: "Where do my posts and goals go?",
    a: "On the free tier, the text of each post (plus a shrunk copy of its picture, if you turn picture checks on) and your goals pass through Focus’s server on their way to the model; nothing is stored or logged, only an anonymous daily counter. With your own key, they go straight from your browser to OpenRouter or TypeSafe and Focus never sees them. Settings and keys live in your browser (chrome.storage.local).",
  },
  {
    q: "What won’t it catch?",
    a: "Out of the box it reads text, not pictures, so a calm title over a screaming thumbnail gets through, and posts that are only a picture aren’t judged. Turn on picture checks in settings and the model looks at thumbnails and post pictures too; picture judging is brand new, so it’s off by default and labelled experimental. Hover needs a mouse. And all three sites change their pages often, so the extension may occasionally need an update.",
  },
];
