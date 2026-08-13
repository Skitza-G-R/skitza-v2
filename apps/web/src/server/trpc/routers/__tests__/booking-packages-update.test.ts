import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendAgreementPdfRevision,
  markAgreementPdfContractForCleanup,
  type AgreementPdfDocument,
} from "~/server/domain/agreement-pdfs/contract";

// Tests for booking.packages.update — the mutation the Task 14 Edit
// button dispatches. Verifies the mutation exists on the legacy
// `.packages.*` alias (still used by the dashboard action), accepts
// the full edit-mode input shape the form emits, and enforces the
// same non-leaking NOT_FOUND boundary as archive/deactivate.

const PRODUCER_ID = "producer-uuid-1";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000b01";

const producersMarker = { __table: "producers" };
const productsMarker = { __table: "products" };

const agreementPdfDocument: AgreementPdfDocument = {
  storageBucket: "docs",
  storageKey: `agreement-pdfs/${"a".repeat(64)}`,
  originalFileName: "terms.pdf",
  contentType: "application/pdf",
  sizeBytes: 128,
  objectEtag: '"agreement-etag"',
  sha256: "b".repeat(64),
};

const agreementPdfCandidate = {
  storageBucket: "docs" as const,
  storageKey: agreementPdfDocument.storageKey,
  originalFileName: agreementPdfDocument.originalFileName,
  contentType: agreementPdfDocument.contentType,
  sizeBytes: agreementPdfDocument.sizeBytes,
};

const agreementPdfMocks = vi.hoisted(() => ({
  candidate: vi.fn(),
  deleteFinal: vi.fn<(document: AgreementPdfDocument) => Promise<void>>(),
  finalize: vi.fn(),
  resolveCandidate: vi.fn(),
  verify: vi.fn(),
}));

const commercialValidation = vi.hoisted(() => ({ rejectMergedActiveProduct: false }));

type Row = Record<string, unknown>;

// Two independent select queues so the producer-procedure lookup and
// the router's own by-id select don't stomp on each other. Calls
// against producers → first queue; calls against products → second.
const producerSelectQueue: Row[][] = [];
const productSelectQueue: Row[][] = [];

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

function queueOpenProducerCapabilityLock(): void {
  producerSelectQueue.push([{ id: PRODUCER_ID }], [{ id: PRODUCER_ID, closedAt: null }]);
}

const updateReturningSpy = vi.fn<() => Promise<Row[]>>(() =>
  Promise.resolve([{ id: PRODUCT_ID, name: "Renamed" }]),
);
const updateSetSpy = vi.fn(() => ({
  where: () => ({ returning: updateReturningSpy }),
}));
const insertReturningSpy = vi.fn<() => Promise<Row[]>>(() =>
  Promise.resolve([{ id: PRODUCT_ID, name: "Created" }]),
);
const insertValuesSpy = vi.fn((values: Row) => {
  void values;
  return { returning: insertReturningSpy };
});

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const handler = () => {
        if (table === producersMarker) return shift(producerSelectQueue);
        if (table === productsMarker) return shift(productSelectQueue);
        return [];
      };
      // producer-procedure uses .where().limit(1); the router's
      // ownership check does .where().limit(1) too.
      return {
        where: () => {
          const result = Promise.resolve(handler());
          return Object.assign(result, {
            limit: () => Object.assign(result, { for: () => result }),
            orderBy: () => result,
          });
        },
      };
    },
  }),
  update: () => ({ set: updateSetSpy }),
  insert: () => ({ values: insertValuesSpy }),
  execute: () => Promise.resolve(),
  transaction: (callback: unknown) => (callback as (tx: unknown) => Promise<unknown>)(dbMock),
};

vi.mock("~/server/domain/store-products/service", () => {
  class StoreProductCommercialError extends Error {}
  return {
    StoreProductCommercialError,
    validateStoreProductCommercialState: () => undefined,
    mergeAndValidateStoreProduct: (
      existing: { active?: boolean },
      patch: { paymentPlans?: unknown[] },
    ) => {
      if (commercialValidation.rejectMergedActiveProduct && existing.active === true) {
        throw new StoreProductCommercialError("Active product is commercially incomplete");
      }
      if (patch.paymentPlans?.length === 0) {
        throw new StoreProductCommercialError("Choose at least one payment option");
      }
      return patch;
    },
  };
});

vi.mock("~/server/domain/agreement-pdfs/storage", () => ({
  agreementPdfFinalCandidate: agreementPdfMocks.candidate,
  createPrivateAgreementPdfUpload: vi.fn(),
  deletePrivateAgreementPdfFinalIfExact: agreementPdfMocks.deleteFinal,
  deletePrivateAgreementPdfStaging: vi.fn(),
  finalizePrivateAgreementPdfUpload: agreementPdfMocks.finalize,
  resolvePrivateAgreementPdfFinalCandidate: agreementPdfMocks.resolveCandidate,
}));

vi.mock("~/server/domain/agreement-pdfs/tokens", () => ({
  createAgreementPdfUploadToken: vi.fn(),
  verifyOwnedAgreementPdfUploadToken: agreementPdfMocks.verify,
  verifyOwnedAgreementPdfUploadTokenForCleanup: agreementPdfMocks.verify,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: () => "127.0.0.1",
    }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  products: productsMarker,
  // Tables referenced elsewhere in booking.ts module scope — included
  // so the import resolves cleanly. None are used by the update path.
  projects: { __table: "projects" },
  bookings: { __table: "bookings" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  purchases: { __table: "purchases" },
  purchaseSessionAllowances: { __table: "purchase_session_allowances" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
  isNull: (col: unknown) => ({ isNull: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  productSelectQueue.length = 0;
  updateReturningSpy.mockReset().mockResolvedValue([{ id: PRODUCT_ID, name: "Renamed" }]);
  updateSetSpy.mockReset().mockReturnValue({
    where: () => ({ returning: updateReturningSpy }),
  });
  insertReturningSpy.mockReset().mockResolvedValue([{ id: PRODUCT_ID, name: "Created" }]);
  insertValuesSpy.mockClear();
  agreementPdfMocks.candidate.mockReset().mockReturnValue(agreementPdfCandidate);
  agreementPdfMocks.deleteFinal.mockReset().mockResolvedValue();
  agreementPdfMocks.finalize.mockReset().mockResolvedValue(agreementPdfDocument);
  agreementPdfMocks.resolveCandidate.mockReset().mockResolvedValue(agreementPdfDocument);
  agreementPdfMocks.verify.mockReset().mockReturnValue({ uploadId: "signed-upload" });
  commercialValidation.rejectMergedActiveProduct = false;
  process.env.DATABASE_URL = "postgresql://test/test";
  process.env.CLERK_SECRET_KEY = "test-clerk-secret-key-at-least-twenty";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_1" });
};

// Full edit-mode payload matching what NewPackageForm emits when
// initialValues is supplied. Kept near the tests so any future
// input-shape change breaks these assertions first.
function fullEditInput() {
  return {
    id: PRODUCT_ID,
    name: "Renamed mix",
    description: "A better description",
    durationMin: 90,
    sessionCount: 2,
    priceCents: 25000,
    currency: "USD" as const,
    kind: "mixing" as const,
    locationType: "remote" as const,
    bufferMinutes: 15,
    minLeadHours: 24,
    paymentPlans: [{ kind: "full" as const }, { kind: "split_50_50" as const }],
  };
}

describe("booking.packages.update", () => {
  it("exists on the legacy packages.* alias and accepts the full edit payload", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    const row = await caller.booking.packages.update(fullEditInput());
    expect(row).toEqual({
      id: PRODUCT_ID,
      name: "Renamed",
      agreementPdf: null,
      legacyAgreementLinkPresent: false,
    });
    expect(updateReturningSpy).toHaveBeenCalledOnce();
  });

  it("is identical to booking.products.update (same underlying router)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.booking.products.update(fullEditInput());
    expect(updateReturningSpy).toHaveBeenCalledOnce();
  });

  it("returns the same NOT_FOUND for a product owned by another producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([]); // scoped SQL hides the foreign row
    const caller = await buildCaller();
    await expect(caller.booking.packages.update(fullEditInput())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(updateReturningSpy).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the product id is unknown", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(caller.booking.packages.update(fullEditInput())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(updateReturningSpy).not.toHaveBeenCalled();
  });

  it("does not finalize a replacement for an unknown or foreign product", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([]);
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        agreementPdf: { kind: "replace", uploadToken: "signed-upload" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(agreementPdfMocks.finalize).not.toHaveBeenCalled();
  });

  it("does not finalize a replacement when merged commercial validation rejects the patch", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([
      { id: PRODUCT_ID, producerId: PRODUCER_ID, contractUrl: null, active: true },
    ]);
    commercialValidation.rejectMergedActiveProduct = true;
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        agreementPdf: { kind: "replace", uploadToken: "signed-upload" },
      }),
    ).rejects.toThrow(/commercially incomplete/i);

    expect(agreementPdfMocks.finalize).not.toHaveBeenCalled();
  });

  it("rejects updates to a terminal agreement cleanup tombstone", async () => {
    const cleanupContract = markAgreementPdfContractForCleanup(
      appendAgreementPdfRevision(null, {
        revisionId: "00000000-0000-4000-8000-000000000009",
        effectiveAt: "2026-08-09T00:00:00.000Z",
        document: agreementPdfDocument,
      }),
    );
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([
      { id: PRODUCT_ID, producerId: PRODUCER_ID, contractUrl: cleanupContract },
    ]);
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.update({ id: PRODUCT_ID, name: "Cannot restore me" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(updateReturningSpy).not.toHaveBeenCalled();
    expect(agreementPdfMocks.finalize).not.toHaveBeenCalled();
  });

  it("rejects replay attachment while the same final key is reserved by a cleanup tombstone", async () => {
    const cleanupContract = markAgreementPdfContractForCleanup(
      appendAgreementPdfRevision(null, {
        revisionId: "00000000-0000-4000-8000-000000000010",
        effectiveAt: "2026-08-09T00:00:00.000Z",
        document: agreementPdfDocument,
      }),
    );
    queueOpenProducerCapabilityLock();
    productSelectQueue.push([], [{ contractUrl: cleanupContract }]);
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.create({
        name: "Replay",
        priceCents: 20_000,
        agreementPdf: { kind: "replace", uploadToken: "signed-upload" },
      }),
    ).rejects.toThrow(/already being cleaned up/i);

    expect(agreementPdfMocks.finalize).not.toHaveBeenCalled();
    expect(insertValuesSpy).not.toHaveBeenCalled();
    expect(agreementPdfMocks.deleteFinal).not.toHaveBeenCalled();
  });

  it("conditionally cleans an unreferenced final replacement after a database failure", async () => {
    queueOpenProducerCapabilityLock();
    productSelectQueue.push([{ id: PRODUCT_ID, producerId: PRODUCER_ID, contractUrl: null }], []);
    updateReturningSpy.mockRejectedValueOnce(new Error("database write failed"));
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        agreementPdf: { kind: "replace", uploadToken: "signed-upload" },
      }),
    ).rejects.toThrow(/database write failed/i);

    expect(agreementPdfMocks.finalize).toHaveBeenCalledOnce();
    expect(agreementPdfMocks.deleteFinal).toHaveBeenCalledWith(agreementPdfDocument);
  });

  it("cleans a deterministic final candidate when copy succeeds but verification throws", async () => {
    queueOpenProducerCapabilityLock();
    productSelectQueue.push([{ id: PRODUCT_ID, producerId: PRODUCER_ID, contractUrl: null }], []);
    agreementPdfMocks.finalize.mockRejectedValueOnce(
      new Error("final verification was temporarily unavailable"),
    );
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        agreementPdf: { kind: "replace", uploadToken: "signed-upload" },
      }),
    ).rejects.toThrow(/final verification was temporarily unavailable/i);

    expect(agreementPdfMocks.candidate).toHaveBeenCalledOnce();
    expect(agreementPdfMocks.resolveCandidate).toHaveBeenCalledWith(agreementPdfCandidate);
    expect(agreementPdfMocks.deleteFinal).toHaveBeenCalledWith(agreementPdfDocument);
  });

  it("keeps a replayed final object when another product ledger references it", async () => {
    const referencedContract = appendAgreementPdfRevision(null, {
      revisionId: "00000000-0000-4000-8000-000000000001",
      effectiveAt: "2026-08-09T00:00:00.000Z",
      document: agreementPdfDocument,
    });
    queueOpenProducerCapabilityLock();
    productSelectQueue.push(
      [{ id: PRODUCT_ID, producerId: PRODUCER_ID, contractUrl: null }],
      [{ contractUrl: referencedContract }],
      [{ contractUrl: referencedContract }],
    );
    updateReturningSpy.mockRejectedValueOnce(new Error("database write failed"));
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        agreementPdf: { kind: "replace", uploadToken: "signed-upload" },
      }),
    ).rejects.toThrow(/database write failed/i);

    expect(agreementPdfMocks.deleteFinal).not.toHaveBeenCalled();
  });

  it("fails closed before finalization when any producer product ledger is malformed", async () => {
    queueOpenProducerCapabilityLock();
    productSelectQueue.push(
      [{ id: PRODUCT_ID, producerId: PRODUCER_ID, contractUrl: null }],
      [{ contractUrl: "skitza-private-agreement:v1:not-canonical" }],
    );
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        agreementPdf: { kind: "replace", uploadToken: "signed-upload" },
      }),
    ).rejects.toThrow(/private agreement metadata is invalid/i);

    expect(agreementPdfMocks.finalize).not.toHaveBeenCalled();
    expect(agreementPdfMocks.deleteFinal).not.toHaveBeenCalled();
  });

  it("cleans an unreferenced final replacement when product creation fails after finalization", async () => {
    queueOpenProducerCapabilityLock();
    productSelectQueue.push([], []);
    insertReturningSpy.mockRejectedValueOnce(new Error("insert failed"));
    const caller = await buildCaller();

    await expect(
      caller.booking.packages.create({
        name: "Product with PDF",
        priceCents: 20_000,
        agreementPdf: { kind: "replace", uploadToken: "signed-upload" },
      }),
    ).rejects.toThrow(/insert failed/i);

    expect(agreementPdfMocks.finalize).toHaveBeenCalledOnce();
    expect(agreementPdfMocks.deleteFinal).toHaveBeenCalledWith(agreementPdfDocument);
  });

  it("accepts a minimal patch (just name) for partial edits", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    const row = await caller.booking.packages.update({
      id: PRODUCT_ID,
      name: "Only name changed",
    });
    expect(row).toEqual({
      id: PRODUCT_ID,
      name: "Renamed",
      agreementPdf: null,
      legacyAgreementLinkPresent: false,
    });
  });

  it("rejects an explicitly empty payment-plan selection", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([
      {
        producerId: PRODUCER_ID,
        paymentPlans: [{ kind: "full" }],
      },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        paymentPlans: [],
      }),
    ).rejects.toThrow(/at least one payment option/i);
    expect(updateReturningSpy).not.toHaveBeenCalled();
  });

  it("rejects an explicitly empty payment-plan selection on create", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.create({
        name: "No payment options",
        priceCents: 20_000,
        paymentPlans: [],
      }),
    ).rejects.toThrow(/at least one payment option/i);
  });

  it("inserts a hidden product as hidden in the original create transaction", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([]);
    const caller = await buildCaller();

    await caller.booking.packages.create({
      name: "Private draft",
      priceCents: 20_000,
      durationMin: 0,
      sessionCount: 0,
      active: false,
    });

    expect(insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        producerId: PRODUCER_ID,
        active: false,
      }),
    );
  });

  it("keeps omitted create visibility live for onboarding and legacy callers", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([]);
    const caller = await buildCaller();

    await caller.booking.packages.create({
      name: "Published product",
      priceCents: 20_000,
      durationMin: 60,
      sessionCount: 1,
    });

    expect(insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        producerId: PRODUCER_ID,
        active: true,
      }),
    );
  });

  it("rejects duplicate standard plans and multiple monthly schedules", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        paymentPlans: [
          { kind: "full" },
          { kind: "full" },
          { kind: "monthly", installments: 3 },
          { kind: "monthly", installments: 6 },
        ],
      }),
    ).rejects.toThrow(/only once|one monthly/i);
    expect(updateReturningSpy).not.toHaveBeenCalled();
  });

  it("orders the three approved payment plans without preserving removed variants", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    productSelectQueue.push([{ producerId: PRODUCER_ID, paymentPlans: [{ kind: "full" }] }]);
    const caller = await buildCaller();
    await caller.booking.packages.update({
      id: PRODUCT_ID,
      paymentPlans: [
        { kind: "monthly", installments: 4 },
        { kind: "split_50_50" },
        { kind: "full" },
      ],
    });

    expect(updateSetSpy).toHaveBeenCalledWith({
      paymentPlans: [
        { kind: "full" },
        { kind: "split_50_50" },
        { kind: "monthly", installments: 4 },
      ],
    });
  });

  it("rejects the removed milestone plan at the runtime boundary", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        paymentPlans: [
          {
            kind: "milestones",
            milestones: [{ label: "Delivery", pct: 100 }],
          },
        ],
      } as never),
    ).rejects.toThrow();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("validates royalty basis points at the router boundary", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        royaltyTerms: {
          master: { mode: "percentage", bps: 0 },
          composition: { mode: "none" },
        },
      }),
    ).rejects.toThrow();
    expect(updateReturningSpy).not.toHaveBeenCalled();
  });

  it("rejects every mutable external agreement URL", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.booking.packages.update({
        id: PRODUCT_ID,
        contractUrl: "javascript:alert(1)",
      } as never),
    ).rejects.toThrow();
    expect(updateReturningSpy).not.toHaveBeenCalled();
  });
});
