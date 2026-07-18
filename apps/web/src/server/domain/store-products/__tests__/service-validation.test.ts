import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";
import { describe, expect, it } from "vitest";

import {
  assertPublishedStoreProduct,
  mergeAndValidateStoreProduct,
  StoreProductCommercialError,
  validateStoreProductCommercialState,
  type StoreProductCommercialErrorCode,
  type StoreProductCommercialInput,
} from "../service";

function product(
  patch: Partial<StoreProductCommercialInput> = {},
): StoreProductCommercialInput {
  return {
    name: "Mix package",
    description: "A release-ready stereo mix",
    kind: "mix",
    pricingModel: "flat",
    priceCents: 100_000,
    currency: "ILS",
    volumeTiers: null,
    hourlyRateCents: null,
    durationMin: 60,
    sessionCount: 1,
    deliverables: ["Stereo WAV", "Instrumental"],
    locationType: "remote",
    bufferMinutes: 15,
    minLeadHours: 24,
    paymentPlans: [{ kind: "full" }],
    royaltyTerms: {
      master: { mode: "none" },
      composition: { mode: "none" },
    },
    agreementText: null,
    active: true,
    archivedAt: null,
    ...patch,
  };
}

function expectError(
  action: () => unknown,
  code: StoreProductCommercialErrorCode,
  field?: string,
): StoreProductCommercialError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(StoreProductCommercialError);
    expect(error).toMatchObject({ code, ...(field ? { field } : {}) });
    return error as StoreProductCommercialError;
  }
  throw new Error(`Expected ${code}`);
}

describe("published Store product validation", () => {
  it.each([
    ["flat", { pricingModel: "flat", priceCents: 0 }],
    ["bundle", { pricingModel: "bundle", priceCents: 0 }],
  ] as const)("requires positive cash pricing for %s products", (_label, patch) => {
    expectError(
      () => {
        assertPublishedStoreProduct(product(patch));
      },
      "PUBLISHED_CASH_PRICE_REQUIRED",
    );
  });

  it("allows a hidden draft to retain a zero price but never treats it as published", () => {
    const draft = product({ active: false, priceCents: 0 });
    expect(validateStoreProductCommercialState(draft).priceCents).toBe(0);
    expectError(() => {
      assertPublishedStoreProduct(draft);
    }, "PRODUCT_NOT_PUBLISHED");
  });

  it("keeps hidden legacy hourly rows storage-compatible but rejects publishing them", () => {
    const legacyHourly = product({
      kind: "hourly",
      pricingModel: "hourly",
      priceCents: 0,
      hourlyRateCents: 35_000,
      active: false,
    });

    expect(validateStoreProductCommercialState(legacyHourly)).toMatchObject({
      pricingModel: "hourly",
      hourlyRateCents: 35_000,
    });
    expectError(
      () => validateStoreProductCommercialState({ ...legacyHourly, active: true }),
      "INVALID_PRODUCT",
      "pricingModel",
    );
  });

  it("rejects an archived row that still claims to be active", () => {
    expectError(
      () =>
        validateStoreProductCommercialState(
          product({ archivedAt: new Date("2026-07-18T00:00:00.000Z") }),
        ),
      "INVALID_PRODUCT",
      "active",
    );
  });

  it("normalizes complete text, currency, deliverables, and plan order", () => {
    const validated = validateStoreProductCommercialState(
      product({
        name: "  Mix package  ",
        kind: " mix ",
        currency: "ils",
        deliverables: [" Stereo WAV ", " Instrumental "],
        paymentPlans: [
          { kind: "monthly", installments: 4 },
          { kind: "split_50_50" },
          { kind: "full" },
        ],
      }),
    );

    expect(validated).toMatchObject({
      name: "Mix package",
      kind: "mix",
      currency: "ILS",
      deliverables: ["Stereo WAV", "Instrumental"],
      paymentPlans: [
        { kind: "full" },
        { kind: "split_50_50" },
        { kind: "monthly", installments: 4 },
      ],
    });
  });

  it("merges a patch into the persisted state before validating cross-field rules", () => {
    const existing = product({ active: false, priceCents: 0 });

    expectError(
      () => mergeAndValidateStoreProduct(existing, { active: true }),
      "PUBLISHED_CASH_PRICE_REQUIRED",
      "priceCents",
    );

    const published = mergeAndValidateStoreProduct(existing, {
      active: true,
      priceCents: 42_000,
    });
    expect(published).toMatchObject({ active: true, priceCents: 42_000 });
  });

  it("ignores undefined patch members instead of erasing persisted state", () => {
    const existing = product();
    const merged = mergeAndValidateStoreProduct(existing, {
      priceCents: undefined,
      agreementText: undefined,
    });
    expect(merged.priceCents).toBe(100_000);
    expect(merged.agreementText).toBeNull();
  });
});

describe("per-song commercial tiers", () => {
  const basePatch = {
    pricingModel: "per_song",
    priceCents: 10_000,
    volumeTiers: [
      { minQty: 5, pricePerUnitCents: 8_000 },
      { minQty: 1, pricePerUnitCents: 10_000 },
      { minQty: 10, pricePerUnitCents: 7_000 },
    ],
  } satisfies Partial<StoreProductCommercialInput>;

  it("sorts an authored tier ladder into a deterministic ascending order", () => {
    const validated = validateStoreProductCommercialState(product(basePatch));
    expect(validated.volumeTiers).toEqual([
      { minQty: 1, pricePerUnitCents: 10_000 },
      { minQty: 5, pricePerUnitCents: 8_000 },
      { minQty: 10, pricePerUnitCents: 7_000 },
    ]);
  });

  it.each([
    [
      "missing base",
      [
        { minQty: 2, pricePerUnitCents: 10_000 },
        { minQty: 5, pricePerUnitCents: 8_000 },
      ],
    ],
    [
      "duplicate threshold",
      [
        { minQty: 1, pricePerUnitCents: 10_000 },
        { minQty: 1, pricePerUnitCents: 8_000 },
      ],
    ],
    ["zero cash tier", [{ minQty: 1, pricePerUnitCents: 0 }]],
    ["fractional threshold", [{ minQty: 1.5, pricePerUnitCents: 10_000 }]],
    [
      "price increase",
      [
        { minQty: 1, pricePerUnitCents: 10_000 },
        { minQty: 5, pricePerUnitCents: 11_000 },
      ],
    ],
  ] as const)("rejects %s", (_label, volumeTiers) => {
    expectError(
      () =>
        validateStoreProductCommercialState(
          product({
            pricingModel: "per_song",
            priceCents: volumeTiers[0].pricePerUnitCents,
            volumeTiers,
          }),
        ),
      "INVALID_VOLUME_TIERS",
    );
  });

  it("requires the compatibility card price to match the one-song tier", () => {
    expectError(
      () => validateStoreProductCommercialState(product({ ...basePatch, priceCents: 9_999 })),
      "INVALID_VOLUME_TIERS",
      "priceCents",
    );
  });
});

describe("enabled payment plans", () => {
  it("rejects an empty selection", () => {
    expectError(
      () => validateStoreProductCommercialState(product({ paymentPlans: [] })),
      "INVALID_PAYMENT_PLANS",
      "paymentPlans",
    );
  });

  it.each([
    { label: "milestone", plans: [{ kind: "milestone" }] },
    { label: "deposit", plans: [{ kind: "deposit", percent: 20 }] },
    { label: "monthly below range", plans: [{ kind: "monthly", installments: 1 }] },
    { label: "monthly above range", plans: [{ kind: "monthly", installments: 13 }] },
    { label: "duplicate full", plans: [{ kind: "full" }, { kind: "full" }] },
    {
      label: "duplicate monthly",
      plans: [
        { kind: "monthly", installments: 3 },
        { kind: "monthly", installments: 6 },
      ],
    },
  ])("rejects $label choices", ({ plans }) => {
    expectError(
      () =>
        validateStoreProductCommercialState(
          product({ paymentPlans: plans as unknown as PaymentPlan[] }),
        ),
      "INVALID_PAYMENT_PLANS",
    );
  });

  it.each([
    {
      label: "a two-part split on a one-cent product",
      priceCents: 1,
      paymentPlans: [{ kind: "split_50_50" }],
    },
    {
      label: "four monthly installments on a three-cent product",
      priceCents: 3,
      paymentPlans: [{ kind: "monthly", installments: 4 }],
    },
  ] satisfies Array<{
    label: string;
    priceCents: number;
    paymentPlans: PaymentPlan[];
  }>)("rejects $label", ({ priceCents, paymentPlans }) => {
    expectError(
      () => validateStoreProductCommercialState(product({ priceCents, paymentPlans })),
      "INVALID_PAYMENT_PLANS",
      "paymentPlans",
    );
  });

  it("accepts a product whose minimum cash subtotal equals its largest installment count", () => {
    expect(
      validateStoreProductCommercialState(
        product({
          priceCents: 4,
          paymentPlans: [
            { kind: "full" },
            { kind: "split_50_50" },
            { kind: "monthly", installments: 4 },
          ],
        }),
      ).paymentPlans,
    ).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 4 },
    ]);
  });

  it("checks discounted per-song tier transitions, not only the one-song card price", () => {
    expectError(
      () =>
        validateStoreProductCommercialState(
          product({
            pricingModel: "per_song",
            priceCents: 100,
            volumeTiers: [
              { minQty: 1, pricePerUnitCents: 100 },
              { minQty: 2, pricePerUnitCents: 1 },
            ],
            paymentPlans: [{ kind: "monthly", installments: 4 }],
          }),
        ),
      "INVALID_PAYMENT_PLANS",
      "paymentPlans",
    );
  });

  it("lets an unpublished draft retain an infeasible plan while its price is unfinished", () => {
    expect(
      validateStoreProductCommercialState(
        product({
          active: false,
          priceCents: 0,
          paymentPlans: [{ kind: "monthly", installments: 12 }],
        }),
      ).paymentPlans,
    ).toEqual([{ kind: "monthly", installments: 12 }]);
  });
});

describe("royalty agreement validation", () => {
  it("requires immutable inline text when a right delegates detail to the agreement", () => {
    const royaltyTerms: ProductRoyaltyTerms = {
      master: { mode: "agreement" },
      composition: { mode: "none" },
    };
    expectError(
      () => validateStoreProductCommercialState(product({ royaltyTerms })),
      "IMMUTABLE_AGREEMENT_REQUIRED",
      "agreementText",
    );
  });

  it("accepts dedicated inline terms and the legacy encoded contract fallback", () => {
    const royaltyTerms: ProductRoyaltyTerms = {
      master: { mode: "agreement" },
      composition: { mode: "agreement" },
    };
    expect(() =>
      validateStoreProductCommercialState(
        product({ royaltyTerms, agreementText: "Producer keeps the rights stated below." }),
      ),
    ).not.toThrow();
    expect(() =>
      validateStoreProductCommercialState(
        product({
          royaltyTerms,
          description: "Tagline\n---\nrevisions: 2\ncontract_text: Legacy exact terms",
        }),
      ),
    ).not.toThrow();
  });

  it("validates percentage basis points without floating-point percentages", () => {
    expectError(
      () =>
        validateStoreProductCommercialState(
          product({
            royaltyTerms: {
              master: { mode: "percentage", bps: 0 },
              composition: { mode: "none" },
            },
          }),
        ),
      "INVALID_ROYALTY_TERMS",
      "royaltyTerms.master.bps",
    );
  });
});
