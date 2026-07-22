import { describe, expect, it } from "vitest";

import { projectPurchaseLedger } from "../policy";
import {
  sendAutomaticPurchaseReminders,
  sendManualPurchaseReminder,
  type NewPurchaseReminderDelivery,
  type PaymentReminderRepository,
  type PurchaseReminderClaimResult,
  type PurchaseReminderDeliveryRecord,
  type PurchaseReminderLogRecord,
  type SendPaymentReminder,
} from "../reminders";
import type { PurchaseLedgerSnapshot, ReconciledPurchaseLedger } from "../service";

type ReminderOverrides = Readonly<{
  globalEnabled?: boolean;
  installmentEnabled?: boolean;
  pendingProof?: boolean;
  lifecycleStatus?: "waiting_for_payment" | "active" | "canceled";
  dueAt?: Date;
  email?: string;
  amountCents?: number;
  timeZone?: string;
}>;

function reminderLedger(asOf: Date, overrides: ReminderOverrides = {}): ReconciledPurchaseLedger {
  const amountCents = overrides.amountCents ?? 1_000;
  const lifecycleStatus = overrides.lifecycleStatus ?? "active";
  const snapshot: PurchaseLedgerSnapshot = {
    purchase: {
      id: "purchase-a",
      producerId: "producer-a",
      projectId: "project-a",
      clientContactId: "client-a",
      currency: "USD",
      totalCents: amountCents,
      plan: "full",
      lifecycleStatus,
      acceptedAt: new Date("2026-07-01T10:00:00.000Z"),
      activatedAt: new Date("2026-07-01T10:00:00.000Z"),
      canceledAt: lifecycleStatus === "canceled" ? new Date("2026-07-19T10:00:00.000Z") : null,
    },
    project: {
      id: "project-a",
      producerId: "producer-a",
      clientContactId: "client-a",
      lifecycleStatus: "active",
    },
    producer: {
      id: "producer-a",
      timeZone: overrides.timeZone ?? "UTC",
      automaticRemindersEnabled: overrides.globalEnabled ?? true,
      displayName: "Producer",
    },
    client: { id: "client-a", name: "Artist", email: overrides.email ?? "artist@example.com" },
    purchaseName: "Mix",
    refNumber: "SK-REMINDER",
    installments: [
      {
        id: "installment-a",
        purchaseId: "purchase-a",
        producerId: "producer-a",
        position: 1,
        amountCents,
        currency: "USD",
        dueTrigger: "acceptance",
        dueAt: overrides.dueAt ?? new Date("2026-07-20T10:00:00.000Z"),
        triggeredAt: new Date("2026-07-01T10:00:00.000Z"),
        requiredForActivation: true,
        status: lifecycleStatus === "canceled" ? "overdue" : "not_paid",
        remindersEnabled: overrides.installmentEnabled ?? true,
      },
    ],
    payments: [],
    corrections: [],
    waivers: [],
    pendingProofInstallmentIds: overrides.pendingProof ? ["installment-a"] : [],
    cancellation: null,
    pauseEvents: [],
  };
  return {
    snapshot,
    projection: projectPurchaseLedger({
      purchase: {
        id: snapshot.purchase.id,
        producerId: snapshot.purchase.producerId,
        currency: snapshot.purchase.currency,
        lifecycleStatus: snapshot.purchase.lifecycleStatus,
        wasActivated: true,
      },
      installments: snapshot.installments,
      payments: [],
      corrections: [],
      waivers: [],
      pendingProofInstallmentIds: snapshot.pendingProofInstallmentIds,
      asOf,
      timeZone: snapshot.producer.timeZone,
    }),
  };
}

class MemoryReminderRepository implements PaymentReminderRepository {
  readonly deliveries: PurchaseReminderDeliveryRecord[] = [];
  readonly logs: PurchaseReminderLogRecord[] = [];
  readonly events: string[] = [];
  loadCount = 0;
  completeFailures = 0;
  releaseFailures = 0;
  private id = 0;

  constructor(public ledger: ReconciledPurchaseLedger) {}

  listAutomaticPurchaseScopes() {
    return Promise.resolve([
      {
        producerId: this.ledger.snapshot.purchase.producerId,
        purchaseId: this.ledger.snapshot.purchase.id,
      },
    ]);
  }

  loadLedger() {
    this.loadCount += 1;
    return Promise.resolve(this.ledger);
  }

  listRecoverableDeliveries(asOf: Date) {
    return Promise.resolve(
      this.deliveries.filter(
        (delivery) =>
          delivery.status === "reserved" ||
          (delivery.status === "sending" &&
            delivery.claimUntil !== null &&
            delivery.claimUntil.getTime() <= asOf.getTime()),
      ),
    );
  }

  findDelivery(input: Parameters<PaymentReminderRepository["findDelivery"]>[0]) {
    return Promise.resolve(
      this.deliveries.find(
        (delivery) =>
          delivery.producerId === input.producerId &&
          delivery.purchaseId === input.purchaseId &&
          delivery.operationKey === input.operationKey,
      ) ?? null,
    );
  }

  reserveDelivery(input: NewPurchaseReminderDelivery) {
    this.events.push("reserve");
    const existing = this.deliveries.find(
      (row) => row.purchaseId === input.purchaseId && row.operationKey === input.operationKey,
    );
    if (existing) return Promise.resolve({ delivery: existing, created: false });
    this.id += 1;
    const delivery: PurchaseReminderDeliveryRecord = {
      ...input,
      id: `delivery-${String(this.id)}`,
      status: "reserved",
      claimToken: null,
      claimUntil: null,
      attemptCount: 0,
      firstAttemptAt: null,
      lastAttemptAt: null,
      providerDedupeExpiresAt: null,
      lastFailedAt: null,
      providerMessageId: null,
      sentAt: null,
      createdAt: input.reservedAt,
      updatedAt: input.reservedAt,
    };
    this.deliveries.push(delivery);
    return Promise.resolve({ delivery, created: true });
  }

  claimDelivery(input: Parameters<PaymentReminderRepository["claimDelivery"]>[0]) {
    const row = this.deliveries.find(
      (candidate) =>
        candidate.purchaseId === input.purchaseId &&
        candidate.producerId === input.producerId &&
        candidate.operationKey === input.operationKey,
    );
    if (!row) return Promise.reject(new Error("missing reservation"));
    if (row.status === "sent") {
      const log = this.logs.find(
        (candidate) =>
          candidate.purchaseId === input.purchaseId &&
          candidate.operationKey === input.operationKey,
      );
      if (!log) return Promise.reject(new Error("missing log"));
      return Promise.resolve<PurchaseReminderClaimResult>({ state: "sent", log });
    }
    if (row.status === "dedupe_expired") {
      return Promise.resolve<PurchaseReminderClaimResult>({ state: "dedupe_expired" });
    }
    if (row.status === "reservation_expired") {
      return Promise.resolve<PurchaseReminderClaimResult>({ state: "reservation_expired" });
    }
    if (
      row.status === "sending" &&
      row.claimUntil &&
      row.claimUntil.getTime() > input.claimedAt.getTime()
    ) {
      return Promise.resolve<PurchaseReminderClaimResult>({ state: "busy" });
    }
    const expiresAt = row.providerDedupeExpiresAt ?? input.newProviderDedupeExpiresAt;
    if (
      row.firstAttemptAt === null &&
      input.claimedAt.getTime() >= row.createdAt.getTime() + 24 * 60 * 60 * 1_000
    ) {
      Object.assign(row, {
        status: "reservation_expired",
        claimToken: null,
        claimUntil: null,
        updatedAt: input.claimedAt,
      });
      return Promise.resolve<PurchaseReminderClaimResult>({ state: "reservation_expired" });
    }
    if (row.firstAttemptAt && input.claimedAt.getTime() >= expiresAt.getTime()) {
      Object.assign(row, {
        status: "dedupe_expired",
        claimToken: null,
        claimUntil: null,
        updatedAt: input.claimedAt,
      });
      return Promise.resolve<PurchaseReminderClaimResult>({ state: "dedupe_expired" });
    }
    Object.assign(row, {
      status: "sending",
      claimToken: input.claimToken,
      claimUntil: input.claimUntil,
      attemptCount: row.attemptCount + 1,
      firstAttemptAt: row.firstAttemptAt ?? input.claimedAt,
      lastAttemptAt: input.claimedAt,
      providerDedupeExpiresAt: expiresAt,
      updatedAt: input.claimedAt,
    });
    return Promise.resolve<PurchaseReminderClaimResult>({
      state: "claimed",
      delivery: row,
      claimToken: input.claimToken,
    });
  }

  completeDelivery(input: Parameters<PaymentReminderRepository["completeDelivery"]>[0]) {
    if (this.completeFailures > 0) {
      this.completeFailures -= 1;
      return Promise.reject(new Error("database completion unavailable"));
    }
    const delivery = this.deliveries.find(
      (row) => row.purchaseId === input.purchaseId && row.operationKey === input.operationKey,
    );
    if (!delivery || delivery.status !== "sending" || delivery.claimToken !== input.claimToken) {
      return Promise.reject(new Error("claim lost"));
    }
    const existing = this.logs.find(
      (row) => row.purchaseId === input.purchaseId && row.operationKey === input.operationKey,
    );
    if (existing) return Promise.resolve({ log: existing, created: false });
    this.id += 1;
    const log: PurchaseReminderLogRecord = {
      id: `log-${String(this.id)}`,
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
    };
    this.logs.push(log);
    Object.assign(delivery, {
      status: "sent",
      claimToken: null,
      claimUntil: null,
      providerMessageId: input.providerMessageId,
      sentAt: input.sentAt,
      updatedAt: input.sentAt,
    });
    return Promise.resolve({ log, created: true });
  }

  releaseDeliveryClaim(input: Parameters<PaymentReminderRepository["releaseDeliveryClaim"]>[0]) {
    if (this.releaseFailures > 0) {
      this.releaseFailures -= 1;
      return Promise.reject(new Error("database release unavailable"));
    }
    const delivery = this.deliveries.find(
      (row) =>
        row.purchaseId === input.purchaseId &&
        row.operationKey === input.operationKey &&
        row.claimToken === input.claimToken,
    );
    if (delivery) {
      Object.assign(delivery, {
        status: "reserved",
        claimToken: null,
        claimUntil: null,
        lastFailedAt: input.failedAt,
        updatedAt: input.failedAt,
      });
    }
    return Promise.resolve();
  }
}

function provider(events?: string[]): {
  send: SendPaymentReminder;
  calls: Parameters<SendPaymentReminder>[0][];
} {
  const calls: Parameters<SendPaymentReminder>[0][] = [];
  const delivered = new Map<string, string>();
  return {
    calls,
    send: (email) => {
      events?.push("send");
      calls.push(email);
      const existing = delivered.get(email.idempotencyKey);
      if (existing) return Promise.resolve(existing);
      const id = `provider-${String(delivered.size + 1)}`;
      delivered.set(email.idempotencyKey, id);
      return Promise.resolve(id);
    },
  };
}

const paymentUrlForPurchase = (purchaseId: string) =>
  `https://skitza.app/artist/payments/${purchaseId}`;

describe("purchase reminders", () => {
  it("durably reserves before send and completes one auditable success", async () => {
    const asOf = new Date("2026-07-17T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(asOf));
    const mail = provider(repository.events);
    const run = () =>
      sendAutomaticPurchaseReminders(repository, mail.send, { asOf, paymentUrlForPurchase });

    const first = await run();
    const retry = await run();
    expect(first).toMatchObject({ reconciled: 1, eligible: 1, sent: 1, errored: 0 });
    expect(retry).toMatchObject({ reconciled: 1, eligible: 1, sent: 0, skipped: 1 });
    expect(repository.events.slice(0, 2)).toEqual(["reserve", "send"]);
    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0]?.idempotencyKey).toContain(
      "purchase-reminder:purchase-a:automatic:installment-a:automatic_3_days_before",
    );
    expect(repository.deliveries).toHaveLength(1);
    expect(repository.logs).toHaveLength(1);
    expect(repository.logs[0]).toMatchObject({
      amountDueCents: 1_000,
      currency: "USD",
      recipientEmail: "artist@example.com",
      kind: "automatic_3_days_before",
      providerMessageId: "provider-1",
    });
  });

  it.each([
    { globalEnabled: false, installmentEnabled: true },
    { globalEnabled: true, installmentEnabled: false },
    { globalEnabled: true, installmentEnabled: true, lifecycleStatus: "canceled" as const },
  ])("reconciles despite email gates, including canceled retained debt", async (flags) => {
    const asOf = new Date("2026-07-20T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(asOf, flags));
    const mail = provider();
    const result = await sendAutomaticPurchaseReminders(repository, mail.send, {
      asOf,
      paymentUrlForPurchase,
    });
    expect(result.reconciled).toBe(1);
    expect(repository.loadCount).toBe(1);
    expect(result.sent).toBe(0);
    expect(mail.calls).toHaveLength(0);
  });

  it("does not send an automatic reminder while payment proof awaits review", async () => {
    const asOf = new Date("2026-07-17T12:00:00.000Z");
    const repository = new MemoryReminderRepository(
      reminderLedger(asOf, { pendingProof: true }),
    );
    const mail = provider();

    const result = await sendAutomaticPurchaseReminders(repository, mail.send, {
      asOf,
      paymentUrlForPurchase,
    });

    expect(result).toMatchObject({ reconciled: 1, eligible: 0, sent: 0, errored: 0 });
    expect(mail.calls).toHaveLength(0);
    expect(repository.deliveries).toHaveLength(0);
  });

  it("selects today's producer-local occurrence before the exact due wall-clock time", async () => {
    const asOf = new Date("2026-07-20T05:00:00.000Z");
    const repository = new MemoryReminderRepository(
      reminderLedger(asOf, {
        dueAt: new Date("2026-07-20T14:00:00.000Z"),
        timeZone: "America/New_York",
      }),
    );
    const mail = provider();
    const result = await sendAutomaticPurchaseReminders(repository, mail.send, {
      asOf,
      paymentUrlForPurchase,
    });
    expect(result).toMatchObject({ eligible: 1, sent: 1 });
    expect(repository.logs[0]?.kind).toBe("automatic_due");
  });

  it("catches up at most two producer-local calendar days", async () => {
    const occurrenceDate = new Date("2026-07-17T10:00:00.000Z");
    const twoDaysLater = new Date("2026-07-19T01:00:00.000Z");
    const within = new MemoryReminderRepository(reminderLedger(twoDaysLater));
    const withinMail = provider();
    const sent = await sendAutomaticPurchaseReminders(within, withinMail.send, {
      asOf: twoDaysLater,
      paymentUrlForPurchase,
    });
    expect(sent).toMatchObject({ eligible: 1, sent: 1 });
    expect(within.logs[0]?.scheduledFor).toEqual(occurrenceDate);

    const threeDaysLater = new Date("2026-07-20T01:00:00.000Z");
    const past = new MemoryReminderRepository(
      reminderLedger(threeDaysLater, { dueAt: new Date("2026-07-20T22:00:00.000Z") }),
    );
    const pastResult = await sendAutomaticPurchaseReminders(past, provider().send, {
      asOf: threeDaysLater,
      paymentUrlForPurchase,
    });
    // The old -3 occurrence is outside catch-up; today's due occurrence is
    // still selected even before its wall-clock time.
    expect(pastResult).toMatchObject({ eligible: 1, sent: 1 });
    expect(past.logs[0]?.kind).toBe("automatic_due");
  });

  it("retries a failed send with one stable provider key inside 24 hours", async () => {
    const firstAt = new Date("2026-07-17T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(firstAt));
    const calls: Parameters<SendPaymentReminder>[0][] = [];
    const first = await sendAutomaticPurchaseReminders(
      repository,
      (email) => {
        calls.push(email);
        return Promise.reject(new Error("provider unavailable"));
      },
      { asOf: firstAt, paymentUrlForPurchase },
    );
    expect(first).toMatchObject({ sent: 0, errored: 1 });
    expect(repository.deliveries).toHaveLength(1);
    expect(repository.logs).toHaveLength(0);

    const failedRecovery = await sendAutomaticPurchaseReminders(
      repository,
      (email) => {
        calls.push(email);
        return Promise.reject(new Error("provider still unavailable"));
      },
      { asOf: new Date("2026-07-17T12:30:00.000Z"), paymentUrlForPurchase },
    );
    expect(failedRecovery).toMatchObject({
      recovery: { candidates: 1, sent: 0, errored: 1 },
      sent: 0,
      skipped: 1,
    });
    // Recovery owns this operation for the run; occurrence generation must
    // not immediately make a second provider attempt after the error.
    expect(calls).toHaveLength(2);

    const retry = await sendAutomaticPurchaseReminders(
      repository,
      (email) => {
        calls.push(email);
        return Promise.resolve("provider-retry");
      },
      { asOf: new Date("2026-07-17T13:00:00.000Z"), paymentUrlForPurchase },
    );
    expect(retry).toMatchObject({
      recovery: { candidates: 1, sent: 1, dedupeExpired: 0, errored: 0 },
      sent: 0,
      errored: 0,
    });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((call) => call.idempotencyKey)).size).toBe(1);
    expect(repository.logs).toHaveLength(1);
  });

  it("recovers a stale send/completion crash despite later cancellation and disabled email", async () => {
    const firstAt = new Date("2026-07-17T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(firstAt));
    repository.completeFailures = 1;
    repository.releaseFailures = 1;
    const mail = provider();
    const first = await sendAutomaticPurchaseReminders(repository, mail.send, {
      asOf: firstAt,
      paymentUrlForPurchase,
    });
    expect(repository.deliveries[0]?.status).toBe("sending");
    repository.ledger = reminderLedger(new Date("2026-07-17T12:06:00.000Z"), {
      lifecycleStatus: "canceled",
      globalEnabled: false,
      installmentEnabled: false,
      email: "changed@example.com",
      amountCents: 500,
    });
    const retry = await sendAutomaticPurchaseReminders(repository, mail.send, {
      asOf: new Date("2026-07-17T12:06:00.000Z"),
      paymentUrlForPurchase,
    });
    expect(first).toMatchObject({ sent: 0, errored: 1 });
    expect(retry).toMatchObject({
      recovery: { candidates: 1, sent: 1, busy: 0, dedupeExpired: 0, errored: 0 },
      sent: 0,
      eligible: 0,
      errored: 0,
    });
    expect(mail.calls).toHaveLength(2);
    expect(new Set(mail.calls.map((call) => call.idempotencyKey)).size).toBe(1);
    expect(mail.calls[1]).toMatchObject({
      to: "artist@example.com",
      props: { amountCents: 1_000, currency: "USD" },
    });
    expect(repository.logs).toHaveLength(1);
  });

  it("does not blindly resend once the provider dedupe window expires", async () => {
    const firstAt = new Date("2026-07-17T00:30:00.000Z");
    const repository = new MemoryReminderRepository(
      reminderLedger(firstAt, { dueAt: new Date("2026-07-20T00:30:00.000Z") }),
    );
    repository.completeFailures = 1;
    const mail = provider();
    await sendAutomaticPurchaseReminders(repository, mail.send, {
      asOf: firstAt,
      paymentUrlForPurchase,
    });
    const afterWindow = await sendAutomaticPurchaseReminders(repository, mail.send, {
      asOf: new Date("2026-07-18T00:31:00.000Z"),
      paymentUrlForPurchase,
    });
    expect(afterWindow).toMatchObject({
      recovery: { candidates: 1, sent: 0, dedupeExpired: 1, errored: 0 },
      sent: 0,
      errored: 0,
    });
    expect(mail.calls).toHaveLength(1);
    expect(repository.deliveries[0]?.status).toBe("dedupe_expired");
    expect(repository.logs).toHaveLength(0);
  });

  it("logs a manual reminder after success and replays the same intent", async () => {
    const requestedAt = new Date("2026-07-20T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(requestedAt));
    const mail = provider();
    const input = {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-a",
      operationKey: "manual-click-1",
      actorId: "clerk-producer",
      paymentUrl: "https://skitza.app/artist/payments/purchase-a",
      requestedAt,
    };
    const first = await sendManualPurchaseReminder(repository, mail.send, input);
    expect(repository.loadCount).toBe(1);
    repository.ledger = reminderLedger(new Date("2026-07-20T13:00:00.000Z"), {
      lifecycleStatus: "canceled",
      email: "changed@example.com",
      amountCents: 500,
    });
    const retry = await sendManualPurchaseReminder(repository, mail.send, {
      ...input,
      requestedAt: new Date("2026-07-20T13:00:00.000Z"),
    });
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(repository.loadCount).toBe(1);
    expect(mail.calls).toHaveLength(1);
    expect(repository.logs[0]?.sentByClerkUserId).toBe("clerk-producer");
  });

  it("rejects a manual reminder while payment proof awaits review", async () => {
    const requestedAt = new Date("2026-07-20T12:00:00.000Z");
    const repository = new MemoryReminderRepository(
      reminderLedger(requestedAt, { pendingProof: true }),
    );
    const mail = provider();

    await expect(
      sendManualPurchaseReminder(repository, mail.send, {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        installmentId: "installment-a",
        operationKey: "manual-proof-review",
        actorId: "clerk-producer",
        paymentUrl: "https://skitza.app/artist/payments/purchase-a",
        requestedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mail.calls).toHaveLength(0);
    expect(repository.deliveries).toHaveLength(0);
  });

  it("retries an uncertain manual send from its stored snapshot after live terms change", async () => {
    const requestedAt = new Date("2026-07-20T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(requestedAt));
    repository.completeFailures = 1;
    const mail = provider();
    const input = {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-a",
      operationKey: "manual-uncertain-1",
      actorId: "clerk-producer",
      paymentUrl: "https://skitza.app/artist/payments/purchase-a",
      requestedAt,
    };
    await expect(sendManualPurchaseReminder(repository, mail.send, input)).rejects.toThrow(
      "database completion unavailable",
    );
    repository.ledger = reminderLedger(new Date("2026-07-20T13:00:00.000Z"), {
      lifecycleStatus: "canceled",
      email: "changed@example.com",
      amountCents: 500,
    });
    const retry = await sendManualPurchaseReminder(repository, mail.send, {
      ...input,
      requestedAt: new Date("2026-07-20T13:00:00.000Z"),
    });
    expect(retry.created).toBe(true);
    expect(repository.loadCount).toBe(1);
    expect(mail.calls).toHaveLength(2);
    expect(mail.calls[1]).toMatchObject({
      to: "artist@example.com",
      props: { amountCents: 1_000, currency: "USD" },
    });
    expect(mail.calls[1]?.idempotencyKey).toBe(mail.calls[0]?.idempotencyKey);
  });

  it("recovers a pending manual reservation without consulting current ledger eligibility", async () => {
    const requestedAt = new Date("2026-07-20T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(requestedAt));
    const calls: Parameters<SendPaymentReminder>[0][] = [];
    const input = {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-a",
      operationKey: "manual-recovery-1",
      actorId: "clerk-producer",
      paymentUrl: "https://skitza.app/artist/payments/purchase-a",
      requestedAt,
    };
    await expect(
      sendManualPurchaseReminder(
        repository,
        (email) => {
          calls.push(email);
          return Promise.reject(new Error("provider unavailable"));
        },
        input,
      ),
    ).rejects.toThrow("provider unavailable");
    repository.ledger = reminderLedger(new Date("2026-07-20T13:00:00.000Z"), {
      lifecycleStatus: "canceled",
      globalEnabled: false,
      installmentEnabled: false,
    });
    const recovered = await sendAutomaticPurchaseReminders(
      repository,
      (email) => {
        calls.push(email);
        return Promise.resolve("provider-manual-recovery");
      },
      { asOf: new Date("2026-07-20T13:00:00.000Z"), paymentUrlForPurchase },
    );
    expect(recovered).toMatchObject({
      recovery: { candidates: 1, sent: 1, errored: 0 },
      eligible: 0,
      sent: 0,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey);
    expect(repository.logs[0]).toMatchObject({
      kind: "manual",
      sentByClerkUserId: "clerk-producer",
    });
  });

  it("terminalizes an old never-attempted reservation without provider I/O", async () => {
    const reservedAt = new Date("2026-06-01T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(reservedAt));
    await expect(
      sendManualPurchaseReminder(repository, () => Promise.reject(new Error("seed failure")), {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        installmentId: "installment-a",
        operationKey: "old-unsent-1",
        actorId: "clerk-producer",
        paymentUrl: "https://skitza.app/artist/payments/purchase-a",
        requestedAt: reservedAt,
      }),
    ).rejects.toThrow("seed failure");
    const delivery = repository.deliveries[0];
    if (!delivery) throw new Error("missing seeded reservation");
    Object.assign(delivery, {
      status: "reserved",
      attemptCount: 0,
      firstAttemptAt: null,
      lastAttemptAt: null,
      providerDedupeExpiresAt: null,
      lastFailedAt: null,
      createdAt: reservedAt,
      updatedAt: reservedAt,
    });
    repository.ledger = reminderLedger(new Date("2026-07-20T12:00:00.000Z"), {
      lifecycleStatus: "canceled",
    });
    const recoveryCalls: Parameters<SendPaymentReminder>[0][] = [];
    const result = await sendAutomaticPurchaseReminders(
      repository,
      (email) => {
        recoveryCalls.push(email);
        return Promise.resolve("must-not-send");
      },
      { asOf: new Date("2026-07-20T12:00:00.000Z"), paymentUrlForPurchase },
    );
    expect(result).toMatchObject({
      recovery: {
        candidates: 1,
        sent: 0,
        reservationExpired: 1,
        dedupeExpired: 0,
        errored: 0,
      },
    });
    expect(recoveryCalls).toHaveLength(0);
    expect(delivery.status).toBe("reservation_expired");
  });

  it("rejects reuse of a manual operation key with changed caller intent", async () => {
    const requestedAt = new Date("2026-07-20T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(requestedAt));
    const mail = provider();
    const input = {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-a",
      operationKey: "manual-click-1",
      actorId: "clerk-producer",
      paymentUrl: "https://skitza.app/artist/payments/purchase-a",
      requestedAt,
    };
    await sendManualPurchaseReminder(repository, mail.send, input);
    await expect(
      sendManualPurchaseReminder(repository, mail.send, {
        ...input,
        paymentUrl: "https://skitza.app/artist/payments/a-different-purchase",
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    expect(repository.loadCount).toBe(1);
    expect(repository.deliveries[0]?.messageSnapshot.to).toBe("artist@example.com");
  });

  it("keeps one reservation, provider send, and audit row during concurrent runs", async () => {
    const asOf = new Date("2026-07-17T12:00:00.000Z");
    const repository = new MemoryReminderRepository(reminderLedger(asOf));
    const calls: Parameters<SendPaymentReminder>[0][] = [];
    let releaseProvider: ((id: string) => void) | undefined;
    let markProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const send: SendPaymentReminder = (email) => {
      calls.push(email);
      return new Promise((resolve) => {
        releaseProvider = resolve;
        markProviderStarted?.();
      });
    };
    const first = sendAutomaticPurchaseReminders(repository, send, {
      asOf,
      paymentUrlForPurchase,
    });
    await providerStarted;
    const second = sendAutomaticPurchaseReminders(repository, send, {
      asOf,
      paymentUrlForPurchase,
    });
    if (!releaseProvider) throw new Error("provider was not started");
    releaseProvider("provider-1");
    await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect(repository.deliveries).toHaveLength(1);
    expect(repository.logs).toHaveLength(1);
  });
});
