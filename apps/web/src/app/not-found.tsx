import Link from "next/link";

import { Button } from "~/components/ui/button";

// Global 404. Next routes here for both no-match URLs and explicit
// `notFound()` calls from server components. Post-Story-03 (PRD §6.6)
// the legacy `/p/<slug>` + `/p/<slug>/book` routes are removed
// entirely, so any visitor hitting one of those lands here. Typo'd
// dashboard paths and unknown `/join/<slug>` slugs also land here.
// Magic-link failures (`/m/[token]`) return raw 404s, not HTML.
export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[rgb(var(--bg-base))] px-6 text-center text-[rgb(var(--fg-primary))]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[rgb(var(--brand-primary)/0.08)] blur-[120px]" />
      </div>
      <div className="relative z-10">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          Error 404 · Signal lost
        </p>
        <h1
          className="mt-4 font-display text-[clamp(4rem,14vw,9rem)] leading-none tracking-tight"
          style={{ fontVariationSettings: '"opsz" 144' }}
        >
          Off-air.
        </h1>
        <p className="mx-auto mt-6 max-w-md text-[rgb(var(--fg-secondary))]">
          This page doesn&apos;t exist — or the studio behind it has moved on.
          Try the homepage, or the producer&apos;s portfolio URL if you came from
          a magic link.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/">Back to Skitza</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sign-up">Make your own studio</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
