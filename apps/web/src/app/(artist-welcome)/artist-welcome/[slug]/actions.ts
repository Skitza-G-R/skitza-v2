"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  and,
  clientContacts,
  createDb,
  eq,
  isNull,
  producers,
} from "@skitza/db";
import { emailHashFor } from "~/server/artist/identity";

// `joinArtistWorkspace` — server action behind the "Open my artist
// workspace →" button on /artist-welcome/<slug>.
//
// 2026-04-22 — Added as a fix for the webhook-race bug Gili caught in
// manual QA: when an artist signs up via /join/<slug>, Clerk's
// user.created webhook fires async (typically 500ms-2s), while the
// browser is redirected to /artist-welcome/<slug> immediately. If the
// user clicks through the splash BEFORE the webhook lands, they hit
// /artist with no client_contacts row yet → (artist)/layout sees no
// studios and redirects them to the generic /artist-welcome orphan
// page ("ask a producer to send you a link") — which is wrong, they
// just signed up via this producer's link.
//
// This action removes the race entirely by doing the insert
// synchronously on button-click BEFORE redirecting. The webhook is
// now an optimisation: if it fires first, the unique
// (producer_id, email_hash) constraint + onConflictDoNothing makes
// this insert a no-op; if the webhook is still pending, this insert
// IS the primary write.
//
// Also stamps clerk_user_id on any OTHER pre-existing client_contacts
// rows sharing this email hash — same "multi-producer artist
// identity" logic as the webhook. Works whether or not the user has
// been invited by another producer before.

export async function joinArtistWorkspace(slug: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) {
    redirect(
      `/sign-in?redirect_url=/artist-welcome/${encodeURIComponent(slug)}`,
    );
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const db = createDb(dbUrl);

  const user = await currentUser();
  const rawEmail = user?.emailAddresses[0]?.emailAddress;
  if (!user || !rawEmail) {
    throw new Error("unable to resolve email from Clerk session");
  }
  const email = rawEmail.trim().toLowerCase();
  const emailHash = emailHashFor(rawEmail);
  const firstName = user.firstName?.trim() ?? "";

  // Resolve the producer by slug. Use NOT_FOUND → fall through to
  // /artist (user ends up on the generic welcome if they have no
  // other studios) rather than 500-ing the action.
  const [producer] = await db
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.slug, slug))
    .limit(1);
  if (!producer) {
    redirect("/artist");
  }

  // Upsert the client_contacts row. The UNIQUE(producer_id, email_hash)
  // constraint + onConflictDoNothing means re-running this (e.g. if
  // the webhook already fired) is a safe no-op.
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

  // Stamp clerkUserId on any OTHER pre-existing client_contacts rows
  // for this email (across all producers). Mirrors the webhook's
  // final UPDATE — ensures multi-producer artist identity unifies
  // whether the user signed up via /join or was pre-invited by
  // another producer earlier.
  await db
    .update(clientContacts)
    .set({ clerkUserId: userId })
    .where(
      and(
        eq(clientContacts.emailHash, emailHash),
        isNull(clientContacts.clerkUserId),
      ),
    );

  redirect("/artist");
}
