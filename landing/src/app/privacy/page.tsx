import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/components/Closing";
import { Logo } from "@/components/ui";
import { SITE } from "@/lib/site";

// Linked from the Chrome Web Store listing. Keep it in step with the store's data-usage
// disclosures and with what background.js and /api/jev actually send and keep.

const UPDATED = "October 26, 2026";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What the Focus Chrome extension reads, where it sends it, and what is kept.",
  alternates: { canonical: "/privacy" },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-serif text-[30px] leading-tight tracking-[-0.01em]">{title}</h2>
      <div className="mt-4 space-y-4 text-[16px] leading-relaxed text-ink/80">{children}</div>
    </section>
  );
}

const ext = (href: string, label: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="underline decoration-ink/25 underline-offset-2 hover:decoration-ink">
    {label}
  </a>
);

export default function Privacy() {
  return (
    <>
      <header className="mx-auto max-w-[720px] px-5 pt-8">
        <Link href="/" aria-label="Focus, home">
          <Logo className="text-[16px]" />
        </Link>
      </header>

      <main className="mx-auto max-w-[720px] px-5 pt-16">
        <h1 className="font-serif text-[clamp(44px,8vw,72px)] leading-[0.95] tracking-[-0.03em]">Privacy policy</h1>
        <p className="mt-4 text-[14px] text-muted">Last updated {UPDATED}</p>
        <p className="mt-8 text-[18px] leading-relaxed text-ink/80">
          This policy covers the {SITE.name} Chrome extension. In short: it reads the text of the posts in your YouTube, X and
          LinkedIn feeds (and their pictures, if you turn that on), sends them and your goals to an AI model to judge them, and
          blurs the ones it flags. There are no
          accounts, no ads and no analytics, and your data is never sold.
        </p>

        <Section title="What the extension reads">
          <p>
            Only on youtube.com, x.com (and twitter.com) and linkedin.com, and only the items in your feed: each video&apos;s or
            post&apos;s title or text, the channel or author name, and the metadata shown with it, such as views, duration or the
            post&apos;s reaction counts.
          </p>
          <p>
            If you turn on picture checks in settings (they&apos;re off by default), it also loads each item&apos;s thumbnail or
            first picture from the site&apos;s own image server (i.ytimg.com, pbs.twimg.com or media.licdn.com): the same picture
            your browser is already showing. It shrinks that picture and sends the copy to be judged. The picture&apos;s address
            is used only to load it and is never sent.
          </p>
          <p>
            It does not read your browsing history, your messages, your account details, or anything on any other website.
          </p>
        </Section>

        <Section title="Where it goes">
          <p>
            To judge each item, the extension sends batches of up to 20 items, together with the goals you wrote, to an AI model
            from TypeSafe. With picture checks on, pictures go in separate batches of up to 10, each next to its item&apos;s text.
            Which way it goes depends on your setup:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-medium text-ink">With your own API key:</strong> straight from your browser to the provider
              you picked, {ext("https://openrouter.ai/privacy", "OpenRouter")} or {ext("https://typesafe.ai/privacy", "TypeSafe")}, along
              with your key. It does not pass through our server.
            </li>
            <li>
              <strong className="font-medium text-ink">Without a key (the free tier):</strong> to our server at{" "}
              <code className="font-mono text-[14px]">feed-filter-two.vercel.app</code>, which forwards it to the model through
              OpenRouter using our own key and returns the answers.
            </li>
          </ul>
          <p>The model returns a score for each item. The extension uses those scores only to decide what to blur.</p>
        </Section>

        <Section title="What our free-tier server keeps">
          <p>
            The free-tier server does not store or log the posts, titles, pictures or goals you send. To guard against abuse
            it keeps only counters of how many items and pictures were judged, keyed by:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>a one-way hash of a random install ID the extension creates when you install it, and</li>
            <li>a one-way hash of your IP address. The IP address itself is never stored.</li>
          </ul>
          <p>
            These counters expire on their own: the per-minute ones after two minutes and the daily ones at midnight UTC. They
            can&apos;t be used to identify you. The server runs on {ext("https://vercel.com/legal/privacy-notice", "Vercel")},
            and the counters live in {ext("https://upstash.com/trust/privacy.pdf", "Upstash")} Redis. As hosting providers, they
            may keep standard request logs for a short time.
          </p>
        </Section>

        <Section title="What stays on your device">
          <p>
            In Chrome&apos;s local extension storage, never synced to an account: your settings, your goals, your API key if you
            add one, recent verdicts (kept for up to 7 days so the same post isn&apos;t judged twice), the random install ID, and
            where you placed the on-page switch. Uninstalling the extension deletes all of it. You can also clear the verdict cache
            from the options page at any time.
          </p>
        </Section>

        <Section title="What we don't do">
          <ul className="list-disc space-y-2 pl-5">
            <li>We don&apos;t sell or rent your data, or hand it to anyone except the providers named above for judging posts.</li>
            <li>We don&apos;t use it for advertising, profiling, or anything unrelated to filtering your feed.</li>
            <li>We don&apos;t use it to decide creditworthiness or for lending.</li>
            <li>The extension has no analytics, tracking or accounts, and it runs no code from outside its own package.</li>
          </ul>
          <p>
            Our use of information received through the extension complies with the{" "}
            {ext("https://developer.chrome.com/docs/webstore/program-policies/user-data-faq", "Chrome Web Store User Data Policy")},
            including its Limited Use requirements.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            If the extension starts handling data differently, this page will change first, with a new date at the top. For
            questions or requests, open an issue on {ext(`${SITE.repo}/issues`, "GitHub")}.
          </p>
        </Section>
      </main>

      <Footer />
    </>
  );
}
