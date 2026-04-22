import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { fetchUserRole } from "~/server/auth/role";
import { decideArtistWelcomeRedirect } from "./decide-redirect";

// `/artist-welcome` — the generic no-slug orphan welcome. Shown ONLY
// to truly-orphan authed users: signed in, but no producer row AND
// no client_contacts for their Clerk user id. In practice that's the
// webhook-race window (usually sub-second) or a webhook-delivery
// failure.
//
// 2026-04-22 — Added role-check guard. Before this, the page was a
// bare Server Component with zero auth/role logic — any authed user
// who landed here (via (artist)/layout redirecting on webhook-race,
// browser back button, reload, etc.) saw the "ask a producer for a
// link" copy even when their account was fully provisioned. Now the
// page resolves the user's role server-side and redirects everyone
// but true orphans to their correct destination.
//
// The sibling /artist-welcome/<slug> page (the post-signup splash
// greeting a just-joined artist with the producer's display name) is
// a separate route with its own logic — that one uses a server
// action on click to insert client_contacts synchronously.
export default async function ArtistWelcomePage() {
  const { userId } = await auth();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideArtistWelcomeRedirect(role);
  if (redirectTo) redirect(redirectTo);

  // Only truly-orphan authed users reach this render path. Give them
  // a useful signal + a one-click reload (their webhook might just
  // be pending — sub-second window, refresh usually self-heals).
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
