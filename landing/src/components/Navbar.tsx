"use client";

import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { SITE } from "@/lib/site";
import { btn, Logo } from "./ui";

const LINKS = [
  { label: "Goals", href: "#goals" },
  { label: "How it works", href: "#how" },
  { label: "Where", href: "#where" },
  { label: "FAQ", href: "#faq" },
];

export function Navbar() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  return (
    <div className="fixed inset-x-0 top-3 z-50 px-3 sm:top-4">
      <motion.header
        className="mx-auto flex h-14 max-w-[1000px] items-center justify-between rounded-full pl-5 pr-2"
        animate={{
          backgroundColor: scrolled ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0)",
          boxShadow: scrolled ? "0 10px 30px -14px rgba(22,21,15,0.28), inset 0 0 0 1px rgba(22,21,15,0.08)" : "0 0 0 0 rgba(22,21,15,0), inset 0 0 0 1px rgba(22,21,15,0)",
        }}
        transition={{ duration: 0.3 }}
        style={{ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
      >
        <a href="#top" aria-label="Focus, back to top">
          <Logo className="text-[16px]" />
        </a>
        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-[14px] text-muted transition-colors hover:bg-ink/5 hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
        <a href={SITE.store} target="_blank" rel="noreferrer" className={`${btn.ink} px-4 py-2.5 text-[14px]`}>
          Get the extension
        </a>
      </motion.header>
    </div>
  );
}
