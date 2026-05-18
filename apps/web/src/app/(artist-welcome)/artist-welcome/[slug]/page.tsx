import Link from "next/link";
import { notFound } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createDb, producers, eq } from "@skitza/db";

import { connectArtistToProducer } from "~/server/contacts/connect-artist";

// `/artist-welcome/<slug>` — the post-signup splash shown to users
// who just signed up (or signed in) via the /join/<slug> funnel.
// Distinct from the sibling `/artist-welcome` (no-slug) page, which
// is the generic "you have no studios yet, ask a producer for an
// invite" copy.
//
// 2026-04-22 — Added as part of Task 15 (docs/audit-report.md).
// 2026-05-19 — Now also the canonical connect step for ALREADY
//              signed-in artists arriving via a different producer's
//              /join link. Originally the Clerk user.created webhook
//              was the only thing inserting client_contacts for the
//              join flow — that worked once per user (the artist's
//              first signup) but never fired again when the same
//              artist visited another producer's link. We now upsert
//              here on every render: idempotent for repeat visits,
//              and the single mechanism handling brand-new
//              connections, CRM-pre-added connections, and
//              reconnects after a Settings → Disconnect.
//
// The upsert happens server-side BEFORE the page paints, so by the
// time the artist clicks "Continue", the connection is durable.
// We deliberately keep the splash (rather than redirecting straight
// to /artist) so the returning artist sees the connection
// acknowledged — silent connect would look like the click did
// nothing.
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
    .select({
      id: producers.id,
      displayName: producers.displayName,
      slug: producers.slug,
    })
    .from(producers)
    .where(eq(producers.slug, slug))
    .limit(1);

  if (!producer) notFound();

  // Server-side connect step. Runs for both first-time signups (where
  // the Clerk webhook ALSO inserts the same row — onConflictDoUpdate
  // makes the two paths cleanly converge) and for returning signed-in
  // artists arriving at a new producer's link (where the webhook
  // doesn't fire because the Clerk user already exists).
  //
  // Failure here would be sub-optimal but not catastrophic — the
  // splash still renders, and the artist could navigate to /artist
  // and see zero studios. We swallow + log so a transient DB blip
  // doesn't error-page the welcome surface; observability picks it
  // up via Sentry on the server.
  const { userId } = await auth();
  if (userId) {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;
    if (email) {
      const name =
        [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
        user?.username ||
        email.split("@")[0] ||
        "Artist";
      try {
        await connectArtistToProducer(db, {
          producerId: producer.id,
          email,
          name,
          clerkUserId: userId,
        });
      } catch (err) {
        console.error(
          "[artist-welcome] connectArtistToProducer failed",
          { producerSlug: slug },
          err,
        );
      }
    }
  }

  const displayName = producer.displayName ?? "this producer";

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

      <Link
        href={`/artist?studio=${producer.id}`}
        className={[
          "sk-cta-shine mt-10 inline-flex min-h-12 items-center justify-center",
          "rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))]",
          "px-8 py-3 text-sm font-semibold text-[#0C0A07]",
          "transition-transform hover:scale-[1.02] hover:-translate-y-[1px] active:translate-y-[1px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
        ].join(" ")}
      >
        Continue to your studio →
      </Link>

      <p className="mt-8 text-xs text-[rgb(var(--fg-muted))]">
        If you were invited under a different email, ask {displayName} to
        re-send the invite to the address you used to sign up.
      </p>
    </div>
  );
}
