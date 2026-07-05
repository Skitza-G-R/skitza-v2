"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ChevronLeft, CloseIcon } from "~/components/artist/funnel/funnel-icons";
import {
  lerp,
  stickyBtnBackground,
  stickyEase,
  stickyIconColor,
} from "~/components/artist/sticky-nav-math";

// StickyNav — Handoff 4's collapsing header for standing screens with a
// cover hero (S1 join, S2 store). Floats transparent over the cover
// (glassy dark back button, no title), then fades to a solid cream bar
// with a centered Syne title as the page scrolls, so the status bar
// always ends up resting on a clean background.
//
// Scroll source is the window (artist pages scroll the document). The
// ease value is quantized so scrolling doesn't re-render per pixel.

const NAV_H = 46;
const QUANT = 0.02;

type StickyNavProps = {
  title: string;
  sub?: string;
  /** Renders a round back button linking here (Link). */
  backHref?: string;
  /** Alternative to backHref for client-side back (e.g. router.back). */
  onBack?: () => void;
  backIcon?: "chev" | "close";
  /** Optional right-side slot (round button expected). */
  action?: React.ReactNode;
  /** Scroll offsets (px) where the collapse starts/completes. */
  start?: number;
  end?: number;
};

export function StickyNav({
  title,
  sub,
  backHref,
  onBack,
  backIcon = "chev",
  action,
  start = 46,
  end = 116,
}: StickyNavProps) {
  const [ease, setEase] = useState(0);

  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const next = stickyEase(window.scrollY, start, end);
      setEase((prev) => (Math.abs(next - prev) < QUANT && next !== 0 && next !== 1 ? prev : next));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [start, end]);

  const btnStyle: React.CSSProperties = {
    width: 38,
    height: 38,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: stickyBtnBackground(ease),
    color: stickyIconColor(ease),
    backdropFilter: "blur(14px) saturate(160%)",
    WebkitBackdropFilter: "blur(14px) saturate(160%)",
    boxShadow: `0 2px 10px rgba(0,0,0,${String(lerp(0.22, 0.08, ease))})`,
    border: `0.5px solid rgba(17,16,9,${String(lerp(0, 0.06, ease))})`,
  };

  const backContent = backIcon === "close" ? <CloseIcon /> : <ChevronLeft />;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50"
      style={{ height: `calc(env(safe-area-inset-top, 0px) + ${String(NAV_H + 8)}px)` }}
    >
      {/* solid backing fades in */}
      <div
        aria-hidden
        className="absolute inset-0 border-b"
        style={{
          background: "rgb(var(--bg-background) / 0.88)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          borderColor: `rgb(17 16 9 / ${String(0.08 * ease)})`,
          opacity: ease,
          transition: "opacity 0.1s linear",
        }}
      />
      {/* nav row */}
      <div
        className="pointer-events-auto absolute inset-x-3.5 flex items-center justify-between"
        style={{ top: `calc(env(safe-area-inset-top, 0px) + 4px)`, height: NAV_H }}
      >
        {backHref ? (
          <Link href={backHref} aria-label="Back" className="sk-press-pop" style={btnStyle}>
            {backContent}
          </Link>
        ) : onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="sk-press-pop"
            style={btnStyle}
          >
            {backContent}
          </button>
        ) : (
          <span style={{ width: 38 }} />
        )}
        {/* collapsing centered title */}
        <div
          className="pointer-events-none absolute inset-x-14 text-center"
          style={{ opacity: ease, transform: `translateY(${String(lerp(7, 0, ease))}px)` }}
        >
          <div className="font-syne text-fg-default truncate text-[15px] font-extrabold tracking-[-0.02em]">
            {title}
          </div>
          {sub ? (
            <div className="label-eyebrow text-fg-muted mt-px text-[9px] tracking-[0.08em] normal-case">
              {sub}
            </div>
          ) : null}
        </div>
        {action ?? <span style={{ width: 38 }} />}
      </div>
    </div>
  );
}
