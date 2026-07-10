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
import { buildProofStagingKey } from "~/server/storage/r2";

const { r2SendMock, proofVerifiedEmailMock, purchaseApprovedEmailMock, purchaseDeclinedEmailMock } =
  vi.hoisted(() => ({
    r2SendMock: vi.fn((command: { constructor: { name: string } }) => {
      if (command.constructor.name === "HeadObjectCommand") {
        return Promise.resolve({
          ContentLength: 2_048,
          ContentType: "image/png",
          ETag: '"proof-etag"',
        });
      }
      if (command.constructor.name === "CopyObjectCommand") {
        return Promise.resolve({ CopyObjectResult: { ETag: '"proof-etag"' } });
      }
      if (command.constructor.name === "GetObjectCommand") {
        return Promise.resolve({
          Body: {
            transformToByteArray: () =>
              Promise.resolve(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
          },
        });
      }
      return Promise.resolve({});
    }),
    proofVerifiedEmailMock: vi.fn(() => Promise.resolve(undefined)),
    purchaseApprovedEmailMock: vi.fn(() => Promise.resolve(undefined)),
    purchaseDeclinedEmailMock: vi.fn(() => Promise.resolve(undefined)),
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
    getR2: () => ({ send: r2SendMock }),
  };
});

vi.mock("~/server/email/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/email/send")>();
  return {
    ...actual,
    sendProofVerifiedEmail: proofVerifiedEmailMock,
    sendProofRejectedEmail: vi.fn(() => Promise.resolve(undefined)),
    sendPurchaseApprovedEmail: purchaseApprovedEmailMock,
    sendPurchaseDeclinedEmail: purchaseDeclinedEmailMock,
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

  async function createArtist(label: string) {
    const userId = `artist_${label}_${suffix}`;
    await db.insert(clientContacts).values({
      producerId,
      emailHash: `e2e-hash-${label}-${suffix}`,
      email: `${userId}@example.com`,
      name: `E2E ${label} Artist`,
      clerkUserId: userId,
    });
    return {
      userId,
      caller: appRouter.createCaller({ userId }),
    };
  }

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

  it("allows exactly one concurrent approve-or-decline transition and one email", async () => {
    const { caller: artist } = await createArtist("gate-race");
    const producer = appRouter.createCaller({ userId: producerUserId });
    const created = await artist.artist.purchase.request({
      productId,
      paymentPlan: { kind: "full" },
      agreementAccepted: true,
    });

    purchaseApprovedEmailMock.mockClear();
    purchaseDeclinedEmailMock.mockClear();
    const outcomes = await Promise.allSettled([
      producer.producer.purchase.approve({ id: created.purchaseRequestId }),
      producer.producer.purchase.decline({
        id: created.purchaseRequestId,
        reason: "Concurrent decision test",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(
      purchaseApprovedEmailMock.mock.calls.length + purchaseDeclinedEmailMock.mock.calls.length,
    ).toBe(1);

    const [persisted] = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, created.purchaseRequestId));
    expect(["approved", "declined"]).toContain(persisted?.status);
  }, 30_000);

  it("keeps approval undo and plan choice coherent under a real database race", async () => {
    const { caller: artist } = await createArtist("undo-race");
    const producer = appRouter.createCaller({ userId: producerUserId });
    const created = await artist.artist.purchase.request({
      productId,
      paymentPlan: { kind: "full" },
      agreementAccepted: true,
    });
    await producer.producer.purchase.approve({ id: created.purchaseRequestId });

    const outcomes = await Promise.allSettled([
      artist.artist.purchase.paymentPlan.choose({
        purchaseRequestId: created.purchaseRequestId,
        paymentPlan: { kind: "full" },
      }),
      producer.producer.purchase.undoApproval({ id: created.purchaseRequestId }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const [persisted] = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, created.purchaseRequestId));
    if (!persisted) throw new Error("Race-test purchase disappeared");
    if (persisted.status === "pending") {
      expect(persisted.approvedAt).toBeNull();
      expect(persisted.paymentPlanChosenAt).toBeNull();
    } else {
      expect(persisted.status).toBe("approved");
      expect(persisted.approvedAt).toBeInstanceOf(Date);
      expect(persisted.paymentPlanChosenAt).toBeInstanceOf(Date);
    }
  }, 30_000);

  it("lets exactly one of confirm or reject win for the same immutable proof", async () => {
    const { caller: artist } = await createArtist("proof-race");
    const producer = appRouter.createCaller({ userId: producerUserId });
    const created = await artist.artist.purchase.request({
      productId,
      paymentPlan: { kind: "full" },
      agreementAccepted: true,
    });
    await producer.producer.purchase.approve({ id: created.purchaseRequestId });
    await artist.artist.purchase.paymentPlan.choose({
      purchaseRequestId: created.purchaseRequestId,
      paymentPlan: { kind: "full" },
    });
    const proof = await artist.artist.purchase.proofOfPayment.submit({
      purchaseRequestId: created.purchaseRequestId,
      amountCents: 240_000,
      storageKey: buildProofStagingKey({
        producerId,
        purchaseRequestId: created.purchaseRequestId,
      }),
      originalFileName: "race-proof.png",
    });

    r2SendMock.mockRejectedValueOnce(new Error("simulated ETag mismatch"));
    await expect(
      producer.producer.purchase.proofOfPayment.confirm({ proofId: proof.proofId }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This proof file changed or is unavailable. Ask the artist to upload it again.",
    });
    const invoicesAfterTamper = await db
      .select()
      .from(invoices)
      .where(eq(invoices.paymentProofId, proof.proofId));
    expect(invoicesAfterTamper).toHaveLength(0);

    const outcomes = await Promise.allSettled([
      producer.producer.purchase.proofOfPayment.confirm({ proofId: proof.proofId }),
      producer.producer.purchase.proofOfPayment.reject({
        proofId: proof.proofId,
        note: "Race rejection",
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const [persistedProof] = await db
      .select()
      .from(paymentProofs)
      .where(eq(paymentProofs.id, proof.proofId));
    const proofInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.paymentProofId, proof.proofId));
    const [persistedRequest] = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, created.purchaseRequestId));
    expect(["confirmed", "rejected"]).toContain(persistedProof?.status);
    if (persistedProof?.status === "confirmed") {
      expect(proofInvoices).toHaveLength(1);
      expect(persistedRequest?.status).toBe("paid");
    } else {
      expect(proofInvoices).toHaveLength(0);
      expect(persistedRequest?.status).toBe("approved");
    }
  }, 45_000);

  it("persists request → approval → split proofs → paid-in-full and enforces tenant boundaries", async () => {
    r2SendMock.mockClear();
    proofVerifiedEmailMock.mockClear();

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

    const stagingKey = buildProofStagingKey({
      producerId,
      purchaseRequestId: created.purchaseRequestId,
    });
    const callsBeforeInvalidAmount = r2SendMock.mock.calls.length;
    await expect(
      artist.artist.purchase.proofOfPayment.submit({
        purchaseRequestId: created.purchaseRequestId,
        amountCents: 1,
        storageKey: stagingKey,
        originalFileName: "one-cent.png",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "The proof amount must match the payment currently due.",
    });
    expect(r2SendMock).toHaveBeenCalledTimes(callsBeforeInvalidAmount);

    const firstProof = await artist.artist.purchase.proofOfPayment.submit({
      purchaseRequestId: created.purchaseRequestId,
      amountCents: 120_000,
      storageKey: stagingKey,
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
        storageKey: stagingKey,
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
      storageKey: stagingKey,
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
    expect(persistedProofs.every((proof) => proof.objectEtag === '"proof-etag"')).toBe(true);
    expect(
      persistedProofs.every((proof) =>
        new RegExp(
          `^producers/${producerId}/proofs/${created.purchaseRequestId}/final/[0-9a-f]{32}-`,
        ).test(proof.storageKey),
      ),
    ).toBe(true);
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
    const commandNames = r2SendMock.mock.calls.map(([command]) => command.constructor.name);
    expect(commandNames.filter((name) => name === "CopyObjectCommand")).toHaveLength(2);
    expect(commandNames.filter((name) => name === "DeleteObjectCommand")).toHaveLength(2);
    expect(proofVerifiedEmailMock).toHaveBeenCalledTimes(2);
  }, 30_000);
});
