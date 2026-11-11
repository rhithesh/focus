// One place for the site's identity: metadata, sitemap, robots, structured data and the
// share image all read from here.

// NEXT_PUBLIC_SITE_URL wins (set it when a custom domain is added); otherwise Vercel's
// production domain, which Vercel provides at build time.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://feed-filter-two.vercel.app")
).replace(/\/$/, "");

export const SITE = {
  name: "Focus",
  title: "Focus: block clickbait and spam on YouTube, X and LinkedIn",
  shortTitle: "Your feeds, minus the noise",
  description:
    "Free Chrome extension that blurs clickbait, spam and off-topic posts on YouTube, X (Twitter) and LinkedIn, judged against goals you write. Hover any post to see it anyway.",
  version: "1.1.2",
  // The Chrome Web Store listing. The ID-only form survives a rename of the listing.
  store: "https://chromewebstore.google.com/detail/mfcjcbmgdedipgjenjcalfmmdnoejaik",
  repo: "https://github.com/rhithesh/youtube-focus",
  author: { name: "rhithesh", url: "https://github.com/rhithesh" },
  keywords: [
    "YouTube clickbait blocker",
    "block clickbait YouTube",
    "LinkedIn feed filter",
    "X spam filter",
    "Twitter spam blocker",
    "Chrome extension",
    "focus extension",
    "distraction blocker",
    "feed blocker",
    "AI content filter",
  ],
  theme: "#f3f0e8",
};
