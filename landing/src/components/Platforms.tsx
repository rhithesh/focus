"use client";

import { motion } from "motion/react";
import { ITEMS, type Platform } from "@/lib/feed";
import { FeedCard } from "./FeedCard";
import { Glyph, Kicker, Mark, Reveal } from "./ui";

const PLATFORMS: { key: Platform; name: string; where: string; catches: string[]; example: string }[] = [
  {
    key: "youtube",
    name: "YouTube",
    where: "Home, search, the watch-next sidebar and Shorts.",
    catches: [" reaction thumbnails", "I made $10k in a day", "rabbit holes off your goal"],
    example: "yt-millionaire",
  },
  {
    key: "x",
    name: "X",
    where: "Your For you and Following timelines.",
    catches: ["rage-bait and dunks", "airdrop and giveaway scams", "engagement farming"],
    example: "x-airdrop",
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    where: "Your home feed.",
    catches: ["one-line-per-sentence broetry", "“Agree?” and “Comment YES”", "thought-leader filler"],
    example: "li-fired",
  },
];

const NUMBERS = [
  { big: "$0.0003", small: "to judge a page of ten posts" },
  { big: "~1s", small: "for the whole page, in one request" },
  { big: "7 days", small: "verdicts are cached, so scrolling back is free" },
  { big: "0", small: "posts or goals stored by Focus, free tier included" },
];

export function Platforms() {
  return (
    <section id="where" className="mt-24 bg-night text-paper sm:mt-36">
      <div className="mx-auto max-w-[1200px] px-5 py-24 sm:py-32">
        <Reveal>
          {/*<Kicker dark>Three feeds, one filter</Kicker>*/}
          <h2 className="mt-4 max-w-[860px] font-serif text-[clamp(44px,6.4vw,84px)] leading-[0.95] tracking-[-0.02em]">
            Works where you <Mark dark>actually</Mark> scroll.
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {PLATFORMS.map((p, i) => (
            <Reveal key={p.key} delay={i * 0.1} className="h-full">
              <div className="flex h-full flex-col rounded-[28px] bg-night-2 p-5">
                <div className="flex items-center gap-2.5">
                  <Glyph platform={p.key} className="size-7" />
                  <h3 className="text-[20px] font-semibold tracking-tight">{p.name}</h3>
                </div>
                <p className="mt-3 text-[14.5px] leading-relaxed text-paper/60">{p.where}</p>
                <ul className="mt-4 space-y-2">
                  {p.catches.map((c) => (
                    <li key={c} className="flex items-start gap-2.5 text-[14.5px]">
                      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-lime" />
                      {c}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-6 text-ink">
                  <FeedCard item={ITEMS[p.example]} blurred showGlyph={false} />
                  <p className="mt-2.5 text-center text-[12px] text-paper/40">Hover to peek</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>


      </div>
    </section>
  );
}
