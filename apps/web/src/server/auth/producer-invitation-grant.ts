import { type Db, createDb, eq, producerInvitationGrants, producers, sql } from "@skitza/db";

import { invitationPlaceholderSlug } from "~/lib/slug";

import type { AcceptedProducerInvitation } from "./producer-invitation";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ProducerInvitationGrantInput = AcceptedProducerInvitation &
  Readonly<{ clerkInstanceId: string; providerClerkUserId: string }>;

export type ProducerInvitationGrantResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "already_granted" }>
  | Readonly<{ status: "conflict" }>;

function sameInstant(left: Date, right: number): boolean {
  return left.getTime() === right;
}

function receiptMatches(
  existing: typeof producerInvitationGrants.$inferSelect,
  input: ProducerInvitationGrantInput,
): boolean {
  return (
    existing.clerkInvitationId === input.invitationId &&
    existing.clerkUserId === input.clerkUserId &&
    existing.providerClerkUserId === input.providerClerkUserId &&
    existing.clerkInstanceId === input.clerkInstanceId &&
    existing.invitedEmailHash === input.emailHash &&
    sameInstant(existing.invitationCreatedAt, input.createdAt) &&
    sameInstant(existing.providerUpdatedAt, input.updatedAt)
  );
}

/**
 * Claims one accepted invitation and creates the Producer membership in the
 * same transaction. An old receipt never recreates a deleted Producer role.
 */
export async function claimProducerInvitationGrant(
  dbUrl: string,
  input: ProducerInvitationGrantInput,
): Promise<ProducerInvitationGrantResult> {
  const db = createDb(dbUrl);

  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as TransactionDb;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`producer-invitation:${input.clerkUserId}`}, 0))`,
    );

    const [existingProducer] = await tx
      .select({ clerkUserId: producers.clerkUserId })
      .from(producers)
      .where(eq(producers.clerkUserId, input.clerkUserId))
      .limit(1);
    const [existingReceipt] = await tx
      .select()
      .from(producerInvitationGrants)
      .where(eq(producerInvitationGrants.clerkUserId, input.clerkUserId))
      .limit(1);

    if (existingReceipt) {
      return receiptMatches(existingReceipt, input) && existingProducer
        ? { status: "already_granted" as const }
        : { status: "conflict" as const };
    }

    if (existingProducer) {
      // Legacy Producers remain valid, but an invitation must not attach a new
      // immutable authorization story to a role created by an older path.
      return { status: "conflict" as const };
    }

    const claimed = await tx
      .insert(producerInvitationGrants)
      .values({
        clerkInvitationId: input.invitationId,
        clerkUserId: input.clerkUserId,
        providerClerkUserId: input.providerClerkUserId,
        clerkInstanceId: input.clerkInstanceId,
        invitedEmailHash: input.emailHash,
        invitationCreatedAt: new Date(input.createdAt),
        providerUpdatedAt: new Date(input.updatedAt),
      })
      .onConflictDoNothing()
      .returning({ clerkInvitationId: producerInvitationGrants.clerkInvitationId });

    if (claimed.length !== 1) return { status: "conflict" as const };

    const created = await tx
      .insert(producers)
      .values({
        clerkUserId: input.clerkUserId,
        email: input.emailAddress,
        displayName: null,
        slug: invitationPlaceholderSlug(input.emailAddress, input.invitationId),
      })
      .onConflictDoNothing()
      .returning({ clerkUserId: producers.clerkUserId });

    if (created.length !== 1) {
      throw new Error("PRODUCER_INVITATION_GRANT_CONFLICT");
    }

    return { status: "created" as const };
  });
}
