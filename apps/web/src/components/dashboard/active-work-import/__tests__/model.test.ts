import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { assessActiveWorkImportDraft } from "~/server/domain/active-work-import/service";

import {
  IMPORT_NOTICE,
  applyTemplate,
  draftPaymentBalance,
  draftTaxBreakdown,
  installmentBalance,
  inputToCents,
  isRowReady,
  localDateInputValue,
  mapPublicImportAssessment,
  materializeErrorMessage,
  matchingExistingClient,
  newImportDraft,
  normalizedEmail,
  artistShareMessage,
  parseStoredImportDraft,
  postImportSummary,
  quickRowAllocation,
  quickRowDraft,
  quickRowSummary,
  requiresExplicitClientMatch,
  rowDisplayReasons,
  toServerDraftPayload,
  type SetupClientOption,
  type SetupInstallmentOption,
  type StoreTemplateOption,
  type WorkspaceImportRow,
} from "../model";

const defaults = {
  defaultCurrency: "USD",
  defaultTaxMode: "tax_added" as const,
  defaultTaxRatePct: 17,
};

describe("active-work import model", () => {
  it("keeps the producer notice exact", () => {
    expect(IMPORT_NOTICE).toBe("Added by producer from an existing agreement");
  });

  it("keeps a restored server-ready row Needs info until required Service is present", () => {
    const draft = newImportDraft(defaults);
    const serverReady = {
      state: "ready" as const,
      creationDigest: "sha256:ready",
      normalized: {} as never,
    };

    expect(isRowReady(serverReady, draft, [])).toBe(false);
    expect(rowDisplayReasons(serverReady, draft, [])).toContainEqual({
      code: "agreement_service_required",
      field: "agreement.service",
      message: "Add the service from the agreement.",
    });

    draft.agreement.service = "Production and mixing";
    expect(isRowReady(serverReady, draft, [])).toBe(true);
  });

  it("normalizes email exactly like the server and requires an explicit existing-client choice", () => {
    const draft = newImportDraft(defaults);
    draft.client.email = "  MAYA@Example.COM ";
    const clients = [{ id: "client-1", name: "Maya", email: "maya@example.com" }];

    expect(normalizedEmail(draft.client.email)).toBe("maya@example.com");
    expect(matchingExistingClient(draft, clients)?.id).toBe("client-1");
    expect(requiresExplicitClientMatch(draft, clients)).toBe(true);

    draft.client.existingClientId = "client-1";
    expect(requiresExplicitClientMatch(draft, clients)).toBe(false);

    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "model.ts"),
      "utf8",
    );
    expect(source).toContain(".toLowerCase()");
    expect(source).not.toContain("toLocaleLowerCase");
  });

  it("tracks remaining and overpaid money per installment, never at purchase level", () => {
    const schedule = [
      { position: 1, amountCents: 50_000 },
      { position: 2, amountCents: 50_000 },
    ];

    expect(installmentBalance(schedule, [{ installmentPosition: 1, amountCents: 70_000 }])).toEqual(
      { paidCents: 70_000, remainingCents: 50_000, overpaidCents: 20_000 },
    );
    expect(installmentBalance(schedule, [{ installmentPosition: 2, amountCents: 30_000 }])).toEqual(
      { paidCents: 30_000, remainingCents: 70_000, overpaidCents: 0 },
    );
    expect(
      installmentBalance(schedule, [
        { installmentPosition: 1, amountCents: 50_000 },
        { installmentPosition: 2, amountCents: 50_000 },
      ]),
    ).toEqual({ paidCents: 100_000, remainingCents: 0, overpaidCents: 0 });
    expect(installmentBalance(schedule, [{ installmentPosition: 3, amountCents: 1_000 }])).toEqual({
      paidCents: 1_000,
      remainingCents: 100_000,
      overpaidCents: 1_000,
    });

    const draft = newImportDraft({ ...defaults, defaultTaxMode: "tax_free" });
    draft.agreement.subtotal = "1000";
    draft.agreement.planKind = "split_50_50";
    draft.payments = [
      {
        operationKey: "first-half-overpaid",
        installmentPosition: 1,
        amount: "700",
        paidAt: "2026-07-01",
        note: "",
        proofUploadToken: null,
        proofFileName: null,
      },
    ];
    expect(draftPaymentBalance(draft)).toEqual({
      paidCents: 70_000,
      remainingCents: 50_000,
      overpaidCents: 20_000,
    });

    draft.agreement.subtotal = "";
    expect(draftPaymentBalance(draft)).toEqual({
      paidCents: 70_000,
      remainingCents: null,
      overpaidCents: 0,
    });
  });

  it("turns row failure codes into specific sentences with one generic fallback", () => {
    expect(materializeErrorMessage(null)).toBeNull();
    expect(materializeErrorMessage("")).toBeNull();
    expect(materializeErrorMessage("PROOF_UPLOAD_MISSING")).toBe(
      "The payment proof file is no longer available. Attach it again and retry.",
    );
    expect(materializeErrorMessage("PROOF_INVALID")).toBe(
      "The payment proof could not be verified. Attach it again and retry.",
    );
    expect(materializeErrorMessage("OPERATION_KEY_CONFLICT")).toBe(
      "The reviewed details changed. Review this item and try again.",
    );
    expect(materializeErrorMessage("CONFLICT")).toBe(
      "The reviewed details changed. Review this item and try again.",
    );
    expect(materializeErrorMessage("INVALID_INPUT")).toBe(
      "Some details are no longer valid. Review this item and try again.",
    );
    expect(materializeErrorMessage("NOT_FOUND")).toBe(
      "Part of this item could not be found. Review it and try again.",
    );
    expect(materializeErrorMessage("INTEGRITY_ERROR")).toBe(
      "Skitza could not create this item safely. Your saved draft is unchanged.",
    );
    expect(
      materializeErrorMessage("TEMPORARY_FAILURE", "This item was not created. Try again."),
    ).toBe("This item was not created. Try again.");
    expect(materializeErrorMessage("NeonDbError")).toBe(
      "Last create attempt failed. Your saved draft is unchanged.",
    );
    expect(materializeErrorMessage("UNKNOWN", "   ")).toBe(
      "Last create attempt failed. Your saved draft is unchanged.",
    );
  });

  it("uses the local calendar date for date inputs", () => {
    expect(localDateInputValue(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
  });

  it("uses exact integer tax math for added and included tax", () => {
    const added = newImportDraft(defaults);
    added.agreement.subtotal = "100.01";
    added.agreement.taxRatePct = "17";
    expect(draftTaxBreakdown(added)).toEqual({
      subtotalCents: 10_001,
      taxRatePct: 17,
      taxAmountCents: 1_700,
      totalCents: 11_701,
    });

    const included = newImportDraft(defaults);
    included.agreement.taxMode = "tax_included";
    included.agreement.subtotal = "117.00";
    included.agreement.taxRatePct = "17";
    expect(draftTaxBreakdown(included)).toEqual({
      subtotalCents: 11_700,
      taxRatePct: 17,
      taxAmountCents: 1_700,
      totalCents: 11_700,
    });
  });

  it("rejects prices and tax-added totals above the Postgres integer boundary", () => {
    expect(inputToCents("21474836.47")).toBe(2_147_483_647);
    expect(inputToCents("21474836.48")).toBeNull();

    const overflowingTotal = newImportDraft(defaults);
    overflowingTotal.agreement.subtotal = "21474836.47";
    overflowingTotal.agreement.taxRatePct = "100";
    expect(draftTaxBreakdown(overflowingTotal)).toEqual({
      subtotalCents: 2_147_483_647,
      taxRatePct: 100,
      taxAmountCents: null,
      totalCents: null,
    });
  });

  it("round-trips saved drafts without losing in-progress input strings", () => {
    const draft = newImportDraft(defaults);
    draft.client = {
      existingClientId: null,
      name: "Maya",
      email: "maya@example.com",
      phone: "+972 50 555 0123",
    };
    draft.project = { title: "Blue Hour", deadlineAt: "2026-10-05" };
    draft.agreement.subtotal = "1200.";
    draft.agreement.taxRatePct = "17";
    draft.agreement.masterMode = "percentage";
    draft.agreement.masterPercentage = "12.5";

    const restored = parseStoredImportDraft(toServerDraftPayload(draft), defaults);

    expect(restored.client).toEqual(draft.client);
    expect(restored.project).toEqual(draft.project);
    expect(restored.agreement.subtotal).toBe("1200.");
    expect(restored.agreement.masterPercentage).toBe("12.5");
  });

  // SK-270: the wizard's optional "When is the first payment due?" answer has
  // to survive being saved, closed, and reopened, and has to arrive at the
  // server assessment as the same calendar day the producer typed.
  it("round-trips the captured first payment due date all the way to the server", () => {
    const draft = newImportDraft(defaults);
    expect(draft.agreement.firstPaymentDueAt).toBe("");
    draft.client = {
      existingClientId: null,
      name: "Maya",
      email: "maya@example.com",
      phone: "",
    };
    draft.project = { title: "Blue Hour", deadlineAt: "" };
    draft.agreement.name = "EP production";
    draft.agreement.service = "Production and mixing";
    draft.agreement.deliverables = ["4 produced tracks"];
    draft.agreement.rights = ["Artist owns the masters"];
    draft.agreement.subtotal = "1200.00";
    draft.agreement.firstPaymentDueAt = "2026-09-15";

    const saved = toServerDraftPayload(draft);
    expect((saved.agreement as Record<string, unknown>).firstPaymentDueAt).toBe("2026-09-15");

    const reopened = parseStoredImportDraft(saved, defaults);
    expect(reopened.agreement.firstPaymentDueAt).toBe("2026-09-15");

    const assessment = assessActiveWorkImportDraft(toServerDraftPayload(reopened));
    if (assessment.state !== "ready") {
      throw new Error(`Expected a Ready assessment, got ${assessment.reasons[0]?.code ?? "none"}`);
    }
    expect(assessment.normalized.firstPaymentDueDate).toBe("2026-09-15");
  });

  it("round-trips an empty first payment due date as the import day", () => {
    const draft = newImportDraft(defaults);
    draft.client = {
      existingClientId: null,
      name: "Maya",
      email: "maya@example.com",
      phone: "",
    };
    draft.project = { title: "Blue Hour", deadlineAt: "" };
    draft.agreement.name = "EP production";
    draft.agreement.service = "Production and mixing";
    draft.agreement.deliverables = ["4 produced tracks"];
    draft.agreement.rights = ["Artist owns the masters"];
    draft.agreement.subtotal = "1200.00";

    const saved = toServerDraftPayload(draft);
    expect((saved.agreement as Record<string, unknown>).firstPaymentDueAt).toBeNull();
    expect(parseStoredImportDraft(saved, defaults).agreement.firstPaymentDueAt).toBe("");

    const assessment = assessActiveWorkImportDraft(saved);
    if (assessment.state !== "ready") {
      throw new Error(`Expected a Ready assessment, got ${assessment.reasons[0]?.code ?? "none"}`);
    }
    expect(assessment.normalized.firstPaymentDueDate).toBeNull();
  });

  it("round-trips an attached agreement PDF reference and drops a malformed one", () => {
    const draft = newImportDraft(defaults);
    expect(draft.agreement.agreementPdf).toBeNull();
    draft.agreement.agreementPdf = {
      uploadToken: "signed-agreement-token",
      fileName: "deal.pdf",
      sizeBytes: 2_048,
    };

    const payload = toServerDraftPayload(draft);
    expect((payload.agreement as Record<string, unknown>).agreementPdf).toEqual({
      uploadToken: "signed-agreement-token",
      fileName: "deal.pdf",
      sizeBytes: 2_048,
    });
    expect(parseStoredImportDraft(payload, defaults).agreement.agreementPdf).toEqual(
      draft.agreement.agreementPdf,
    );

    const broken = {
      ...payload,
      agreement: { ...(payload.agreement as Record<string, unknown>), agreementPdf: "deal.pdf" },
    };
    expect(parseStoredImportDraft(broken, defaults).agreement.agreementPdf).toBeNull();
  });

  it("shows the attached PDF name and size in a Ready review without its token", () => {
    const base = {
      state: "ready" as const,
      creationDigest: "digest",
      normalized: {
        existingClientId: null,
        templateProductId: null,
        clientName: "Maya",
        clientEmail: "maya@example.com",
        clientPhone: null,
        projectTitle: "Blue Hour",
        deadlineAt: null,
        firstPaymentDueDate: "2026-09-15",
        plan: { kind: "full" as const },
        agreementPdf: { fileName: "deal.pdf", sizeBytes: 2_048 },
        commercialSnapshot: {} as never,
        snapshotDigest: "snapshot",
        schedule: [],
        payments: [],
      },
    };
    const review = mapPublicImportAssessment(base);
    expect(review.state).toBe("ready");
    if (review.state !== "ready") throw new Error("Expected a Ready review");
    expect(review.normalized.agreementPdf).toEqual({ fileName: "deal.pdf", sizeBytes: 2_048 });
    const withoutPdf = mapPublicImportAssessment({
      ...base,
      normalized: { ...base.normalized, agreementPdf: null },
    });
    if (withoutPdf.state !== "ready") throw new Error("Expected a Ready review");
    expect(withoutPdf.normalized.agreementPdf).toBeNull();
  });

  it("copies a Store template into an editable draft without sharing its arrays", () => {
    const draft = newImportDraft(defaults);
    const template: StoreTemplateOption = {
      id: "template-1",
      name: "Album production",
      kind: "album",
      service: "Production",
      deliverables: ["Mixes", "Masters"],
      subtotalCents: 250_000,
      currency: "USD",
      taxMode: "tax_added",
      taxRatePct: 17,
      includedSongSpaces: 8,
      revisionRule: { kind: "fixed", count: 2 },
      royaltyTerms: {
        master: { mode: "percentage", bps: 1_500 },
        composition: {
          mode: "percentage",
          bps: 500,
          role: "composer",
        },
      },
      rights: ["Artist owns the masters"],
      plans: [{ kind: "split_50_50" }],
      agreementText: "Existing agreement text",
      session: {
        limit: { kind: "fixed", count: 4 },
        durationMin: 90,
        locationType: "studio",
        bufferMinutes: 15,
        minLeadHours: 24,
      },
    };

    const next = applyTemplate(draft, template);

    expect(next.agreement).toMatchObject({
      templateProductId: "template-1",
      name: "Album production",
      subtotal: "2500.00",
      masterPercentage: "15",
      compositionPercentage: "5",
      planKind: "split_50_50",
      sessionsMode: "fixed",
      sessionCount: "4",
      sessionDurationMin: "90",
      sessionLocationType: "studio",
      sessionBufferMinutes: "15",
      sessionMinLeadHours: "24",
    });
    expect(next.agreement.deliverables).not.toBe(template.deliverables);
    expect(next.agreement.rights).not.toBe(template.rights);

    const withoutSessions = applyTemplate(draft, { ...template, session: null });
    expect(withoutSessions.agreement.sessionsMode).toBe("none");
    expect(withoutSessions.agreement.sessionCount).toBe("");
  });

  it("round-trips included sessions through the server payload and back", () => {
    const draft = newImportDraft(defaults);
    draft.agreement.sessionsMode = "fixed";
    draft.agreement.sessionCount = "4";
    draft.agreement.sessionDurationMin = "90";
    draft.agreement.sessionBufferMinutes = "15";
    draft.agreement.sessionMinLeadHours = "24";

    const payload = toServerDraftPayload(draft);
    expect((payload.agreement as Record<string, unknown>).session).toEqual({
      limit: { kind: "fixed", count: 4 },
      durationMin: 90,
      locationType: "studio",
      bufferMinutes: 15,
      minLeadHours: 24,
    });

    const restored = parseStoredImportDraft(payload, defaults);
    expect(restored.agreement.sessionsMode).toBe("fixed");
    expect(restored.agreement.sessionCount).toBe("4");
    expect(restored.agreement.sessionDurationMin).toBe("90");
    expect(restored.agreement.sessionBufferMinutes).toBe("15");
    expect(restored.agreement.sessionMinLeadHours).toBe("24");

    draft.agreement.sessionsMode = "unlimited";
    const unlimitedPayload = toServerDraftPayload(draft);
    expect((unlimitedPayload.agreement as Record<string, unknown>).session).toMatchObject({
      limit: { kind: "unlimited" },
    });
    const restoredUnlimited = parseStoredImportDraft(unlimitedPayload, defaults);
    expect(restoredUnlimited.agreement.sessionsMode).toBe("unlimited");

    draft.agreement.sessionsMode = "none";
    const nonePayload = toServerDraftPayload(draft);
    expect((nonePayload.agreement as Record<string, unknown>).session).toBeNull();
    expect(parseStoredImportDraft(nonePayload, defaults).agreement.sessionsMode).toBe("none");
  });
});

const quickTemplate: StoreTemplateOption = {
  id: "template-quick",
  name: "Full production",
  kind: "album",
  service: "Production and mixing",
  deliverables: ["Mixes", "Masters"],
  subtotalCents: 100_000,
  currency: "ILS",
  taxMode: "tax_included",
  taxRatePct: 17,
  includedSongSpaces: 3,
  revisionRule: { kind: "fixed", count: 2 },
  royaltyTerms: null,
  rights: ["Artist owns the masters"],
  plans: [{ kind: "split_50_50" }],
  agreementText: "The agreement we already signed.",
  session: null,
};

const quickInput = {
  artistName: "Noya Levi",
  email: "noya@example.com",
  phone: "+972500000000",
  projectTitle: "Noya EP",
  total: "5000",
  paidSoFar: "2500",
  paidAt: "2026-09-04",
  paymentOperationKey: "active-work-import-payment:fixed-key",
};

describe("quick row", () => {
  it("takes five typed fields and defaults the rest from the product", () => {
    const draft = quickRowDraft(quickInput, quickTemplate, defaults);

    expect(draft.client).toEqual({
      existingClientId: null,
      name: "Noya Levi",
      email: "noya@example.com",
      phone: "+972500000000",
    });
    expect(draft.project.title).toBe("Noya EP");
    // Everything below was proposed by the product, not typed.
    expect(draft.agreement).toMatchObject({
      templateProductId: "template-quick",
      name: "Full production",
      service: "Production and mixing",
      currency: "ILS",
      taxMode: "tax_included",
      taxRatePct: "17",
      includedSongSpaces: "3",
      planKind: "split_50_50",
      agreementText: "The agreement we already signed.",
      rights: ["Artist owns the masters"],
    });
    // The typed total wins over the product's own price.
    expect(draftTaxBreakdown(draft).totalCents).toBe(500_000);
  });

  it("derives the stored subtotal backwards for each tax mode", () => {
    const included = quickRowDraft(quickInput, quickTemplate, defaults);
    // tax_included: the typed number already IS the total, tax sits inside it.
    expect(draftTaxBreakdown(included)).toMatchObject({
      subtotalCents: 500_000,
      taxAmountCents: 72_650,
      totalCents: 500_000,
    });

    const added = quickRowDraft(
      quickInput,
      { ...quickTemplate, taxMode: "tax_added" },
      defaults,
    );
    // tax_added: 427,350 + 17% = exactly the 500,000 the producer typed.
    expect(draftTaxBreakdown(added)).toMatchObject({
      subtotalCents: 427_350,
      taxAmountCents: 72_650,
      totalCents: 500_000,
    });

    const free = quickRowDraft(quickInput, { ...quickTemplate, taxMode: "tax_free" }, defaults);
    expect(draftTaxBreakdown(free)).toMatchObject({
      subtotalCents: 500_000,
      taxAmountCents: 0,
      totalCents: 500_000,
    });
  });

  it("records paid-so-far as one confirmed payment on the first installment", () => {
    const draft = quickRowDraft(quickInput, quickTemplate, defaults);
    expect(draft.payments).toEqual([
      {
        operationKey: "active-work-import-payment:fixed-key",
        installmentPosition: 1,
        amount: "2500.00",
        paidAt: "2026-09-04",
        note: "",
        proofUploadToken: null,
        proofFileName: null,
      },
    ]);
    expect(quickRowAllocation(draft).kind).toBe("ok");
  });

  it("records no payment at all when nothing has been paid", () => {
    const draft = quickRowDraft({ ...quickInput, paidSoFar: "" }, quickTemplate, defaults);
    expect(draft.payments).toEqual([]);
    expect(quickRowAllocation(draft).kind).toBe("ok");
  });

  it("sends paid-so-far past the first installment to Needs info instead of splitting it", () => {
    // 50/50 on ₪5,000 makes each half ₪2,500. ₪3,000 cannot belong to one
    // installment, and quick mode never splits a payment on its own.
    const draft = quickRowDraft({ ...quickInput, paidSoFar: "3000" }, quickTemplate, defaults);
    const allocation = quickRowAllocation(draft);
    expect(allocation.kind).toBe("needs_split");
    expect(allocation.kind === "needs_split" && allocation.reason).toEqual({
      code: "payment_needs_single_installment",
      field: "payments",
      message: "Payment must be assigned to one installment. Open Change details to split it.",
    });
  });

  it("leaves a genuine overpayment alone when there is only one installment", () => {
    // Paid in full means one installment, so more than the total is a real
    // overpayment and stays Overpaid, exactly as the full editor shows it.
    const draft = quickRowDraft(
      { ...quickInput, paidSoFar: "6000" },
      { ...quickTemplate, plans: [{ kind: "full" }] },
      defaults,
    );
    expect(quickRowAllocation(draft).kind).toBe("ok");
    expect(draftPaymentBalance(draft).overpaidCents).toBe(100_000);
  });

  it("writes the one-line summary the producer confirms", () => {
    const summary = quickRowSummary(quickRowDraft(quickInput, quickTemplate, defaults));
    expect(summary?.parts).toEqual([
      "Full production",
      "₪5,000 incl. 17% tax",
      "50/50",
      "3 songs",
      "Noya has paid ₪2,500",
    ]);
    expect(summary?.question).toBe("Is this the deal with Noya?");
  });

  it("drops the paid clause from the summary when nothing has been paid", () => {
    const summary = quickRowSummary(
      quickRowDraft({ ...quickInput, paidSoFar: "" }, quickTemplate, defaults),
    );
    expect(summary?.parts).toEqual([
      "Full production",
      "₪5,000 incl. 17% tax",
      "50/50",
      "3 songs",
    ]);
  });

  it("says so when rounding cannot land on the typed total exactly", () => {
    // ₪1.00 at 17% added on top has no subtotal behind it.
    const draft = quickRowDraft(
      { ...quickInput, total: "1", paidSoFar: "" },
      { ...quickTemplate, taxMode: "tax_added" },
      defaults,
    );
    const summary = quickRowSummary(draft, "1");
    expect(draftTaxBreakdown(draft).totalCents).toBe(99);
    expect(summary?.roundedFromTypedTotal).toBe(true);
    // A total that lands exactly never claims it was moved.
    expect(
      quickRowSummary(quickRowDraft(quickInput, quickTemplate, defaults), "5000")
        ?.roundedFromTypedTotal,
    ).toBe(false);
  });

  it("has no summary until the money makes sense", () => {
    expect(quickRowSummary(quickRowDraft({ ...quickInput, total: "" }, quickTemplate, defaults)))
      .toBeNull();
  });
});

function createdRow(rowId: string, clientContactId: string): WorkspaceImportRow {
  return {
    rowId,
    operationKey: `op-${rowId}`,
    revision: 1,
    draft: newImportDraft(defaults),
    assessment: null,
    materializedAtIso: "2026-09-04T10:00:00.000Z",
    createdClientContactId: clientContactId,
    createdProjectId: `project-${rowId}`,
    createdPurchaseId: `purchase-${rowId}`,
    saveState: "idle",
    saveError: null,
    materializeError: null,
    localVersion: 0,
    persistedLocalVersion: 0,
  };
}

function installment(
  input: Partial<SetupInstallmentOption> & { rowId: string },
): SetupInstallmentOption {
  return {
    id: `installment-${input.rowId}-${String(input.position ?? 1)}`,
    projectId: `project-${input.rowId}`,
    purchaseId: `purchase-${input.rowId}`,
    projectTitle: "Noya EP",
    agreementName: "Full production",
    position: 1,
    amountCents: 250_000,
    remainingCents: 250_000,
    currency: "ILS",
    dueTrigger: "producer_import",
    dueAtIso: "2026-10-15T00:00:00.000Z",
    triggeredAtIso: null,
    status: "not_paid",
    remindersEnabled: true,
    reminderEligible: true,
    reminderWaitingForDueDate: false,
    ...input,
  };
}

function setupClient(id: string, name: string): SetupClientOption {
  return {
    id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    connected: false,
    providerAcceptedAtIso: null,
    invitationEligible: true,
    invitationState: "available",
  };
}

describe("what the producer sees right after the import", () => {
  it("adds up only what is still owed, per currency", () => {
    const summary = postImportSummary({
      rows: [createdRow("row-1", "client-1"), createdRow("row-2", "client-2")],
      installments: [
        installment({ rowId: "row-1", remainingCents: 250_000 }),
        // Already settled by the paid-so-far the producer confirmed.
        installment({ rowId: "row-1", position: 2, remainingCents: 0 }),
        installment({ rowId: "row-2", currency: "USD", remainingCents: 100_000 }),
      ],
      clients: [setupClient("client-1", "Noya"), setupClient("client-2", "Amit")],
    });

    expect(summary.owed).toEqual([
      { currency: "ILS", cents: 250_000 },
      { currency: "USD", cents: 100_000 },
    ]);
  });

  it("finds the soonest payment still coming", () => {
    const summary = postImportSummary({
      rows: [createdRow("row-1", "client-1"), createdRow("row-2", "client-2")],
      installments: [
        installment({ rowId: "row-1", dueAtIso: "2026-11-01T00:00:00.000Z" }),
        installment({ rowId: "row-2", dueAtIso: "2026-09-20T00:00:00.000Z" }),
      ],
      clients: [setupClient("client-1", "Noya"), setupClient("client-2", "Amit")],
    });

    expect(summary.nextDueAtIso).toBe("2026-09-20T00:00:00.000Z");
  });

  it("joins money to the right artist through the created row", () => {
    const summary = postImportSummary({
      rows: [createdRow("row-1", "client-1"), createdRow("row-2", "client-2")],
      installments: [
        installment({ rowId: "row-2", remainingCents: 90_000, projectTitle: "Amit single" }),
      ],
      clients: [setupClient("client-1", "Noya"), setupClient("client-2", "Amit")],
    });

    expect(summary.artists).toEqual([
      {
        clientContactId: "client-1",
        name: "Noya",
        projectTitles: [],
        owed: [],
        nextDueAtIso: null,
        reminderArmed: false,
      },
      {
        clientContactId: "client-2",
        name: "Amit",
        projectTitles: ["Amit single"],
        owed: [{ currency: "ILS", cents: 90_000 }],
        nextDueAtIso: "2026-10-15T00:00:00.000Z",
        reminderArmed: true,
      },
    ]);
  });

  it("never claims a reminder is armed without a due date behind it", () => {
    const summary = postImportSummary({
      rows: [createdRow("row-1", "client-1")],
      installments: [
        installment({ rowId: "row-1", remindersEnabled: true, dueAtIso: null }),
      ],
      clients: [setupClient("client-1", "Noya")],
    });

    expect(summary.artists[0]?.reminderArmed).toBe(false);
  });

  it("ignores rows that were never created", () => {
    const uncreated = { ...createdRow("row-1", "client-1"), materializedAtIso: null };
    const summary = postImportSummary({
      rows: [uncreated],
      installments: [installment({ rowId: "row-1" })],
      clients: [setupClient("client-1", "Noya")],
    });

    expect(summary.artists).toEqual([]);
    expect(summary.owed).toEqual([]);
  });

  it("writes a message an artist would actually read", () => {
    expect(
      artistShareMessage({
        artistName: "Noya Levi",
        projectTitle: "Noya EP",
        producerName: "Gili",
        url: "https://skitza.app/sign-up/join/gili/home",
      }),
    ).toBe(
      "Hi Noya, I moved our work on Noya EP into Skitza. You can hear the songs, see what's " +
        "paid and what's left, and book sessions in one place: " +
        "https://skitza.app/sign-up/join/gili/home — Gili",
    );
    // Never the old placeholder.
    expect(
      artistShareMessage({
        artistName: "",
        projectTitle: "",
        producerName: "",
        url: "https://skitza.app/x",
      }),
    ).not.toContain("Join me on Skitza");
  });
});
