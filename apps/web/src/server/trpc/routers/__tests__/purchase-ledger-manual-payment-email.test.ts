import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SK-271 — recording a cash payment must not email a client who never joined.
 *
 * The producer can import an existing client by hand. That client has no Clerk
 * account, and when the producer records the payment without uploading a
 * receipt there is no proof row either. The old wiring skipped both
 * notification branches and still sent "Payment confirmed — review your
 * schedule from your home screen" to someone with no home screen.
 */

const h = vi.hoisted(() => ({
  PRODUCER_ID: "producer-uuid-sk271",
  PURCHASE_ID: "11111111-1111-4111-8111-111111111111",
  INSTALLMENT_ID: "22222222-2222-4222-8222-222222222222",
  OPERATION_KEY: "33333333-3333-4333-8333-333333333333",
  PROJECT_ID: "44444444-4444-4444-8444-444444444444",
  deferred: [] as Array<() => unknown>,
  db: { __fakeDb: true },
  recordProducerManualPayment: vi.fn(),
  emitArtistProofDecisionNotification: vi.fn(),
  getArtistProfile: vi.fn(),
  deliverPushToProjectArtist: vi.fn(),
  sendProofVerifiedEmail: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (work: () => unknown) => {
    h.deferred.push(work);
  },
}));

vi.mock("~/server/trpc/producer-procedure", async () => {
  const { publicProcedure } = await import("~/server/trpc/init");
  return {
    producerProcedure: publicProcedure.use(({ ctx, next }) =>
      next({ ctx: { ...ctx, db: h.db, producerId: h.PRODUCER_ID } }),
    ),
  };
});

vi.mock("~/server/domain/payment-proofs/producer-manual-payment", () => ({
  recordProducerManualPayment: h.recordProducerManualPayment,
  prepareProducerReceiptUpload: vi.fn(),
  cancelProducerReceiptUpload: vi.fn(),
}));

vi.mock("~/server/artist/notification-emitters", () => ({
  emitArtistProofDecisionNotification: h.emitArtistProofDecisionNotification,
}));

vi.mock("~/server/artist/profile", () => ({
  getArtistProfile: h.getArtistProfile,
}));

vi.mock("~/server/push/delivery", () => ({
  deliverPushToProjectArtist: h.deliverPushToProjectArtist,
}));

vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.test",
  sendPaymentReminderEmail: vi.fn(),
  sendProofVerifiedEmail: h.sendProofVerifiedEmail,
}));

const EMAIL = {
  artistEmail: "client@example.com",
  artistName: "Shoshana",
  producerName: "Studio Ada",
  productName: "Full production",
  refNumber: "SK-0001",
  currency: "ILS",
  amountCents: 50_000,
  paidCents: 50_000,
  totalCents: 50_000,
  paidInFull: true,
};

function manualPaymentResult(
  overrides: Readonly<{ proofId: string | null; artistClerkUserId: string | null }>,
) {
  return {
    paymentId: "55555555-5555-4555-8555-555555555555",
    proofId: overrides.proofId,
    purchaseId: h.PURCHASE_ID,
    installmentId: h.INSTALLMENT_ID,
    installmentPosition: 1,
    projectId: h.PROJECT_ID,
    installmentStatus: "confirmed" as const,
    paidInFull: true,
    created: true,
    artistClerkUserId: overrides.artistClerkUserId,
    email: EMAIL,
  };
}

function proofPreference(enabled: boolean) {
  return {
    notificationPreferences: {
      proof: { inApp: true, transactionalEmail: enabled, activityEmail: false },
    },
  };
}

async function recordCashPayment() {
  const { purchaseLedgerRouter } = await import("../purchase-ledger");
  const caller = purchaseLedgerRouter.createCaller({ userId: "user_producer_sk271" });
  const result = await caller.recordManualPayment({
    purchaseId: h.PURCHASE_ID,
    installmentId: h.INSTALLMENT_ID,
    operationKey: h.OPERATION_KEY,
    amountCents: 50_000,
    paidAt: new Date("2026-08-28T09:00:00.000Z"),
  });
  // `after()` work is deferred by Next in production; run it here so the push
  // and email side effects are observable.
  const queued = [...h.deferred];
  h.deferred.length = 0;
  for (const work of queued) await work();
  return result;
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test/test";
  process.env.SKITZA_CAPABILITY_SECRET = "s".repeat(32);
  h.deferred.length = 0;
  h.recordProducerManualPayment.mockReset();
  h.emitArtistProofDecisionNotification
    .mockReset()
    .mockResolvedValue({ inserted: true, emailEnabled: true });
  h.getArtistProfile.mockReset().mockResolvedValue(proofPreference(true));
  h.deliverPushToProjectArtist.mockReset().mockResolvedValue(undefined);
  h.sendProofVerifiedEmail.mockReset().mockResolvedValue(undefined);
});

describe("recordManualPayment — who actually gets the payment-confirmed email", () => {
  it("emails a client who joined Skitza when a receipt was attached", async () => {
    h.recordProducerManualPayment.mockResolvedValue(
      manualPaymentResult({ proofId: "proof-1", artistClerkUserId: "user_artist_1" }),
    );

    await recordCashPayment();

    expect(h.emitArtistProofDecisionNotification).toHaveBeenCalledTimes(1);
    expect(h.sendProofVerifiedEmail).toHaveBeenCalledWith(EMAIL.artistEmail, EMAIL);
    expect(h.deliverPushToProjectArtist).toHaveBeenCalledTimes(1);
  });

  it("emails a client who joined Skitza with no receipt when their proof emails are on", async () => {
    h.recordProducerManualPayment.mockResolvedValue(
      manualPaymentResult({ proofId: null, artistClerkUserId: "user_artist_1" }),
    );

    await recordCashPayment();

    expect(h.getArtistProfile).toHaveBeenCalledTimes(1);
    expect(h.sendProofVerifiedEmail).toHaveBeenCalledWith(EMAIL.artistEmail, EMAIL);
    expect(h.deliverPushToProjectArtist).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a joined client turned proof emails off", async () => {
    h.recordProducerManualPayment.mockResolvedValue(
      manualPaymentResult({ proofId: null, artistClerkUserId: "user_artist_1" }),
    );
    h.getArtistProfile.mockResolvedValue(proofPreference(false));

    await recordCashPayment();

    expect(h.sendProofVerifiedEmail).not.toHaveBeenCalled();
    expect(h.deliverPushToProjectArtist).toHaveBeenCalledTimes(1);
  });

  it("sends nothing to an imported client with no Skitza account and no receipt", async () => {
    h.recordProducerManualPayment.mockResolvedValue(
      manualPaymentResult({ proofId: null, artistClerkUserId: null }),
    );

    await recordCashPayment();

    // No account and no proof: neither notification branch can run, and the
    // client already holds the receipt the producer handed over in person.
    expect(h.emitArtistProofDecisionNotification).not.toHaveBeenCalled();
    expect(h.getArtistProfile).not.toHaveBeenCalled();
    expect(h.sendProofVerifiedEmail).not.toHaveBeenCalled();
    // Push delivery is unchanged — it is scoped to the project and is a no-op
    // when nobody has a subscription.
    expect(h.deliverPushToProjectArtist).toHaveBeenCalledTimes(1);
  });

  it("still emails a client without an account when a receipt exists to point at", async () => {
    h.recordProducerManualPayment.mockResolvedValue(
      manualPaymentResult({ proofId: "proof-1", artistClerkUserId: null }),
    );

    await recordCashPayment();

    expect(h.sendProofVerifiedEmail).toHaveBeenCalledWith(EMAIL.artistEmail, EMAIL);
  });
});
