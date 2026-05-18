import { clientContacts, sql, type Db } from "@skitza/db";
import { emailHashFor } from "~/server/artist/identity";

// Connect a signed-in Clerk user to a producer as that producer's
// artist. Idempotent UPSERT against client_contacts.(producer_id,
// email_hash) — the same call cleanly handles every case the join
// flow can land in:
//
//   (a) Brand-new connection. No row exists → INSERT with
//       clerkUserId stamped, archivedAt null. Producer's CRM now
//       shows the artist; artist's switcher will list this studio.
//
//   (b) Producer pre-added the artist via their CRM but the artist
//       hasn't signed in yet. A row exists with the email but
//       clerkUserId IS NULL. ON CONFLICT promotes the existing row
//       by stamping clerkUserId — preserves any tags/notes/
//       referralSource the producer already attached.
//
//   (c) Artist previously disconnected (Settings → Disconnect) and
//       is now reconnecting via the producer's /join link. A row
//       exists with archivedAt set. ON CONFLICT clears archivedAt
//       and re-stamps clerkUserId — single source of truth for
//       "this connection is live again", CRM history intact.
//
//   (d) Duplicate visit / page refresh. Row already linked and
//       active. ON CONFLICT no-ops the identity fields (same
//       clerkUserId, archivedAt already null) and bumps
//       lastSeenAt. Harmless.
//
// `name` is preserved if the existing row already has one — the
// producer's chosen display ("Maya from Coldplay's team") wins over
// what Clerk auto-derives from the artist's profile. We only fill
// it in if the existing row stored an empty string, which can
// happen for legacy rows.
//
// db is passed in so callers control connection reuse + so this is
// trivially testable. Mirrors `recordContact` in this directory.
export async function connectArtistToProducer(
  db: Db,
  input: {
    producerId: string;
    email: string;
    name: string;
    clerkUserId: string;
  },
): Promise<void> {
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) return;
  const emailHash = emailHashFor(normalizedEmail);
  const trimmedName = input.name.trim() || "Artist";
  const now = new Date();

  await db
    .insert(clientContacts)
    .values({
      producerId: input.producerId,
      email: normalizedEmail,
      emailHash,
      name: trimmedName,
      clerkUserId: input.clerkUserId,
      firstSeenAt: now,
      lastSeenAt: now,
      archivedAt: null,
    })
    .onConflictDoUpdate({
      target: [clientContacts.producerId, clientContacts.emailHash],
      set: {
        clerkUserId: input.clerkUserId,
        archivedAt: null,
        lastSeenAt: now,
        // Preserve the producer's chosen name when the existing row
        // has one; only backfill if the stored name was empty.
        name: sql`COALESCE(NULLIF(${clientContacts.name}, ''), EXCLUDED.name)`,
      },
    });
}
