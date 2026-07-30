import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";
import { describe, expect, it } from "vitest";

import { encodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import { digestCommercialSnapshot } from "~/server/domain/purchases/policy";
import {
  buildStorePurchaseSnapshot,
  deriveStoreProductRights,
  StoreProductCommercialError,
  type StoreProductCommercialErrorCode,
  type StoreProductCommercialInput,
} from "../service";

function product(
  patch: Partial<StoreProductCommercialInput> = {},
): StoreProductCommercialInput {
  return {
    name: "Mix package",
    description: encodeDescription({
      tagline: "A release-ready stereo mix",
      revisions: 2,
      unlimitedRevisions: false,
      contractText: "",
    }),
    kind: "mix",
    pricingModel: "flat",
    priceCents: 100_001,
    currency: "ILS",
    volumeTiers: null,
    hourlyRateCents: null,
    durationMin: 90,
    sessionCount: 2,
    bookingEnabled: true,
    deliverables: ["Stereo WAV", "Instrumental"],
    locationType: "remote",
    bufferMinutes: 15,
    minLeadHours: 24,
    paymentPlans: [
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 4 },
    ],
    royaltyTerms: {
      master: { mode: "percentage", bps: 250 },
      composition: {
        mode: "percentage",
        bps: 1_250,
        role: "composer",
        collectingSociety: "ACUM",
      },
      notes: "Credit the producer in release metadata.",
    },
    agreementText: "The artist may release the approved final master worldwide.",
    active: true,
    archivedAt: null,
    ...patch,
  };
}

function build(
  productInput = product(),
  patch: Partial<{
    requestedSongQty: number | null;
    taxMode: string;
    taxRatePct: number;
    selectedPaymentPlan: PaymentPlan;
  }> = {},
) {
  return buildStorePurchaseSnapshot({
    product: productInput,
    requestedSongQty: null,
    taxMode: "tax_free",
    taxRatePct: 18,
    selectedPaymentPlan: { kind: "full" },
    ...patch,
  });
}

function expectError(
  action: () => unknown,
  code: StoreProductCommercialErrorCode,
): StoreProductCommercialError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(StoreProductCommercialError);
    expect(error).toMatchObject({ code });
    return error as StoreProductCommercialError;
  }
  throw new Error(`Expected ${code}`);
}

describe("Store purchase snapshot", () => {
  it("freezes every authored and derived term for a flat product", () => {
    const { snapshot, snapshotDigest } = build();

    expect(snapshot).toMatchObject({
      version: 2,
      bookingEnabled: true,
      productOrOfferName: "Mix package",
      tagline: "A release-ready stereo mix",
      service: "mix",
      deliverables: ["Stereo WAV", "Instrumental"],
      lineItems: [
        {
          label: "Mix package",
          quantity: 1,
          listUnitPriceCents: 100_001,
          unitPriceCents: 100_001,
          totalCents: 100_001,
        },
      ],
      listSubtotalCents: 100_001,
      discountCents: 0,
      subtotalCents: 100_001,
      tax: { mode: "tax_free", ratePct: 18, amountCents: 0 },
      totalCents: 100_001,
      currency: "ILS",
      includedSongSpaces: 1,
      session: {
        limit: { kind: "fixed", count: 2 },
        durationMin: 90,
        locationType: "remote",
        bufferMinutes: 15,
        minLeadHours: 24,
      },
      revisionRule: { kind: "fixed", count: 2 },
      royaltyTerms: product().royaltyTerms,
      rights: [
        "Producer receives 2.5% master royalty.",
        "Producer receives 12.5% composition royalty as Composer (ACUM).",
        "Rights notes: Credit the producer in release metadata.",
      ],
      selectedPaymentPlan: { kind: "full" },
      offeredPaymentPlans: [
        { kind: "full" },
        { kind: "split_50_50" },
        { kind: "monthly", installments: 4 },
      ],
    });
    expect(snapshot.agreementText).toContain("Product: Mix package");
    expect(snapshot.agreementText).toContain("Total: ILS 1000.01");
    expect(snapshot.agreementText).toContain("Revisions: 2");
    expect(snapshot.agreementText).toContain(
      "The artist may release the approved final master worldwide.",
    );
    expect(snapshotDigest).toBe(digestCommercialSnapshot(snapshot));
  });

  it("uses only the server tier ladder and freezes selected song count and discount", () => {
    const { snapshot } = build(
      product({
        pricingModel: "per_song",
        priceCents: 10_000,
        volumeTiers: [
          { minQty: 10, pricePerUnitCents: 7_000 },
          { minQty: 1, pricePerUnitCents: 10_000 },
          { minQty: 5, pricePerUnitCents: 8_000 },
        ],
      }),
      { requestedSongQty: 6 },
    );

    expect(snapshot.lineItems).toEqual([
      {
        label: "Mix package",
        quantity: 6,
        listUnitPriceCents: 10_000,
        unitPriceCents: 8_000,
        totalCents: 48_000,
      },
    ]);
    expect(snapshot).toMatchObject({
      listSubtotalCents: 60_000,
      discountCents: 12_000,
      subtotalCents: 48_000,
      totalCents: 48_000,
      includedSongSpaces: 6,
    });
    expect(snapshot.agreementText).toContain("Quantity: 6");
    expect(snapshot.agreementText).toContain("Volume discount: ILS 120.00");
  });

  it("requires an explicit selected quantity only for per-song products", () => {
    const perSong = product({
      pricingModel: "per_song",
      priceCents: 10_000,
      volumeTiers: [{ minQty: 1, pricePerUnitCents: 10_000 }],
    });
    expectError(() => build(perSong), "INVALID_SONG_QUANTITY");
    expectError(() => build(product(), { requestedSongQty: 2 }), "INVALID_SONG_QUANTITY");
  });

  it("uses the canonical bundle price but rejects legacy hourly rows at purchase time", () => {
    const bundle = build(product({ pricingModel: "bundle", priceCents: 250_000 })).snapshot;
    expect(bundle).toMatchObject({
      subtotalCents: 250_000,
      totalCents: 250_000,
      includedSongSpaces: 1,
    });

    expectError(
      () =>
        build(
          product({
            kind: "hourly",
            pricingModel: "hourly",
            priceCents: 0,
            hourlyRateCents: 35_000,
          }),
        ),
      "INVALID_PRODUCT",
    );
  });

  it("rejects a plan that is not enabled, including a different monthly count", () => {
    const fullOnly = product({ paymentPlans: [{ kind: "full" }] });
    expectError(
      () => build(fullOnly, { selectedPaymentPlan: { kind: "split_50_50" } }),
      "PAYMENT_PLAN_NOT_OFFERED",
    );
    expectError(
      () => build(product(), { selectedPaymentPlan: { kind: "monthly", installments: 6 } }),
      "PAYMENT_PLAN_NOT_OFFERED",
    );
  });

  it("freezes an enabled Monthly selection exactly", () => {
    const { snapshot } = build(product(), {
      selectedPaymentPlan: { kind: "monthly", installments: 4 },
    });
    expect(snapshot.selectedPaymentPlan).toEqual({ kind: "monthly", installments: 4 });
    expect(snapshot.agreementText).toContain("Payment plan: Monthly (4 installments)");
  });

  it("rejects a hidden or archived product at the purchase boundary", () => {
    expectError(() => build(product({ active: false })), "PRODUCT_NOT_PUBLISHED");
    expectError(
      () =>
        build(
          product({
            active: false,
            archivedAt: new Date("2026-07-18T00:00:00.000Z"),
          }),
        ),
      "PRODUCT_NOT_PUBLISHED",
    );
  });
});

describe("deterministic integer money and tax", () => {
  it.each([
    [
      "tax_free",
      17,
      { mode: "tax_free", ratePct: 17, amountCents: 0 },
      10_001,
    ],
    [
      "tax_included",
      17,
      { mode: "tax_included", ratePct: 17, amountCents: 1_453 },
      10_001,
    ],
    [
      "tax_added",
      17,
      { mode: "tax_added", ratePct: 17, amountCents: 1_700 },
      11_701,
    ],
  ])("calculates %s without floating-point cents", (taxMode, taxRatePct, tax, totalCents) => {
    const result = build(product({ priceCents: 10_001 }), { taxMode, taxRatePct });
    expect(result.snapshot.tax).toEqual(tax);
    expect(result.snapshot.totalCents).toBe(totalCents);
  });

  it("rounds an exact half-cent up using integer arithmetic", () => {
    const { snapshot } = build(product({ priceCents: 5 }), {
      taxMode: "tax_added",
      taxRatePct: 10,
    });
    expect(snapshot.tax.amountCents).toBe(1);
    expect(snapshot.totalCents).toBe(6);
  });

  it("rejects unsupported tax metadata", () => {
    expectError(() => build(product(), { taxMode: "vat_magic" }), "INVALID_TAX");
    expectError(() => build(product(), { taxRatePct: 18.5 }), "INVALID_TAX");
    expectError(() => build(product(), { taxRatePct: 101 }), "INVALID_TAX");
  });

  it("rejects totals that cannot fit the persisted purchase integer columns", () => {
    expectError(
      () =>
        build(
          product({
            pricingModel: "per_song",
            priceCents: 2_147_484,
            volumeTiers: [{ minQty: 1, pricePerUnitCents: 2_147_484 }],
          }),
          { requestedSongQty: 1_000 },
        ),
      "PRICE_OVERFLOW",
    );
  });

  it("returns byte-stable snapshots and digests for identical server inputs", () => {
    const first = build(product(), { taxMode: "tax_added", taxRatePct: 18 });
    const second = build(product(), { taxMode: "tax_added", taxRatePct: 18 });
    expect(second.snapshot).toEqual(first.snapshot);
    expect(second.snapshotDigest).toBe(first.snapshotDigest);
  });

  it("changes the digest when a future product edit changes commercial terms", () => {
    const before = build(product());
    const after = build(product({ priceCents: 110_000 }));
    expect(after.snapshotDigest).not.toBe(before.snapshotDigest);
    expect(before.snapshot.totalCents).toBe(100_001);
    expect(after.snapshot.totalCents).toBe(110_000);
  });
});

describe("sessions, revisions, rights, and immutable source copies", () => {
  it("freezes unlimited sessions and unlimited revisions", () => {
    const { snapshot } = build(
      product({
        sessionCount: 0,
        description: encodeDescription({
          tagline: "Unlimited feedback",
          revisions: 0,
          unlimitedRevisions: true,
          contractText: "",
        }),
      }),
    );
    expect(snapshot.session?.limit).toEqual({ kind: "unlimited" });
    expect(snapshot.revisionRule).toEqual({ kind: "unlimited" });
    expect(snapshot.agreementText).toContain("Sessions: Unlimited × 90 minutes");
    expect(snapshot.agreementText).toContain("Revisions: Unlimited");
  });

  it("records an explicit zero-revision rule and no session for delivery-only work", () => {
    const { snapshot } = build(
      product({
        durationMin: 0,
        bookingEnabled: false,
        description: encodeDescription({
          tagline: "Delivery only",
          revisions: 0,
          unlimitedRevisions: false,
          contractText: "",
        }),
      }),
    );
    expect(snapshot.session).toBeNull();
    expect(snapshot.bookingEnabled).toBe(false);
    expect(snapshot.revisionRule).toEqual({ kind: "fixed", count: 0 });
  });

  it("does not infer booking eligibility from legacy session-shaped terms", () => {
    const { snapshot } = build(product({ bookingEnabled: false }));

    expect(snapshot).toMatchObject({
      version: 2,
      bookingEnabled: false,
      session: null,
    });
  });

  it("derives deterministic rights for none, percentage, agreement, and legacy null terms", () => {
    expect(
      deriveStoreProductRights({
        master: { mode: "none" },
        composition: { mode: "none" },
      }),
    ).toEqual([
      "Producer receives no master royalty.",
      "Producer receives no composition royalty.",
    ]);
    expect(
      deriveStoreProductRights({
        master: { mode: "agreement" },
        composition: { mode: "agreement" },
      }),
    ).toEqual([
      "Master rights and royalties are defined in this agreement.",
      "Composition rights and royalties are defined in this agreement.",
    ]);
    expect(deriveStoreProductRights(null)).toEqual([
      "Master rights and royalties: not specified.",
      "Composition rights and royalties: not specified.",
    ]);
  });

  it("does not retain mutable references to product arrays or royalty objects", () => {
    const deliverables = ["Stereo WAV"];
    const paymentPlans: PaymentPlan[] = [{ kind: "full" }];
    const royaltyTerms: ProductRoyaltyTerms = {
      master: { mode: "none" },
      composition: { mode: "none" },
    };
    const source = product({ deliverables, paymentPlans, royaltyTerms });
    const { snapshot } = build(source);

    deliverables[0] = "Changed stems";
    paymentPlans.push({ kind: "split_50_50" });
    royaltyTerms.master = { mode: "percentage", bps: 5_000 };

    expect(snapshot.deliverables).toEqual(["Stereo WAV"]);
    expect(snapshot.offeredPaymentPlans).toEqual([{ kind: "full" }]);
    expect(snapshot.royaltyTerms).toEqual({
      master: { mode: "none" },
      composition: { mode: "none" },
    });
  });

  it("uses legacy embedded contract text only when the dedicated field is absent", () => {
    const legacy = product({
      description: encodeDescription({
        tagline: "Legacy mix",
        revisions: 1,
        unlimitedRevisions: false,
        contractText: "Legacy exact agreement.",
      }),
      agreementText: null,
    });
    expect(build(legacy).snapshot.agreementText).toContain("Legacy exact agreement.");

    const explicitlyCleared = product({
      description: legacy.description,
      agreementText: "",
    });
    expect(build(explicitlyCleared).snapshot.agreementText).not.toContain(
      "Legacy exact agreement.",
    );
  });
});
