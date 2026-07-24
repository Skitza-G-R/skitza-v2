import Link from "next/link";
import { notFound } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createDb, producers, eq } from "@skitza/db";

import { verifiedEmailHashesFromUser } from "~/server/auth/verified-email";
import { connectVerifiedArtistToProducer } from "~/server/contacts/connect-artist";

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
  // The success state below is only rendered after this server-side
  // connection is durable. A transient failure stays local to this
  // screen and offers a retry without claiming the studio was added.
  const { userId } = await auth();
  let connectionConfirmed = false;
  if (userId) {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;
    if (email) {
      const verifiedEmailHashes = verifiedEmailHashesFromUser(user, userId);
      const name =
        [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
        user?.username ||
        email.split("@")[0] ||
        "Artist";
      try {
        await connectVerifiedArtistToProducer(db, {
          producerId: producer.id,
          primaryEmail: email,
          verifiedEmailHashes,
          name,
          clerkUserId: userId,
        });
        connectionConfirmed = true;
      } catch (err) {
        console.error(
          "[artist-welcome] connectVerifiedArtistToProducer failed",
          { producerSlug: slug },
          err,
        );
      }
    }
  }

  const displayName = producer.displayName ?? "this producer";

  return (
    <div className="sk-safe-top sk-safe-bottom mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12 text-center">
      <h1 className="font-display text-3xl tracking-tight">Welcome to Skitza.</h1>

      {connectionConfirmed ? (
        <>
          <p className="mt-4 text-sm text-[rgb(var(--fg-secondary))]">
            You&apos;re now connected to{" "}
            <span className="font-semibold text-[rgb(var(--fg-primary))]">{displayName}</span>.
            Their catalog, booking, and session history will show up in your artist workspace.
          </p>

          <Link
            href={`/artist?studio=${producer.id}`}
            className={[
              "sk-press sk-cta-shine mt-10 inline-flex min-h-12 items-center justify-center",
              "rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))]",
              "px-8 py-3 text-sm font-semibold text-[#0C0A07]",
              "transition-transform hover:-translate-y-[1px] hover:scale-[1.02] active:translate-y-[1px]",
              "focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))] focus-visible:outline-none",
            ].join(" ")}
          >
            Continue to your studio →
          </Link>
        </>
      ) : (
        <>
          <p
            role="alert"
            className="mt-4 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.1)] px-4 py-3 text-sm text-[rgb(var(--fg-danger-text))]"
          >
            We couldn&apos;t confirm your connection to {displayName}. No studio access was added.
            Check your connection and try again.
          </p>
          <form action={`/artist-welcome/${encodeURIComponent(slug)}`} method="get">
            <button
              type="submit"
              className="sk-press mt-10 inline-flex min-h-12 w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-8 py-3 text-sm font-semibold text-[rgb(var(--fg-on-brand))]"
            >
              Try connecting again
            </button>
          </form>
        </>
      )}

      <p className="mt-8 text-xs text-[rgb(var(--fg-muted))]">
        If you were invited under a different email, ask {displayName} to re-send the invite to the
        address you used to sign up.
      </p>
    </div>
  );
}
