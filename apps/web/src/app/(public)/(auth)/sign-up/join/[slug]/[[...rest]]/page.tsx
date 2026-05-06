import { SignUp } from "@clerk/nextjs";
import { AuthHero } from "~/components/auth/auth-hero";

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

type Props = { params: Promise<{ slug: string; rest?: string[] }> };

export default async function JoinSignUpPage({ params }: Props) {
  const { slug } = await params;
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
