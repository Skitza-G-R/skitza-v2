import type { ReactNode } from "react";

// Public route group (`/p/[slug]`, future short-link landings, etc.).
//
// The chrome-dark theme is the `:root` default in globals.css, so this
// wrapper doesn't need a `data-theme` selector to opt in. We tag the wrapper
// `data-theme="chrome-dark"` purely as intent (and a hook for future
// per-page overrides) — it has no visual effect on its own. We can't set
// the theme on `<body>` here: Next.js App Router only allows ONE
// `<html>`/`<body>` and that lives in apps/web/src/app/layout.tsx.
//
// Background and text colors are bound to the resolved CSS tokens so any
// per-producer brand overrides applied deeper in the tree (Task 10) win
// via inline-style specificity at the workspace root.
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
