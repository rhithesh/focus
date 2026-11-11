"use client";

import {
  animate,
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { HERO_GOAL, ITEMS, WALL, WALL_NOISE, WALL_TOTAL, isNoise } from "@/lib/feed";
import { SITE } from "@/lib/site";
import { FeedCard } from "./FeedCard";
import { btn, Glyph } from "./ui";

const EASE = [0.2, 0.7, 0.2, 1] as const;
const SPEEDS = [26, 20, 30, 22]; // px per second
const COL_VISIBILITY = ["", "", "hidden md:block", "hidden lg:block"];

/** One column of the wall, looping forever. Two copies stacked; we wrap at one copy's height. */
function Column({ ids, index, on, speed }: { ids: string[]; index: number; on: boolean; speed: MotionValue<number> }) {
  const copyRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const dir = index % 2 === 0 ? -1 : 1;

  useAnimationFrame((_, delta) => {
    const h = copyRef.current?.offsetHeight ?? 0;
    if (!h) return;
    let next = y.get() + dir * SPEEDS[index] * speed.get() * (Math.min(delta, 64) / 1000);
    if (next <= -h) next += h;
    if (next > 0) next -= h;
    y.set(next);
  });

  const copy = (n: number) => (
    <div ref={n === 0 ? copyRef : undefined} aria-hidden={n === 1 || undefined} className="flex flex-col gap-4 pb-4">
      {ids.map((id, row) => (
        <FeedCard key={id + n} item={ITEMS[id]} blurred={on && isNoise(id)} delay={index * 0.12 + row * 0.07} />
      ))}
    </div>
  );

  return (
    <div className={COL_VISIBILITY[index]}>
      <motion.div style={{ y }} className="will-change-transform">
        {copy(0)}
        {copy(1)}
      </motion.div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label="Filter"
      onClick={() => onChange(!on)}
      className={`relative flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors duration-300 ${on ? "bg-ink" : "bg-ink/15"}`}
    >
      <motion.span
        className={`block size-5 rounded-full shadow ${on ? "bg-lime" : "bg-card"}`}
        animate={{ x: on ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 600, damping: 34 }}
      />
    </button>
  );
}

function Headline({ on }: { on: boolean }) {
  const [peek, setPeek] = useState(false);
  const blur = on && !peek;
  const words = ["Your", "feeds,"];
  return (
    <h1 className="font-serif text-[clamp(58px,10.5vw,148px)] leading-[0.9] tracking-[-0.025em]">
      {words.map((w, i) => (
        <span key={w} className="ff-slide mr-[0.2em] inline-block" style={{ "--d": 0.05 + i * 0.08 + "s" } as React.CSSProperties}>
          {w}
        </span>
      ))}
      <br />
      <span className="ff-slide mr-[0.2em] inline-block" style={{ "--d": "0.21s" } as React.CSSProperties}>
        minus
      </span>
      <span className="ff-slide inline-block" style={{ "--d": "0.29s" } as React.CSSProperties}>
        the{" "}
        <motion.span
          className="inline-block cursor-help italic"
          onHoverStart={() => setPeek(true)}
          onHoverEnd={() => setPeek(false)}
          animate={{ filter: blur ? "blur(0.07em)" : "blur(0em)", opacity: blur ? 0.6 : 1 }}
          transition={{ duration: blur ? 0.9 : 0.25, ease: EASE }}
        >
          noise.
        </motion.span>
      </span>
    </h1>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const [on, setOn] = useState(false);
  const touched = useRef(false);
  const wallRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wallRef);
  const speed = useMotionValue(1);
  const [hovering, setHovering] = useState(false);

  // Show the raw feed for a beat, then switch the filter on, like opening a tab with the extension installed.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!touched.current) setOn(true);
    }, reduce ? 0 : 1600);
    return () => clearTimeout(t);
  }, [reduce]);

  // Glide to a stop while the pointer is over the wall so a card can be peeked at; freeze off-screen.
  useEffect(() => {
    const target = reduce || !inView ? 0 : hovering ? 0 : 1;
    const a = animate(speed, target, { duration: target ? 0.8 : 0.5, ease: "easeOut" });
    return () => a.stop();
  }, [hovering, inView, reduce, speed]);

  const setFilter = (v: boolean) => {
    touched.current = true;
    setOn(v);
  };

  return (
    <section id="top" className="relative overflow-hidden pt-32 sm:pt-36">
      <div className="mx-auto max-w-[1200px] px-5 text-center">
        {/* Above-the-fold entrances are CSS (.ff-rise), not Motion: they start with the first paint
            instead of waiting for hydration, which keeps Largest Contentful Paint fast. */}
        <div className="ff-rise inline-flex items-center gap-2 rounded-full border border-ink/10 bg-card/70 px-3 py-1.5 text-[13px] text-muted">
          <span className="flex gap-1">
            <Glyph platform="youtube" className="size-4" />
            <Glyph platform="x" className="size-4" />
            <Glyph platform="linkedin" className="size-4" />
          </span>
          <span className="hidden sm:inline">A Chrome extension for YouTube, X and LinkedIn</span>
          <span className="sm:hidden">For YouTube, X and LinkedIn</span>
        </div>

        <div className="mt-7">
          <Headline on={on} />
        </div>

        <p
          className="ff-slide mx-auto mt-7 max-w-[560px] text-[17px] leading-relaxed text-muted sm:text-[18px]"
          style={{ "--d": "0.3s" } as React.CSSProperties}
        >
          Write down what you&rsquo;re on these sites for. Focus blurs the clickbait, the scams and
          everything off-goal. Hover anything to see it anyway.
        </p>

        <div className="ff-rise mt-9 flex flex-wrap justify-center gap-3" style={{ "--d": "0.38s" } as React.CSSProperties}>
          <a href={SITE.store} target="_blank" rel="noreferrer" className={btn.ink}>
            Get the extension
            <span aria-hidden>→</span>
          </a>
          <a href="#how" className={btn.ghost}>
            How it works
          </a>
        </div>
      </div>

      <div
        style={{ "--d": "0.55s" } as React.CSSProperties}
        className="ff-rise relative z-20 mx-auto mt-16 flex w-fit max-w-[calc(100%-2.5rem)] flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-[22px] border border-ink/10 bg-card px-4 py-3 shadow-[0_12px_40px_-16px_rgba(22,21,15,0.35)] sm:rounded-full sm:py-2.5 sm:pl-3"
      >
        <div className="flex items-center gap-3">
          <Toggle on={on} onChange={setFilter} />
          <span className="w-[74px] text-left text-[14px] font-medium">Filter {on ? "on" : "off"}</span>
        </div>
        <span className="hidden h-5 w-px bg-line sm:block" />
        <span className="max-w-[340px] truncate text-[13px] text-muted" title={HERO_GOAL}>
          Goal: <span className="text-ink">{HERO_GOAL}</span>
        </span>
        <span className="hidden h-5 w-px bg-line sm:block" />
        <span className="text-[13px] tabular-nums text-muted" aria-live="polite">
          <motion.span key={String(on)} className="inline-block font-medium text-ink" initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            {on ? WALL_NOISE : 0}
          </motion.span>{" "}
          of {WALL_TOTAL} blurred
        </span>
      </div>

      <motion.div
        ref={wallRef}
        className="ff-fade wall-mask relative -mt-7 h-[620px] overflow-hidden sm:h-[700px]"
        onHoverStart={() => setHovering(true)}
        onHoverEnd={() => setHovering(false)}
      >
        <div className="mx-auto grid max-w-[1320px] grid-cols-2 gap-3 px-3 pt-4 sm:gap-4 sm:px-5 md:grid-cols-3 lg:grid-cols-4">
          {WALL.map((ids, i) => (
            <Column key={i} ids={ids} index={i} on={on} speed={speed} />
          ))}
        </div>
      </motion.div>

    </section>
  );
}
