import { randomUUID } from "node:crypto";

import {
  agreementAcceptances,
  clientContacts,
  createDb,
  eq,
  inArray,
  invoices,
  paymentProofs,
  producers,
  products,
  purchaseRequests,
} from "@skitza/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { headObjectMock, proofVerifiedEmailMock } = vi.hoisted(() => ({
  headObjectMock: vi.fn(() =>
    Promise.resolve({
      ContentLength: 2_048,
      ContentType: "image/png",
    }),
  ),
  proofVerifiedEmailMock: vi.fn(() => Promise.resolve(undefined)),
}));

// `after()` needs a Next request scope in production. The integration test
// executes its callback immediately so email dispatch is observable without
// creating external side effects.
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    void callback();
  },
}));

// Keep the key-ownership and bucket code real. Only the remote object HEAD is
// replaced: CI has a disposable Neon branch, not disposable R2 credentials.
vi.mock("~/server/storage/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/storage/r2")>();
  return {
    ...actual,
    getR2: () => ({ send: headObjectMock }),
  };
});

vi.mock("~/server/email/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/email/send")>();
  return {
    ...actual,
    sendProofVerifiedEmail: proofVerifiedEmailMock,
    sendProofRejectedEmail: vi.fn(() => Promise.resolve(undefined)),
    sendPurchaseApprovedEmail: vi.fn(() => Promise.resolve(undefined)),
    sendPurchaseDeclinedEmail: vi.fn(() => Promise.resolve(undefined)),
  };
});

import { appRouter } from "../_app";

const databaseUrl = process.env.DATABASE_URL_TEST;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("artist purchase flow — real Postgres integration", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const suffix = randomUUID();
  const artistUserId = `artist_e2e_${suffix}`;
  const strangerArtistUserId = `artist_stranger_${suffix}`;
  const producerUserId = `producer_e2e_${suffix}`;
  const attackerProducerUserId = `producer_attacker_${suffix}`;
  // Vitest still evaluates a skipped suite's registration callback. Use a
  // syntactically valid, never-contacted fallback URL when local CI secrets
  // are absent; every query remains inside the skipped hooks/test.
  const db = createDb(databaseUrl ?? "postgresql://unused:unused@localhost/unused");

  let producerId = "";
  let attackerProducerId = "";
  let productId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    const [producer] = await db
      .insert(producers)
      .values({
        clerkUserId: producerUserId,
        email: `${producerUserId}@example.com`,
        displayName: "E2E Studio",
        slug: `e2e-studio-${suffix}`,
        defaultCurrency: "ILS",
        paymentDetails: {
          bankTransfer: "Test Bank · Branch 123 · Account 456",
          bitPhone: "050-000-0000",
        },
      })
      .returning();
    if (!producer) throw new Error("Failed to seed E2E producer");
    producerId = producer.id;

    const [attacker] = await db
      .insert(producers)
      .values({
        clerkUserId: attackerProducerUserId,
        email: `${attackerProducerUserId}@example.com`,
        displayName: "Other Studio",
        slug: `e2e-other-studio-${suffix}`,
      })
      .returning();
    if (!attacker) throw new Error("Failed to seed E2E attacker producer");
    attackerProducerId = attacker.id;

    await db.insert(clientContacts).values({
      producerId,
      emailHash: `e2e-hash-${suffix}`,
      email: `${artistUserId}@example.com`,
      name: "E2E Artist",
      clerkUserId: artistUserId,
    });

    const [product] = await db
      .insert(products)
      .values({
        producerId,
        name: "E2E Premium Single",
        description: "Disposable integration-test product",
        durationMin: 120,
        priceCents: 240_000,
        currency: "ILS",
        depositModel: "flat",
        paymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
        contractUrl: "https://example.com/e2e-agreement.pdf",
      })
      .returning();
    if (!product) throw new Error("Failed to seed E2E product");
    productId = product.id;
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;

    const seededProducerIds = [producerId, attackerProducerId].filter(Boolean);
    if (seededProducerIds.length > 0) {
      await db.delete(producers).where(inArray(producers.id, seededProducerIds));
    }
  });

  it("rolls back a failed interactive transaction", async () => {
    const rollbackUserId = `producer_rollback_${suffix}`;

    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(producers).values({
            clerkUserId: rollbackUserId,
            email: `${rollbackUserId}@example.com`,
            displayName: "Rollback Studio",
            slug: `rollback-studio-${suffix}`,
          });
          throw new Error("force transaction rollback");
        }),
      ).rejects.toThrow("force transaction rollback");

      const rolledBackRows = await db
        .select()
        .from(producers)
        .where(eq(producers.clerkUserId, rollbackUserId));
      expect(rolledBackRows).toHaveLength(0);
    } finally {
      // Keep the disposable test branch clean even if a future adapter
      // regression accidentally commits before this assertion runs.
      await db.delete(producers).where(eq(producers.clerkUserId, rollbackUserId));
    }
  });

  it("persists request → approval → split proofs → paid-in-full and enforces tenant boundaries", async () => {
    const anonymous = appRouter.createCaller({ userId: null });
    const artist = appRouter.createCaller({ userId: artistUserId });
    const strangerArtist = appRouter.createCaller({ userId: strangerArtistUserId });
    const producer = appRouter.createCaller({ userId: producerUserId });
    const attackerProducer = appRouter.createCaller({ userId: attackerProducerUserId });

    await expect(
      anonymous.artist.purchase.request({
        productId,
        paymentPlan: { kind: "full" },
        agreementAccepted: true,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const created = await artist.artist.purchase.request({
      productId,
      paymentPlan: { kind: "full" },
      agreementAccepted: true,
    });
    expect(created.status).toBe("pending");
    expect(created.priceCents).toBe(240_000);

    const acceptances = await db
      .select()
      .from(agreementAcceptances)
      .where(eq(agreementAcceptances.purchaseRequestId, created.purchaseRequestId));
    expect(acceptances).toHaveLength(1);
    const acceptance = acceptances[0];
    if (!acceptance) throw new Error("Purchase acceptance was not persisted");
    expect(acceptance.acceptedByClerkUserId).toBe(artistUserId);

    await expect(
      strangerArtist.artist.purchase.proofOfPayment.state({
        purchaseRequestId: created.purchaseRequestId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      attackerProducer.producer.purchase.approve({ id: created.purchaseRequestId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const approved = await producer.producer.purchase.approve({ id: created.purchaseRequestId });
    expect(approved.status).toBe("approved");

    const options = await artist.artist.purchase.paymentPlan.options({
      purchaseRequestId: created.purchaseRequestId,
    });
    expect(options.options.map((option) => option.kind)).toEqual(["full", "split_50_50"]);

    await artist.artist.purchase.paymentPlan.choose({
      purchaseRequestId: created.purchaseRequestId,
      paymentPlan: { kind: "split_50_50" },
    });
    await expect(
      artist.artist.purchase.paymentPlan.choose({
        purchaseRequestId: created.purchaseRequestId,
        paymentPlan: { kind: "full" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const instructions = await artist.artist.purchase.paymentInstructions({
      purchaseRequestId: created.purchaseRequestId,
    });
    expect(instructions.amountDueNowCents).toBe(120_000);
    expect(instructions.bankTransfer).toContain("Test Bank");

    const firstProof = await artist.artist.purchase.proofOfPayment.submit({
      purchaseRequestId: created.purchaseRequestId,
      amountCents: 120_000,
      storageKey: `producers/${producerId}/proofs/${created.purchaseRequestId}/first-proof.png`,
      originalFileName: "first-proof.png",
      note: "E2E deposit",
    });

    const invoicesBeforeConfirmation = await db
      .select()
      .from(invoices)
      .where(eq(invoices.purchaseRequestId, created.purchaseRequestId));
    expect(invoicesBeforeConfirmation).toHaveLength(0);

    await expect(
      artist.artist.purchase.proofOfPayment.submit({
        purchaseRequestId: created.purchaseRequestId,
        amountCents: 120_000,
        storageKey: `producers/${producerId}/proofs/${created.purchaseRequestId}/duplicate.png`,
        originalFileName: "duplicate.png",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      attackerProducer.producer.purchase.proofOfPayment.confirm({ proofId: firstProof.proofId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const confirmations = await Promise.all([
      producer.producer.purchase.proofOfPayment.confirm({ proofId: firstProof.proofId }),
      producer.producer.purchase.proofOfPayment.confirm({ proofId: firstProof.proofId }),
    ]);
    expect(confirmations.every((result) => result.depositPaid)).toBe(true);
    expect(confirmations.every((result) => !result.finalPaid)).toBe(true);

    const firstProofInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.paymentProofId, firstProof.proofId));
    expect(firstProofInvoices).toHaveLength(1);
    expect(firstProofInvoices[0]?.status).toBe("paid");

    const halfway = await artist.artist.purchase.proofOfPayment.state({
      purchaseRequestId: created.purchaseRequestId,
    });
    expect(halfway.requestStatus).toBe("paid");
    expect(halfway.paidCents).toBe(120_000);
    expect(halfway.remainingCents).toBe(120_000);
    expect(halfway.paidInFull).toBe(false);

    const secondProof = await artist.artist.purchase.proofOfPayment.submit({
      purchaseRequestId: created.purchaseRequestId,
      amountCents: 120_000,
      storageKey: `producers/${producerId}/proofs/${created.purchaseRequestId}/final-proof.png`,
      originalFileName: "final-proof.png",
      note: "E2E final payment",
    });
    const finalConfirmation = await producer.producer.purchase.proofOfPayment.confirm({
      proofId: secondProof.proofId,
    });
    expect(finalConfirmation.finalPaid).toBe(true);

    const complete = await artist.artist.purchase.proofOfPayment.state({
      purchaseRequestId: created.purchaseRequestId,
    });
    expect(complete.paidCents).toBe(240_000);
    expect(complete.remainingCents).toBe(0);
    expect(complete.paidInFull).toBe(true);

    const persistedProofs = await db
      .select()
      .from(paymentProofs)
      .where(eq(paymentProofs.purchaseRequestId, created.purchaseRequestId));
    const persistedInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.purchaseRequestId, created.purchaseRequestId));
    expect(persistedProofs).toHaveLength(2);
    expect(persistedProofs.every((proof) => proof.status === "confirmed")).toBe(true);
    expect(persistedProofs.every((proof) => proof.storageBucket === "docs")).toBe(true);
    expect(persistedInvoices).toHaveLength(2);
    expect(persistedInvoices.reduce((sum, invoice) => sum + invoice.amountCents, 0)).toBe(240_000);

    // A fully-paid request releases the single-active-purchase slot.
    const nextPurchase = await artist.artist.purchase.request({
      productId,
      paymentPlan: { kind: "full" },
      agreementAccepted: true,
    });
    expect(nextPurchase.purchaseRequestId).not.toBe(created.purchaseRequestId);

    const rows = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.clientContactId, acceptance.clientContactId));
    expect(rows).toHaveLength(2);
    expect(headObjectMock).toHaveBeenCalledTimes(3);
    expect(proofVerifiedEmailMock).toHaveBeenCalledTimes(2);
  }, 30_000);
});
