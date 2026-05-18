import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createDb, eq, producers } from "@skitza/db";

import { AuthHero } from "~/components/auth/auth-hero";
import { fetchUserRole } from "~/server/auth/role";
import { connectArtistToProducer } from "~/server/contacts/connect-artist";
import { SignOutAndReturnButton } from "./sign-out-and-return-button";

// Dedicated sign-up entry for the /join/<slug> → artist flow.
//
// 2026-04-22 — FIX v2. Initial attempt (v1) mounted SignUp at the
// specific route /sign-up/join/[slug]/page.tsx, which looked right
// but broke Clerk's multi-step flow. When the user submitted their
// email and Clerk needed to navigate to /sign-up/join/<slug>/verify-
// email-address (or /sso-callback for OAuth), that sub-path had no
// matching route — result: white page / infinite loading loop /
// bounce to a different sign-in surface.
//
// Clerk's docs are explicit: "The route needs to be an optional
// catch-all route so the sign-up flow can handle nested paths."
// https://clerk.com/docs/reference/components/authentication/sign-up
//
// Fix: this file now lives under an optional catch-all segment
// ([[...rest]]), so /sign-up/join/<slug> AND any sub-path like
// /sign-up/join/<slug>/verify-email-address all resolve here. The
// `path` prop tells Clerk where it's mounted so it navigates to
// sub-paths under THIS route instead of defaulting to /sign-up.
//
// End-to-end flow (how this works):
//  1. `SignupCta` on `/join/<slug>` points its Link at
//     `/sign-up/join/<slug>`.
//  2. This page renders Clerk's `<SignUp>` with
//     `unsafeMetadata={ signupOrigin: "join", producerSlug: <slug> }`,
//     and `path={`/sign-up/join/${slug}`}` so Clerk's internal
//     routing stays within this subtree.
//  3. The webhook at `/api/webhooks/clerk` reads the metadata on
//     `user.created`, resolves the slug to a real producer, and
//     inserts a `client_contacts` row instead of a `producers` row.
//  4. `fallbackRedirectUrl` sends the freshly-signed-in user to
//     `/artist-welcome/<slug>`, which greets them + links to /artist.
//
// "unsafe" in Clerk's naming just means "client-settable" — it's
// fine to use because the webhook re-validates the slug against the
// DB before trusting it. A tampered metadata value falls through to
// the default producer-insert branch.
//
// 2026-05-08 — Producer-already-signed-in branch.
//
// When a producer who's already signed in clicks "Book a session" on
// /join/<slug>, they hit this route. Clerk's <SignUp> auto-redirects
// signed-in users to fallbackRedirectUrl (/artist-welcome/<slug>),
// whose CTA points at /artist, whose layout calls requireRole("artist"),
// which then bounces a `producer-complete` to /dashboard. End result:
// "Book a session" feels broken — it lands the producer on their
// dashboard with no explanation.
//
// The fix is local to this page (Option A from the diagnosis): peek
// the role via fetchUserRole (no redirect), and if the visitor is
// `producer-complete`, render an explainer screen instead of <SignUp>.
// The role isolation policy in server/auth/role.ts is intentionally
// untouched — that contract is depended on across the producer/artist
// boundary and changing it here would be out of scope.

type Props = { params: Promise<{ slug: string; rest?: string[] }> };

export default async function JoinSignUpPage({ params }: Props) {
  const { slug } = await params;

  // Peek the role server-side. fetchUserRole is the I/O wrapper
  // around resolveUserRole + Drizzle lookups — it returns the role
  // shape WITHOUT redirecting (decideRoleRedirect is what redirects;
  // we deliberately skip that step here). Anonymous visitors come
  // back as { kind: "unauthenticated" } and fall through to <SignUp>
  // exactly as before.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const { userId } = await auth();
  const role = await fetchUserRole({ dbUrl, userId });

  // Signed-in artist arriving at a (potentially different) producer's
  // join link. Without intervention here, Clerk's <SignUp> would
  // auto-redirect them to fallbackRedirectUrl (/artist-welcome/<slug>)
  // — that destination now also runs the connect upsert, so this
  // branch is technically defense-in-depth. We still do the upsert
  // here to (a) handle the case where Clerk's redirect chain skips
  // the welcome page for any reason, and (b) make the route's
  // connect contract explicit at every entry point. The redirect to
  // /artist-welcome/<slug> preserves the splash so the artist sees
  // the connection acknowledged before landing in their workspace.
  if (role.kind === "artist") {
    const db = createDb(dbUrl);
    const [producer] = await db
      .select({ id: producers.id })
      .from(producers)
      .where(eq(producers.slug, slug))
      .limit(1);

    if (producer && userId) {
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
          // Swallow + log: the welcome page will retry the same
          // upsert, so a transient failure here doesn't strand the
          // artist. Sentry surfaces it server-side.
          console.error(
            "[sign-up/join] connectArtistToProducer failed",
            { producerSlug: slug },
            err,
          );
        }
      }
    }

    // Slug doesn't resolve → fall through to /artist-welcome/<slug>
    // anyway; that page's notFound() will render a 404 surface that
    // matches the rest of the join funnel.
    redirect(`/artist-welcome/${encodeURIComponent(slug)}`);
  }

  if (role.kind === "producer-complete") {
    const producerName = role.producer.displayName ?? "a producer";
    return (
      <div className="space-y-6">
        <AuthHero
          eyebrow="Already signed in"
          title="You're signed in as a producer"
          blurb={
            <>
              You&apos;re currently signed in as{" "}
              <span
                className="font-semibold"
                style={{ color: "rgb(var(--fg-primary))" }}
              >
                {producerName}
              </span>
              . To book a session as an artist, you need to sign in with a
              different account.
            </>
          }
        />
        <div className="space-y-3">
          <SignOutAndReturnButton slug={slug} />
          <Link
            href="/dashboard"
            className={[
              "inline-flex min-h-12 w-full items-center justify-center",
              "rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]",
              "bg-transparent px-6 py-3 text-sm font-semibold",
              "text-[rgb(var(--fg-primary))]",
              "transition-colors hover:bg-[rgb(var(--bg-elevated))]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
            ].join(" ")}
          >
            Go to my dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Default branch — anonymous visitor or signed-in artist landing on
  // their own join sign-up. <SignUp> handles signed-in artists via its
  // own redirect-when-already-signed-in behavior (→ fallbackRedirectUrl
  // = /artist-welcome/<slug>, which is the correct destination for an
  // artist re-arriving on this URL).
  //
  // `path` must NOT be URL-encoded — Clerk uses it as-is for
  // navigation. Slugs are validated upstream as kebab-case ASCII
  // (^[a-z0-9-]+$), so percent-encoding is a no-op for us and
  // passing the raw slug avoids double-encoding when Clerk appends
  // sub-paths like "/verify-email-address".
  //
  // `fallbackRedirectUrl` IS URL-encoded — Next's router handles the
  // final navigation and expects a valid URL.
  return (
    <div className="space-y-6">
      <AuthHero
        eyebrow="Join Skitza"
        title="Make it official"
        blurb="One last step — your inbox stays clean and your producer keeps your tracks tight."
      />
      <SignUp
        path={`/sign-up/join/${slug}`}
        signInUrl="/sign-in"
        fallbackRedirectUrl={`/artist-welcome/${encodeURIComponent(slug)}`}
        unsafeMetadata={{ signupOrigin: "join", producerSlug: slug }}
      />
    </div>
  );
}
