import { randomUUID } from "node:crypto";

import type { ClientInvitationEmailMessageSnapshot } from "@skitza/db";

const PROVIDER_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const CLAIM_LEASE_MS = 5 * 60 * 1_000;

export type ClientInvitationDeliveryStatus =
  | "reserved"
  | "sending"
  | "provider_accepted"
  | "failed"
  | "dedupe_expired";

export type ClientInvitationPresentationState =
  | "available"
  | "requested"
  | "failed"
  | "provider_accepted";

export type ProducerClientInvitationPresentationState =
  | ClientInvitationPresentationState
  | "connected";

export function hasActiveClientConnection(
  clerkUserId: string | null,
  artistArchivedAt: Date | null,
): boolean {
  return clerkUserId !== null && artistArchivedAt === null;
}

export type ClientInvitationDeliveryRecord = Readonly<{
  id: string;
  clientContactId: string;
  producerId: string;
  operationKey: string;
  operationDigest: string;
  recipientEmail: string;
  recipientEmailHash: string;
  messageSnapshot: ClientInvitationEmailMessageSnapshot;
  requestedByClerkUserId: string;
  providerIdempotencyKey: string;
  status: ClientInvitationDeliveryStatus;
  claimToken: string | null;
  claimUntil: Date | null;
  attemptCount: number;
  firstAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  providerDedupeExpiresAt: Date | null;
  providerMessageId: string | null;
  providerAcceptedAt: Date | null;
  lastFailedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ClientInvitationClaimResult =
  | Readonly<{
      state: "claimed";
      delivery: ClientInvitationDeliveryRecord;
      claimToken: string;
    }>
  | Readonly<{ state: "busy" }>
  | Readonly<{ state: "dedupe_expired" }>
  | Readonly<{ state: "provider_accepted"; delivery: ClientInvitationDeliveryRecord }>;

export interface ClientInvitationDeliveryRepository {
  claimDelivery(
    input: Readonly<{
      producerId: string;
      clientContactId: string;
      operationKey: string;
      claimToken: string;
      claimedAt: Date;
      claimUntil: Date;
      newProviderDedupeExpiresAt: Date;
    }>,
  ): Promise<ClientInvitationClaimResult>;
  completeDelivery(
    input: Readonly<{
      producerId: string;
      clientContactId: string;
      operationKey: string;
      claimToken: string;
      providerMessageId: string;
      providerAcceptedAt: Date;
    }>,
  ): Promise<Readonly<{ delivery: ClientInvitationDeliveryRecord; created: boolean }>>;
  failDelivery(
    input: Readonly<{
      producerId: string;
      clientContactId: string;
      operationKey: string;
      claimToken: string;
      failedAt: Date;
      failureCode: string;
    }>,
  ): Promise<void>;
}

export type SendClientInvitation = (
  input: Readonly<{
    message: ClientInvitationEmailMessageSnapshot;
    idempotencyKey: string;
  }>,
) => Promise<string>;

export class ClientInvitationDomainError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "CONFLICT"
      | "OPERATION_KEY_CONFLICT"
      | "INTEGRITY_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ClientInvitationDomainError";
  }
}

export type ActiveWorkImportInvitationGate =
  | Readonly<{ state: "eligible" }>
  | Readonly<{ state: "connected" }>
  | Readonly<{ state: "provider_accepted"; providerAcceptedAt: Date }>
  | Readonly<{ state: "ineligible" }>;

/**
 * A normal invite started before a reload keeps its frozen message and
 * provider idempotency key. A new UI operation key resumes that durable row
 * while delivery is reserved/sending, or while a failed provider operation is
 * still inside its dedupe window. Accepted rows remain eligible for a later
 * deliberate resend; expired rows require a genuinely new reservation.
 */
export function resumableNormalClientInvitation(
  deliveries: readonly ClientInvitationDeliveryRecord[],
  requestedAtValue: Date,
): ClientInvitationDeliveryRecord | null {
  const requestedAt = validDate(requestedAtValue, "Invitation request time");
  const latestAcceptedAt =
    deliveries
      .filter(
        (delivery) =>
          delivery.status === "provider_accepted" && delivery.providerAcceptedAt !== null,
      )
      .flatMap((delivery) =>
        delivery.providerAcceptedAt === null ? [] : [delivery.providerAcceptedAt],
      )
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
  return (
    deliveries.find(
      (delivery) =>
        (latestAcceptedAt === null || delivery.createdAt.getTime() > latestAcceptedAt.getTime()) &&
        (delivery.status === "reserved" ||
          (delivery.status === "sending" &&
            (delivery.providerDedupeExpiresAt === null ||
              requestedAt.getTime() < delivery.providerDedupeExpiresAt.getTime())) ||
          (delivery.status === "failed" &&
            (delivery.providerDedupeExpiresAt === null ||
              requestedAt.getTime() < delivery.providerDedupeExpiresAt.getTime()))),
    ) ?? null
  );
}

/** Current-email presentation truth. Legacy `Client.invitedAt` is never an
 * input, so copying a link cannot make the UI claim that email was sent. */
export function clientInvitationPresentationState(
  deliveries: readonly Pick<ClientInvitationDeliveryRecord, "status" | "providerAcceptedAt">[],
): ClientInvitationPresentationState {
  if (
    deliveries.some(
      (delivery) => delivery.status === "provider_accepted" && delivery.providerAcceptedAt !== null,
    )
  ) {
    return "provider_accepted";
  }
  if (
    deliveries.some((delivery) => delivery.status === "reserved" || delivery.status === "sending")
  ) {
    return "requested";
  }
  if (
    deliveries.some(
      (delivery) => delivery.status === "failed" || delivery.status === "dedupe_expired",
    )
  ) {
    return "failed";
  }
  return "available";
}

export function producerClientInvitationPresentationState(
  clerkUserId: string | null,
  deliveryState: ClientInvitationPresentationState | undefined,
  artistArchivedAt: Date | null = null,
): ProducerClientInvitationPresentationState {
  return hasActiveClientConnection(clerkUserId, artistArchivedAt)
    ? "connected"
    : (deliveryState ?? "available");
}

/**
 * Decide setup identity truth from rows read while holding the Client lock.
 * The repository separately resumes any retryable frozen delivery, including
 * one created by a prior bulk key, so reloads cannot create a second provider
 * idempotency key.
 */
export function activeWorkImportInvitationGate(
  input: Readonly<{
    connected: boolean;
    currentEmailValid: boolean;
    currentEmailHash: string;
    expectedEmailHash: string;
    operationKey: string;
    deliveries: readonly Readonly<{
      operationKey: string;
      status: ClientInvitationDeliveryStatus;
      attemptCount: number;
      providerAcceptedAt: Date | null;
    }>[];
  }>,
): ActiveWorkImportInvitationGate {
  if (input.connected) return { state: "connected" };
  if (!input.currentEmailValid || input.currentEmailHash !== input.expectedEmailHash) {
    return { state: "ineligible" };
  }
  const accepted = input.deliveries
    .filter(
      (delivery) => delivery.status === "provider_accepted" && delivery.providerAcceptedAt !== null,
    )
    .flatMap((delivery) =>
      delivery.providerAcceptedAt === null ? [] : [delivery.providerAcceptedAt],
    )
    .sort((left, right) => right.getTime() - left.getTime())[0];
  if (accepted) return { state: "provider_accepted", providerAcceptedAt: accepted };
  return { state: "eligible" };
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ClientInvitationDomainError("INVALID_INPUT", `${label} must be valid`);
  }
  return new Date(value);
}

function validCompletionTime(clock: () => Date, attemptedAt: Date, label: string): Date {
  const completedAt = validDate(clock(), label);
  if (completedAt.getTime() < attemptedAt.getTime()) {
    throw new ClientInvitationDomainError("INVALID_INPUT", `${label} cannot be before the attempt`);
  }
  return completedAt;
}

function failureCode(error: unknown): string {
  const value = error instanceof Error && error.name ? error.name : "EMAIL_PROVIDER_ERROR";
  return value.trim().slice(0, 200) || "EMAIL_PROVIDER_ERROR";
}

function assertStoredIntent(delivery: ClientInvitationDeliveryRecord): void {
  if (
    !delivery.operationKey.trim() ||
    !/^sha256:[0-9a-f]{64}$/.test(delivery.operationDigest) ||
    !delivery.providerIdempotencyKey.trim() ||
    delivery.providerIdempotencyKey.length > 256 ||
    delivery.messageSnapshot.to !== delivery.recipientEmail ||
    !delivery.messageSnapshot.inviteUrl.trim() ||
    !/^[0-9a-f]{64}$/.test(delivery.recipientEmailHash)
  ) {
    throw new ClientInvitationDomainError(
      "INTEGRITY_ERROR",
      "Stored client invitation intent is invalid",
    );
  }
}

export type DeliverClientInvitationOutcome =
  | Readonly<{
      state: "provider_accepted";
      delivery: ClientInvitationDeliveryRecord;
      created: boolean;
    }>
  | Readonly<{ state: "sending" }>
  | Readonly<{ state: "dedupe_expired" }>;

/**
 * Deliver one already-reserved intent. Provider acceptance means only that
 * Resend accepted the intentional request; it never claims inbox delivery.
 */
export async function deliverClientInvitation(
  repository: ClientInvitationDeliveryRepository,
  send: SendClientInvitation,
  delivery: ClientInvitationDeliveryRecord,
  attemptedAtValue = new Date(),
  completionTime: () => Date = () => new Date(),
): Promise<DeliverClientInvitationOutcome> {
  assertStoredIntent(delivery);
  const attemptedAt = validDate(attemptedAtValue, "Invitation attempt time");
  const claimToken = randomUUID();
  const claim = await repository.claimDelivery({
    producerId: delivery.producerId,
    clientContactId: delivery.clientContactId,
    operationKey: delivery.operationKey,
    claimToken,
    claimedAt: attemptedAt,
    claimUntil: new Date(attemptedAt.getTime() + CLAIM_LEASE_MS),
    newProviderDedupeExpiresAt: new Date(attemptedAt.getTime() + PROVIDER_DEDUPE_WINDOW_MS),
  });
  if (claim.state === "provider_accepted") {
    assertStoredIntent(claim.delivery);
    return { state: "provider_accepted", delivery: claim.delivery, created: false };
  }
  if (claim.state === "busy") return { state: "sending" };
  if (claim.state === "dedupe_expired") return claim;
  assertStoredIntent(claim.delivery);

  try {
    const providerMessageId = (
      await send({
        message: claim.delivery.messageSnapshot,
        idempotencyKey: claim.delivery.providerIdempotencyKey,
      })
    ).trim();
    if (!providerMessageId) throw new Error("Email provider returned no message id");
    const providerAcceptedAt = validCompletionTime(
      completionTime,
      attemptedAt,
      "Invitation provider acceptance time",
    );
    const completed = await repository.completeDelivery({
      producerId: claim.delivery.producerId,
      clientContactId: claim.delivery.clientContactId,
      operationKey: claim.delivery.operationKey,
      claimToken,
      providerMessageId,
      providerAcceptedAt,
    });
    assertStoredIntent(completed.delivery);
    return { state: "provider_accepted", ...completed };
  } catch (error) {
    const failedAt = validCompletionTime(completionTime, attemptedAt, "Invitation failure time");
    try {
      await repository.failDelivery({
        producerId: claim.delivery.producerId,
        clientContactId: claim.delivery.clientContactId,
        operationKey: claim.delivery.operationKey,
        claimToken,
        failedAt,
        failureCode: failureCode(error),
      });
    } catch (markError) {
      // A completion racing this failure owns the row now; never overwrite it.
      console.error("[client-invitations] failure marking failed", {
        clientContactId: claim.delivery.clientContactId,
        deliveryId: claim.delivery.id,
        error: markError,
      });
    }
    throw error;
  }
}

export function providerAcceptedAtForCurrentEmail(
  currentEmailHash: string,
  deliveries: readonly Pick<
    ClientInvitationDeliveryRecord,
    "status" | "recipientEmailHash" | "providerAcceptedAt"
  >[],
): Date | null {
  const accepted = deliveries
    .filter(
      (delivery) =>
        delivery.status === "provider_accepted" &&
        delivery.recipientEmailHash === currentEmailHash &&
        delivery.providerAcceptedAt !== null,
    )
    .flatMap((delivery) =>
      delivery.providerAcceptedAt === null ? [] : [delivery.providerAcceptedAt],
    )
    .sort((left, right) => right.getTime() - left.getTime());
  return accepted[0] ? new Date(accepted[0]) : null;
}
