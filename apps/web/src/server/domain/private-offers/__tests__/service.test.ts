import { describe, expect, it } from "vitest";

import {
  assertPrivateOfferActionAllowed,
  buildPrivateOfferSnapshot,
  defaultPrivateOfferExpiry,
  finalizePrivateOfferSnapshot,
  isPrivateOfferExpired,
  PrivateOfferDomainError,
  privateOfferPaymentPlanKey,
  type PrivateOfferAction,
  type PrivateOfferInput,
  type PrivateOfferStatus,
} from "../service";

function offerInput(overrides: Partial<PrivateOfferInput> = {}): PrivateOfferInput {
  return {
    name: "Custom album production",
    tagline: "Four songs, made together",
    service: "Production",
    deliverables: ["Four mixed masters", "Instrumentals", "Stems"],
    cashPriceCents: 100_000,
    currency: "ils",
    taxMode: "tax_added",
    taxRatePct: 18,
    includedSongSpaces: 4,
    session: {
      limit: { kind: "unlimited" },
      durationMin: 120,
      locationType: "studio",
      bufferMinutes: 30,
      minLeadHours: 24,
    },
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: {
      master: { mode: "percentage", bps: 250 },
      composition: {
        mode: "percentage",
        bps: 500,
        role: "arranger",
        collectingSociety: "  ACUM  ",
      },
      notes: "  Calculated from producer net receipts.  ",
    },
    rights: ["Artist owns the final master subject to the stated royalty."],
    enabledPaymentPlans: [
      { kind: "monthly", installments: 4 },
      { kind: "full" },
      { kind: "split_50_50" },
    ],
    agreementText: "  These are the exact additional terms.\nThey survive acceptance.  ",
    ...overrides,
  };
}

function domainError(run: () => unknown): PrivateOfferDomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateOfferDomainError);
    return error as PrivateOfferDomainError;
  }
  throw new Error("Expected PrivateOfferDomainError");
}

describe("private-offer commercial terms", () => {
  it("builds and normalizes every immutable snapshot field", () => {
    const snapshot = buildPrivateOfferSnapshot(offerInput());

    expect(snapshot).toEqual({
      version: 2,
      bookingEnabled: true,
      productOrOfferName: "Custom album production",
      tagline: "Four songs, made together",
      service: "Production",
      deliverables: ["Four mixed masters", "Instrumentals", "Stems"],
      lineItems: [
        {
          label: "Custom album production",
          quantity: 1,
          listUnitPriceCents: 100_000,
          unitPriceCents: 100_000,
          totalCents: 100_000,
        },
      ],
      listSubtotalCents: 100_000,
      discountCents: 0,
      subtotalCents: 100_000,
      tax: { mode: "tax_added", ratePct: 18, amountCents: 18_000 },
      totalCents: 118_000,
      currency: "ILS",
      includedSongSpaces: 4,
      session: {
        limit: { kind: "unlimited" },
        durationMin: 120,
        locationType: "studio",
        bufferMinutes: 30,
        minLeadHours: 24,
      },
      revisionRule: { kind: "fixed", count: 2 },
      royaltyTerms: {
        master: { mode: "percentage", bps: 250 },
        composition: {
          mode: "percentage",
          bps: 500,
          role: "arranger",
          collectingSociety: "ACUM",
        },
        notes: "Calculated from producer net receipts.",
      },
      rights: ["Artist owns the final master subject to the stated royalty."],
      selectedPaymentPlan: null,
      offeredPaymentPlans: [
        { kind: "full" },
        { kind: "split_50_50" },
        { kind: "monthly", installments: 4 },
      ],
      agreementText: "These are the exact additional terms.\nThey survive acceptance.",
    });
  });

  it("computes included tax without increasing the cash total", () => {
    const snapshot = buildPrivateOfferSnapshot(
      offerInput({ cashPriceCents: 118_000, taxMode: "tax_included" }),
    );

    expect(snapshot.subtotalCents).toBe(118_000);
    expect(snapshot.tax).toEqual({ mode: "tax_included", ratePct: 18, amountCents: 18_000 });
    expect(snapshot.totalCents).toBe(118_000);
  });

  it("supports a true zero or royalty-only offer without plans", () => {
    const draft = buildPrivateOfferSnapshot(
      offerInput({
        cashPriceCents: 0,
        enabledPaymentPlans: [],
        taxMode: "tax_added",
      }),
    );
    const accepted = finalizePrivateOfferSnapshot({
      draft,
      selectedPaymentPlan: null,
      target: { kind: "new" },
    });

    expect(draft.totalCents).toBe(0);
    expect(draft.tax.amountCents).toBe(0);
    expect(draft.offeredPaymentPlans).toEqual([]);
    expect(accepted.snapshot.selectedPaymentPlan).toBeNull();
    expect(accepted.installments).toEqual([]);
    expect(accepted.snapshot.agreementText).toContain("Project target: Start a new project.");
    expect(accepted.snapshot.agreementText).toContain("Selected payment plan: None");
    expect(accepted.snapshot.agreementText).toContain("No payment is due");
  });

  it("snapshots non-session offers as explicitly non-bookable", () => {
    const snapshot = buildPrivateOfferSnapshot(offerInput({ session: null }));

    expect(snapshot).toMatchObject({
      version: 2,
      bookingEnabled: false,
      session: null,
    });
  });

  it("rejects plans on a zero offer and requires a feasible plan set on a paid offer", () => {
    expect(
      domainError(() =>
        buildPrivateOfferSnapshot(
          offerInput({ cashPriceCents: 0, enabledPaymentPlans: [{ kind: "full" }] }),
        ),
      ).code,
    ).toBe("INVALID_PAYMENT_PLANS");

    expect(
      domainError(() =>
        buildPrivateOfferSnapshot(
          offerInput({ cashPriceCents: 1, taxMode: "tax_free", enabledPaymentPlans: [] }),
        ),
      ).code,
    ).toBe("INVALID_PAYMENT_PLANS");

    expect(
      domainError(() =>
        buildPrivateOfferSnapshot(
          offerInput({
            cashPriceCents: 1,
            taxMode: "tax_free",
            enabledPaymentPlans: [{ kind: "split_50_50" }],
          }),
        ),
      ).code,
    ).toBe("INVALID_PAYMENT_PLANS");
  });

  it("validates required agreement, currency, allowances, terms, and duplicate plan kinds", () => {
    expect(
      domainError(() => buildPrivateOfferSnapshot(offerInput({ agreementText: "  " }))).field,
    ).toBe("agreementText");
    expect(
      domainError(() => buildPrivateOfferSnapshot(offerInput({ currency: "shekel" }))).field,
    ).toBe("currency");
    expect(
      domainError(() => buildPrivateOfferSnapshot(offerInput({ includedSongSpaces: -1 }))).field,
    ).toBe("includedSongSpaces");
    expect(
      domainError(() => buildPrivateOfferSnapshot(offerInput({ deliverables: [] }))).field,
    ).toBe("deliverables");
    expect(domainError(() => buildPrivateOfferSnapshot(offerInput({ rights: [] }))).field).toBe(
      "rights",
    );
    expect(
      domainError(() =>
        buildPrivateOfferSnapshot(
          offerInput({
            royaltyTerms: { master: { mode: "percentage", bps: 0 }, composition: { mode: "none" } },
          }),
        ),
      ).code,
    ).toBe("INVALID_ROYALTY_TERMS");
    expect(
      domainError(() =>
        buildPrivateOfferSnapshot(
          offerInput({
            enabledPaymentPlans: [
              { kind: "monthly", installments: 3 },
              { kind: "monthly", installments: 6 },
            ],
          }),
        ),
      ).code,
    ).toBe("INVALID_PAYMENT_PLANS");
  });
});

describe("private-offer acceptance finalization", () => {
  it("selects only an enabled plan and freezes the existing target and exact schedule", () => {
    const draft = buildPrivateOfferSnapshot(
      offerInput({ cashPriceCents: 100_001, taxMode: "tax_free", taxRatePct: 0 }),
    );
    const result = finalizePrivateOfferSnapshot({
      draft,
      selectedPaymentPlan: { kind: "monthly", installments: 4 },
      target: {
        kind: "existing",
        projectId: "project-123",
        projectName: "  Debut album  ",
      },
    });

    expect(result.snapshot.selectedPaymentPlan).toEqual({ kind: "monthly", installments: 4 });
    expect(
      result.installments.map(({ sequence, amountCents, trigger }) => ({
        sequence,
        amountCents,
        trigger,
      })),
    ).toEqual([
      { sequence: 1, amountCents: 25_001, trigger: "acceptance" },
      { sequence: 2, amountCents: 25_000, trigger: "monthly_anniversary" },
      { sequence: 3, amountCents: 25_000, trigger: "monthly_anniversary" },
      { sequence: 4, amountCents: 25_000, trigger: "monthly_anniversary" },
    ]);
    expect(result.snapshot.agreementText).toContain("Project target: Debut album (project-123).");
    expect(result.snapshot.agreementText).toContain(
      "Selected payment plan: Monthly (4 installments).",
    );
    expect(result.snapshot.agreementText).toContain(
      "- 1. First payment due at acceptance: ILS 250.01 [acceptance]",
    );
    expect(result.snapshot.agreementText).toContain(
      "- 4. Monthly payment 4: ILS 250.00 [monthly_anniversary]",
    );
    expect(result.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a missing, disabled, or mismatched selected plan", () => {
    const draft = buildPrivateOfferSnapshot(offerInput());

    expect(
      domainError(() =>
        finalizePrivateOfferSnapshot({
          draft,
          selectedPaymentPlan: null,
          target: { kind: "new" },
        }),
      ).code,
    ).toBe("PAYMENT_PLAN_REQUIRED");
    expect(
      domainError(() =>
        finalizePrivateOfferSnapshot({
          draft,
          selectedPaymentPlan: { kind: "monthly", installments: 6 },
          target: { kind: "new" },
        }),
      ).code,
    ).toBe("PAYMENT_PLAN_NOT_OFFERED");

    const zero = buildPrivateOfferSnapshot(
      offerInput({ cashPriceCents: 0, enabledPaymentPlans: [] }),
    );
    expect(
      domainError(() =>
        finalizePrivateOfferSnapshot({
          draft: zero,
          selectedPaymentPlan: { kind: "full" },
          target: { kind: "new" },
        }),
      ).code,
    ).toBe("PAYMENT_PLAN_NOT_ALLOWED");
  });

  it("rejects malformed persisted drafts and target identities", () => {
    const draft = buildPrivateOfferSnapshot(offerInput());
    const tampered = { ...draft, totalCents: draft.totalCents + 1 };

    expect(
      domainError(() =>
        finalizePrivateOfferSnapshot({
          draft: tampered,
          selectedPaymentPlan: { kind: "full" },
          target: { kind: "new" },
        }),
      ).code,
    ).toBe("INVALID_TERMS");
    expect(
      domainError(() =>
        finalizePrivateOfferSnapshot({
          draft,
          selectedPaymentPlan: { kind: "full" },
          target: { kind: "existing", projectId: " ", projectName: "Album" },
        }),
      ).field,
    ).toBe("target.projectId");
  });

  it("uses stable payment-plan identity", () => {
    expect(privateOfferPaymentPlanKey({ kind: "full" })).toBe("full");
    expect(privateOfferPaymentPlanKey({ kind: "split_50_50" })).toBe("split_50_50");
    expect(privateOfferPaymentPlanKey({ kind: "monthly", installments: 7 })).toBe("monthly:7");
  });
});

describe("private-offer expiry and status policy", () => {
  const now = new Date("2026-07-19T10:00:00.000Z");
  const future = new Date("2026-07-19T10:00:00.001Z");

  it("defaults to exactly 14 days and treats the expiry instant as expired", () => {
    const expiry = defaultPrivateOfferExpiry(now);

    expect(expiry.toISOString()).toBe("2026-08-02T10:00:00.000Z");
    expect(isPrivateOfferExpired(expiry, new Date(expiry.getTime() - 1))).toBe(false);
    expect(isPrivateOfferExpired(expiry, expiry)).toBe(true);
    expect(isPrivateOfferExpired(expiry, new Date(expiry.getTime() + 1))).toBe(true);
  });

  it.each<[PrivateOfferStatus, readonly PrivateOfferAction[]]>([
    ["draft", ["edit", "send", "correct_target", "cancel"]],
    ["sent", ["edit", "correct_target", "accept", "reject", "cancel"]],
  ])("allows only the intended %s actions", (status, allowed) => {
    const actions: readonly PrivateOfferAction[] = [
      "edit",
      "send",
      "correct_target",
      "accept",
      "reject",
      "cancel",
    ];
    for (const action of actions) {
      const run = () => {
        assertPrivateOfferActionAllowed({ status, action, expiresAt: future, now });
      };
      if (allowed.includes(action)) {
        expect(run).not.toThrow();
      } else {
        expect(domainError(run).code).toBe("INVALID_STATUS");
      }
    }
  });

  it("locks every terminal state", () => {
    for (const status of ["accepted", "declined", "canceled"] as const) {
      expect(
        domainError(() => {
          assertPrivateOfferActionAllowed({ status, action: "accept", expiresAt: future, now });
        }).code,
      ).toBe("INVALID_STATUS");
    }
  });

  it("blocks sent-offer actions at and after expiry while allowing a draft to be repaired", () => {
    for (const action of ["edit", "correct_target", "accept", "reject", "cancel"] as const) {
      expect(
        domainError(() => {
          assertPrivateOfferActionAllowed({ status: "sent", action, expiresAt: now, now });
        }).code,
      ).toBe("EXPIRED");
    }
    expect(
      domainError(() => {
        assertPrivateOfferActionAllowed({
          status: "expired",
          action: "accept",
          expiresAt: now,
          now,
        });
      }).code,
    ).toBe("EXPIRED");
    expect(() => {
      assertPrivateOfferActionAllowed({ status: "draft", action: "edit", expiresAt: now, now });
    }).not.toThrow();
    expect(
      domainError(() => {
        assertPrivateOfferActionAllowed({ status: "draft", action: "send", expiresAt: now, now });
      }).code,
    ).toBe("EXPIRED");
  });
});
