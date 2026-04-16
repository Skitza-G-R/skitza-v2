import Link from "next/link";
import type { ReactNode } from "react";

// Wrapper for the sign-in + sign-up pages. Adds a subtle atmospheric
// background + a "Skitza" wordmark so the Clerk widget doesn't sit on
// a blank body. The widget itself is themed via the root layout's
// ClerkProvider appearance prop.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-[-8rem] h-[38rem] w-[38rem] rounded-full bg-[rgb(var(--brand-primary)/0.10)] blur-[140px]" />
        <div className="absolute right-[-16rem] bottom-[-10rem] h-[30rem] w-[30rem] rounded-full bg-[rgb(var(--brand-accent)/0.10)] blur-[140px]" />
      </div>
      <header className="relative z-10 mx-auto w-full max-w-4xl px-6 py-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <AuthMark />
          <span className="font-display text-lg tracking-tight">Skitza</span>
        </Link>
      </header>
      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-12">
        {children}
      </div>
    </div>
  );
}

function AuthMark() {
  return (
    <svg aria-hidden width="24" height="24" viewBox="0 0 28 28">
      <defs>
        <linearGradient id="auth-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand-primary))" />
          <stop offset="100%" stopColor="rgb(var(--brand-accent))" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="rgb(var(--bg-elevated))" stroke="rgb(var(--border-strong))" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="url(#auth-mark)" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2" fill="url(#auth-mark)" />
    </svg>
  );
}
