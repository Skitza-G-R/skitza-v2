import Link from "next/link";
import type { ReactNode } from "react";

// Shared shell for the legal / informational pages: privacy, terms,
// about. Shows a lightweight header so visitors can navigate back.
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
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
