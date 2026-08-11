import { describe, expect, it } from "vitest";

import {
  MAX_AGREEMENT_LENGTH,
  MAX_CASH_PRICE_CENTS,
  MAX_RIGHT_LENGTH,
  MAX_RIGHTS,
  parsePrivateOfferComposerDraftJson,
  privateOfferTaxBreakdown,
  seedPrivateOfferDraft,
  totalForTemplateQuantity,
  validatePrivateOfferDraft,
  validatePrivateOfferRecipient,
  validatePrivateOfferReviewDraft,
  validatePrivateOfferTemplateQuantity,
  type PrivateOfferComposerDraft,
} from "../private-offer-editor-model";
import type { PrivateOfferTemplateProduct } from "../private-offer-template-types";

const FUTURE_EXPIRY = "2099-08-24T12:00";

function validDraft(overrides: Partial<PrivateOfferComposerDraft> = {}): PrivateOfferComposerDraft {
  return {
    ...seedPrivateOfferDraft({
      defaultCurrency: "USD",
      taxMode: "tax_free",
      taxRatePct: 0,
      lockedClientId: "client-1",
    }),
    name: "Single production",
    tagline: "Release-ready production",
    service: "Production",
    deliverables: "Final master\nInstrumental",
    includedSongSpaces: "1",
    cashPrice: "100.00",
    fullPlan: true,
    rights: "Artist may release the final master.",
    agreementText: "These are the complete private-offer terms.",
    expiresAtLocal: FUTURE_EXPIRY,
    ...overrides,
  };
}

function expectError(
  result: ReturnType<typeof validatePrivateOfferDraft>,
  step: string,
  message: string,
) {
  expect(result).toEqual({ error: { step, message } });
}

describe("private-offer editor recipient model", () => {
  it("does not silently choose a default recipient", () => {
    const draft = seedPrivateOfferDraft({
      defaultCurrency: "USD",
      taxMode: "tax_added",
      taxRatePct: 18,
    });

    expect(draft.recipientKind).toBe("existing");
    expect(draft.clientContactId).toBe("");
    expect(validatePrivateOfferRecipient(draft, undefined, [])).toEqual({
      error: { step: "recipient", message: "Choose a recipient." },
    });
  });

  it("trims a new recipient and normalizes their email to lowercase", () => {
    const draft = validDraft({
      recipientKind: "new",
      clientContactId: "",
      newRecipientName: "  Maya Stone  ",
      newRecipientEmail: "  MAYA@Example.COM  ",
    });

    expect(validatePrivateOfferRecipient(draft, undefined, [])).toEqual({
      value: {
        recipient: { kind: "new", name: "Maya Stone", email: "maya@example.com" },
        target: { kind: "new" },
      },
    });
  });

  it.each(["maya", "maya@", "@example.com", "maya @example.com"])(
    "rejects an invalid new-recipient email: %s",
    (email) => {
      const draft = validDraft({
        recipientKind: "new",
        clientContactId: "",
        newRecipientName: "Maya",
        newRecipientEmail: email,
      });

      expect(validatePrivateOfferRecipient(draft, undefined, [])).toEqual({
        error: { step: "recipient", message: "Enter a valid recipient email." },
      });
    },
  );

  it("accepts an existing project only when it is in the selected client's options", () => {
    const draft = validDraft({
      clientContactId: "client-other",
      targetKind: "existing",
      targetProjectId: "project-1",
    });

    expect(validatePrivateOfferRecipient(draft, "client-1", [{ id: "project-other" }])).toEqual({
      error: {
        step: "recipient",
        message: "That project is no longer available for this client.",
      },
    });
    expect(validatePrivateOfferRecipient(draft, "client-1", [{ id: "project-1" }])).toEqual({
      value: {
        recipient: { kind: "existing", clientContactId: "client-1" },
        target: { kind: "existing", projectId: "project-1" },
      },
    });
  });
});

describe("private-offer runtime draft parser", () => {
  it("restores the exact current draft shape", () => {
    const draft = validDraft({ cashPrice: "245.00", compositionRole: "composer" });
    expect(parsePrivateOfferComposerDraftJson(JSON.stringify(draft))).toEqual(draft);
  });

  it.each([
    "not-json",
    '{"clientContactId":"client-1"}',
    JSON.stringify({ ...validDraft(), unexpected: true }),
    JSON.stringify({ ...validDraft(), fullPlan: "true" }),
    JSON.stringify({ ...validDraft(), taxMode: "unknown" }),
  ])("ignores malformed, partial, extra-key, or wrongly typed draft JSON", (draftJson) => {
    expect(parsePrivateOfferComposerDraftJson(draftJson)).toBeNull();
  });
});

describe("private-offer editor payload model", () => {
  it("preserves the exact normalized terms and purchase snapshot", () => {
    const draft = validDraft({
      clientContactId: "client-1",
      targetKind: "existing",
      targetProjectId: "project-1",
      name: "  Custom production  ",
      tagline: "  Built for Maya's release  ",
      service: "  Production and mix  ",
      deliverables: "  Final master  \n\n Instrumental \n Stems  ",
      cashPrice: "123.45",
      currency: "EUR",
      taxMode: "tax_added",
      taxRatePct: "18",
      fullPlan: true,
      splitPlan: true,
      monthlyPlan: true,
      monthlyInstallments: "4",
      includedSongSpaces: "2",
      hasSessionAllowance: true,
      sessionLimitMode: "fixed",
      sessionCount: "3",
      sessionDurationMin: "90",
      sessionLocationType: "  remote  ",
      sessionBufferMinutes: "15",
      sessionMinLeadHours: "48",
      revisionMode: "fixed",
      revisionCount: "2",
      masterMode: "percentage",
      masterPercentage: "12.5",
      compositionMode: "percentage",
      compositionPercentage: "7.25",
      compositionRole: "publisher",
      collectingSociety: "  ASCAP  ",
      royaltyNotes: "  Royalties are paid quarterly.  ",
      rights: "  Artist may release the final master.  \n Producer may use excerpts. ",
      agreementText: "  These are the exact accepted terms.  ",
    });

    const result = validatePrivateOfferDraft(draft, undefined, [{ id: "project-1" }]);

    expect(result).toEqual({
      value: {
        recipient: {
          recipient: { kind: "existing", clientContactId: "client-1" },
          target: { kind: "existing", projectId: "project-1" },
        },
        terms: {
          name: "Custom production",
          tagline: "Built for Maya's release",
          service: "Production and mix",
          deliverables: ["Final master", "Instrumental", "Stems"],
          cashPriceCents: 12_345,
          currency: "EUR",
          taxMode: "tax_added",
          taxRatePct: 18,
          includedSongSpaces: 2,
          session: {
            limit: { kind: "fixed", count: 3 },
            durationMin: 90,
            locationType: "remote",
            bufferMinutes: 15,
            minLeadHours: 48,
          },
          revisionRule: { kind: "fixed", count: 2 },
          royaltyTerms: {
            master: { mode: "percentage", bps: 1_250 },
            composition: {
              mode: "percentage",
              bps: 725,
              role: "publisher",
              collectingSociety: "ASCAP",
            },
            notes: "Royalties are paid quarterly.",
          },
          rights: ["Artist may release the final master.", "Producer may use excerpts."],
          enabledPaymentPlans: [
            { kind: "full" },
            { kind: "split_50_50" },
            { kind: "monthly", installments: 4 },
          ],
          agreementText: "These are the exact accepted terms.",
        },
        expiry: new Date(FUTURE_EXPIRY),
        snapshot: {
          version: 2,
          bookingEnabled: true,
          productOrOfferName: "Custom production",
          tagline: "Built for Maya's release",
          service: "Production and mix",
          deliverables: ["Final master", "Instrumental", "Stems"],
          lineItems: [
            {
              label: "Custom production",
              quantity: 1,
              listUnitPriceCents: 12_345,
              unitPriceCents: 12_345,
              totalCents: 12_345,
            },
          ],
          listSubtotalCents: 12_345,
          discountCents: 0,
          subtotalCents: 12_345,
          tax: { mode: "tax_added", ratePct: 18, amountCents: 2_222 },
          totalCents: 14_567,
          currency: "EUR",
          includedSongSpaces: 2,
          session: {
            limit: { kind: "fixed", count: 3 },
            durationMin: 90,
            locationType: "remote",
            bufferMinutes: 15,
            minLeadHours: 48,
          },
          revisionRule: { kind: "fixed", count: 2 },
          royaltyTerms: {
            master: { mode: "percentage", bps: 1_250 },
            composition: {
              mode: "percentage",
              bps: 725,
              role: "publisher",
              collectingSociety: "ASCAP",
            },
            notes: "Royalties are paid quarterly.",
          },
          rights: ["Artist may release the final master.", "Producer may use excerpts."],
          selectedPaymentPlan: null,
          offeredPaymentPlans: [
            { kind: "full" },
            { kind: "split_50_50" },
            { kind: "monthly", installments: 4 },
          ],
          agreementText: "These are the exact accepted terms.",
        },
      },
    });
  });

  it("clears every payment plan for a free offer", () => {
    const result = validatePrivateOfferDraft(
      validDraft({
        cashPrice: "0.00",
        taxMode: "tax_added",
        taxRatePct: "100",
        fullPlan: true,
        splitPlan: true,
        monthlyPlan: true,
        monthlyInstallments: "99",
      }),
      undefined,
      [],
    );

    expect(result).toHaveProperty("value.terms.enabledPaymentPlans", []);
    expect(result).toHaveProperty("value.snapshot.offeredPaymentPlans", []);
    expect(result).toHaveProperty("value.snapshot.totalCents", 0);
  });

  it("requires at least one plan for a paid offer", () => {
    const result = validatePrivateOfferDraft(
      validDraft({ fullPlan: false, splitPlan: false, monthlyPlan: false }),
      undefined,
      [],
    );

    expectError(result, "payment", "Choose at least one payment option for a paid offer.");
  });

  it.each(["1", "13", "2.5", "word"])(
    "rejects an invalid monthly installment count: %s",
    (monthlyInstallments) => {
      const result = validatePrivateOfferDraft(
        validDraft({
          fullPlan: false,
          splitPlan: false,
          monthlyPlan: true,
          monthlyInstallments,
        }),
        undefined,
        [],
      );

      expectError(result, "payment", "Monthly payments must be between 2 and 12.");
    },
  );

  it.each(["2", "12"])("accepts the monthly installment boundary: %s", (monthlyInstallments) => {
    const result = validatePrivateOfferDraft(
      validDraft({
        fullPlan: false,
        splitPlan: false,
        monthlyPlan: true,
        monthlyInstallments,
      }),
      undefined,
      [],
    );

    expect(result).toHaveProperty("value.terms.enabledPaymentPlans", [
      { kind: "monthly", installments: Number(monthlyInstallments) },
    ]);
  });
});

describe("private-offer editor price model", () => {
  it.each([
    ["tax_added", 10_000, 18, { taxCents: 1_800, totalCents: 11_800 }],
    ["tax_included", 11_800, 18, { taxCents: 1_800, totalCents: 11_800 }],
    ["tax_free", 10_000, 18, { taxCents: 0, totalCents: 10_000 }],
  ] as const)("calculates %s tax", (mode, subtotalCents, ratePct, expected) => {
    expect(privateOfferTaxBreakdown(subtotalCents, mode, ratePct)).toEqual(expected);
  });

  it("accepts the maximum database cash amount and rejects one cent more", () => {
    const maximum = validatePrivateOfferDraft(
      validDraft({
        cashPrice: "21474836.47",
        taxMode: "tax_free",
        taxRatePct: "0",
      }),
      undefined,
      [],
    );
    const overMaximum = validatePrivateOfferDraft(
      validDraft({
        cashPrice: "21474836.48",
        taxMode: "tax_free",
        taxRatePct: "0",
      }),
      undefined,
      [],
    );

    expect(maximum).toHaveProperty("value.terms.cashPriceCents", MAX_CASH_PRICE_CENTS);
    expectError(overMaximum, "price", "Enter a valid price with up to two decimal places.");
  });

  it("rejects a maximum cash amount when added tax would overflow storage", () => {
    const result = validatePrivateOfferDraft(
      validDraft({
        cashPrice: "21474836.47",
        taxMode: "tax_added",
        taxRatePct: "1",
      }),
      undefined,
      [],
    );

    expectError(
      result,
      "price",
      "This price is too high after tax. Lower the price and try again.",
    );
  });

  it("uses the active per-song volume tier for the entire requested quantity", () => {
    const tiers = [
      { minQty: 5, pricePerUnitCents: 8_000 },
      { minQty: 1, pricePerUnitCents: 10_000 },
      { minQty: 3, pricePerUnitCents: 9_000 },
    ] as const;

    expect(totalForTemplateQuantity(tiers, 1)).toBe(10_000);
    expect(totalForTemplateQuantity(tiers, 3)).toBe(27_000);
    expect(totalForTemplateQuantity(tiers, 7)).toBe(56_000);
    expect(
      totalForTemplateQuantity([{ minQty: 1, pricePerUnitCents: MAX_CASH_PRICE_CENTS }], 2),
    ).toBe(MAX_CASH_PRICE_CENTS * 2);
  });
});

describe("private-offer editor delivery bounds", () => {
  it("accepts the maximum fixed session and revision values", () => {
    const result = validatePrivateOfferDraft(
      validDraft({
        includedSongSpaces: "1000",
        hasSessionAllowance: true,
        sessionLimitMode: "fixed",
        sessionCount: "1000",
        sessionDurationMin: "1440",
        sessionLocationType: "remote",
        sessionBufferMinutes: "1440",
        sessionMinLeadHours: "8760",
        revisionMode: "fixed",
        revisionCount: "1000",
      }),
      undefined,
      [],
    );

    expect(result).toHaveProperty("value.terms.session", {
      limit: { kind: "fixed", count: 1_000 },
      durationMin: 1_440,
      locationType: "remote",
      bufferMinutes: 1_440,
      minLeadHours: 8_760,
    });
    expect(result).toHaveProperty("value.terms.revisionRule", {
      kind: "fixed",
      count: 1_000,
    });
  });

  it("ignores count fields for unlimited sessions and revisions", () => {
    const result = validatePrivateOfferDraft(
      validDraft({
        hasSessionAllowance: true,
        sessionLimitMode: "unlimited",
        sessionCount: "not used",
        sessionDurationMin: "60",
        sessionLocationType: "studio",
        sessionBufferMinutes: "0",
        sessionMinLeadHours: "0",
        revisionMode: "unlimited",
        revisionCount: "not used",
      }),
      undefined,
      [],
    );

    expect(result).toHaveProperty("value.terms.session.limit", { kind: "unlimited" });
    expect(result).toHaveProperty("value.terms.revisionRule", { kind: "unlimited" });
  });

  it.each([
    [{ sessionCount: "0" }, "Session allowance must be from 1 to 1,000."],
    [{ sessionCount: "1001" }, "Session allowance must be from 1 to 1,000."],
    [{ sessionDurationMin: "0" }, "Session duration must be from 1 to 1,440 minutes."],
    [{ sessionDurationMin: "1441" }, "Session duration must be from 1 to 1,440 minutes."],
    [{ sessionBufferMinutes: "-1" }, "Session buffer must be from 0 to 1,440 minutes."],
    [{ sessionBufferMinutes: "1441" }, "Session buffer must be from 0 to 1,440 minutes."],
    [{ sessionMinLeadHours: "-1" }, "Session notice must be from 0 to 8,760 hours."],
    [{ sessionMinLeadHours: "8761" }, "Session notice must be from 0 to 8,760 hours."],
  ] as const)("rejects an out-of-bounds session value", (overrides, message) => {
    const result = validatePrivateOfferDraft(
      validDraft({
        hasSessionAllowance: true,
        sessionLimitMode: "fixed",
        sessionCount: "1",
        sessionDurationMin: "60",
        sessionLocationType: "studio",
        sessionBufferMinutes: "0",
        sessionMinLeadHours: "0",
        ...overrides,
      }),
      undefined,
      [],
    );

    expectError(result, "delivery", message);
  });

  it.each(["-1", "1001", "1.5"])("rejects an out-of-bounds revision count: %s", (count) => {
    const result = validatePrivateOfferDraft(
      validDraft({ revisionMode: "fixed", revisionCount: count }),
      undefined,
      [],
    );

    expectError(result, "delivery", "Revisions must be a whole number from 0 to 1,000.");
  });
});

describe("private-offer editor rights and expiry bounds", () => {
  it("requires at least one right", () => {
    expectError(
      validatePrivateOfferDraft(validDraft({ rights: " \n " }), undefined, []),
      "rights",
      "Write the rights included in this offer.",
    );
  });

  it("enforces the right count and per-right length limits", () => {
    const tooManyRights = Array.from(
      { length: MAX_RIGHTS + 1 },
      (_, index) => `Right ${String(index)}`,
    );

    expectError(
      validatePrivateOfferDraft(validDraft({ rights: tooManyRights.join("\n") }), undefined, []),
      "rights",
      "Add no more than 20 rights.",
    );
    expectError(
      validatePrivateOfferDraft(
        validDraft({ rights: "r".repeat(MAX_RIGHT_LENGTH + 1) }),
        undefined,
        [],
      ),
      "rights",
      "Each right must be 1,000 characters or fewer.",
    );
  });

  it("requires complete exact agreement text and enforces its limit", () => {
    expectError(
      validatePrivateOfferDraft(validDraft({ agreementText: "" }), undefined, []),
      "rights",
      "Write the exact agreement the artist will accept.",
    );
    expectError(
      validatePrivateOfferDraft(
        validDraft({ agreementText: "Complete text", agreementNeedsCompletion: true }),
        undefined,
        [],
      ),
      "rights",
      "Write the exact agreement the artist will accept.",
    );
    expectError(
      validatePrivateOfferDraft(
        validDraft({ agreementText: "a".repeat(MAX_AGREEMENT_LENGTH + 1) }),
        undefined,
        [],
      ),
      "rights",
      "Exact agreement must be 50,000 characters or fewer.",
    );
  });

  it("accepts the exact maximum rights and agreement sizes", () => {
    const rights = Array.from({ length: MAX_RIGHTS }, () => "r".repeat(MAX_RIGHT_LENGTH));
    const result = validatePrivateOfferDraft(
      validDraft({
        rights: rights.join("\n"),
        agreementText: "a".repeat(MAX_AGREEMENT_LENGTH),
      }),
      undefined,
      [],
    );

    expect(result).toHaveProperty("value.terms.rights", rights);
    expect(result).toHaveProperty("value.terms.agreementText", "a".repeat(MAX_AGREEMENT_LENGTH));
  });

  it("accepts only an expiry in the future", () => {
    const future = validatePrivateOfferDraft(
      validDraft({ expiresAtLocal: FUTURE_EXPIRY }),
      undefined,
      [],
    );
    const past = validatePrivateOfferDraft(
      validDraft({ expiresAtLocal: "2000-01-01T00:00" }),
      undefined,
      [],
    );
    const invalid = validatePrivateOfferDraft(
      validDraft({ expiresAtLocal: "not-a-date" }),
      undefined,
      [],
    );

    expect(future).toHaveProperty("value.expiry", new Date(FUTURE_EXPIRY));
    expectError(past, "review", "Choose an expiry date in the future.");
    expectError(invalid, "review", "Choose an expiry date in the future.");
  });

  it("keeps an expired saved draft reviewable so the expiry can be corrected", () => {
    const expiredDraft = validDraft({ expiresAtLocal: "2000-01-01T00:00" });

    expect(validatePrivateOfferReviewDraft(expiredDraft, undefined, [])).toHaveProperty(
      "value.snapshot.productOrOfferName",
      "Single production",
    );
    expectError(
      validatePrivateOfferDraft(expiredDraft, undefined, []),
      "review",
      "Choose an expiry date in the future.",
    );
  });
});

describe("private-offer Store template safety", () => {
  it("requires an exact whole per-song quantity and matching tier total", () => {
    const pricing = {
      kind: "per_song" as const,
      initialQuantity: 1 as const,
      volumeTiers: [
        { minQty: 1, pricePerUnitCents: 10_000 },
        { minQty: 3, pricePerUnitCents: 8_000 },
      ],
    };

    expect(
      validatePrivateOfferTemplateQuantity(
        validDraft({ templateQuantity: "3", includedSongSpaces: "3", cashPrice: "240.00" }),
        pricing,
      ),
    ).toEqual({ value: { quantity: 3, totalCents: 24_000 } });
    expect(
      validatePrivateOfferTemplateQuantity(validDraft({ templateQuantity: "2.5" }), pricing),
    ).toEqual({
      error: { step: "price", message: "Choose a whole number of songs from 1 to 1,000." },
    });
    expect(
      validatePrivateOfferTemplateQuantity(
        validDraft({ templateQuantity: "3", includedSongSpaces: "2", cashPrice: "200.00" }),
        pricing,
      ),
    ).toEqual({
      error: {
        step: "price",
        message: "The song quantity no longer matches the offer price. Re-enter the quantity.",
      },
    });
  });

  it("preserves a valid three-letter currency outside the common quick list", () => {
    const result = validatePrivateOfferDraft(validDraft({ currency: "CAD" }), undefined, []);

    expect(result).toHaveProperty("value.terms.currency", "CAD");
    expectError(
      validatePrivateOfferDraft(validDraft({ currency: "" }), undefined, []),
      "price",
      "Enter a valid three-letter currency code.",
    );
  });

  it("requires an explicit fixed subtotal for an hourly Store template", () => {
    const hourlyTemplate: PrivateOfferTemplateProduct = {
      source: {
        productId: "product-hourly",
        productName: "Studio time",
        productKind: "session",
      },
      terms: {
        name: "Studio time",
        service: "Session",
        deliverables: ["Studio session"],
        cashPriceCents: 12_500,
        currency: "CAD",
        taxMode: "tax_free",
        taxRatePct: 0,
        includedSongSpaces: 0,
        session: {
          limit: { kind: "fixed", count: 1 },
          durationMin: 60,
          locationType: "studio",
          bufferMinutes: 15,
          minLeadHours: 24,
        },
        revisionRule: null,
        royaltyTerms: null,
        rights: ["Artist may use the recorded session."],
        enabledPaymentPlans: [{ kind: "full" }],
        agreementText: "Exact studio-session terms.",
      },
      pricing: { kind: "hourly", hourlyRateCents: 12_500 },
      agreementNeedsCompletion: false,
    };

    const draft = seedPrivateOfferDraft({
      defaultCurrency: "ILS",
      taxMode: "tax_added",
      taxRatePct: 18,
      lockedClientId: "client-1",
      templateProduct: hourlyTemplate,
    });

    expect(draft.cashPrice).toBe("");
    expect(draft.currency).toBe("CAD");
    expectError(
      validatePrivateOfferDraft(
        {
          ...draft,
          expiresAtLocal: FUTURE_EXPIRY,
        },
        "client-1",
        [],
      ),
      "price",
      "Enter a valid price with up to two decimal places.",
    );
  });
});
