import {
  and,
  clientContacts,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  privateOffers,
  sql,
  type Db,
} from "@skitza/db";
import { emailHashFor } from "~/server/artist/identity";
import {
  assertStableArtistOwnerAssignment,
  ProjectOwnershipDomainError,
} from "~/server/domain/project-ownership/service";

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

  const [contact] = await db
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
      setWhere: sql`${clientContacts.clerkUserId} IS NULL OR ${clientContacts.clerkUserId} = ${input.clerkUserId}`,
      set: {
        clerkUserId: input.clerkUserId,
        archivedAt: null,
        lastSeenAt: now,
        // Preserve the producer's chosen name when the existing row
        // has one; only backfill if the stored name was empty.
        name: sql`COALESCE(NULLIF(${clientContacts.name}, ''), EXCLUDED.name)`,
      },
    })
    .returning({ clerkUserId: clientContacts.clerkUserId });
  if (!contact) {
    throw new ProjectOwnershipDomainError(
      "OWNER_CONFLICT",
      "This client already belongs to another verified account",
    );
  }
  assertStableArtistOwnerAssignment(contact.clerkUserId, input.clerkUserId);
}

/**
 * Claims pre-existing contacts during Clerk's user.created webhook without
 * letting a mutable email edit bypass a pending offer's frozen recipient.
 */
export async function stampUnownedArtistContactsForCreatedUser(
  db: Db,
  input: { email: string; clerkUserId: string; now?: Date },
): Promise<void> {
  const emailHash = emailHashFor(input.email);
  const now = input.now ?? new Date();
  await db
    .update(clientContacts)
    .set({ clerkUserId: input.clerkUserId })
    .where(
      and(
        eq(clientContacts.emailHash, emailHash),
        isNull(clientContacts.clerkUserId),
        notExists(
          db
            .select({ id: privateOffers.id })
            .from(privateOffers)
            .where(
              and(
                eq(privateOffers.clientContactId, clientContacts.id),
                eq(privateOffers.producerId, clientContacts.producerId),
                eq(privateOffers.status, "sent"),
                gt(privateOffers.expiresAt, now),
                ne(privateOffers.recipientEmailHash, emailHash),
              ),
            ),
        ),
      ),
    );
}

/**
 * Connects every producer contact that the signed-in Clerk account can prove
 * it owns. A pending private offer uses its frozen recipient hash, so editing
 * mutable contact email cannot transfer that offer or its target project.
 */
export async function connectVerifiedArtistToProducer(
  db: Db,
  input: {
    producerId: string;
    primaryEmail: string;
    verifiedEmailHashes: readonly string[];
    name: string;
    clerkUserId: string;
    now?: Date;
  },
): Promise<void> {
  const verifiedEmailHashes = [
    ...new Set(input.verifiedEmailHashes.filter((hash) => /^[0-9a-f]{64}$/.test(hash))),
  ];
  if (verifiedEmailHashes.length === 0) return;

  const verifiedSet = new Set(verifiedEmailHashes);
  const now = input.now ?? new Date();
  const normalizedPrimaryEmail = input.primaryEmail.trim().toLowerCase();

  await db.transaction(async (tx) => {
    const matchingOffers = await tx
      .select({ clientContactId: privateOffers.clientContactId })
      .from(privateOffers)
      .where(
        and(
          eq(privateOffers.producerId, input.producerId),
          eq(privateOffers.status, "sent"),
          gt(privateOffers.expiresAt, now),
          inArray(privateOffers.recipientEmailHash, verifiedEmailHashes),
        ),
      );
    const offerContactIds = [...new Set(matchingOffers.map((row) => row.clientContactId))];
    const candidateIdentity =
      offerContactIds.length === 0
        ? inArray(clientContacts.emailHash, verifiedEmailHashes)
        : or(
            inArray(clientContacts.emailHash, verifiedEmailHashes),
            inArray(clientContacts.id, offerContactIds),
          );
    const candidates = await tx
      .select({
        id: clientContacts.id,
        emailHash: clientContacts.emailHash,
        clerkUserId: clientContacts.clerkUserId,
      })
      .from(clientContacts)
      .where(and(eq(clientContacts.producerId, input.producerId), candidateIdentity))
      .for("update");

    if (candidates.length === 0) {
      if (!normalizedPrimaryEmail || !verifiedSet.has(emailHashFor(normalizedPrimaryEmail))) {
        return;
      }
      const [contact] = await tx
        .insert(clientContacts)
        .values({
          producerId: input.producerId,
          email: normalizedPrimaryEmail,
          emailHash: emailHashFor(normalizedPrimaryEmail),
          name: input.name.trim() || "Artist",
          clerkUserId: input.clerkUserId,
          firstSeenAt: now,
          lastSeenAt: now,
          archivedAt: null,
        })
        .onConflictDoUpdate({
          target: [clientContacts.producerId, clientContacts.emailHash],
          setWhere: sql`${clientContacts.clerkUserId} IS NULL OR ${clientContacts.clerkUserId} = ${input.clerkUserId}`,
          set: {
            clerkUserId: input.clerkUserId,
            archivedAt: null,
            lastSeenAt: now,
            name: sql`COALESCE(NULLIF(${clientContacts.name}, ''), ${input.name.trim() || "Artist"})`,
          },
        })
        .returning({ clerkUserId: clientContacts.clerkUserId });
      if (!contact) {
        throw new ProjectOwnershipDomainError(
          "OWNER_CONFLICT",
          "This client already belongs to another verified account",
        );
      }
      assertStableArtistOwnerAssignment(contact.clerkUserId, input.clerkUserId);
      return;
    }

    const candidateIds = candidates.map((candidate) => candidate.id);
    const activeOffers = await tx
      .select({
        clientContactId: privateOffers.clientContactId,
        recipientEmailHash: privateOffers.recipientEmailHash,
      })
      .from(privateOffers)
      .where(
        and(
          eq(privateOffers.producerId, input.producerId),
          inArray(privateOffers.clientContactId, candidateIds),
          eq(privateOffers.status, "sent"),
          gt(privateOffers.expiresAt, now),
        ),
      );
    const offerHashesByContact = new Map<string, string[]>();
    for (const offer of activeOffers) {
      const hashes = offerHashesByContact.get(offer.clientContactId) ?? [];
      hashes.push(offer.recipientEmailHash);
      offerHashesByContact.set(offer.clientContactId, hashes);
    }

    const claimableIds = candidates
      .filter((candidate) => {
        const activeOfferHashes = offerHashesByContact.get(candidate.id) ?? [];
        const provesCurrentEmail = verifiedSet.has(candidate.emailHash);
        const provesActiveOffer = activeOfferHashes.some((hash) => verifiedSet.has(hash));
        return (
          (candidate.clerkUserId === null || candidate.clerkUserId === input.clerkUserId) &&
          (provesCurrentEmail || provesActiveOffer) &&
          activeOfferHashes.every((hash) => verifiedSet.has(hash))
        );
      })
      .map((candidate) => candidate.id);
    if (claimableIds.length === 0) {
      throw new ProjectOwnershipDomainError(
        "OWNER_CONFLICT",
        "This client already belongs to another verified account",
      );
    }

    const claimed = await tx
      .update(clientContacts)
      .set({
        clerkUserId: input.clerkUserId,
        archivedAt: null,
        lastSeenAt: now,
        name: sql`COALESCE(NULLIF(${clientContacts.name}, ''), ${input.name.trim() || "Artist"})`,
      })
      .where(
        and(
          eq(clientContacts.producerId, input.producerId),
          inArray(clientContacts.id, claimableIds),
          or(isNull(clientContacts.clerkUserId), eq(clientContacts.clerkUserId, input.clerkUserId)),
        ),
      )
      .returning({ clerkUserId: clientContacts.clerkUserId });
    if (claimed.length !== claimableIds.length) {
      throw new ProjectOwnershipDomainError(
        "OWNER_CONFLICT",
        "This client already belongs to another verified account",
      );
    }
    for (const contact of claimed) {
      assertStableArtistOwnerAssignment(contact.clerkUserId, input.clerkUserId);
    }
  });
}
