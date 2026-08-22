import {
  and,
  clientContacts,
  clientInvitationEmailDeliveries,
  desc,
  eq,
  inArray,
  producers,
  sql,
  type ClientInvitationEmailMessageSnapshot,
  type Db,
} from "@skitza/db";

import { buildClientInviteUrl } from "~/lib/clients/invite-url";
import { emailHashFor } from "~/server/artist/identity";
import { clientAdvisoryLockKey } from "../client-management/lock";
import { digestCommercialSnapshot } from "../purchases/policy";
import {
  activeWorkImportInvitationGate,
  clientInvitationPresentationState,
  ClientInvitationDomainError,
  hasActiveClientConnection,
  resumableNormalClientInvitation,
  type ClientInvitationClaimResult,
  type ClientInvitationDeliveryRecord,
  type ClientInvitationDeliveryRepository,
} from "./service";

function operationKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new ClientInvitationDomainError(
      "INVALID_INPUT",
      "Invitation operation key must be between 1 and 200 characters",
    );
  }
  return normalized;
}

function digest(
  input: Readonly<{
    producerId: string;
    clientContactId: string;
    operationKey: string;
    recipientEmailHash: string;
    requestedByClerkUserId: string;
    messageSnapshot: ClientInvitationEmailMessageSnapshot;
  }>,
): string {
  return `sha256:${digestCommercialSnapshot({
    kind: "client-invitation-email-v1",
    producerId: input.producerId,
    clientContactId: input.clientContactId,
    operationKey: input.operationKey,
    recipientEmailHash: input.recipientEmailHash,
    requestedByClerkUserId: input.requestedByClerkUserId,
    messageSnapshot: input.messageSnapshot,
  })}`;
}

function idempotencyKey(
  input: Readonly<{
    producerId: string;
    clientContactId: string;
    operationKey: string;
  }>,
): string {
  return `client-invite:${input.clientContactId}:${digestCommercialSnapshot({
    kind: "client-invitation-provider-operation-v1",
    ...input,
  })}`;
}

function record(
  row: typeof clientInvitationEmailDeliveries.$inferSelect,
): ClientInvitationDeliveryRecord {
  return {
    id: row.id,
    clientContactId: row.clientContactId,
    producerId: row.producerId,
    operationKey: row.operationKey,
    operationDigest: row.operationDigest,
    recipientEmail: row.recipientEmail,
    recipientEmailHash: row.recipientEmailHash,
    messageSnapshot: row.messageSnapshot,
    requestedByClerkUserId: row.requestedByClerkUserId,
    providerIdempotencyKey: row.providerIdempotencyKey,
    status: row.status,
    claimToken: row.claimToken,
    claimUntil: row.claimUntil,
    attemptCount: row.attemptCount,
    firstAttemptAt: row.firstAttemptAt,
    lastAttemptAt: row.lastAttemptAt,
    providerDedupeExpiresAt: row.providerDedupeExpiresAt,
    providerMessageId: row.providerMessageId,
    providerAcceptedAt: row.providerAcceptedAt,
    lastFailedAt: row.lastFailedAt,
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertReservationReplay(
  delivery: ClientInvitationDeliveryRecord,
  expected: Readonly<{
    producerId: string;
    clientContactId: string;
    operationKey: string;
    operationDigest: string;
    recipientEmail: string;
    recipientEmailHash: string;
    messageSnapshot: ClientInvitationEmailMessageSnapshot;
    requestedByClerkUserId: string;
    providerIdempotencyKey: string;
  }>,
): void {
  if (
    delivery.producerId !== expected.producerId ||
    delivery.clientContactId !== expected.clientContactId ||
    delivery.operationKey !== expected.operationKey ||
    delivery.operationDigest !== expected.operationDigest ||
    delivery.recipientEmail !== expected.recipientEmail ||
    delivery.recipientEmailHash !== expected.recipientEmailHash ||
    delivery.requestedByClerkUserId !== expected.requestedByClerkUserId ||
    delivery.providerIdempotencyKey !== expected.providerIdempotencyKey ||
    digestCommercialSnapshot(delivery.messageSnapshot) !==
      digestCommercialSnapshot(expected.messageSnapshot)
  ) {
    throw new ClientInvitationDomainError(
      "OPERATION_KEY_CONFLICT",
      "This invitation operation key belongs to different details",
    );
  }
}

type ClientInvitationReservation = Readonly<{
  delivery: ClientInvitationDeliveryRecord;
  created: boolean;
}>;

export type ActiveWorkImportClientInvitationReservation =
  | Readonly<{ state: "reserved"; delivery: ClientInvitationDeliveryRecord }>
  | Readonly<{ state: "connected" }>
  | Readonly<{ state: "provider_accepted"; providerAcceptedAt: Date }>
  | Readonly<{ state: "ineligible" }>;

type ReservationInput = Readonly<{
  producerId: string;
  clientContactId: string;
  operationKey: string;
  requestedByClerkUserId: string;
  siteUrl: string;
  requestedAt?: Date;
  activeWorkExpectedEmailHash?: string;
}>;

async function reserveClientInvitationEmailInternal(
  db: Db,
  input: ReservationInput,
): Promise<ClientInvitationReservation | ActiveWorkImportClientInvitationReservation> {
  const key = operationKey(input.operationKey);
  const requestedAt = input.requestedAt ?? new Date();
  if (Number.isNaN(requestedAt.getTime())) {
    throw new ClientInvitationDomainError("INVALID_INPUT", "Invitation time must be valid");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${clientAdvisoryLockKey(input.clientContactId)}, 0))`,
    );
    const [client] = await tx
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, input.clientContactId),
          eq(clientContacts.producerId, input.producerId),
        ),
      )
      .limit(1)
      .for("update");
    const [producer] = await tx
      .select({
        id: producers.id,
        clerkUserId: producers.clerkUserId,
        slug: producers.slug,
        displayName: producers.displayName,
      })
      .from(producers)
      .where(
        and(
          eq(producers.id, input.producerId),
          eq(producers.clerkUserId, input.requestedByClerkUserId),
        ),
      )
      .limit(1);
    if (!client || !producer) {
      throw new ClientInvitationDomainError("NOT_FOUND", "Client was not found");
    }
    const recipientEmail = client.email.trim().toLowerCase();
    const recipientEmailHash = emailHashFor(recipientEmail);
    const currentEmailDeliveryRows = await tx
      .select()
      .from(clientInvitationEmailDeliveries)
      .where(
        and(
          eq(clientInvitationEmailDeliveries.producerId, input.producerId),
          eq(clientInvitationEmailDeliveries.clientContactId, input.clientContactId),
          eq(clientInvitationEmailDeliveries.recipientEmailHash, client.emailHash),
        ),
      )
      .orderBy(
        desc(clientInvitationEmailDeliveries.providerAcceptedAt),
        desc(clientInvitationEmailDeliveries.updatedAt),
      );
    const currentEmailDeliveries = currentEmailDeliveryRows.map(record);
    if (input.activeWorkExpectedEmailHash !== undefined) {
      const gate = activeWorkImportInvitationGate({
        connected: hasActiveClientConnection(client.clerkUserId, client.archivedAt),
        currentEmailValid:
          recipientEmailHash === client.emailHash &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail),
        currentEmailHash: client.emailHash,
        expectedEmailHash: input.activeWorkExpectedEmailHash,
        operationKey: key,
        deliveries: currentEmailDeliveries,
      });
      if (gate.state !== "eligible") return gate;
      const resumable = resumableNormalClientInvitation(currentEmailDeliveries, requestedAt);
      if (resumable) return { state: "reserved", delivery: resumable };
    }
    if (!recipientEmail || recipientEmailHash !== client.emailHash) {
      throw new ClientInvitationDomainError("INTEGRITY_ERROR", "Client email identity is invalid");
    }
    if (input.activeWorkExpectedEmailHash === undefined) {
      const resumable = resumableNormalClientInvitation(currentEmailDeliveries, requestedAt);
      if (resumable) {
        if (client.invitedAt === null) {
          await tx
            .update(clientContacts)
            .set({ invitedAt: requestedAt })
            .where(
              and(
                eq(clientContacts.id, input.clientContactId),
                eq(clientContacts.producerId, input.producerId),
              ),
            );
        }
        return { delivery: resumable, created: false };
      }
    }
    const messageSnapshot: ClientInvitationEmailMessageSnapshot = {
      to: recipientEmail,
      artistName: client.name.trim(),
      producerName: producer.displayName?.trim() || "Your producer",
      inviteUrl: buildClientInviteUrl(producer.slug, input.siteUrl),
    };
    const expected = {
      producerId: input.producerId,
      clientContactId: input.clientContactId,
      operationKey: key,
      recipientEmail,
      recipientEmailHash,
      messageSnapshot,
      requestedByClerkUserId: input.requestedByClerkUserId,
      providerIdempotencyKey: idempotencyKey({
        producerId: input.producerId,
        clientContactId: input.clientContactId,
        operationKey: key,
      }),
      operationDigest: "",
    };
    expected.operationDigest = digest(expected);
    const [inserted] = await tx
      .insert(clientInvitationEmailDeliveries)
      .values({
        ...expected,
        createdAt: requestedAt,
        updatedAt: requestedAt,
      })
      .onConflictDoNothing()
      .returning();
    let delivery = inserted ? record(inserted) : null;
    if (!delivery) {
      const [existing] = await tx
        .select()
        .from(clientInvitationEmailDeliveries)
        .where(
          and(
            eq(clientInvitationEmailDeliveries.producerId, input.producerId),
            eq(clientInvitationEmailDeliveries.clientContactId, input.clientContactId),
            eq(clientInvitationEmailDeliveries.operationKey, key),
          ),
        )
        .limit(1)
        .for("update");
      if (!existing) {
        throw new ClientInvitationDomainError(
          "INTEGRITY_ERROR",
          "Invitation reservation conflict could not be resolved",
        );
      }
      delivery = record(existing);
    }
    assertReservationReplay(delivery, expected);
    if (client.invitedAt === null) {
      await tx
        .update(clientContacts)
        .set({ invitedAt: requestedAt })
        .where(
          and(
            eq(clientContacts.id, input.clientContactId),
            eq(clientContacts.producerId, input.producerId),
          ),
        );
    }
    return input.activeWorkExpectedEmailHash === undefined
      ? { delivery, created: Boolean(inserted) }
      : { state: "reserved", delivery };
  });
}

/** Reserve normal email intent and legacy deletion-safety evidence atomically. */
export async function reserveClientInvitationEmail(
  db: Db,
  input: Omit<ReservationInput, "activeWorkExpectedEmailHash">,
): Promise<ClientInvitationReservation> {
  return (await reserveClientInvitationEmailInternal(db, input)) as ClientInvitationReservation;
}

/**
 * Reserve a setup invitation only if the same reviewed Client identity is
 * still unconnected and has no provider-accepted invitation for its current
 * email. The client lock closes query-to-mutation races without affecting the
 * normal deliberate resend path.
 */
export async function reserveActiveWorkImportClientInvitationEmail(
  db: Db,
  input: Omit<ReservationInput, "activeWorkExpectedEmailHash"> & {
    expectedEmailHash: string;
  },
): Promise<ActiveWorkImportClientInvitationReservation> {
  const { expectedEmailHash, ...reservation } = input;
  return (await reserveClientInvitationEmailInternal(db, {
    ...reservation,
    activeWorkExpectedEmailHash: expectedEmailHash,
  })) as ActiveWorkImportClientInvitationReservation;
}

export function clientInvitationDeliveryRepository(db: Db): ClientInvitationDeliveryRepository {
  return {
    claimDelivery: (input) =>
      db.transaction(async (tx): Promise<ClientInvitationClaimResult> => {
        const [row] = await tx
          .select()
          .from(clientInvitationEmailDeliveries)
          .where(
            and(
              eq(clientInvitationEmailDeliveries.producerId, input.producerId),
              eq(clientInvitationEmailDeliveries.clientContactId, input.clientContactId),
              eq(clientInvitationEmailDeliveries.operationKey, input.operationKey),
            ),
          )
          .limit(1)
          .for("update");
        if (!row) {
          throw new ClientInvitationDomainError("NOT_FOUND", "Invitation was not found");
        }
        if (row.status === "provider_accepted") {
          return { state: "provider_accepted", delivery: record(row) };
        }
        if (row.status === "dedupe_expired") return { state: "dedupe_expired" };
        if (
          row.status === "sending" &&
          row.claimUntil &&
          row.claimUntil.getTime() > input.claimedAt.getTime()
        ) {
          return { state: "busy" };
        }
        const providerDedupeExpiresAt =
          row.providerDedupeExpiresAt ?? input.newProviderDedupeExpiresAt;
        if (row.firstAttemptAt && input.claimedAt.getTime() >= providerDedupeExpiresAt.getTime()) {
          const [expired] = await tx
            .update(clientInvitationEmailDeliveries)
            .set({
              status: "dedupe_expired",
              claimToken: null,
              claimUntil: null,
              failureCode: row.status === "failed" ? row.failureCode : null,
              updatedAt: input.claimedAt,
            })
            .where(eq(clientInvitationEmailDeliveries.id, row.id))
            .returning();
          if (!expired) {
            throw new ClientInvitationDomainError("CONFLICT", "Invitation claim changed");
          }
          return { state: "dedupe_expired" };
        }
        const [claimed] = await tx
          .update(clientInvitationEmailDeliveries)
          .set({
            status: "sending",
            claimToken: input.claimToken,
            claimUntil: input.claimUntil,
            attemptCount: row.attemptCount + 1,
            firstAttemptAt: row.firstAttemptAt ?? input.claimedAt,
            lastAttemptAt: input.claimedAt,
            providerDedupeExpiresAt,
            failureCode: null,
            updatedAt: input.claimedAt,
          })
          .where(eq(clientInvitationEmailDeliveries.id, row.id))
          .returning();
        if (!claimed) {
          throw new ClientInvitationDomainError("CONFLICT", "Invitation claim changed");
        }
        return { state: "claimed", delivery: record(claimed), claimToken: input.claimToken };
      }),
    completeDelivery: (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(clientInvitationEmailDeliveries)
          .where(
            and(
              eq(clientInvitationEmailDeliveries.producerId, input.producerId),
              eq(clientInvitationEmailDeliveries.clientContactId, input.clientContactId),
              eq(clientInvitationEmailDeliveries.operationKey, input.operationKey),
            ),
          )
          .limit(1)
          .for("update");
        if (!row) {
          throw new ClientInvitationDomainError("NOT_FOUND", "Invitation was not found");
        }
        if (row.status === "provider_accepted") {
          if (row.providerMessageId !== input.providerMessageId) {
            throw new ClientInvitationDomainError(
              "OPERATION_KEY_CONFLICT",
              "Invitation provider response changed",
            );
          }
          return { delivery: record(row), created: false };
        }
        if (row.status !== "sending" || row.claimToken !== input.claimToken) {
          throw new ClientInvitationDomainError("CONFLICT", "Invitation claim is no longer owned");
        }
        const providerMessageId = input.providerMessageId.trim();
        if (!providerMessageId) {
          throw new ClientInvitationDomainError(
            "INVALID_INPUT",
            "Invitation provider message id is missing",
          );
        }
        const [completed] = await tx
          .update(clientInvitationEmailDeliveries)
          .set({
            status: "provider_accepted",
            claimToken: null,
            claimUntil: null,
            providerMessageId,
            providerAcceptedAt: input.providerAcceptedAt,
            failureCode: null,
            updatedAt: input.providerAcceptedAt,
          })
          .where(eq(clientInvitationEmailDeliveries.id, row.id))
          .returning();
        if (!completed) {
          throw new ClientInvitationDomainError("CONFLICT", "Invitation completion changed");
        }
        return { delivery: record(completed), created: true };
      }),
    failDelivery: async (input) => {
      await db
        .update(clientInvitationEmailDeliveries)
        .set({
          status: "failed",
          claimToken: null,
          claimUntil: null,
          lastFailedAt: input.failedAt,
          failureCode: input.failureCode,
          updatedAt: input.failedAt,
        })
        .where(
          and(
            eq(clientInvitationEmailDeliveries.producerId, input.producerId),
            eq(clientInvitationEmailDeliveries.clientContactId, input.clientContactId),
            eq(clientInvitationEmailDeliveries.operationKey, input.operationKey),
            eq(clientInvitationEmailDeliveries.status, "sending"),
            eq(clientInvitationEmailDeliveries.claimToken, input.claimToken),
          ),
        );
    },
  };
}

export type CurrentClientInvitationState = Readonly<{
  providerAcceptedAt: Date | null;
  activeWorkBlocked: boolean;
  presentationState: "available" | "requested" | "failed" | "provider_accepted";
}>;

/** Current-email truth used by setup eligibility and provider evidence reads. */
export async function loadCurrentClientInvitationStates(
  db: Db,
  input: Readonly<{ producerId: string; clientContactIds?: readonly string[] }>,
): Promise<ReadonlyMap<string, CurrentClientInvitationState>> {
  if (input.clientContactIds?.length === 0) return new Map();
  const rows = await db
    .select({
      clientContactId: clientInvitationEmailDeliveries.clientContactId,
      status: clientInvitationEmailDeliveries.status,
      attemptCount: clientInvitationEmailDeliveries.attemptCount,
      providerAcceptedAt: clientInvitationEmailDeliveries.providerAcceptedAt,
    })
    .from(clientInvitationEmailDeliveries)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, clientInvitationEmailDeliveries.clientContactId),
        eq(clientContacts.producerId, clientInvitationEmailDeliveries.producerId),
        eq(clientContacts.emailHash, clientInvitationEmailDeliveries.recipientEmailHash),
      ),
    )
    .where(
      and(
        eq(clientInvitationEmailDeliveries.producerId, input.producerId),
        ...(input.clientContactIds
          ? [inArray(clientInvitationEmailDeliveries.clientContactId, [...input.clientContactIds])]
          : []),
      ),
    )
    .orderBy(
      desc(clientInvitationEmailDeliveries.providerAcceptedAt),
      desc(clientInvitationEmailDeliveries.updatedAt),
      desc(clientInvitationEmailDeliveries.id),
    );
  const rowsByClient = new Map<string, typeof rows>();
  for (const row of rows) {
    const grouped = rowsByClient.get(row.clientContactId) ?? [];
    grouped.push(row);
    rowsByClient.set(row.clientContactId, grouped);
  }
  const states = new Map<string, CurrentClientInvitationState>();
  for (const [clientContactId, deliveries] of rowsByClient) {
    const providerAcceptedAt =
      deliveries
        .filter(
          (delivery) =>
            delivery.status === "provider_accepted" && delivery.providerAcceptedAt !== null,
        )
        .flatMap((delivery) =>
          delivery.providerAcceptedAt === null ? [] : [delivery.providerAcceptedAt],
        )
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    states.set(clientContactId, {
      providerAcceptedAt,
      presentationState: clientInvitationPresentationState(deliveries),
      activeWorkBlocked: deliveries.some(
        (delivery) =>
          delivery.status === "reserved" ||
          delivery.status === "sending" ||
          delivery.attemptCount > 0,
      ),
    });
  }
  return states;
}

/** Provider-accepted evidence only for the Client's current email identity. */
export async function loadCurrentClientInvitationEvidence(
  db: Db,
  input: Readonly<{ producerId: string; clientContactIds?: readonly string[] }>,
): Promise<ReadonlyMap<string, Date>> {
  const states = await loadCurrentClientInvitationStates(db, input);
  const evidence = new Map<string, Date>();
  for (const [clientContactId, state] of states) {
    if (state.providerAcceptedAt) {
      evidence.set(clientContactId, state.providerAcceptedAt);
    }
  }
  return evidence;
}
