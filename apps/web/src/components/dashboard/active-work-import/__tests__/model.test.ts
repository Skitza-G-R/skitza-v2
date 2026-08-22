import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  IMPORT_NOTICE,
  applyTemplate,
  draftPaymentBalance,
  draftTaxBreakdown,
  installmentBalance,
  inputToCents,
  isRowReady,
  localDateInputValue,
  matchingExistingClient,
  newImportDraft,
  normalizedEmail,
  parseStoredImportDraft,
  requiresExplicitClientMatch,
  rowDisplayReasons,
  toServerDraftPayload,
  type StoreTemplateOption,
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
    };

    const next = applyTemplate(draft, template);

    expect(next.agreement).toMatchObject({
      templateProductId: "template-1",
      name: "Album production",
      subtotal: "2500.00",
      masterPercentage: "15",
      compositionPercentage: "5",
      planKind: "split_50_50",
    });
    expect(next.agreement.deliverables).not.toBe(template.deliverables);
    expect(next.agreement.rights).not.toBe(template.rights);
  });
});
