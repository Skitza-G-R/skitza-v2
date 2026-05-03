"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "~/components/ui/button";

// T8 — completion screen. Full-page centered layout, brand-primary
// checkmark, copy-to-clipboard for the producer's join link.

export function CompleteScreenClient({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const joinLink = `skitza.app/join/${slug}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // clipboard write can throw in non-secure contexts; a silent
      // failure is fine here — the link text is selectable below.
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgb(var(--brand-primary)/0.08)] blur-[140px]" />
      </div>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center px-6 text-center">
        <svg
          aria-hidden
          viewBox="0 0 64 64"
          className="h-16 w-16 text-[rgb(var(--brand-primary))]"
        >
          <circle
            cx="32"
            cy="32"
            r="30"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            opacity="0.3"
          />
          <path
            d="M20 33 L29 42 L45 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <h1
          className="mt-7 font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          You&apos;re all set.
        </h1>

        <p className="mt-4 text-[rgb(var(--fg-secondary))]">
          Your studio is ready. Share your link with artists and start booking.
        </p>

        <div className="mt-8 flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2">
          <code className="flex-1 truncate text-left font-mono text-sm text-[rgb(var(--fg-primary))]">
            {joinLink}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void handleCopy();
            }}
            aria-label="Copy join link"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <Button asChild size="lg" className="mt-8">
          <Link href="/dashboard">Go to my dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
