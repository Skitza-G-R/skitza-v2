import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import {
  and,
  clientContacts,
  createDb,
  eq,
  isNull,
  producers,
} from "@skitza/db";
import { emailHashFor } from "~/server/artist/identity";
import { fetchUserRole } from "~/server/auth/role";
import { decideArtistWelcomeRedirect } from "./decide-redirect";

// `/artist-welcome` — generic no-slug orphan welcome + self-heal path.
//
// 2026-04-22 — Verified via Vercel logs that Gili's /artist-welcome
// requests NEVER triggered joinArtistWorkspace's console.log, meaning
// the button-click + slug-page flow silently failed in production
// (likely a Server Actions / RSC caching quirk we couldn't diagnose
// remotely). Switched to an INLINE self-heal here: if the user has
// Clerk unsafeMetadata.signupOrigin === "join" and a producer slug,
// do the client_contacts INSERT + re-read in the SAME request, then
// redirect to /artist only if the re-read confirms the row. No
// cross-request state, no redirect loop, no Neon HTTP consistency
// gotchas — it all happens inside one Node function invocation.
//
// Logs upgraded from console.log → console.error so they reliably
// surface in Vercel's default filter. Marked for removal once Sentry
// is wired (roadmap S2.3).

export const dynamic = "force-dynamic";

export default async function ArtistWelcomePage() {
  const { userId } = await auth();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  console.error("[/artist-welcome] role resolved:", role.kind, "userId:", userId);

  const redirectTo = decideArtistWelcomeRedirect(role);
  if (redirectTo) {
    console.error("[/artist-welcome] primary redirect:", redirectTo);
    redirect(redirectTo);
  }

  // Orphan path. Try the INLINE self-heal before rendering the welcome
  // copy. All work happens in this single request so Neon's read-after-
  // write consistency across requests isn't a concern.
  if (role.kind === "orphan" && userId) {
    const user = await currentUser();
    const meta = user?.unsafeMetadata as
      | { signupOrigin?: unknown; producerSlug?: unknown }
      | undefined
      | null;
    const rawEmail = user?.emailAddresses[0]?.emailAddress;
    const signupOrigin = meta?.signupOrigin;
    const producerSlug = meta?.producerSlug;
    console.error("[/artist-welcome] orphan recovery check:", {
      hasMetadata: !!meta,
      signupOrigin,
      producerSlug,
      hasEmail: !!rawEmail,
    });

    if (
      signupOrigin === "join" &&
      typeof producerSlug === "string" &&
      rawEmail
    ) {
      const db = createDb(dbUrl);
      const email = rawEmail.trim().toLowerCase();
      const emailHash = emailHashFor(rawEmail);

      // Find the target producer.
      const [producer] = await db
        .select({ id: producers.id })
        .from(producers)
        .where(eq(producers.slug, producerSlug))
        .limit(1);
      console.error("[/artist-welcome] producer lookup by slug:", {
        producerSlug,
        found: !!producer,
        producerId: producer?.id,
      });

      if (producer) {
        // Upsert the client_contacts row. Idempotent — if a row
        // already exists for (producerId, emailHash) we skip.
        const firstName = user.firstName?.trim() ?? "";
        try {
          await db
            .insert(clientContacts)
            .values({
              producerId: producer.id,
              emailHash,
              email,
              name: firstName || email.split("@")[0] || "Artist",
              clerkUserId: userId,
            })
            .onConflictDoNothing();
          console.error(
            "[/artist-welcome] INLINE insert complete",
            { producerId: producer.id, userId },
          );
        } catch (err) {
          console.error(
            "[/artist-welcome] INLINE insert threw:",
            err instanceof Error ? err.message : err,
          );
        }

        // Stamp clerkUserId on any pre-existing contacts (multi-
        // producer identity unification).
        try {
          await db
            .update(clientContacts)
            .set({ clerkUserId: userId })
            .where(
              and(
                eq(clientContacts.emailHash, emailHash),
                isNull(clientContacts.clerkUserId),
              ),
            );
        } catch (err) {
          console.error(
            "[/artist-welcome] stamp-update threw:",
            err instanceof Error ? err.message : err,
          );
        }

        // Re-read in the SAME request to confirm the row is visible
        // before redirecting. Avoids the loop risk where a subsequent
        // request might not see the write yet (Neon HTTP eventual
        // consistency across requests).
        const [confirm] = await db
          .select({ id: clientContacts.id })
          .from(clientContacts)
          .where(eq(clientContacts.clerkUserId, userId))
          .limit(1);
        console.error("[/artist-welcome] re-read confirmation:", {
          foundAfterInsert: !!confirm,
        });

        if (confirm) {
          console.error("[/artist-welcome] self-heal succeeded → /artist");
          redirect("/artist");
        }
        // If re-read didn't see the row, fall through to the orphan
        // copy with an explanatory message. At least the user isn't
        // stuck in a loop.
      }
    }
  }

  // True orphan (or self-heal didn't succeed). Render the welcome
  // copy with a Refresh link + sign-out escape hatch.
  console.error(
    "[/artist-welcome] rendering orphan copy (self-heal did not redirect)",
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
