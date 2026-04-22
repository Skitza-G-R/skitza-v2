import { notFound } from "next/navigation";
import { createDb, producers, eq } from "@skitza/db";

import { joinArtistWorkspace } from "./actions";

// `/artist-welcome/<slug>` — the post-signup splash shown to users
// who just signed up via /join/<slug>. Distinct from the sibling
// `/artist-welcome` (no-slug) page, which is the generic "you have no
// studios yet, ask a producer for an invite" copy.
//
// 2026-04-22 — Added as part of Task 15 (docs/audit-report.md). The
// /join/<slug> → /sign-up/join/<slug> flow now lands here after Clerk
// provisions the account and our webhook inserts the right
// client_contacts row (scoped to this producer).
//
// 2026-04-22 (follow-up) — the "Open my artist workspace →" button is
// now a SERVER ACTION form (joinArtistWorkspace) rather than a plain
// <Link href="/artist">. This closes the webhook-race bug Gili caught
// in manual QA: the Clerk webhook and the browser's redirect to this
// splash are independent processes, and a fast-clicker could beat the
// webhook and land on /artist with no client_contacts row yet — at
// which point (artist)/layout bounced them to the generic orphan
// welcome. The server action does the client_contacts upsert
// synchronously on button click, so by the time we redirect to
// /artist the relationship is already in the DB.
//
// If the slug doesn't resolve to a producer (tampered / stale link /
// deleted producer) → 404. The fallback welcome at /artist-welcome
// is the right destination for true orphans.

type Props = { params: Promise<{ slug: string }> };

export default async function JoinedArtistWelcomePage({ params }: Props) {
  const { slug } = await params;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const db = createDb(dbUrl);
  const [producer] = await db
    .select({ displayName: producers.displayName, slug: producers.slug })
    .from(producers)
    .where(eq(producers.slug, slug))
    .limit(1);

  if (!producer) notFound();

  const displayName = producer.displayName ?? "this producer";

  // Pre-bind the producer's slug onto the server action so the
  // button can submit with a single `type="submit"` inside a form —
  // no need for a hidden input. Per Next.js App Router server-action
  // patterns, `.bind(null, slug)` returns a new action callable that
  // closes over the slug server-side.
  const submitAction = joinArtistWorkspace.bind(null, slug);

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="font-display text-3xl tracking-tight">Welcome to Skitza.</h1>

      <p className="mt-4 text-sm text-[rgb(var(--fg-secondary))]">
        You&apos;re now connected to{" "}
        <span className="font-semibold text-[rgb(var(--fg-primary))]">
          {displayName}
        </span>
        . Their catalog, booking, and session history will show up in your
        artist workspace.
      </p>

      <form action={submitAction} className="mt-10">
        <button
          type="submit"
          className={[
            "sk-cta-shine inline-flex min-h-12 items-center justify-center",
            "rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))]",
            "px-8 py-3 text-sm font-semibold text-[#0C0A07]",
            "transition-transform hover:scale-[1.02] hover:-translate-y-[1px] active:translate-y-[1px]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
          ].join(" ")}
        >
          Open my artist workspace →
        </button>
      </form>

      <p className="mt-8 text-xs text-[rgb(var(--fg-muted))]">
        If you were invited under a different email, ask {displayName} to
        re-send the invite to the address you used to sign up.
      </p>
    </div>
  );
}
