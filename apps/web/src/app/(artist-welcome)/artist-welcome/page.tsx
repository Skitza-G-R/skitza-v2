import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { fetchUserRole } from "~/server/auth/role";
import { decideArtistWelcomeRedirect } from "./decide-redirect";

// `/artist-welcome` — the generic no-slug orphan welcome, rendered
// ONLY for truly-orphan authed users.
//
// Defensive layers added 2026-04-22 after Gili got stuck here
// repeatedly despite multiple attempted fixes:
//   1. Role guard via fetchUserRole (Task 16 helper) — any role
//      other than "orphan" gets redirected to their real destination.
//   2. Orphan recovery via Clerk unsafeMetadata — if the user is
//      orphan AND their Clerk profile carries signupOrigin="join"
//      metadata (set by /sign-up/join/[slug] at signup time), bounce
//      them to /artist-welcome/<slug>. That slug page auto-runs the
//      client_contacts upsert + redirects to /artist. This rescues
//      any orphan whose webhook was delayed / failed / never fired.
//   3. Heavy console.log on every decision branch so the next time
//      someone reports "stuck on orphan welcome" we can trace
//      exactly what role resolved + what metadata was present.
//   4. User-facing "Refresh" link for the sub-second webhook-race
//      window where a reload self-heals.
//
// All logging is removed once Sentry lands (roadmap S2.3).
export default async function ArtistWelcomePage() {
  const { userId } = await auth();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  console.log("[/artist-welcome] role resolved:", role.kind, "userId:", userId);

  const redirectTo = decideArtistWelcomeRedirect(role);
  if (redirectTo) {
    console.log("[/artist-welcome] primary redirect:", redirectTo);
    redirect(redirectTo);
  }

  // Orphan recovery path. If the Clerk user has unsafeMetadata
  // indicating they signed up via /join/<slug> (metadata set by
  // /sign-up/join/[slug]/[[...rest]]/page.tsx at signup time),
  // bounce them to the slug page — that page auto-runs the
  // client_contacts upsert + redirects to /artist. This closes the
  // "webhook never fired + action never ran" failure mode for
  // anyone who somehow ended up here without going through the
  // slug page's auto-insert.
  if (role.kind === "orphan" && userId) {
    const user = await currentUser();
    const meta = user?.unsafeMetadata as
      | { signupOrigin?: unknown; producerSlug?: unknown }
      | undefined
      | null;
    const signupOrigin = meta?.signupOrigin;
    const producerSlug = meta?.producerSlug;
    console.log("[/artist-welcome] orphan recovery check:", {
      hasMetadata: !!meta,
      signupOrigin,
      producerSlug,
    });
    if (signupOrigin === "join" && typeof producerSlug === "string") {
      console.log(
        "[/artist-welcome] orphan recovery: bouncing to slug page to trigger auto-insert",
        { producerSlug },
      );
      redirect(`/artist-welcome/${encodeURIComponent(producerSlug)}`);
    }
  }

  // True orphan with no recovery metadata — render the welcome copy
  // with a Refresh link + sign-out escape hatch.
  console.log(
    "[/artist-welcome] rendering orphan copy (no metadata recovery available)",
  );
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="font-display text-3xl tracking-tight">
        Welcome to Skitza.
      </h1>
      <p className="mt-4 text-sm text-[rgb(var(--fg-secondary))]">
        Once a producer invites you to work on a project, your studios
        will show up here. Ask the producer to send you a Skitza link
        — clicking it from the same email address you used to sign in
        will connect everything automatically.
      </p>
      <p className="mt-8 text-xs text-[rgb(var(--fg-muted))]">
        Just signed up? Your workspace may still be loading.
      </p>
      <Link
        href="/artist-welcome"
        prefetch={false}
        className="mt-1 inline-block text-sm text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
      >
        Refresh
      </Link>
      <p className="mt-6 text-xs text-[rgb(var(--fg-muted))]">
        Already have an invite link?
      </p>
      <Link
        href="/sign-out"
        className="mt-1 inline-block text-sm text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
      >
        Sign out + click the invite from your email
      </Link>
    </div>
  );
}
