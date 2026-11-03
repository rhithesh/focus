"use client";

import { motion } from "motion/react";
import Image from "next/image";
import { useState } from "react";
import type { Item, Post, Video } from "@/lib/feed";
import { Glyph } from "./ui";

const AVATAR_TONES = ["#E8D9A8", "#CFE6D6", "#D9D3F1", "#F3C8B6", "#C8DCF1", "#E9D0E4", "#DDE7B8"];

function Avatar({ name, size = "size-9" }: { name: string; size?: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span aria-hidden className={`grid ${size} shrink-0 place-items-center rounded-full text-[11px] font-semibold text-ink/80`} style={{ background: tone }}>
      {initials}
    </span>
  );
}

const firstNum = (s: string) => s.split(" · ").map((p) => p.split(" ")[0]);

const INK_UI = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * A YouTube feed tile: the dark #0f0f0f card the real home feed renders, with
 * a full-bleed thumbnail, white two-line title and grey channel/views stack.
 */
function VideoBody({ v }: { v: Video }) {
  return (
    <div className="text-left">
      <div className="relative aspect-video overflow-hidden rounded-t-2xl">
        {"src" in v.thumb ? (
          <Image src={v.thumb.src} alt="" fill sizes="(min-width: 1024px) 20rem, 50vw" className="object-cover" draggable={false} />
        ) : (
          <div
            className="grid h-full place-items-center p-3 text-center text-[clamp(15px,1.9vw,22px)] font-black leading-[1.02] tracking-tight"
            style={{ background: v.thumb.bg, color: v.thumb.fg }}
          >
            {v.thumb.text}
          </div>
        )}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 text-[10px] font-medium leading-4 text-white">{v.duration}</span>
      </div>
      <div className="mt-2.5 flex gap-2.5 px-2.5 pb-2.5">
        <Avatar name={v.channel} size="size-9" />
        <div className="min-w-0">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-[#f1f1f1]">{v.title}</p>
          <p className="mt-1 truncate text-[11.5px] leading-4 text-[#aaaaaa]">{v.channel}</p>
          <p className="truncate text-[11.5px] leading-4 text-[#aaaaaa]">{v.meta}</p>
        </div>
      </div>
    </div>
  );
}

function XBody({ p }: { p: Post }) {
  const [replies, reposts, likes] = firstNum(p.stats);
  return (
    <div className="flex gap-3 p-3.5">
      <Avatar name={p.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">
          <span className="font-semibold">{p.name}</span>{" "}
          <span className="text-muted">
            {p.handle} · {p.when}
          </span>
        </p>
        <p className="mt-1 whitespace-pre-line text-[13.5px] leading-snug">{p.text}</p>
        <div className="mt-2.5 flex justify-between pr-4 text-[11.5px] text-muted">
          <span>↩ {replies}</span>
          <span>⇄ {reposts}</span>
          <span>♡ {likes}</span>
        </div>
      </div>
    </div>
  );
}

/** A LinkedIn post: white card, system-ui type, real reactions row and action bar. */
function LinkedInBody({ p }: { p: Post }) {
  const [, comments] = firstNum(p.stats);
  const reactions = p.stats.split(" · ")[0];
  return (
    <div className="text-left text-[#191919]" style={{ fontFamily: INK_UI }}>
      <div className="flex gap-2 p-3">
        <Avatar name={p.name} size="size-10" />
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold">{p.name}</p>
          <p className="truncate text-[11px] text-[#666666]">{p.handle}</p>
          <p className="truncate text-[10.5px] text-[#666666]">
            {p.when} ·{" "}
            <svg viewBox="0 0 24 24" className="inline size-2.5 align-[-1px]" fill="none" stroke="#666666" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
            </svg>
          </p>
        </div>
      </div>
      <p className="px-3 pb-2.5 whitespace-pre-line text-[13px] leading-[1.45]">{p.text}</p>
      <div className="flex items-center px-3 pb-2 text-[11px] text-[#56687a]">
        <span className="flex -space-x-0.5" aria-hidden>
          <span className="grid size-4 place-items-center rounded-full border border-card bg-[#378FE9]">
            <svg viewBox="0 0 24 24" className="size-2.5" fill="#fff" aria-hidden>
              <path d="M7 21V10l4.2-6c1.1-.5 2.2.3 2.2 1.5V9h4.1c1.3 0 2.2 1.2 1.9 2.4l-1.6 7C17 19.4 16.2 20 15 20H7z" />
            </svg>
          </span>
          <span className="grid size-4 place-items-center rounded-full border border-card bg-[#DF704D]">
            <svg viewBox="0 0 24 24" className="size-2.5" fill="#fff" aria-hidden>
              <path d="M12 2l2.4 7.6H22l-6.2 4.5 2.4 7.6L12 17l-6.2 4.7L8.2 14 2 9.6h7.6z" />
            </svg>
          </span>
          <span className="grid size-4 place-items-center rounded-full border border-card bg-[#6DAE4F]">
            <svg viewBox="0 0 24 24" className="size-2.5" fill="#fff" aria-hidden>
              <path d="M12 21s-8-4.5-8-10a4.4 4.4 0 018-2.5A4.4 4.4 0 0120 11c0 5.5-8 10-8 10z" />
            </svg>
          </span>
        </span>
        <span className="ml-1">{reactions}</span>
        <span className="ml-1">· {comments} comments</span>
      </div>
      <div className="mx-3 mb-2 flex items-center justify-between border-t border-[#e8e5e0] px-1.5 pt-1.5 text-[11px] font-semibold text-[#56687a]">
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M7 21V10l4.2-6c1.1-.5 2.2.3 2.2 1.5V9h4.1c1.3 0 2.2 1.2 1.9 2.4l-1.6 7C17 19.4 16.2 20 15 20H7zM4 9v12h2V9z" />
          </svg>
          Like
        </span>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M4 4h16a1 1 0 011 1v12a1 1 0 01-1 1H8l-5 4V5a1 1 0 011-1z" />
          </svg>
          Comment
        </span>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M20 5a9 9 0 00-9 9v5M20 5h-6M20 5v6" />
            <path d="M4 19a9 9 0 013-3" />
          </svg>
          Repost
        </span>
      </div>
    </div>
  );
}

/**
 * One feed item. When `blurred`, the content blurs under a paper tint, exactly
 * like the extension; hover (or tap, on touch) peeks through.
 */
export function FeedCard({
  item,
  blurred,
  delay = 0,
  showGlyph = true,
  className = "",
}: {
  item: Item;
  blurred: boolean;
  delay?: number;
  showGlyph?: boolean;
  className?: string;
}) {
  const [peek, setPeek] = useState(false);
  const veiled = blurred && !peek;
  const t = { duration: peek ? 0.2 : 0.55, delay: veiled && !peek ? delay : 0, ease: [0.2, 0.7, 0.2, 1] as const };
  // The skins pair with each body: YouTube's tile carries its own dark panel,
  // LinkedIn's white card gets the flat grey border the real feed draws.
  const skin =
    item.platform === "youtube"
      ? "border-[#2b2a24] bg-[#0f0f0f] text-[#f1f1f1]"
      : item.platform === "linkedin"
        ? "border-[#e0ddd6] bg-card text-[#191919]"
        : "border-line bg-card";

  return (
    <motion.article
      className={`relative overflow-hidden rounded-2xl border shadow-[0_1px_0_rgba(22,21,15,0.04),0_8px_24px_-12px_rgba(22,21,15,0.18)] ${skin} ${className}`}
      onHoverStart={() => setPeek(true)}
      onHoverEnd={() => setPeek(false)}
      onPointerUp={(e) => {
        if (e.pointerType === "touch") setPeek((p) => !p);
      }}
    >
      <motion.div
        initial={false}
        animate={{ filter: veiled ? "blur(7px) saturate(0.6)" : "blur(0px) saturate(1)" }}
        transition={t}
      >
        {item.platform === "youtube" ? <VideoBody v={item} /> : item.platform === "x" ? <XBody p={item} /> : <LinkedInBody p={item} />}
      </motion.div>
      {showGlyph && (
        <span className="absolute right-2.5 top-2.5 z-10 rounded-md bg-card/90 p-0.5 shadow-sm">
          <Glyph platform={item.platform} className="size-3.5" />
        </span>
      )}
      <motion.div
        aria-hidden
        className="ygf-veil pointer-events-none absolute inset-0"
        initial={false}
        animate={{ opacity: veiled ? 1 : 0 }}
        transition={t}
      />
      {blurred && <span className="sr-only">Blurred by Feed Filter.</span>}
    </motion.article>
  );
}
