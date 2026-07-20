import { randomUUID } from "node:crypto";

import {
  and,
  eq,
  lte,
  notInArray,
  or,
  purchaseInstallments,
  purchaseReminderDeliveries,
  purchaseReminderLogs,
  purchases,
  type Db,
} from "@skitza/db";

import { digestCommercialSnapshot } from "../purchases/policy";
import { purchaseLedgerRepository } from "./db";
import { PurchaseLedgerDomainError } from "./policy";
import { paymentReminderOccurrences, type PaymentReminderKind } from "./schedule";
import { reconcilePurchaseLedger, type ReconciledPurchaseLedger } from "./service";

const DAY_MS = 24 * 60 * 60 * 1_000;
const AUTOMATIC_CATCH_UP_LOCAL_DAYS = 2;
const PROVIDER_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const UNATTEMPTED_RESERVATION_WINDOW_MS = 24 * 60 * 60 * 1_000;
const DELIVERY_CLAIM_LEASE_MS = 5 * 60 * 1_000;

export type PurchaseReminderLogRecord = Readonly<{
  id: string;
  purchaseId: string;
  installmentId: string;
  producerId: string;
  operationKey: string;
  operationDigest: string;
  kind: PaymentReminderKind | "manual";
  scheduledFor: Date;
  amountDueCents: number;
  currency: string;
  recipientEmail: string;
  sentByClerkUserId: string | null;
  providerMessageId: string;
  sentAt: Date;
}>;

export type PaymentReminderEmail = Readonly<{
  to: string;
  props: Readonly<{
    artistName: string;
    producerName: string;
    purchaseName: string;
    refNumber: string;
    currency: string;
    amountCents: number;
    dueAt: Date;
    producerTimezone: string;
    paymentUrl: string;
  }>;
  idempotencyKey: string;
}>;

type StoredReminderMessage = Readonly<{
  to: string;
  props: Readonly<Omit<PaymentReminderEmail["props"], "dueAt"> & { dueAt: string }>;
}>;

export type PurchaseReminderDeliveryRecord = Readonly<{
  id: string;
  purchaseId: string;
  installmentId: string;
  producerId: string;
  operationKey: string;
  operationDigest: string;
  kind: PaymentReminderKind | "manual";
  scheduledFor: Date;
  amountDueCents: number;
  currency: string;
  recipientEmail: string;
  messageSnapshot: StoredReminderMessage;
  sentByClerkUserId: string | null;
  providerIdempotencyKey: string;
  status: "reserved" | "sending" | "sent" | "reservation_expired" | "dedupe_expired";
  claimToken: string | null;
  claimUntil: Date | null;
  attemptCount: number;
  firstAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  providerDedupeExpiresAt: Date | null;
  lastFailedAt: Date | null;
  providerMessageId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type NewPurchaseReminderDelivery = Readonly<
  Pick<
    PurchaseReminderDeliveryRecord,
    | "purchaseId"
    | "installmentId"
    | "producerId"
    | "operationKey"
    | "operationDigest"
    | "kind"
    | "scheduledFor"
    | "amountDueCents"
    | "currency"
    | "recipientEmail"
    | "messageSnapshot"
    | "sentByClerkUserId"
    | "providerIdempotencyKey"
  > & { reservedAt: Date }
>;

export type PurchaseReminderClaimResult =
  | Readonly<{ state: "claimed"; delivery: PurchaseReminderDeliveryRecord; claimToken: string }>
  | Readonly<{ state: "busy" }>
  | Readonly<{ state: "reservation_expired" }>
  | Readonly<{ state: "dedupe_expired" }>
  | Readonly<{ state: "sent"; log: PurchaseReminderLogRecord }>;

export interface PaymentReminderRepository {
  // This is deliberately a reconciliation sweep, not an email-eligibility
  // query. Producer/installment preferences and cancellation gate only send.
  listAutomaticPurchaseScopes(
    asOf: Date,
  ): Promise<readonly Readonly<{ producerId: string; purchaseId: string }>[]>;
  loadLedger(
    scope: Readonly<{ producerId: string; purchaseId: string }>,
    asOf: Date,
  ): Promise<ReconciledPurchaseLedger>;
  listRecoverableDeliveries(asOf: Date): Promise<readonly PurchaseReminderDeliveryRecord[]>;
  findDelivery(
    input: Readonly<{
      producerId: string;
      purchaseId: string;
      operationKey: string;
    }>,
  ): Promise<PurchaseReminderDeliveryRecord | null>;
  reserveDelivery(
    input: NewPurchaseReminderDelivery,
  ): Promise<Readonly<{ delivery: PurchaseReminderDeliveryRecord; created: boolean }>>;
  claimDelivery(
    input: Readonly<{
      producerId: string;
      purchaseId: string;
      operationKey: string;
      claimToken: string;
      claimedAt: Date;
      claimUntil: Date;
      newProviderDedupeExpiresAt: Date;
    }>,
  ): Promise<PurchaseReminderClaimResult>;
  completeDelivery(
    input: Readonly<{
      producerId: string;
      purchaseId: string;
      operationKey: string;
      claimToken: string;
      providerMessageId: string;
      sentAt: Date;
    }>,
  ): Promise<Readonly<{ log: PurchaseReminderLogRecord; created: boolean }>>;
  releaseDeliveryClaim(
    input: Readonly<{
      producerId: string;
      purchaseId: string;
      operationKey: string;
      claimToken: string;
      failedAt: Date;
    }>,
  ): Promise<void>;
}

export type SendPaymentReminder = (email: PaymentReminderEmail) => Promise<string>;

type LocalDate = Readonly<{ year: number; month: number; day: number }>;

function localDate(value: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

function localCalendarDayDifference(later: Date, earlier: Date, timeZone: string): number {
  const left = localDate(later, timeZone);
  const right = localDate(earlier, timeZone);
  return (
    (Date.UTC(left.year, left.month - 1, left.day) -
      Date.UTC(right.year, right.month - 1, right.day)) /
    DAY_MS
  );
}

function automaticOperationKey(
  installmentId: string,
  kind: PaymentReminderKind,
  scheduledFor: Date,
): string {
  return `automatic:${installmentId}:${kind}:${scheduledFor.toISOString()}`;
}

function providerIdempotencyKey(purchaseId: string, operationKey: string): string {
  const value = `purchase-reminder:${purchaseId}:${operationKey}`;
  if (value.length > 256) {
    throw new PurchaseLedgerDomainError(
      "INVALID_INPUT",
      "Reminder operation key is too long for safe delivery",
    );
  }
  return value;
}

function reminderDigest(input: {
  purchaseId: string;
  installmentId: string;
  kind: PaymentReminderKind | "manual";
  scheduledFor: Date;
  actorId: string | null;
  messageSnapshot: StoredReminderMessage;
}): string {
  return digestCommercialSnapshot({
    kind: "purchase-reminder-v2",
    purchaseId: input.purchaseId,
    installmentId: input.installmentId,
    reminderKind: input.kind,
    scheduledFor: input.kind === "manual" ? null : input.scheduledFor.toISOString(),
    actorId: input.actorId,
    message: input.messageSnapshot,
  });
}

function assertReplay(
  existing: Readonly<{ operationDigest: string }>,
  expectedDigest: string,
): void {
  if (existing.operationDigest !== expectedDigest) {
    throw new PurchaseLedgerDomainError(
      "OPERATION_KEY_CONFLICT",
      "This reminder operation key belongs to a different send",
    );
  }
}

function assertManualDeliveryIntent(
  delivery: PurchaseReminderDeliveryRecord,
  input: Readonly<{
    producerId: string;
    purchaseId: string;
    installmentId: string;
    operationKey: string;
    actorId: string;
    paymentUrl: string;
  }>,
): void {
  if (
    delivery.producerId !== input.producerId ||
    delivery.purchaseId !== input.purchaseId ||
    delivery.installmentId !== input.installmentId ||
    delivery.operationKey !== input.operationKey ||
    delivery.kind !== "manual" ||
    delivery.sentByClerkUserId !== input.actorId ||
    delivery.messageSnapshot.props.paymentUrl !== input.paymentUrl
  ) {
    throw new PurchaseLedgerDomainError(
      "OPERATION_KEY_CONFLICT",
      "This reminder operation key belongs to a different send",
    );
  }
  if (
    delivery.recipientEmail !== delivery.messageSnapshot.to ||
    delivery.currency !== delivery.messageSnapshot.props.currency ||
    delivery.amountDueCents !== delivery.messageSnapshot.props.amountCents ||
    delivery.providerIdempotencyKey !==
      providerIdempotencyKey(delivery.purchaseId, delivery.operationKey)
  ) {
    throw new PurchaseLedgerDomainError(
      "INTEGRITY_ERROR",
      "Stored reminder delivery snapshot is inconsistent",
    );
  }
  const storedDigest = reminderDigest({
    purchaseId: delivery.purchaseId,
    installmentId: delivery.installmentId,
    kind: "manual",
    scheduledFor: delivery.scheduledFor,
    actorId: delivery.sentByClerkUserId,
    messageSnapshot: delivery.messageSnapshot,
  });
  if (storedDigest !== delivery.operationDigest) {
    throw new PurchaseLedgerDomainError(
      "INTEGRITY_ERROR",
      "Stored reminder delivery digest is inconsistent",
    );
  }
}

function messageFor(
  ledger: ReconciledPurchaseLedger,
  installmentId: string,
  amountCents: number,
  paymentUrl: string,
): StoredReminderMessage {
  const installment = ledger.snapshot.installments.find((row) => row.id === installmentId);
  if (!installment?.dueAt) {
    throw new PurchaseLedgerDomainError("INTEGRITY_ERROR", "Reminder installment has no due date");
  }
  return {
    to: ledger.snapshot.client.email,
    props: {
      artistName: ledger.snapshot.client.name,
      producerName: ledger.snapshot.producer.displayName,
      purchaseName: ledger.snapshot.purchaseName,
      refNumber: ledger.snapshot.refNumber,
      currency: ledger.snapshot.purchase.currency,
      amountCents,
      dueAt: installment.dueAt.toISOString(),
      producerTimezone: ledger.snapshot.producer.timeZone,
      paymentUrl,
    },
  };
}

function emailFromDelivery(delivery: PurchaseReminderDeliveryRecord): PaymentReminderEmail {
  const dueAt = new Date(delivery.messageSnapshot.props.dueAt);
  if (Number.isNaN(dueAt.getTime())) {
    throw new PurchaseLedgerDomainError("INTEGRITY_ERROR", "Reminder snapshot due date is invalid");
  }
  return {
    to: delivery.messageSnapshot.to,
    props: { ...delivery.messageSnapshot.props, dueAt },
    idempotencyKey: delivery.providerIdempotencyKey,
  };
}

function automaticOccurrencesForRun(
  dueAt: Date,
  asOf: Date,
  timeZone: string,
): readonly Readonly<{ kind: PaymentReminderKind; scheduledFor: Date }>[] {
  // The schedule is calendar-date based. Looking slightly beyond the current
  // instant includes today's occurrence even when cron runs before its exact
  // wall-clock time; the local-day filter prevents any future-date send.
  const scheduleThrough = new Date(asOf.getTime() + 36 * 60 * 60 * 1_000);
  const rows = paymentReminderOccurrences(dueAt, scheduleThrough, timeZone).filter((occurrence) => {
    const days = localCalendarDayDifference(asOf, occurrence.scheduledFor, timeZone);
    return days >= 0 && days <= AUTOMATIC_CATCH_UP_LOCAL_DAYS;
  });
  if (rows.length > 1) {
    throw new PurchaseLedgerDomainError(
      "INTEGRITY_ERROR",
      "Reminder schedule produced overlapping catch-up occurrences",
    );
  }
  return rows;
}

async function deliverReserved(
  repository: PaymentReminderRepository,
  send: SendPaymentReminder,
  delivery: PurchaseReminderDeliveryRecord,
  attemptedAt: Date,
): Promise<
  | Readonly<{ state: "sent"; log: PurchaseReminderLogRecord; created: boolean }>
  | Readonly<{ state: "busy" | "reservation_expired" | "dedupe_expired" }>
> {
  const claimToken = randomUUID();
  const claim = await repository.claimDelivery({
    producerId: delivery.producerId,
    purchaseId: delivery.purchaseId,
    operationKey: delivery.operationKey,
    claimToken,
    claimedAt: attemptedAt,
    claimUntil: new Date(attemptedAt.getTime() + DELIVERY_CLAIM_LEASE_MS),
    newProviderDedupeExpiresAt: new Date(attemptedAt.getTime() + PROVIDER_DEDUPE_WINDOW_MS),
  });
  if (claim.state === "sent") return { ...claim, created: false };
  if (claim.state !== "claimed") return claim;

  try {
    const providerMessageId = (await send(emailFromDelivery(claim.delivery))).trim();
    if (!providerMessageId) throw new Error("Payment reminder provider returned no message id");
    const completed = await repository.completeDelivery({
      producerId: delivery.producerId,
      purchaseId: delivery.purchaseId,
      operationKey: delivery.operationKey,
      claimToken,
      providerMessageId,
      sentAt: attemptedAt,
    });
    return { state: "sent", ...completed };
  } catch (error) {
    try {
      await repository.releaseDeliveryClaim({
        producerId: delivery.producerId,
        purchaseId: delivery.purchaseId,
        operationKey: delivery.operationKey,
        claimToken,
        failedAt: attemptedAt,
      });
    } catch {
      // A stale sending claim is intentional: another worker may reclaim it
      // with the same provider key while the 24-hour window remains open.
    }
    throw error;
  }
}

export type AutomaticReminderRunResult = Readonly<{
  recovery: Readonly<{
    candidates: number;
    sent: number;
    busy: number;
    alreadyCompleted: number;
    reservationExpired: number;
    dedupeExpired: number;
    errored: number;
  }>;
  reconciled: number;
  eligible: number;
  sent: number;
  skipped: number;
  errored: number;
}>;

export async function sendAutomaticPurchaseReminders(
  repository: PaymentReminderRepository,
  send: SendPaymentReminder,
  input: Readonly<{ asOf?: Date; paymentUrlForPurchase: (purchaseId: string) => string }>,
): Promise<AutomaticReminderRunResult> {
  const asOf = input.asOf ?? new Date();
  if (Number.isNaN(asOf.getTime())) {
    throw new PurchaseLedgerDomainError("INVALID_INPUT", "Reminder run time is invalid");
  }
  const recoveryKeys = new Set<string>();
  const recovery = {
    candidates: 0,
    sent: 0,
    busy: 0,
    alreadyCompleted: 0,
    reservationExpired: 0,
    dedupeExpired: 0,
    errored: 0,
  };
  try {
    const pending = await repository.listRecoverableDeliveries(asOf);
    recovery.candidates = pending.length;
    for (const delivery of pending) {
      recoveryKeys.add(`${delivery.purchaseId}\u0000${delivery.operationKey}`);
      try {
        const delivered = await deliverReserved(repository, send, delivery, asOf);
        if (delivered.state === "sent") {
          if (delivered.created) recovery.sent += 1;
          else recovery.alreadyCompleted += 1;
        } else if (delivered.state === "busy") recovery.busy += 1;
        else if (delivered.state === "reservation_expired") recovery.reservationExpired += 1;
        else recovery.dedupeExpired += 1;
      } catch {
        recovery.errored += 1;
      }
    }
  } catch {
    recovery.errored += 1;
  }

  const scopes = await repository.listAutomaticPurchaseScopes(asOf);
  let reconciled = 0;
  let eligible = 0;
  let sent = 0;
  let skipped = 0;
  let errored = 0;

  for (const scope of scopes) {
    let ledger: ReconciledPurchaseLedger;
    try {
      ledger = await repository.loadLedger(scope, asOf);
      reconciled += 1;
    } catch {
      errored += 1;
      continue;
    }

    // Reconciliation above is unconditional. These settings gate email only.
    if (
      ledger.snapshot.purchase.lifecycleStatus === "canceled" ||
      !ledger.snapshot.producer.automaticRemindersEnabled
    ) {
      skipped += 1;
      continue;
    }

    for (const projected of ledger.projection.installments) {
      const stored = ledger.snapshot.installments.find((row) => row.id === projected.id);
      if (
        !stored?.dueAt ||
        !stored.remindersEnabled ||
        projected.remainingCents <= 0 ||
        projected.status === "confirmed" ||
        projected.status === "waived" ||
        projected.status === "canceled"
      ) {
        continue;
      }

      let occurrences: readonly Readonly<{
        kind: PaymentReminderKind;
        scheduledFor: Date;
      }>[];
      try {
        occurrences = automaticOccurrencesForRun(
          stored.dueAt,
          asOf,
          ledger.snapshot.producer.timeZone,
        );
      } catch {
        errored += 1;
        continue;
      }

      for (const occurrence of occurrences) {
        eligible += 1;
        const operationKey = automaticOperationKey(
          stored.id,
          occurrence.kind,
          occurrence.scheduledFor,
        );
        if (recoveryKeys.has(`${scope.purchaseId}\u0000${operationKey}`)) {
          skipped += 1;
          continue;
        }
        const messageSnapshot = messageFor(
          ledger,
          stored.id,
          projected.remainingCents,
          input.paymentUrlForPurchase(scope.purchaseId),
        );
        const operationDigest = reminderDigest({
          purchaseId: scope.purchaseId,
          installmentId: stored.id,
          kind: occurrence.kind,
          scheduledFor: occurrence.scheduledFor,
          actorId: null,
          messageSnapshot,
        });

        try {
          const reservation = await repository.reserveDelivery({
            purchaseId: scope.purchaseId,
            installmentId: stored.id,
            producerId: scope.producerId,
            operationKey,
            operationDigest,
            kind: occurrence.kind,
            scheduledFor: occurrence.scheduledFor,
            amountDueCents: projected.remainingCents,
            currency: projected.currency,
            recipientEmail: messageSnapshot.to,
            messageSnapshot,
            sentByClerkUserId: null,
            providerIdempotencyKey: providerIdempotencyKey(scope.purchaseId, operationKey),
            reservedAt: asOf,
          });
          // Automatic retries intentionally use the first durable snapshot.
          // Balance/contact changes after a crash must not change the payload
          // attached to the provider idempotency key.
          const delivered = await deliverReserved(repository, send, reservation.delivery, asOf);
          if (delivered.state === "sent" && delivered.created) sent += 1;
          else if (delivered.state === "dedupe_expired") errored += 1;
          else skipped += 1;
        } catch {
          errored += 1;
        }
      }
    }
  }
  return { recovery, reconciled, eligible, sent, skipped, errored };
}

export async function sendManualPurchaseReminder(
  repository: PaymentReminderRepository,
  send: SendPaymentReminder,
  rawInput: Readonly<{
    producerId: string;
    purchaseId: string;
    installmentId: string;
    operationKey: string;
    actorId: string;
    paymentUrl: string;
    requestedAt?: Date;
  }>,
): Promise<Readonly<{ log: PurchaseReminderLogRecord; created: boolean }>> {
  const producerId = rawInput.producerId.trim();
  const purchaseId = rawInput.purchaseId.trim();
  const installmentId = rawInput.installmentId.trim();
  const actorId = rawInput.actorId.trim();
  const callerKey = rawInput.operationKey.trim();
  const paymentUrl = rawInput.paymentUrl.trim();
  const requestedAt = rawInput.requestedAt ?? new Date();
  if (
    !producerId ||
    !purchaseId ||
    !installmentId ||
    !actorId ||
    !callerKey ||
    !paymentUrl ||
    callerKey.length > 180 ||
    Number.isNaN(requestedAt.getTime())
  ) {
    throw new PurchaseLedgerDomainError("INVALID_INPUT", "Manual reminder input is invalid");
  }

  const operationKey = `manual:${callerKey}`;
  const manualIntent = {
    producerId,
    purchaseId,
    installmentId,
    operationKey,
    actorId,
    paymentUrl,
  };
  const existing = await repository.findDelivery({ producerId, purchaseId, operationKey });
  if (existing) {
    assertManualDeliveryIntent(existing, manualIntent);
    const delivered = await deliverReserved(repository, send, existing, requestedAt);
    if (delivered.state === "sent") return { log: delivered.log, created: delivered.created };
    if (delivered.state === "dedupe_expired") {
      throw new PurchaseLedgerDomainError(
        "CONFLICT",
        "This reminder delivery can no longer be retried safely; send a new explicit reminder",
      );
    }
    if (delivered.state === "reservation_expired") {
      throw new PurchaseLedgerDomainError(
        "CONFLICT",
        "This unsent reminder reservation expired; send a new explicit reminder",
      );
    }
    throw new PurchaseLedgerDomainError("CONFLICT", "This reminder is already being delivered");
  }

  const ledger = await repository.loadLedger({ producerId, purchaseId }, requestedAt);
  if (ledger.snapshot.purchase.lifecycleStatus === "canceled") {
    throw new PurchaseLedgerDomainError("CONFLICT", "A canceled purchase cannot be reminded");
  }
  const projected = ledger.projection.installments.find((row) => row.id === installmentId);
  const stored = ledger.snapshot.installments.find((row) => row.id === installmentId);
  if (!projected || !stored?.dueAt) {
    throw new PurchaseLedgerDomainError("NOT_FOUND", "Installment was not found");
  }
  if (projected.remainingCents <= 0) {
    throw new PurchaseLedgerDomainError("CONFLICT", "This installment has no remaining debt");
  }

  const messageSnapshot = messageFor(ledger, installmentId, projected.remainingCents, paymentUrl);
  const operationDigest = reminderDigest({
    purchaseId,
    installmentId,
    kind: "manual",
    scheduledFor: requestedAt,
    actorId,
    messageSnapshot,
  });
  const reservation = await repository.reserveDelivery({
    purchaseId,
    installmentId,
    producerId,
    operationKey,
    operationDigest,
    kind: "manual",
    scheduledFor: requestedAt,
    amountDueCents: projected.remainingCents,
    currency: projected.currency,
    recipientEmail: messageSnapshot.to,
    messageSnapshot,
    sentByClerkUserId: actorId,
    providerIdempotencyKey: providerIdempotencyKey(purchaseId, operationKey),
    reservedAt: requestedAt,
  });
  assertManualDeliveryIntent(reservation.delivery, manualIntent);
  const delivered = await deliverReserved(repository, send, reservation.delivery, requestedAt);
  if (delivered.state === "sent") return { log: delivered.log, created: delivered.created };
  if (delivered.state === "dedupe_expired") {
    throw new PurchaseLedgerDomainError(
      "CONFLICT",
      "This reminder delivery can no longer be retried safely; send a new explicit reminder",
    );
  }
  if (delivered.state === "reservation_expired") {
    throw new PurchaseLedgerDomainError(
      "CONFLICT",
      "This unsent reminder reservation expired; send a new explicit reminder",
    );
  }
  throw new PurchaseLedgerDomainError("CONFLICT", "This reminder is already being delivered");
}

function deliveryRecord(
  row: typeof purchaseReminderDeliveries.$inferSelect,
): PurchaseReminderDeliveryRecord {
  return {
    ...row,
    messageSnapshot: row.messageSnapshot as StoredReminderMessage,
  };
}

function reminderLogRecord(
  row: typeof purchaseReminderLogs.$inferSelect,
): PurchaseReminderLogRecord {
  return {
    id: row.id,
    purchaseId: row.purchaseId,
    installmentId: row.installmentId,
    producerId: row.producerId,
    operationKey: row.operationKey,
    operationDigest: row.operationDigest,
    kind: row.kind,
    scheduledFor: row.scheduledFor,
    amountDueCents: row.amountDueCents,
    currency: row.currency,
    recipientEmail: row.recipientEmail,
    sentByClerkUserId: row.sentByClerkUserId,
    providerMessageId: row.providerMessageId,
    sentAt: row.sentAt,
  };
}

export function paymentReminderRepository(db: Db): PaymentReminderRepository {
  return {
    listAutomaticPurchaseScopes: async (asOf) => {
      // Calendar-day offsets can span 71–73 hours across DST. Four days also
      // covers the same-date early run and bounded catch-up. This query must
      // not filter producer/installment preferences or canceled purchases:
      // every candidate is reconciled before those values gate email.
      const horizon = new Date(asOf.getTime() + 4 * DAY_MS);
      return db
        .selectDistinct({
          producerId: purchases.producerId,
          purchaseId: purchases.id,
        })
        .from(purchaseInstallments)
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, purchaseInstallments.purchaseId),
            eq(purchases.producerId, purchaseInstallments.producerId),
          ),
        )
        .where(
          and(
            lte(purchaseInstallments.dueAt, horizon),
            notInArray(purchaseInstallments.status, ["confirmed", "waived", "canceled"]),
          ),
        );
    },
    loadLedger: (scope, asOf) =>
      reconcilePurchaseLedger(purchaseLedgerRepository(db), { ...scope, asOf }),
    listRecoverableDeliveries: async (asOf) => {
      const rows = await db
        .select()
        .from(purchaseReminderDeliveries)
        .where(
          or(
            eq(purchaseReminderDeliveries.status, "reserved"),
            and(
              eq(purchaseReminderDeliveries.status, "sending"),
              lte(purchaseReminderDeliveries.claimUntil, asOf),
            ),
          ),
        )
        .orderBy(purchaseReminderDeliveries.createdAt, purchaseReminderDeliveries.id);
      return rows.map(deliveryRecord);
    },
    findDelivery: async (input) => {
      const [row] = await db
        .select()
        .from(purchaseReminderDeliveries)
        .where(
          and(
            eq(purchaseReminderDeliveries.producerId, input.producerId),
            eq(purchaseReminderDeliveries.purchaseId, input.purchaseId),
            eq(purchaseReminderDeliveries.operationKey, input.operationKey),
          ),
        )
        .limit(1);
      return row ? deliveryRecord(row) : null;
    },
    reserveDelivery: async (input) => {
      const [inserted] = await db
        .insert(purchaseReminderDeliveries)
        .values({
          purchaseId: input.purchaseId,
          installmentId: input.installmentId,
          producerId: input.producerId,
          operationKey: input.operationKey,
          operationDigest: input.operationDigest,
          kind: input.kind,
          scheduledFor: input.scheduledFor,
          amountDueCents: input.amountDueCents,
          currency: input.currency,
          recipientEmail: input.recipientEmail,
          messageSnapshot: input.messageSnapshot,
          sentByClerkUserId: input.sentByClerkUserId,
          providerIdempotencyKey: input.providerIdempotencyKey,
          createdAt: input.reservedAt,
          updatedAt: input.reservedAt,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return { delivery: deliveryRecord(inserted), created: true };
      const [existing] = await db
        .select()
        .from(purchaseReminderDeliveries)
        .where(
          and(
            eq(purchaseReminderDeliveries.purchaseId, input.purchaseId),
            eq(purchaseReminderDeliveries.producerId, input.producerId),
            eq(purchaseReminderDeliveries.operationKey, input.operationKey),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new PurchaseLedgerDomainError(
          "INTEGRITY_ERROR",
          "Reminder reservation conflict could not be resolved",
        );
      }
      return { delivery: deliveryRecord(existing), created: false };
    },
    claimDelivery: (input) =>
      db.transaction(async (tx): Promise<PurchaseReminderClaimResult> => {
        const [row] = await tx
          .select()
          .from(purchaseReminderDeliveries)
          .where(
            and(
              eq(purchaseReminderDeliveries.purchaseId, input.purchaseId),
              eq(purchaseReminderDeliveries.producerId, input.producerId),
              eq(purchaseReminderDeliveries.operationKey, input.operationKey),
            ),
          )
          .limit(1)
          .for("update");
        if (!row) {
          throw new PurchaseLedgerDomainError("NOT_FOUND", "Reminder reservation was not found");
        }
        if (row.status === "sent") {
          const [log] = await tx
            .select()
            .from(purchaseReminderLogs)
            .where(
              and(
                eq(purchaseReminderLogs.purchaseId, input.purchaseId),
                eq(purchaseReminderLogs.producerId, input.producerId),
                eq(purchaseReminderLogs.operationKey, input.operationKey),
              ),
            )
            .limit(1);
          if (!log) {
            throw new PurchaseLedgerDomainError(
              "INTEGRITY_ERROR",
              "Sent reminder is missing its audit log",
            );
          }
          assertReplay(log, row.operationDigest);
          return { state: "sent", log: reminderLogRecord(log) };
        }
        if (row.status === "dedupe_expired") return { state: "dedupe_expired" };
        if (row.status === "reservation_expired") return { state: "reservation_expired" };
        if (
          row.status === "sending" &&
          row.claimUntil &&
          row.claimUntil.getTime() > input.claimedAt.getTime()
        ) {
          return { state: "busy" };
        }

        const providerDedupeExpiresAt =
          row.providerDedupeExpiresAt ?? input.newProviderDedupeExpiresAt;
        if (
          row.firstAttemptAt === null &&
          input.claimedAt.getTime() >= row.createdAt.getTime() + UNATTEMPTED_RESERVATION_WINDOW_MS
        ) {
          await tx
            .update(purchaseReminderDeliveries)
            .set({
              status: "reservation_expired",
              claimToken: null,
              claimUntil: null,
              updatedAt: input.claimedAt,
            })
            .where(eq(purchaseReminderDeliveries.id, row.id));
          return { state: "reservation_expired" };
        }
        if (row.firstAttemptAt && input.claimedAt.getTime() >= providerDedupeExpiresAt.getTime()) {
          await tx
            .update(purchaseReminderDeliveries)
            .set({
              status: "dedupe_expired",
              claimToken: null,
              claimUntil: null,
              updatedAt: input.claimedAt,
            })
            .where(eq(purchaseReminderDeliveries.id, row.id));
          return { state: "dedupe_expired" };
        }

        const [claimed] = await tx
          .update(purchaseReminderDeliveries)
          .set({
            status: "sending",
            claimToken: input.claimToken,
            claimUntil: input.claimUntil,
            attemptCount: row.attemptCount + 1,
            firstAttemptAt: row.firstAttemptAt ?? input.claimedAt,
            lastAttemptAt: input.claimedAt,
            providerDedupeExpiresAt,
            updatedAt: input.claimedAt,
          })
          .where(eq(purchaseReminderDeliveries.id, row.id))
          .returning();
        if (!claimed) {
          throw new PurchaseLedgerDomainError("CONFLICT", "Reminder claim changed concurrently");
        }
        return {
          state: "claimed",
          delivery: deliveryRecord(claimed),
          claimToken: input.claimToken,
        };
      }),
    completeDelivery: (input) =>
      db.transaction(async (tx) => {
        const [delivery] = await tx
          .select()
          .from(purchaseReminderDeliveries)
          .where(
            and(
              eq(purchaseReminderDeliveries.purchaseId, input.purchaseId),
              eq(purchaseReminderDeliveries.producerId, input.producerId),
              eq(purchaseReminderDeliveries.operationKey, input.operationKey),
            ),
          )
          .limit(1)
          .for("update");
        if (!delivery) {
          throw new PurchaseLedgerDomainError("NOT_FOUND", "Reminder reservation was not found");
        }

        const [existingLog] = await tx
          .select()
          .from(purchaseReminderLogs)
          .where(
            and(
              eq(purchaseReminderLogs.purchaseId, input.purchaseId),
              eq(purchaseReminderLogs.producerId, input.producerId),
              eq(purchaseReminderLogs.operationKey, input.operationKey),
            ),
          )
          .limit(1);
        if (delivery.status === "sent") {
          if (!existingLog) {
            throw new PurchaseLedgerDomainError(
              "INTEGRITY_ERROR",
              "Sent reminder is missing its audit log",
            );
          }
          return { log: reminderLogRecord(existingLog), created: false };
        }
        if (delivery.status !== "sending" || delivery.claimToken !== input.claimToken) {
          throw new PurchaseLedgerDomainError("CONFLICT", "Reminder claim is no longer owned");
        }

        const [insertedLog] = await tx
          .insert(purchaseReminderLogs)
          .values({
            purchaseId: delivery.purchaseId,
            installmentId: delivery.installmentId,
            producerId: delivery.producerId,
            operationKey: delivery.operationKey,
            operationDigest: delivery.operationDigest,
            kind: delivery.kind,
            scheduledFor: delivery.scheduledFor,
            amountDueCents: delivery.amountDueCents,
            currency: delivery.currency,
            recipientEmail: delivery.recipientEmail,
            sentByClerkUserId: delivery.sentByClerkUserId,
            providerMessageId: input.providerMessageId,
            sentAt: input.sentAt,
          })
          .onConflictDoNothing()
          .returning();
        const log = insertedLog ?? existingLog;
        if (!log) {
          throw new PurchaseLedgerDomainError(
            "INTEGRITY_ERROR",
            "Successful reminder could not be audited",
          );
        }
        assertReplay(log, delivery.operationDigest);

        await tx
          .update(purchaseReminderDeliveries)
          .set({
            status: "sent",
            claimToken: null,
            claimUntil: null,
            providerMessageId: log.providerMessageId,
            sentAt: log.sentAt,
            updatedAt: input.sentAt,
          })
          .where(eq(purchaseReminderDeliveries.id, delivery.id));
        return { log: reminderLogRecord(log), created: Boolean(insertedLog) };
      }),
    releaseDeliveryClaim: async (input) => {
      await db
        .update(purchaseReminderDeliveries)
        .set({
          status: "reserved",
          claimToken: null,
          claimUntil: null,
          lastFailedAt: input.failedAt,
          updatedAt: input.failedAt,
        })
        .where(
          and(
            eq(purchaseReminderDeliveries.purchaseId, input.purchaseId),
            eq(purchaseReminderDeliveries.producerId, input.producerId),
            eq(purchaseReminderDeliveries.operationKey, input.operationKey),
            eq(purchaseReminderDeliveries.status, "sending"),
            eq(purchaseReminderDeliveries.claimToken, input.claimToken),
          ),
        );
    },
  };
}
