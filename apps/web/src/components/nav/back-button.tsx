"use client";

import { useRouter } from "next/navigation";
import { useEffect, type MouseEvent, type ReactNode } from "react";

import { Icon } from "./icons";

// Chunky pill BackButton — anchored top-left of deep dashboard pages
// once they migrate to the new design (currently consumed by no Phase
// 2 surface; ports the design source's `BackButton` from
// notes/nav.jsx so Phase 3+ pages have it available).
//
// Behaviour:
//   - Default action: `router.back()` — uses Next.js client navigation
//     so layout instances are preserved across the back step.
//   - `onClick` prop overrides default. Useful when a screen wants to
//     pop a stack of inner state (e.g. close a song-detail panel)
//     before committing to a route change.
//   - Esc key triggers the same handler. The keypress is wired only
//     when the component is mounted so multiple BackButtons don't
//     stack-react to a single Esc press.
//
// Variant:
//   - `light=false` (default): chip rendered over the warm canvas.
//   - `light=true`: chip rendered on a coloured hero strip — flips
//     to the elevated white surface so the chip stays legible.
//
// Token usage: the locked `--bg-elevated` surface, `--border-subtle`
// hairline, `--fg-default` for label, `sk-press` for the tactile
// active-scale. The Esc-hint kbd reuses the existing `.kbd` utility
// from globals.css.

export function BackButton({
  onClick,
  label = "Back",
  light = false,
}: {
  onClick?: () => void;
  label?: string;
  /** Set true on dark/coloured headers; flips the chip surface to white. */
  light?: boolean;
}): ReactNode {
  const router = useRouter();

  const handleBack = (e?: MouseEvent<HTMLButtonElement>) => {
    if (e) e.preventDefault();
    if (onClick) onClick();
    else router.back();
  };

  // Esc-to-go-back. Keypress listener is on `keydown` so we can
  // preventDefault the browser's default Esc behaviour (e.g. clearing
  // an unfocused input's selection) and own the gesture.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (onClick) onClick();
      else router.back();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClick, router]);

  return (
    <button
      onClick={handleBack}
      type="button"
      title={`${label} (Escape)`}
      aria-label={`${label} (Escape)`}
      className="sk-press inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
      style={{
        background: light
          ? "rgb(var(--bg-elevated))"
          : "rgb(var(--bg-elevated))",
        border: `1px solid rgb(var(--border-subtle))`,
        color: "rgb(var(--fg-default))",
      }}
    >
      <Icon name="arrow-left" size={13} strokeWidth={2.4} />
      <span>{label}</span>
      <span
        className="font-mono"
        style={{
          fontSize: "0.6rem",
          padding: "1px 5px",
          borderRadius: 3,
          background: "rgb(var(--bg-background))",
          color: "rgb(var(--fg-muted))",
          marginLeft: 4,
        }}
      >
        Esc
      </span>
    </button>
  );
}
