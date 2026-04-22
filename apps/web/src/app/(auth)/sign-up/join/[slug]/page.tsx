import { SignUp } from "@clerk/nextjs";

// Dedicated sign-up entry for the /join/<slug> → artist flow.
//
// 2026-04-22 — Added as part of the Task-15 fix (see
// docs/audit-report.md). The default /sign-up page creates a Producer
// and force-redirects to /dashboard. That is the wrong destination for
// a visitor who arrived from a producer's /join/<slug> public teaser —
// they're an artist, not a producer.
//
// How this works end-to-end:
//  1. `SignupCta` on `/join/<slug>` points its Link at
//     `/sign-up/join/<slug>` (this route).
//  2. This page renders Clerk's `<SignUp>` with
//     `unsafeMetadata={ signupOrigin: "join", producerSlug: <slug> }`.
//     Clerk passes that metadata along to the `user.created` webhook.
//  3. Our webhook at `/api/webhooks/clerk` reads the metadata, resolves
//     the slug to a real producer, and — critically — inserts a
//     `client_contacts` row instead of a `producers` row.
//  4. `fallbackRedirectUrl` sends the freshly-signed-in user to
//     `/artist-welcome/<slug>`, which greets them + links onward
//     into the artist app.
//
// "unsafe" in Clerk's naming just means "client-settable" — it's fine
// to use here because the webhook re-validates the slug against the
// DB before trusting it. If a user tampers with it, the webhook falls
// back to the default producer-insert branch.
//
// We use `fallbackRedirectUrl` (not `forceRedirectUrl`) so any
// `redirect_url` query param the user happens to land with also wins.
// In practice the CTA doesn't set one, but keeping the precedence
// flexible is the right default.

type Props = { params: Promise<{ slug: string }> };

export default async function JoinSignUpPage({ params }: Props) {
  const { slug } = await params;

  return (
    <SignUp
      signInUrl="/sign-in"
      fallbackRedirectUrl={`/artist-welcome/${encodeURIComponent(slug)}`}
      unsafeMetadata={{ signupOrigin: "join", producerSlug: slug }}
    />
  );
}
