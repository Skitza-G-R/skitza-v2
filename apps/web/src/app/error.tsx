"use client";

// Segment-level error boundary for the root. Catches uncaught errors in
// Server Components beneath the root layout (but not inside the root
// layout itself — that's global-error.tsx's job).
//
// `reset()` retries the last render; we expose it as a recovery button.

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "~/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Digest is Next's server-side crash identifier — surface in the
  // console so you can grep Vercel logs, but never show to the visitor.
  useEffect(() => {
    if (typeof console !== "undefined" && error.digest) {
      console.error("[skitza] render error", error.digest, error.message);
    }
  }, [error]);

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[rgb(var(--bg-base))] px-6 text-center text-[rgb(var(--fg-primary))]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[rgb(var(--fg-danger)/0.08)] blur-[110px]" />
      </div>
      <div className="relative z-10 max-w-md">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          Unexpected state
        </p>
        <h1
          className="mt-3 font-display text-5xl leading-[0.95] tracking-tight sm:text-6xl"
          style={{ fontVariationSettings: '"opsz" 144' }}
        >
          Something buzzed.
        </h1>
        <p className="mt-5 text-[rgb(var(--fg-secondary))]">
          An error broke this page. It&apos;s logged on our side — try again, and
          if it keeps happening, your last action probably didn&apos;t take.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
        {error.digest ? (
          <p className="mt-8 font-mono text-xs text-[rgb(var(--fg-muted))]">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
