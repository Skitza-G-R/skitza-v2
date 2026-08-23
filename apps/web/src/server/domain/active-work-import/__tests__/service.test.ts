import { describe, expect, it } from "vitest";

import {
  ACTIVE_WORK_IMPORT_NO_TERMS_TEXT,
  ACTIVE_WORK_IMPORT_NOTICE,
  activeWorkImportCreationDigest,
  activeWorkImportExistingClientReason,
  assessActiveWorkImportDraft,
} from "../service";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client: {
      name: "  Noga Artist  ",
      email: "  NOGA@EXAMPLE.COM  ",
      phone: "  +972 50 123 4567  ",
    },
    project: { title: "  Existing EP  ", deadlineAt: "2026-12-01T00:00:00.000Z" },
    agreement: {
      name: "EP production",
      service: "Production and mixing",
      deliverables: ["  4 produced tracks  "],
      rights: ["  Artist owns the masters  "],
      agreementText: "Our signed agreement from January remains the source of truth.",
      subtotalCents: 100_00,
      taxMode: "tax_free",
      taxRatePct: 0,
      taxAmountCents: 0,
      totalCents: 100_00,
      currency: " usd ",
      includedSongSpaces: 4,
      plan: { kind: "full" },
      revisionRule: { kind: "fixed", count: 2 },
      royaltyTerms: {
        master: { mode: "percentage", bps: 2_000 },
        composition: {
          mode: "percentage",
          bps: 1_000,
          role: "arranger",
        },
      },
    },
    payments: [],
    ...overrides,
  };
}

function ready(value: Record<string, unknown>) {
  const assessment = assessActiveWorkImportDraft(value, NOW);
  expect(assessment.state).toBe("ready");
  if (assessment.state !== "ready") throw new Error("expected a Ready import");
  return assessment.normalized;
}

describe("active work import assessment", () => {
  it("requires an archived matching Client to be restored instead of duplicated", () => {
    const archivedAt = new Date("2026-08-19T12:00:00.000Z");
    const expected = {
      code: "existing_client_archived",
      field: "client.existingClientId",
      message: "Restore this client in Clients & Projects before adding active work.",
    };

    expect(
      activeWorkImportExistingClientReason({
        explicitlySelected: true,
        emailMatches: true,
        producerArchivedAt: archivedAt,
      }),
    ).toEqual(expected);
    expect(
      activeWorkImportExistingClientReason({
        explicitlySelected: false,
        emailMatches: true,
        producerArchivedAt: archivedAt,
      }),
    ).toEqual(expected);
  });

  it("builds one exact imported commercial snapshot without Artist acceptance", () => {
    const normalized = ready(draft());

    expect(ACTIVE_WORK_IMPORT_NOTICE).toBe("Added by producer from an existing agreement");
    expect(normalized).toMatchObject({
      clientName: "Noga Artist",
      clientEmail: "noga@example.com",
      clientPhone: "+972 50 123 4567",
      projectTitle: "Existing EP",
      plan: { kind: "full" },
      schedule: [
        {
          sequence: 1,
          amountCents: 10_000,
          trigger: "producer_import",
          status: "not_paid",
        },
      ],
      commercialSnapshot: {
        version: 2,
        bookingEnabled: false,
        lineItems: [
          {
            label: "EP production",
            quantity: 1,
            listUnitPriceCents: 10_000,
            unitPriceCents: 10_000,
            totalCents: 10_000,
          },
        ],
        listSubtotalCents: 10_000,
        discountCents: 0,
        subtotalCents: 10_000,
        totalCents: 10_000,
        currency: "USD",
        includedSongSpaces: 4,
        session: null,
        selectedPaymentPlan: { kind: "full" },
        offeredPaymentPlans: [{ kind: "full" }],
        revisionRule: { kind: "fixed", count: 2 },
        royaltyTerms: {
          master: { mode: "percentage", bps: 2_000 },
          composition: { mode: "percentage", bps: 1_000, role: "arranger" },
        },
      },
    });
    expect(Object.isFrozen(normalized.commercialSnapshot)).toBe(true);
  });

  it("freezes included sessions into a bookable imported snapshot", () => {
    const base = draft();
    const agreement = base.agreement as Record<string, unknown>;

    const fixed = ready(
      draft({
        agreement: {
          ...agreement,
          session: {
            limit: { kind: "fixed", count: 4 },
            durationMin: 90,
            locationType: "studio",
            bufferMinutes: 15,
            minLeadHours: 24,
          },
        },
      }),
    );
    expect(fixed.commercialSnapshot).toMatchObject({
      bookingEnabled: true,
      session: {
        limit: { kind: "fixed", count: 4 },
        durationMin: 90,
        locationType: "studio",
        bufferMinutes: 15,
        minLeadHours: 24,
      },
    });

    const unlimited = ready(
      draft({
        agreement: {
          ...agreement,
          session: {
            limit: { kind: "unlimited" },
            durationMin: 120,
            locationType: "remote",
            bufferMinutes: 0,
            minLeadHours: 12,
          },
        },
      }),
    );
    expect(unlimited.commercialSnapshot).toMatchObject({
      bookingEnabled: true,
      session: { limit: { kind: "unlimited" }, durationMin: 120 },
    });

    // Absent and null both keep the exact pre-session snapshot shape, so
    // drafts saved before sessions existed keep their digests and stay Ready.
    const absent = ready(draft());
    expect(absent.commercialSnapshot.bookingEnabled).toBe(false);
    expect(absent.commercialSnapshot.session).toBeNull();
    const explicitNull = ready(draft({ agreement: { ...agreement, session: null } }));
    expect(explicitNull.commercialSnapshot.bookingEnabled).toBe(false);
    expect(explicitNull.commercialSnapshot.session).toBeNull();
  });

  it("keeps malformed included sessions at Needs info with one plain reason", () => {
    const base = draft();
    const agreement = base.agreement as Record<string, unknown>;
    const validSession = {
      limit: { kind: "fixed", count: 4 },
      durationMin: 90,
      locationType: "studio",
      bufferMinutes: 0,
      minLeadHours: 12,
    };
    for (const broken of [
      "4 sessions",
      { ...validSession, limit: { kind: "fixed", count: 0 } },
      { ...validSession, limit: { kind: "sometimes" } },
      { ...validSession, limit: null },
      { ...validSession, durationMin: 0 },
      { ...validSession, durationMin: 24 * 60 + 1 },
      { ...validSession, locationType: "  " },
      { ...validSession, bufferMinutes: -1 },
      { ...validSession, minLeadHours: 365 * 24 + 1 },
    ]) {
      const assessment = assessActiveWorkImportDraft(
        draft({ agreement: { ...agreement, session: broken } }),
        NOW,
      );
      expect(assessment.state).toBe("needs_info");
      if (assessment.state !== "needs_info") throw new Error("Expected Needs info");
      expect(assessment.reasons).toEqual([
        {
          code: "session_invalid",
          field: "agreement.session",
          message: "Check the included sessions: how many, and the session length in minutes.",
        },
      ]);
    }
  });

  it("keeps a draft Ready without pasted agreement terms", () => {
    const base = draft();
    const agreement = base.agreement as Record<string, unknown>;

    const withTerms = ready(base);
    expect(withTerms.commercialSnapshot.agreementMode).toBe("text");
    expect(withTerms.commercialSnapshot.agreementText).toBe(
      "Our signed agreement from January remains the source of truth.",
    );

    const withoutTerms = ready(draft({ agreement: { ...agreement, agreementText: "   " } }));
    expect(withoutTerms.commercialSnapshot.agreementMode).toBe("none");
    expect(withoutTerms.commercialSnapshot.agreementText).toBe(ACTIVE_WORK_IMPORT_NO_TERMS_TEXT);
    expect(withoutTerms.commercialSnapshot).not.toHaveProperty("agreementPdf");
  });

  it("carries an attached agreement PDF reference and names it in the frozen terms", () => {
    const base = draft();
    const agreement = base.agreement as Record<string, unknown>;
    const reference = { uploadToken: "signed-token", fileName: "deal.pdf", sizeBytes: 1_234 };

    const pdfOnly = ready(
      draft({ agreement: { ...agreement, agreementText: "", agreementPdf: reference } }),
    );
    expect(pdfOnly.agreementPdf).toEqual(reference);
    expect(pdfOnly.commercialSnapshot.agreementText).toBe(
      'The existing agreement is the attached PDF "deal.pdf".',
    );
    // Exact PDF metadata is only known once the file is finalized at creation.
    expect(pdfOnly.commercialSnapshot.agreementMode).toBe("none");
    expect(pdfOnly.commercialSnapshot).not.toHaveProperty("agreementPdf");

    const pdfAndText = ready(draft({ agreement: { ...agreement, agreementPdf: reference } }));
    expect(pdfAndText.agreementPdf).toEqual(reference);
    expect(pdfAndText.commercialSnapshot.agreementText).toBe(
      "Our signed agreement from January remains the source of truth.",
    );

    const noPdf = ready(draft({ agreement: { ...agreement, agreementPdf: null } }));
    expect(noPdf.agreementPdf).toBeNull();
  });

  it("keeps a malformed agreement PDF reference at Needs info", () => {
    const base = draft();
    const agreement = base.agreement as Record<string, unknown>;
    for (const broken of [
      { uploadToken: "", fileName: "deal.pdf", sizeBytes: 1 },
      { uploadToken: "signed", fileName: "deal.png", sizeBytes: 1 },
      { uploadToken: "signed", fileName: "deal.pdf", sizeBytes: 0 },
      "deal.pdf",
    ]) {
      const assessment = assessActiveWorkImportDraft(
        draft({ agreement: { ...agreement, agreementPdf: broken } }),
        NOW,
      );
      expect(assessment.state).toBe("needs_info");
      if (assessment.state !== "needs_info") throw new Error("Expected Needs info");
      expect(assessment.reasons).toEqual([
        {
          code: "agreement_pdf_invalid",
          field: "agreement.agreementPdf",
          message: "Attach the agreement PDF again.",
        },
      ]);
    }
  });

  it("returns plain, stable Needs info reasons for an incomplete silent draft", () => {
    const assessment = assessActiveWorkImportDraft({}, NOW);
    expect(assessment.state).toBe("needs_info");
    if (assessment.state !== "needs_info") throw new Error("Expected Needs info");
    expect(assessment.reasons).toContainEqual(
      expect.objectContaining({
        code: "client_name_required",
        message: "Add the client name.",
      }),
    );
    expect(assessment.reasons).toContainEqual(
      expect.objectContaining({
        code: "client_email_required",
        message: "Add a valid client email.",
      }),
    );
    expect(assessment.reasons).toContainEqual(
      expect.objectContaining({
        code: "project_title_required",
        message: "Add the project name.",
      }),
    );
    expect(assessment.reasons).toContainEqual(
      expect.objectContaining({
        code: "agreement_name_required",
        message: "Add a name for the agreement.",
      }),
    );
  });

  it("reconciles tax, total, currency, and plan instead of trusting supplied totals", () => {
    const addedTax = draft({
      agreement: {
        ...(draft().agreement as Record<string, unknown>),
        subtotalCents: 9_999,
        taxMode: "tax_added",
        taxRatePct: 18,
        taxAmountCents: 1_800,
        totalCents: 11_799,
        plan: { kind: "monthly", installments: 3 },
      },
    });
    expect(ready(addedTax)).toMatchObject({
      plan: { kind: "monthly", installments: 3 },
      commercialSnapshot: {
        tax: { mode: "tax_added", ratePct: 18, amountCents: 1_800 },
        totalCents: 11_799,
      },
    });

    for (const agreementChange of [
      { taxAmountCents: 1_799 },
      { totalCents: 11_800 },
      { currency: "dollars" },
      { plan: { kind: "monthly", installments: 13 } },
    ]) {
      const value = draft({
        agreement: {
          ...(addedTax.agreement as Record<string, unknown>),
          ...agreementChange,
        },
      });
      expect(assessActiveWorkImportDraft(value, NOW).state).toBe("needs_info");
    }
  });

  it("rejects database integer overflow before a row can be marked Ready", () => {
    const maxInteger = 2_147_483_647;
    expect(
      ready(
        draft({
          agreement: {
            ...(draft().agreement as Record<string, unknown>),
            subtotalCents: maxInteger,
            taxAmountCents: 0,
            totalCents: maxInteger,
            includedSongSpaces: maxInteger,
            revisionRule: { kind: "fixed", count: maxInteger },
          },
          payments: [
            {
              operationKey: "largest-valid-payment",
              installmentPosition: 1,
              amountCents: maxInteger,
              paidAt: "2026-01-10",
            },
          ],
        }),
      ),
    ).toMatchObject({
      commercialSnapshot: {
        totalCents: maxInteger,
        includedSongSpaces: maxInteger,
        revisionRule: { kind: "fixed", count: maxInteger },
      },
      payments: [{ amountCents: maxInteger }],
    });

    const tooLarge = maxInteger + 1;
    const cases = [
      {
        value: draft({
          agreement: {
            ...(draft().agreement as Record<string, unknown>),
            subtotalCents: tooLarge,
            totalCents: tooLarge,
          },
        }),
        code: "amount_invalid",
      },
      {
        value: draft({
          agreement: {
            ...(draft().agreement as Record<string, unknown>),
            taxAmountCents: tooLarge,
          },
        }),
        code: "tax_mismatch",
      },
      {
        value: draft({
          agreement: {
            ...(draft().agreement as Record<string, unknown>),
            totalCents: tooLarge,
          },
        }),
        code: "amount_invalid",
      },
      {
        value: draft({
          agreement: {
            ...(draft().agreement as Record<string, unknown>),
            includedSongSpaces: tooLarge,
          },
        }),
        code: "song_spaces_invalid",
      },
      {
        value: draft({
          agreement: {
            ...(draft().agreement as Record<string, unknown>),
            revisionRule: { kind: "fixed", count: tooLarge },
          },
        }),
        code: "revision_rule_invalid",
      },
      {
        value: draft({
          payments: [
            {
              operationKey: "too-large-payment",
              installmentPosition: 1,
              amountCents: tooLarge,
              paidAt: "2026-01-10",
            },
          ],
        }),
        code: "payment_invalid",
      },
    ] as const;

    for (const testCase of cases) {
      const assessment = assessActiveWorkImportDraft(testCase.value, NOW);
      expect(assessment.state).toBe("needs_info");
      if (assessment.state !== "needs_info") throw new Error("Expected Needs info");
      expect(assessment.reasons.map((item) => item.code)).toContain(testCase.code);
    }

    const taxOverflow = assessActiveWorkImportDraft(
      draft({
        agreement: {
          ...(draft().agreement as Record<string, unknown>),
          subtotalCents: 1_500_000_000,
          taxMode: "tax_added",
          taxRatePct: 100,
          taxAmountCents: 1_500_000_000,
          totalCents: 3_000_000_000,
        },
      }),
      NOW,
    );
    expect(taxOverflow.state).toBe("needs_info");
    if (taxOverflow.state !== "needs_info") throw new Error("Expected Needs info");
    expect(taxOverflow.reasons).toContainEqual({
      code: "amount_invalid",
      field: "agreement.totalCents",
      message: "The price plus tax is too large. Use a smaller price.",
    });
  });

  it("preserves exact revision and royalty terms and rejects malformed supplied terms", () => {
    const exact = ready(draft());
    expect(exact.commercialSnapshot.revisionRule).toEqual({ kind: "fixed", count: 2 });
    expect(exact.commercialSnapshot.royaltyTerms).toEqual({
      master: { mode: "percentage", bps: 2_000 },
      composition: { mode: "percentage", bps: 1_000, role: "arranger" },
    });

    for (const [field, supplied, code] of [
      ["revisionRule", { kind: "fixed", count: "2" }, "revision_rule_invalid"],
      [
        "royaltyTerms",
        { master: { mode: "percentage", bps: 20_000 }, composition: { mode: "none" } },
        "royalty_terms_invalid",
      ],
    ] as const) {
      const value = draft({
        agreement: {
          ...(draft().agreement as Record<string, unknown>),
          [field]: supplied,
        },
      });
      const assessment = assessActiveWorkImportDraft(value, NOW);
      expect(assessment.state).toBe("needs_info");
      if (assessment.state !== "needs_info") throw new Error("Expected Needs info");
      expect(assessment.reasons.map((item) => item.code)).toContain(code);
    }
  });

  it("keeps a historical partial or overpayment canonical but blocks the untriggered final 50%", () => {
    const fullAgreement = draft().agreement as Record<string, unknown>;
    const payments = [
      {
        operationKey: "historical-partial",
        installmentPosition: 1,
        amountCents: 4_000,
        paidAt: "2026-01-10",
        note: "Bank transfer",
      },
      {
        operationKey: "historical-overpayment",
        installmentPosition: 1,
        amountCents: 8_000,
        paidAt: "2026-01-12",
      },
    ];
    expect(ready(draft({ payments })).payments).toHaveLength(2);

    const finalPayment = draft({
      agreement: { ...fullAgreement, plan: { kind: "split_50_50" } },
      payments: [
        {
          operationKey: "forbidden-final",
          installmentPosition: 2,
          amountCents: 5_000,
          paidAt: "2026-01-10",
        },
      ],
    });
    const finalAssessment = assessActiveWorkImportDraft(finalPayment, NOW);
    expect(finalAssessment.state).toBe("needs_info");
    if (finalAssessment.state !== "needs_info") throw new Error("Expected Needs info");
    expect(finalAssessment.reasons.map((item) => item.code)).toContain(
      "final_payment_requires_artist_approval",
    );
  });

  it("accepts a payment dated today for a producer east of UTC and rejects tomorrow", () => {
    // 01:00 on 22 August in Israel (UTC+3) is still 21 August in UTC.
    const israelEarlyMorning = new Date("2026-08-21T22:00:00.000Z");
    const payment = (paidAt: string) => ({
      operationKey: `paid-${paidAt}`,
      installmentPosition: 1,
      amountCents: 4_000,
      paidAt,
    });

    const today = assessActiveWorkImportDraft(
      draft({ payments: [payment("2026-08-22")] }),
      israelEarlyMorning,
    );
    expect(today.state).toBe("ready");

    const tomorrow = assessActiveWorkImportDraft(
      draft({ payments: [payment("2026-08-23")] }),
      israelEarlyMorning,
    );
    expect(tomorrow.state).toBe("needs_info");
    if (tomorrow.state !== "needs_info") throw new Error("Expected Needs info");
    expect(tomorrow.reasons.map((item) => item.code)).toEqual(["payment_invalid"]);
  });

  it("requires a real first Monthly payment before importing later Monthly history", () => {
    const agreement = {
      ...(draft().agreement as Record<string, unknown>),
      plan: { kind: "monthly", installments: 3 },
    };
    const later = {
      operationKey: "month-two",
      installmentPosition: 2,
      amountCents: 3_333,
      paidAt: "2026-02-10",
    };
    const laterAssessment = assessActiveWorkImportDraft(
      draft({ agreement, payments: [later] }),
      NOW,
    );
    expect(laterAssessment.state).toBe("needs_info");
    if (laterAssessment.state !== "needs_info") throw new Error("Expected Needs info");
    expect(laterAssessment.reasons.map((item) => item.code)).toContain("monthly_anchor_missing");
    expect(
      ready(
        draft({
          agreement,
          payments: [
            {
              operationKey: "month-one",
              installmentPosition: 1,
              amountCents: 3_334,
              paidAt: "2026-01-10",
            },
            later,
          ],
        }),
      ).payments,
    ).toHaveLength(2);
  });

  it("commits normalized phone and verified proof identity to a stable creation digest", () => {
    const normalized = ready(draft());
    const proof = [
      {
        paymentOperationKey: "payment-1",
        uploadId: "a".repeat(64),
        originalFileName: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
      },
    ];
    expect(activeWorkImportCreationDigest(normalized, proof)).toBe(
      activeWorkImportCreationDigest(normalized, proof),
    );
    const firstProof = proof[0];
    if (!firstProof) throw new Error("Expected proof fixture");
    expect(
      activeWorkImportCreationDigest(normalized, [{ ...firstProof, uploadId: "b".repeat(64) }]),
    ).not.toBe(activeWorkImportCreationDigest(normalized, proof));
    expect(
      activeWorkImportCreationDigest({ ...normalized, clientPhone: "+972 50 000 0000" }, proof),
    ).not.toBe(activeWorkImportCreationDigest(normalized, proof));

    const agreementPdf = {
      uploadId: "c".repeat(64),
      originalFileName: "deal.pdf",
      contentType: "application/pdf" as const,
      sizeBytes: 2_048,
    };
    expect(activeWorkImportCreationDigest(normalized, proof, agreementPdf)).toBe(
      activeWorkImportCreationDigest(normalized, proof, agreementPdf),
    );
    expect(activeWorkImportCreationDigest(normalized, proof, agreementPdf)).not.toBe(
      activeWorkImportCreationDigest(normalized, proof, null),
    );
    expect(activeWorkImportCreationDigest(normalized, proof, null)).toBe(
      activeWorkImportCreationDigest(normalized, proof),
    );
    expect(
      activeWorkImportCreationDigest(normalized, proof, { ...agreementPdf, sizeBytes: 2_049 }),
    ).not.toBe(activeWorkImportCreationDigest(normalized, proof, agreementPdf));
  });
});
