import { SignUp } from "@clerk/nextjs";

// Dedicated sign-up entry for the /join/<slug> → artist flow.
//
// 2026-05-06 — Removed `fallbackRedirectUrl={artist-welcome/<slug>}`.
// The destination is now decided server-side at /post-signup, which
// reads the same `unsafeMetadata` we set here, validates the slug
// against the DB, and redirects to /artist-welcome/<slug>. Centralizing
// the decision means: (a) tampered metadata can't bypass DB
// validation, (b) the Clerk dashboard's "After sign-up fallback"
// setting (= /post-signup) is the single source of truth for where
// signed-up users land.
//
// `unsafeMetadata` STAYS — it's how /post-signup knows this signup
// originated at /join/<slug>. The webhook also reads it on
// `user.created` to insert the right `client_contacts` row.
//
// "unsafe" in Clerk's naming means "client-settable" — both the
// webhook AND /post-signup re-validate the slug against the DB before
// trusting it.
//
// 2026-04-22 — FIX v2 background. Optional catch-all `[[...rest]]`
// is required so Clerk's multi-step flow (verify-email-address,
// sso-callback) resolves under this same route. The `path` prop tells
// Clerk where it's mounted so its internal navigation stays inside
// the subtree.
//
// End-to-end flow (current):
//   1. SignupCta on /join/<slug> links to /sign-up/join/<slug>.
//   2. This page mounts <SignUp unsafeMetadata={{signupOrigin, producerSlug}}>.
//   3. The webhook at /api/webhooks/clerk reads metadata + inserts
//      client_contacts (no producers row).
//   4. Clerk redirects the signed-in user to /post-signup (dashboard
//      setting) → which redirects to /artist-welcome/<slug>.

type Props = { params: Promise<{ slug: string; rest?: string[] }> };

export default async function JoinSignUpPage({ params }: Props) {
  const { slug } = await params;
  return (
    <SignUp
      path={`/sign-up/join/${slug}`}
      signInUrl="/sign-in"
      unsafeMetadata={{ signupOrigin: "join", producerSlug: slug }}
    />
  );
}
