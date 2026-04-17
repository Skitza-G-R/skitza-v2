import type { ReactNode } from "react";

// Public route group (`/p/[slug]`, `/m/[token]`, legal pages).
//
// `:root` in globals.css is LIGHT (warm cream) — that's the landing +
// producer workspace default. This wrapper opts public CONTENT pages
// into `data-theme="chrome-dark"` so a visitor who clicks a producer's
// magic link lands on a record-sleeve dark page, not the marketing
// cream. Matches the landing's own light → dark dramaturgy.
//
// Set on a wrapper `<div>` because Next's App Router allows exactly
// one `<html>` / `<body>`, which lives in app/layout.tsx.
//
// Bg + text are bound to the tokens so per-producer brand overrides
// (inline-style at a deeper workspace root, Task 10) still win via
// specificity.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-theme="chrome-dark"
      className="min-h-screen bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]"
    >
      {children}
    </div>
  );
}
