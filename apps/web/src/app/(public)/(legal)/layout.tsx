import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// Shared shell for the legal / informational pages: privacy, terms,
// about. These nest inside the (public) `data-theme="chrome-dark"`
// wrapper but shouldn't render dark — they're marketing-adjacent, not
// content-consumption.
//
// Phase D retired the `[data-theme="chrome-light"]` escape-hatch
// selector (light is :root now). To re-assert warm cream inside a
// dark-scoped parent, we inline-override the palette tokens on this
// wrapper. Token *names* stay identical, so every nested
// `rgb(var(--bg-base))` call-site keeps working unchanged. This is
// independent of the global next-themes toggle — legal pages are
// deliberately a fixed editorial surface.
const LIGHT_TOKENS: CSSProperties & Record<string, string> = {
  "--bg-base": "244 239 231",
  "--bg-elevated": "251 247 240",
  "--bg-overlay": "246 240 231",
  "--bg-sunken": "232 226 217",
  "--fg-primary": "26 23 20",
  "--fg-secondary": "61 55 48",
  "--fg-muted": "107 97 88",
  "--fg-inverse": "251 247 240",
  "--border-subtle": "0 0 0 / 0.08",
  "--border-strong": "0 0 0 / 0.14",
  colorScheme: "light",
};

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={LIGHT_TOKENS}
      className="relative min-h-dvh overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-8rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[rgb(var(--brand-primary)/0.08)] blur-[120px]" />
      </div>
      <header className="relative z-10 mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
        <Link href="/" className="font-display text-xl tracking-tight">
          Skitza
        </Link>
        <nav className="flex items-center gap-4 font-mono text-xs text-[rgb(var(--fg-secondary))]">
          <Link href="/about" className="hover:text-[rgb(var(--fg-primary))]">About</Link>
          <Link href="/privacy" className="hover:text-[rgb(var(--fg-primary))]">Privacy</Link>
          <Link href="/terms" className="hover:text-[rgb(var(--fg-primary))]">Terms</Link>
        </nav>
      </header>
      <main className="relative z-10 mx-auto max-w-3xl px-6 pb-20">
        <article className="prose-skitza">{children}</article>
      </main>
    </div>
  );
}
