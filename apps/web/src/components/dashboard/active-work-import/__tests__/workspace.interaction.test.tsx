// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveWorkImportWorkspace } from "../active-work-import-workspace";
import {
  newImportDraft,
  toServerDraftPayload,
  type ImportAssessmentView,
  type InitialImportBatch,
  type SetupOptionsView,
} from "../model";

type ImportActions =
  typeof import("~/app/(producer)/dashboard/clients-projects/bring-active-work/actions");

const mocks = vi.hoisted(() => ({
  createBatch: vi.fn<ImportActions["createImportBatchAction"]>(),
  deleteRow: vi.fn<ImportActions["deleteImportRowAction"]>(),
  finishSetup: vi.fn<ImportActions["finishImportSetupAction"]>(),
  loadRows: vi.fn<ImportActions["loadImportBatchRowsAction"]>(),
  loadSetup: vi.fn<ImportActions["loadImportSetupOptionsAction"]>(),
  materializeRows: vi.fn<ImportActions["materializeImportRowsAction"]>(),
  prepareAgreementPdf: vi.fn<ImportActions["prepareImportAgreementPdfAction"]>(),
  prepareProof: vi.fn<ImportActions["prepareImportProofAction"]>(),
  restoreClient: vi.fn<ImportActions["restoreImportClientAction"]>(),
  saveRow: vi.fn<ImportActions["saveImportRowAction"]>(),
  push: vi.fn<(href: string) => void>(),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/bring-active-work/actions", () => ({
  createImportBatchAction: mocks.createBatch,
  deleteImportRowAction: mocks.deleteRow,
  finishImportSetupAction: mocks.finishSetup,
  loadImportBatchRowsAction: mocks.loadRows,
  loadImportSetupOptionsAction: mocks.loadSetup,
  materializeImportRowsAction: mocks.materializeRows,
  prepareImportAgreementPdfAction: mocks.prepareAgreementPdf,
  prepareImportProofAction: mocks.prepareProof,
  restoreImportClientAction: mocks.restoreClient,
  saveImportRowAction: mocks.saveRow,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const batchId = "00000000-0000-4000-8000-000000000254";
const rowId = "00000000-0000-4000-8000-000000000255";
const sharedSecondRowId = "00000000-0000-4000-8000-000000000258";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function readyAssessment(creationDigest: string): ImportAssessmentView {
  return {
    state: "ready",
    creationDigest,
    normalized: {
      existingClientId: null,
      templateProductId: null,
      clientName: "Maya",
      clientEmail: "maya@example.com",
      clientPhone: null,
      projectTitle: "Blue Hour",
      deadlineAtIso: null,
      firstPaymentDueDate: null,
      agreementPdf: null,
      plan: { kind: "full" },
      commercialSnapshot: {
        version: 2,
        bookingEnabled: false,
        productOrOfferName: "Production agreement",
        deliverables: ["Final mixes"],
        lineItems: [
          {
            label: "Production agreement",
            quantity: 1,
            listUnitPriceCents: 100_000,
            unitPriceCents: 100_000,
            totalCents: 100_000,
          },
        ],
        listSubtotalCents: 100_000,
        discountCents: 0,
        subtotalCents: 100_000,
        tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
        totalCents: 100_000,
        currency: "USD",
        includedSongSpaces: 1,
        session: null,
        revisionRule: null,
        royaltyTerms: null,
        rights: ["Artist owns the masters"],
        selectedPaymentPlan: { kind: "full" },
        offeredPaymentPlans: [{ kind: "full" }],
        agreementText: "Existing agreement terms",
        agreementMode: "text",
      },
      snapshotDigest: "snapshot-v1",
      schedule: [
        {
          sequence: 1,
          amountCents: 100_000,
          trigger: "producer_import",
          status: "not_paid",
        },
      ],
      payments: [],
    },
  };
}

function detailedAssessment(): ImportAssessmentView {
  const base = readyAssessment("ready-detailed");
  if (base.state !== "ready") throw new Error("Detailed assessment must be ready");
  return {
    ...base,
    normalized: {
      ...base.normalized,
      existingClientId: "client-existing",
      clientPhone: "+972 50 123 4567",
      deadlineAtIso: "2026-09-15T23:30:00.000Z",
      plan: { kind: "split_50_50" },
      commercialSnapshot: {
        ...base.normalized.commercialSnapshot,
        tax: { mode: "tax_added", ratePct: 17, amountCents: 17_000 },
        totalCents: 117_000,
        includedSongSpaces: 3,
        revisionRule: { kind: "fixed", count: 2 },
        royaltyTerms: {
          master: { mode: "percentage", bps: 1_250 },
          composition: {
            mode: "percentage",
            bps: 500,
            role: "composer",
            collectingSociety: "ASCAP",
          },
          notes: "Producer share follows the existing agreement.",
        },
        selectedPaymentPlan: { kind: "split_50_50" },
        offeredPaymentPlans: [{ kind: "split_50_50" }],
      },
      schedule: [
        {
          sequence: 1,
          amountCents: 58_500,
          trigger: "producer_import",
          status: "partially_paid",
        },
        {
          sequence: 2,
          amountCents: 58_500,
          trigger: "artist_approval",
          status: "not_paid",
        },
      ],
      payments: [
        {
          operationKey: "history-one",
          installmentPosition: 1,
          amountCents: 30_000,
          paidAtIso: "2026-07-01T00:00:00.000Z",
          note: "Bank transfer",
          hasProof: true,
        },
        {
          operationKey: "history-two",
          installmentPosition: 1,
          amountCents: 20_000,
          paidAtIso: "2026-07-03T00:00:00.000Z",
          note: null,
          hasProof: false,
        },
      ],
    },
  };
}

function initialBatch(
  assessment: ImportAssessmentView = readyAssessment("ready-v1"),
): InitialImportBatch {
  const draft = newImportDraft({
    defaultCurrency: "USD",
    defaultTaxMode: "tax_free",
    defaultTaxRatePct: 0,
  });
  draft.client = {
    existingClientId: null,
    name: "Maya",
    email: "maya@example.com",
    phone: "",
  };
  draft.project.title = "Blue Hour";
  draft.agreement.service = "Production";
  draft.agreement.subtotal = "1000";
  return {
    id: batchId,
    status: "in_progress",
    rows: [
      {
        row: {
          id: rowId,
          operationKey: "row-operation",
          draftRevision: 1,
          draftPayload: toServerDraftPayload(draft),
          materializedAtIso: null,
          createdClientContactId: null,
          createdProjectId: null,
          createdPurchaseId: null,
          lastErrorCode: null,
        },
        assessment,
      },
    ],
  };
}

function detailedBatch(): InitialImportBatch {
  const batch = initialBatch(detailedAssessment());
  const first = batch.rows[0];
  if (!first) throw new Error("Test batch needs one row");
  const draft = newImportDraft({
    defaultCurrency: "USD",
    defaultTaxMode: "tax_added",
    defaultTaxRatePct: 17,
  });
  draft.client = {
    existingClientId: "client-existing",
    name: "Maya",
    email: "maya@example.com",
    phone: "+972 50 123 4567",
  };
  draft.project.title = "Blue Hour";
  draft.agreement.service = "Production";
  draft.payments = [
    {
      operationKey: "history-one",
      installmentPosition: 1,
      amount: "300",
      paidAt: "2026-07-01",
      note: "Bank transfer",
      proofUploadToken: "server-only-proof-token",
      proofFileName: "bank-transfer.pdf",
    },
    {
      operationKey: "history-two",
      installmentPosition: 1,
      amount: "200",
      paidAt: "2026-07-03",
      note: "",
      proofUploadToken: null,
      proofFileName: null,
    },
  ];
  return {
    ...batch,
    rows: [
      {
        ...first,
        row: { ...first.row, draftPayload: toServerDraftPayload(draft) },
      },
    ],
  };
}

function paymentDateTruthBatch(
  input: { draftAmount?: string; normalizedAmountCents?: number } = {},
): InitialImportBatch {
  const batch = initialBatch();
  const first = batch.rows[0];
  if (!first) throw new Error("Test batch needs one row");
  const assessment = readyAssessment("ready-payment-date-truth");
  if (assessment.state !== "ready") throw new Error("Test assessment must be ready");
  const draft = newImportDraft({
    defaultCurrency: "USD",
    defaultTaxMode: "tax_free",
    defaultTaxRatePct: 0,
  });
  draft.client = {
    existingClientId: null,
    name: "Maya",
    email: "maya@example.com",
    phone: "",
  };
  draft.project.title = "Blue Hour";
  draft.agreement.service = "Production";
  draft.payments = [
    {
      operationKey: "payment-date-truth",
      installmentPosition: 1,
      amount: input.draftAmount ?? "100",
      paidAt: "2026-08-20",
      note: "",
      proofUploadToken: null,
      proofFileName: null,
    },
  ];

  return {
    ...batch,
    rows: [
      {
        row: { ...first.row, draftPayload: toServerDraftPayload(draft) },
        assessment: {
          ...assessment,
          normalized: {
            ...assessment.normalized,
            payments: [
              {
                operationKey: "payment-date-truth",
                installmentPosition: 1,
                amountCents: input.normalizedAmountCents ?? 10_000,
                paidAtIso: "2026-08-19T21:00:00.000Z",
                note: null,
                hasProof: false,
              },
            ],
          },
        },
      },
    ],
  };
}

function mixedReadinessBatch(): InitialImportBatch {
  const base = initialBatch();
  const first = base.rows[0];
  if (!first) throw new Error("Test batch needs one row");
  const makeDraft = (name: string, email: string, projectTitle: string) => {
    const draft = newImportDraft({
      defaultCurrency: "USD",
      defaultTaxMode: "tax_free",
      defaultTaxRatePct: 0,
    });
    draft.client = { existingClientId: null, name, email, phone: "" };
    draft.project.title = projectTitle;
    draft.agreement.service = "Production";
    return draft;
  };
  return {
    ...base,
    rows: [
      {
        row: {
          ...first.row,
          operationKey: "row-valid",
          draftPayload: toServerDraftPayload(
            makeDraft("Valid new client", "valid@example.com", "Valid project"),
          ),
        },
        assessment: readyAssessment("digest-valid"),
      },
      {
        row: {
          ...first.row,
          id: "00000000-0000-4000-8000-000000000256",
          operationKey: "row-active-match",
          draftPayload: toServerDraftPayload(
            makeDraft("Active match", "active@example.com", "Active match project"),
          ),
        },
        assessment: readyAssessment("digest-active-match"),
      },
      {
        row: {
          ...first.row,
          id: "00000000-0000-4000-8000-000000000257",
          operationKey: "row-archived-match",
          draftPayload: toServerDraftPayload(
            makeDraft("Archived match", "archived@example.com", "Archived match project"),
          ),
        },
        assessment: readyAssessment("digest-archived-match"),
      },
    ],
  };
}

function sharedNewClientBatch(): InitialImportBatch {
  const base = initialBatch();
  const first = base.rows[0];
  if (!first) throw new Error("Test batch needs one row");
  const makeDraft = (projectTitle: string) => {
    const draft = newImportDraft({
      defaultCurrency: "USD",
      defaultTaxMode: "tax_free",
      defaultTaxRatePct: 0,
    });
    draft.client = {
      existingClientId: null,
      name: "Shared client",
      email: "shared@example.com",
      phone: "",
    };
    draft.project.title = projectTitle;
    draft.agreement.service = "Production";
    return draft;
  };

  return {
    ...base,
    rows: [
      {
        row: {
          ...first.row,
          operationKey: "row-shared-one",
          draftPayload: toServerDraftPayload(makeDraft("First shared project")),
        },
        assessment: readyAssessment("digest-shared-one"),
      },
      {
        row: {
          ...first.row,
          id: sharedSecondRowId,
          operationKey: "row-shared-two",
          draftPayload: toServerDraftPayload(makeDraft("Second shared project")),
        },
        assessment: readyAssessment("digest-shared-two"),
      },
    ],
  };
}

function createdBatch(): InitialImportBatch {
  const batch = initialBatch();
  const first = batch.rows[0];
  if (!first) throw new Error("Test batch needs one row");
  return {
    ...batch,
    rows: [
      {
        row: {
          ...first.row,
          materializedAtIso: "2026-08-20T09:00:00.000Z",
          createdClientContactId: "client-created",
          createdProjectId: "project-created",
          createdPurchaseId: "purchase-created",
        },
        assessment: null,
      },
    ],
  };
}

function setupOptions(setupDigest = "setup-v1"): SetupOptionsView {
  return {
    setupDigest,
    distinctClientCount: 2,
    projectPurchaseCount: 1,
    clients: [
      {
        id: "client-retry",
        name: "Retry client",
        email: "retry@example.com",
        connected: false,
        providerAcceptedAtIso: null,
        invitationEligible: true,
        invitationState: "send_in_progress_or_retryable",
      },
      {
        id: "client-sent",
        name: "Sent client",
        email: "sent@example.com",
        connected: false,
        providerAcceptedAtIso: "2026-08-20T09:01:00.000Z",
        invitationEligible: false,
        invitationState: "provider_accepted",
      },
    ],
    installments: [
      {
        id: "installment-1",
        rowId,
        projectId: "project-created",
        purchaseId: "purchase-created",
        projectTitle: "Blue Hour",
        agreementName: "Production agreement",
        position: 1,
        amountCents: 100_000,
        remainingCents: 100_000,
        currency: "USD",
        dueTrigger: "producer_import",
        dueAtIso: "2026-08-20T09:00:00.000Z",
        triggeredAtIso: "2026-08-20T09:00:00.000Z",
        status: "pending",
        remindersEnabled: false,
        reminderEligible: true,
        reminderWaitingForDueDate: false,
      },
    ],
  };
}

function freshSetupOptions(
  input: { dueTrigger?: "producer_import" | "artist_approval" } = {},
): SetupOptionsView {
  const base = setupOptions("setup-fresh");
  const installment = base.installments[0];
  if (!installment) throw new Error("Test setup needs one installment");
  return {
    ...base,
    distinctClientCount: 1,
    clients: [
      {
        id: "client-available",
        name: "Available client",
        email: "available@example.com",
        connected: false,
        providerAcceptedAtIso: null,
        invitationEligible: true,
        invitationState: "available",
      },
    ],
    installments: [
      {
        ...installment,
        dueTrigger: input.dueTrigger ?? "producer_import",
      },
    ],
  };
}

function savedResult(
  input: Record<string, unknown>,
  options: {
    revision: number;
    assessment: ImportAssessmentView | null;
    assessmentError?: string | null;
  },
) {
  return {
    ok: true as const,
    data: {
      row: {
        id: rowId,
        operationKey: String(input.rowOperationKey),
        draftRevision: options.revision,
        draftPayload: input.draftPayload as Record<string, unknown>,
        materializedAtIso: null,
        createdClientContactId: null,
        createdProjectId: null,
        createdPurchaseId: null,
        lastErrorCode: null,
      },
      assessment: options.assessment,
      assessmentError: options.assessmentError ?? null,
    },
  };
}

// Review rows start collapsed; open the one whose summary mentions `text`.
function expandReviewRow(text: string) {
  const summary = [...document.querySelectorAll("summary")].find((candidate) =>
    candidate.textContent.includes(text),
  );
  if (!summary) throw new Error(`Expected a Review row mentioning ${text}`);
  fireEvent.click(summary);
}

function renderWorkspace(
  batch: InitialImportBatch | null = initialBatch(),
  options: {
    initialSetupOptions?: SetupOptionsView | null;
    existingClients?: readonly { id: string; name: string; email: string }[];
    archivedClients?: readonly { id: string; name: string; email: string }[];
  } = {},
) {
  return render(
    <ActiveWorkImportWorkspace
      initialBatch={batch}
      initialSetupOptions={options.initialSetupOptions ?? null}
      existingClients={options.existingClients ?? []}
      archivedClients={options.archivedClients ?? []}
      templates={[]}
      defaultCurrency="USD"
      defaultTaxMode="tax_free"
      defaultTaxRatePct={0}
    />,
  );
}

beforeEach(() => {
  installMatchMedia(false);
  mocks.createBatch.mockReset();
  mocks.deleteRow.mockReset().mockResolvedValue({ ok: true, data: { deleted: true } });
  mocks.finishSetup.mockReset().mockResolvedValue({
    ok: true,
    data: {
      distinctClientCount: 0,
      projectPurchaseCount: 1,
      invitations: [],
      reminders: [],
      batch: { completed: true, unfinishedDraftCount: 0 },
    },
  });
  mocks.loadRows.mockReset().mockResolvedValue({ ok: true, data: { rows: [] } });
  mocks.loadSetup.mockReset().mockResolvedValue({ ok: true, data: setupOptions() });
  mocks.materializeRows.mockReset();
  mocks.prepareAgreementPdf.mockReset();
  mocks.prepareProof.mockReset();
  mocks.restoreClient
    .mockReset()
    .mockResolvedValue({ ok: true, data: { id: "client-archived", changed: true } });
  mocks.saveRow.mockReset();
  mocks.push.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ActiveWorkImportWorkspace three-step item flow", () => {
  it("opens quietly with the exact step order and renders only one step", () => {
    renderWorkspace(
      initialBatch({
        state: "needs_info",
        reasons: [
          { code: "client_name_required", field: "client.name", message: "Add the client name." },
          {
            code: "project_title_required",
            field: "project.title",
            message: "Add the project name.",
          },
        ],
      }),
    );

    const steps = within(screen.getByRole("navigation", { name: "Item steps" })).getAllByRole(
      "button",
    );
    expect(steps.map((step) => step.textContent.replace(/\s+/g, " ").trim())).toEqual([
      "01Client & Project",
      "02Agreement",
      "03Payments",
    ]);
    expect(document.querySelectorAll("[data-active-import-step]")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Client & Project" })).not.toBeNull();
    expect(screen.queryByText("Finish these details")).toBeNull();
    expect(screen.getByLabelText("Project name")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Agreement" })).toBeNull();
    expect(screen.getByLabelText("Import progress").getAttribute("aria-live")).toBe("polite");
  });

  it("keeps Client and Project errors inline and blocks Continue", async () => {
    const user = userEvent.setup();
    renderWorkspace(
      initialBatch({
        state: "needs_info",
        reasons: [
          { code: "client_name_required", field: "client.name", message: "Add the client name." },
          {
            code: "project_title_required",
            field: "project.title",
            message: "Add the project name.",
          },
        ],
      }),
    );

    const clientName = screen.getByLabelText("Client name");
    const projectName = screen.getByLabelText("Project name");
    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    await screen.findByText("Add the client name.");

    expect(screen.getByRole("heading", { name: "Client & Project" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Agreement" })).toBeNull();
    expect(clientName.getAttribute("aria-invalid")).toBe("true");
    expect(projectName.getAttribute("aria-invalid")).toBe("true");
    const clientIssueId = clientName.getAttribute("aria-describedby");
    const projectIssueId = projectName.getAttribute("aria-describedby");
    expect(clientIssueId).not.toBeNull();
    expect(projectIssueId).not.toBeNull();
    expect(document.getElementById(clientIssueId ?? "")?.textContent).toContain(
      "Add the client name.",
    );
    expect(document.getElementById(projectIssueId ?? "")?.textContent).toContain(
      "Add the project name.",
    );
    expect(screen.getByRole("button", { name: "02 Agreement" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("keeps an incomplete Finish item on the exact failing step with inline reasons", async () => {
    const user = userEvent.setup();
    renderWorkspace(
      initialBatch({
        state: "needs_info",
        reasons: [
          {
            code: "payment_date_required",
            field: "payments.history-one.paidAt",
            message: "Add the real payment date.",
          },
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    await screen.findByRole("heading", { name: "Agreement" });
    await user.click(screen.getByRole("button", { name: "01 Client & Project" }));
    expect(screen.getByRole("heading", { name: "Client & Project" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "02 Agreement" }));
    await screen.findByRole("heading", { name: "Agreement" });
    await user.click(screen.getByRole("button", { name: "Continue to payments" }));
    await screen.findByRole("heading", { name: "Payments" });
    await user.click(screen.getByRole("button", { name: "Finish item" }));

    expect(screen.getByRole("heading", { name: "Payments" })).not.toBeNull();
    expect(screen.getByText("Finish these details")).not.toBeNull();
    expect(screen.getByText("Add the real payment date.")).not.toBeNull();
  });

  it("keeps the item's step when the layout switches between desktop and phone", async () => {
    // A resize or browser-zoom across 1024px swaps the desktop pane for the phone
    // dialog (different component instances). The producer must not be sent back
    // to step 1 when that happens.
    const listeners: Array<() => void> = [];
    let matches = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        get matches() {
          return matches;
        },
        media: "(max-width: 1023px)",
        onchange: null,
        addEventListener: (_: string, listener: () => void) => listeners.push(listener),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    await screen.findByRole("heading", { name: "Agreement" });

    act(() => {
      matches = true;
      listeners.forEach((listener) => {
        listener();
      });
    });
    act(() => {
      matches = false;
      listeners.forEach((listener) => {
        listener();
      });
    });

    await screen.findByRole("heading", { name: "Agreement" });
    expect(screen.getByText("Step 2 of 3")).not.toBeNull();
    expect(document.querySelectorAll('[aria-label^="Edit item"]')).toHaveLength(1);
  });

  it("starts at step 1 again after Save for later and reopening the item", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    await screen.findByRole("heading", { name: "Agreement" });
    await user.click(screen.getByRole("button", { name: "Save for later" }));
    await waitFor(() => {
      expect(document.querySelectorAll('[aria-label^="Edit item"]')).toHaveLength(0);
    });

    const list = screen.getByRole("list", { name: "Active work items" });
    await user.click(within(list).getAllByRole("button")[0] as HTMLButtonElement);
    await screen.findByRole("heading", { name: "Client & Project" });
    expect(screen.getByText("Step 1 of 3")).not.toBeNull();
  });

  it("makes Save payment the only primary action while its inline editor is open", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    await screen.findByRole("heading", { name: "Agreement" });
    await user.click(screen.getByRole("button", { name: "Continue to payments" }));
    await screen.findByRole("heading", { name: "Payments" });

    const finish = screen.getByRole("button", { name: "Finish item" });
    expect((finish as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Record first payment" }));
    await screen.findByRole("group", { name: "Edit Payment 1" });

    await waitFor(() => {
      expect((finish as HTMLButtonElement).disabled).toBe(true);
    });
    expect(finish.className).not.toContain("bg-[rgb(var(--brand-primary))]");
    expect(screen.getByRole("button", { name: "Save payment" }).className).toContain(
      "bg-[rgb(var(--brand-primary))]",
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect((finish as HTMLButtonElement).disabled).toBe(false);
    });
    expect(finish.className).toContain("bg-[rgb(var(--brand-primary))]");
  });

  it("keeps a reloaded row at Needs info until its required service is entered", async () => {
    const user = userEvent.setup();
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(
        savedResult(input, {
          revision: 2,
          assessment: readyAssessment("server-ready-without-service-gate"),
        }),
      ),
    );
    const batch = initialBatch();
    const first = batch.rows[0];
    if (!first) throw new Error("Test batch needs one row");
    const agreement = first.row.draftPayload.agreement;
    if (!isRecord(agreement)) throw new Error("Test draft needs agreement details");

    renderWorkspace({
      ...batch,
      rows: [
        {
          ...first,
          row: {
            ...first.row,
            draftPayload: {
              ...first.row.draftPayload,
              agreement: { ...agreement, service: "" },
            },
          },
        },
      ],
    });

    expect(screen.getByLabelText("Import progress").textContent).toContain("0 Ready");
    expect(screen.getByLabelText("Import progress").textContent).toContain("1 Need info");

    await user.click(screen.getByRole("button", { name: "Review 1 item needing info" }));
    const needsInfo = await screen.findByRole("region", { name: "Needs info · 1" });
    expect(within(needsInfo).getByText("Add the service from the agreement.")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to items" }));

    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    expect(await screen.findByRole("heading", { name: "Agreement" })).not.toBeNull();
    expect(screen.getByLabelText("Service")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Continue to payments" }));
    expect(screen.getByRole("heading", { name: "Agreement" })).not.toBeNull();
    expect(screen.getByText("Add the service from the agreement.")).not.toBeNull();
    const service = screen.getByLabelText("Service");
    expect(service.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(service.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("Add the service from the agreement.");

    fireEvent.change(service, {
      target: { value: "Production and mixing" },
    });
    await waitFor(() => {
      expect(mocks.saveRow).toHaveBeenCalledTimes(1);
    });
    // The footer button reads "Saving…" until the save's promise resolves and
    // the row re-renders; on a slow runner that outlives the waitFor above, so
    // wait for the label to come back rather than querying it synchronously.
    await user.click(await screen.findByRole("button", { name: "Continue to payments" }));
    expect(await screen.findByRole("heading", { name: "Payments" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "02 Agreement" }));
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "" } });
    await waitFor(() => {
      expect(mocks.saveRow).toHaveBeenCalledTimes(2);
    });
    await user.click(screen.getByRole("button", { name: "03 Payments" }));
    await user.click(screen.getByRole("button", { name: "Finish item" }));
    expect(screen.getByRole("heading", { name: "Agreement" })).not.toBeNull();
    expect(screen.getByText("Add the service from the agreement.")).not.toBeNull();
  });

  it("keeps compact agreement rows ordered and grows the terms field", async () => {
    const user = userEvent.setup();
    let revision = 1;
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(
        savedResult(input, {
          revision: ++revision,
          assessment: readyAssessment(`compact-agreement-${String(revision)}`),
        }),
      ),
    );
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    await screen.findByRole("heading", { name: "Agreement" });

    const firstDeliverable = screen.getByLabelText("Deliverables 1");
    if (!(firstDeliverable instanceof HTMLInputElement)) {
      throw new Error("Expected a deliverable input.");
    }
    fireEvent.change(firstDeliverable, { target: { value: "Final mixes" } });
    fireEvent.keyDown(firstDeliverable, { key: "Enter" });
    const secondDeliverable = await screen.findByLabelText("Deliverables 2");
    expect(firstDeliverable.value).toBe("Final mixes");
    expect(document.activeElement).toBe(secondDeliverable);

    const terms = screen.getByLabelText("Existing agreement terms (optional)");
    expect(terms.getAttribute("placeholder")).toBe(
      "Paste the terms you already agreed with the Artist, if you have them in writing.",
    );
    Object.defineProperty(terms, "scrollHeight", { configurable: true, value: 196 });
    fireEvent.input(terms, {
      target: { value: "Line one\nLine two\nLine three\nLine four\nLine five" },
    });
    expect(terms.style.height).toBe("196px");
    await waitFor(() => {
      expect(screen.getByLabelText("Import progress").textContent).toContain("1 Ready");
    });
  });

  it("keeps row order stable and opens the next unfinished item after a Ready finish", async () => {
    const user = userEvent.setup();
    renderWorkspace(mixedReadinessBatch(), {
      existingClients: [{ id: "client-active", name: "Active saved", email: "active@example.com" }],
      archivedClients: [
        { id: "client-archived", name: "Archived saved", email: "archived@example.com" },
      ],
    });
    const list = screen.getByRole("list", { name: "Active work items" });
    const before = within(list)
      .getAllByRole("button")
      .map((row) => row.textContent);

    await user.click(screen.getByRole("button", { name: "03 Payments" }));
    await user.click(screen.getByRole("button", { name: "Finish item" }));

    await screen.findByRole("heading", { name: "Active match project" });
    expect(screen.getByRole("heading", { name: "Client & Project" })).not.toBeNull();
    expect(
      within(list)
        .getAllByRole("button")
        .map((row) => row.textContent),
    ).toEqual(before);
  });

  it("Save for later returns to the queue after the current draft is safe", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Save for later" }));

    expect(screen.getByText("Select an item from the queue.")).not.toBeNull();
    expect(screen.getByRole("list", { name: "Active work items" })).not.toBeNull();
  });

  it("puts a full-size Add new client button in the header beside Review", () => {
    renderWorkspace(sharedNewClientBatch());

    const add = screen.getByRole("button", { name: "Add new client" });
    const review = screen.getByRole("button", { name: "Review 2 ready items" });
    expect(add.closest("header")).not.toBeNull();
    expect(add.parentElement).toBe(review.parentElement);
    expect(add.className).toContain("min-h-11");
    expect(add.className).toContain("rounded-[var(--radius-lg)]");
    expect(add.textContent).toContain("Add new client");
    expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();
    expect(
      within(
        screen.getByRole("list", { name: "Active work items" }).closest("section") as HTMLElement,
      ).queryByRole("button", { name: /add/i }),
    ).toBeNull();
  });

  it("leaves nothing selected after removing a just-added item", async () => {
    const user = userEvent.setup();
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(
        savedResult(input, {
          revision: 1,
          assessment: {
            state: "needs_info",
            reasons: [
              { code: "client_name_required", field: "client.name", message: "Add a client name." },
            ],
          },
        }),
      ),
    );
    renderWorkspace(sharedNewClientBatch());
    const list = screen.getByRole("list", { name: "Active work items" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Add new client" }));
    await waitFor(() => {
      expect(within(list).getAllByRole("button")).toHaveLength(3);
    });
    await waitFor(() => {
      const remove = screen.getByRole("button", { name: "Remove this draft" });
      expect((remove as HTMLButtonElement).disabled).toBe(false);
    });

    await user.click(screen.getByRole("button", { name: "Remove this draft" }));

    await waitFor(() => {
      expect(within(list).getAllByRole("button")).toHaveLength(2);
    });
    expect(mocks.deleteRow).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Select an item from the queue.")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Client & Project" })).toBeNull();
    expect(within(list).queryAllByRole("button", { current: "true" })).toHaveLength(0);
  });
});

describe("ActiveWorkImportWorkspace draft safety", () => {
  it("shares one batch request across double Add and saves the empty row immediately", async () => {
    const batchRequest = deferred<{ ok: true; data: { batchId: string } }>();
    mocks.createBatch.mockReturnValue(batchRequest.promise);
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(
        savedResult(input, {
          revision: 1,
          assessment: {
            state: "needs_info",
            reasons: [
              { code: "client_name_required", field: "client.name", message: "Add a client name." },
            ],
          },
        }),
      ),
    );
    renderWorkspace(null);

    const add = screen.getByRole("button", { name: "Add new client" });
    fireEvent.click(add);
    fireEvent.click(add);

    expect(mocks.createBatch).toHaveBeenCalledTimes(1);
    expect((add as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      batchRequest.resolve({ ok: true, data: { batchId } });
      await batchRequest.promise;
    });

    await waitFor(() => {
      expect(mocks.saveRow).toHaveBeenCalledTimes(1);
    });
    const firstSave = mocks.saveRow.mock.calls[0]?.[0];
    if (firstSave === undefined) {
      throw new Error("Expected the new row to be saved.");
    }
    const { client, project } = firstSave.draftPayload;
    if (!isRecord(client) || !isRecord(project)) {
      throw new Error("Expected the saved draft to include client and project details.");
    }
    expect(firstSave.expectedRevision).toBeNull();
    expect(client.name).toBe("");
    expect(project.title).toBe("");
    expect(screen.getByText("1 item")).not.toBeNull();
  });

  it("never shows a Ready digest returned for an older local version", async () => {
    const firstSave = deferred<ReturnType<typeof savedResult>>();
    const secondSave = deferred<ReturnType<typeof savedResult>>();
    mocks.saveRow.mockReturnValueOnce(firstSave.promise).mockReturnValueOnce(secondSave.promise);
    renderWorkspace();

    expect(screen.getByLabelText("Import progress").textContent).toContain("1 Ready");
    const projectName = screen.getByLabelText("Project name");
    fireEvent.change(projectName, { target: { value: "First local title" } });
    expect(screen.getByLabelText("Import progress").textContent).toContain("0 Ready");

    await waitFor(
      () => {
        expect(mocks.saveRow).toHaveBeenCalledTimes(1);
      },
      { timeout: 1_500 },
    );
    fireEvent.change(projectName, { target: { value: "Latest local title" } });

    await act(async () => {
      firstSave.resolve(
        savedResult(mocks.saveRow.mock.calls[0]?.[0] as Record<string, unknown>, {
          revision: 2,
          assessment: readyAssessment("stale-ready-digest"),
        }),
      );
      await firstSave.promise;
    });

    await waitFor(() => {
      expect(mocks.saveRow).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByLabelText("Import progress").textContent).toContain("0 Ready");
    expect(mocks.saveRow.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 2 });

    await act(async () => {
      secondSave.resolve(
        savedResult(mocks.saveRow.mock.calls[1]?.[0] as Record<string, unknown>, {
          revision: 3,
          assessment: {
            state: "needs_info",
            reasons: [
              {
                code: "agreement_name_required",
                field: "agreement.name",
                message: "Add an agreement name.",
              },
            ],
          },
        }),
      );
      await secondSave.promise;
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Import progress").textContent).toContain("1 Need info");
    });
  });

  it("keeps the saved revision after an assessment failure", async () => {
    mocks.saveRow
      .mockImplementationOnce((input: Record<string, unknown>) =>
        Promise.resolve(
          savedResult(input, {
            revision: 2,
            assessment: null,
            assessmentError: "Saved, but not checked yet. Edit or try again.",
          }),
        ),
      )
      .mockImplementationOnce((input: Record<string, unknown>) =>
        Promise.resolve(
          savedResult(input, {
            revision: 3,
            assessment: {
              state: "needs_info",
              reasons: [
                {
                  code: "service_required",
                  field: "agreement.service",
                  message: "Add the service.",
                },
              ],
            },
          }),
        ),
      );
    renderWorkspace();

    const projectName = screen.getByLabelText("Project name");
    fireEvent.change(projectName, { target: { value: "Saved despite check failure" } });
    await waitFor(
      () => {
        expect(screen.getAllByText("Saved, but not checked yet").length).toBeGreaterThan(0);
      },
      { timeout: 1_500 },
    );
    expect(screen.getByTitle("Saved, but not checked yet. Edit or try again.")).not.toBeNull();
    expect(screen.queryByText("Could not save — try again")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(projectName, { target: { value: "Try the check again" } });
    await waitFor(
      () => {
        expect(mocks.saveRow).toHaveBeenCalledTimes(2);
      },
      { timeout: 1_500 },
    );

    expect(mocks.saveRow.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 2 });
  });

  it("adopts the fresh revision and retries once after a stale-revision conflict", async () => {
    const conflict = {
      ok: false as const,
      error: "This draft changed in another save. Refresh and try again.",
      code: "CONFLICT",
    };
    mocks.saveRow
      .mockResolvedValueOnce(conflict)
      .mockImplementationOnce((input: Record<string, unknown>) =>
        Promise.resolve(
          savedResult(input, { revision: 6, assessment: readyAssessment("ready-after-retry") }),
        ),
      );
    mocks.loadRows.mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: rowId,
            operationKey: "row-operation",
            draftRevision: 5,
            draftPayload: {},
            materializedAtIso: null,
            createdClientContactId: null,
            createdProjectId: null,
            createdPurchaseId: null,
            lastErrorCode: null,
          },
        ],
      },
    });
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Edited after a lost response" },
    });

    await waitFor(() => {
      expect(mocks.saveRow).toHaveBeenCalledTimes(2);
    });
    expect(mocks.saveRow.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 1 });
    expect(mocks.saveRow.mock.calls[1]?.[0]).toMatchObject({
      expectedRevision: 5,
      draftPayload: { project: { title: "Edited after a lost response" } },
    });
    expect(mocks.loadRows).toHaveBeenCalledWith({ batchId });
    await waitFor(() => {
      expect(screen.getByLabelText("Import progress").textContent).toContain("1 Ready");
    });
    expect(screen.queryByText("Could not save — try again")).toBeNull();
  });

  it("adopts the server row after a first save that was never acknowledged", async () => {
    mocks.createBatch.mockResolvedValue({ ok: true, data: { batchId } });
    const needsInfo: ImportAssessmentView = {
      state: "needs_info",
      reasons: [{ code: "client_name_required", field: "client.name", message: "Add a name." }],
    };
    mocks.saveRow
      .mockResolvedValueOnce({
        ok: false,
        error: "This draft changed in another save. Refresh and try again.",
        code: "CONFLICT",
      })
      .mockImplementationOnce((input: Record<string, unknown>) =>
        Promise.resolve(savedResult(input, { revision: 1, assessment: needsInfo })),
      );
    // The server already holds the row from the lost first save, under the
    // same operation key the workspace generated.
    mocks.loadRows.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        data: {
          rows: [
            {
              id: rowId,
              operationKey: String(mocks.saveRow.mock.calls[0]?.[0]?.rowOperationKey),
              draftRevision: 1,
              draftPayload: {},
              materializedAtIso: null,
              createdClientContactId: null,
              createdProjectId: null,
              createdPurchaseId: null,
              lastErrorCode: null,
            },
          ],
        },
      }),
    );
    renderWorkspace(null);

    fireEvent.click(screen.getByRole("button", { name: "Add new client" }));

    await waitFor(() => {
      expect(mocks.saveRow).toHaveBeenCalledTimes(2);
    });
    const operationKey = String(mocks.saveRow.mock.calls[0]?.[0]?.rowOperationKey);
    expect(mocks.saveRow.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: null });
    expect(mocks.saveRow.mock.calls[1]?.[0]).toMatchObject({
      rowOperationKey: operationKey,
      expectedRevision: 1,
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Import progress").textContent).toContain("1 Need info");
    });
    expect(screen.queryByText("Could not save — try again")).toBeNull();
  });

  it("stops after one recovery attempt when the conflict persists", async () => {
    mocks.saveRow.mockResolvedValue({
      ok: false,
      error: "This draft changed in another save. Refresh and try again.",
      code: "CONFLICT",
    });
    mocks.loadRows.mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: rowId,
            operationKey: "row-operation",
            draftRevision: 9,
            draftPayload: {},
            materializedAtIso: null,
            createdClientContactId: null,
            createdProjectId: null,
            createdPurchaseId: null,
            lastErrorCode: null,
          },
        ],
      },
    });
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Still conflicting" },
    });

    await screen.findByText("Could not save — try again");
    expect(mocks.saveRow).toHaveBeenCalledTimes(2);
    expect(mocks.loadRows).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain(
      "This draft changed in another save. Refresh and try again.",
    );
  });

  it("blocks Remove and warns before unload while a draft save is pending", async () => {
    const pendingSave = deferred<ReturnType<typeof savedResult>>();
    mocks.saveRow.mockReturnValue(pendingSave.promise);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Unsaved title" },
    });
    const remove = screen.getByRole("button", { name: "Remove this draft" });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(remove);
    expect(window.confirm).not.toHaveBeenCalled();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await waitFor(
      () => {
        expect(mocks.saveRow).toHaveBeenCalledTimes(1);
      },
      { timeout: 1_500 },
    );
    await act(async () => {
      pendingSave.resolve(
        savedResult(mocks.saveRow.mock.calls[0]?.[0] as Record<string, unknown>, {
          revision: 2,
          assessment: readyAssessment("ready-v2"),
        }),
      );
      await pendingSave.promise;
    });
  });

  it("flushes a pending draft before in-app Back navigation", async () => {
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(
        savedResult(input, {
          revision: 2,
          assessment: readyAssessment("ready-v2"),
        }),
      ),
    );
    const user = userEvent.setup();
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Save before leaving" },
    });
    await user.click(screen.getByRole("button", { name: "Clients & Projects" }));

    await waitFor(() => {
      expect(mocks.saveRow).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/dashboard/clients-projects");
    });
  });

  it("starts a durable save before an immediate SPA unmount can cancel the draft", async () => {
    const pendingSave = deferred<ReturnType<typeof savedResult>>();
    mocks.saveRow.mockReturnValue(pendingSave.promise);
    const view = renderWorkspace();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Save before sidebar navigation" },
    });

    expect(mocks.saveRow).toHaveBeenCalledTimes(1);
    expect(mocks.saveRow.mock.calls[0]?.[0]?.draftPayload).toMatchObject({
      project: { title: "Save before sidebar navigation" },
    });
    view.unmount();

    await act(async () => {
      pendingSave.resolve(
        savedResult(mocks.saveRow.mock.calls[0]?.[0] as Record<string, unknown>, {
          revision: 2,
          assessment: readyAssessment("saved-before-unmount"),
        }),
      );
      await pendingSave.promise;
    });
  });
});

describe("ActiveWorkImportWorkspace client restore", () => {
  it("requires an explicit restore for an archived email and then saves the existing client id", async () => {
    const draft = newImportDraft({
      defaultCurrency: "USD",
      defaultTaxMode: "tax_free",
      defaultTaxRatePct: 0,
    });
    draft.client = {
      existingClientId: null,
      name: "Maya draft name",
      email: "MAYA@example.com",
      phone: "+972 50 555 0101",
    };
    draft.project.title = "Keep this project";
    draft.agreement.service = "Production";
    const base = initialBatch();
    const first = base.rows[0];
    if (!first) throw new Error("Test batch needs one row");
    const batch: InitialImportBatch = {
      ...base,
      rows: [
        {
          row: { ...first.row, draftPayload: toServerDraftPayload(draft) },
          assessment: first.assessment,
        },
      ],
    };
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(
        savedResult(input, {
          revision: 2,
          assessment: readyAssessment("restored-ready"),
        }),
      ),
    );

    renderWorkspace(batch, {
      archivedClients: [{ id: "client-archived", name: "Maya saved", email: "maya@example.com" }],
    });

    expect(mocks.restoreClient).not.toHaveBeenCalled();
    expect(screen.getByText("Maya saved is archived")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore client" }));

    await waitFor(() => {
      expect(mocks.restoreClient).toHaveBeenCalledWith({ id: "client-archived" });
    });
    await waitFor(() => {
      expect(screen.queryByText("Maya saved is archived")).toBeNull();
    });
    await waitFor(
      () => {
        expect(mocks.saveRow).toHaveBeenCalledTimes(1);
      },
      { timeout: 1_500 },
    );

    const savedDraft = mocks.saveRow.mock.calls[0]?.[0]?.draftPayload as {
      client: { existingClientId: string | null; phone: string };
      project: { title: string };
    };
    expect(savedDraft.client).toMatchObject({
      existingClientId: "client-archived",
      phone: "+972 50 555 0101",
    });
    expect(savedDraft.project.title).toBe("Keep this project");
  });
});

describe("ActiveWorkImportWorkspace frozen review and creation", () => {
  it("opens Review when every item needs info and lists every exact reason", async () => {
    const user = userEvent.setup();
    renderWorkspace(
      initialBatch({
        state: "needs_info",
        reasons: [
          {
            code: "client_email_required",
            field: "client.email",
            message: "Add a valid client email.",
          },
          {
            code: "agreement_name_required",
            field: "agreement.name",
            message: "Add a name for the agreement.",
          },
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Review 1 item needing info" }));

    expect(await screen.findByRole("heading", { name: "Review what needs info" })).not.toBeNull();
    const needsInfo = screen.getByRole("region", { name: "Needs info · 1" });
    const item = within(needsInfo).getByRole("article", { name: "Item 1 needs info" });
    fireEvent.click(within(item).getByText("01").closest("summary") as HTMLElement);
    expect(
      within(item)
        .getAllByRole("listitem")
        .map((reason) => reason.textContent),
    ).toEqual(["Add a valid client email.", "Add a name for the agreement."]);
    expect(screen.queryByRole("button", { name: /^Create / })).toBeNull();
    const back = screen.getByRole("button", { name: "Back to items" });
    expect(back.className).toContain("bg-[rgb(var(--brand-primary))]");
  });

  it.each([
    {
      name: "an unconfirmed active client match",
      clientOptions: {
        existingClients: [{ id: "client-active", name: "Maya saved", email: "maya@example.com" }],
      },
      effectiveReason: {
        code: "existing_client_reuse_required",
        field: "client.existingClientId",
        message: "This email already belongs to a client. Choose Use existing client.",
      },
    },
    {
      name: "an archived client match",
      clientOptions: {
        archivedClients: [
          { id: "client-archived", name: "Maya archived", email: "maya@example.com" },
        ],
      },
      effectiveReason: {
        code: "existing_client_archived",
        field: "client.existingClientId",
        message: "Restore this client in Clients & Projects before adding active work.",
      },
    },
  ])(
    "merges $name with every server reason in Review",
    async ({ clientOptions, effectiveReason }) => {
      const user = userEvent.setup();
      renderWorkspace(
        initialBatch({
          state: "needs_info",
          reasons: [
            {
              code: "project_title_required",
              field: "project.title",
              message: "Add the project name.",
            },
            effectiveReason,
            {
              code: "agreement_service_required",
              field: "agreement.service",
              message: "Add the service from the agreement.",
            },
          ],
        }),
        clientOptions,
      );

      await user.click(screen.getByRole("button", { name: "Review 1 item needing info" }));

      const needsInfo = await screen.findByRole("region", { name: "Needs info · 1" });
      const item = within(needsInfo).getByRole("article", { name: "Item 1 needs info" });
      fireEvent.click(within(item).getByText("01").closest("summary") as HTMLElement);
      expect(
        within(item)
          .getAllByRole("listitem")
          .map((reason) => reason.textContent),
      ).toEqual([
        effectiveReason.message,
        "Add the project name.",
        "Add the service from the agreement.",
      ]);
    },
  );

  it("shows the producer-entered payment date instead of the shifted normalized timestamp", async () => {
    const user = userEvent.setup();
    renderWorkspace(paymentDateTruthBatch());

    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    await screen.findByRole("heading", { name: "Review before creating" });
    expandReviewRow("Blue Hour");

    const heading = await screen.findByRole("heading", { name: "Blue Hour" });
    const card = heading.closest("article");
    if (!card) throw new Error("Expected a frozen review card");
    expect(within(card).getByText("Paid Aug 20, 2026")).not.toBeNull();
    expect(within(card).queryByText("Paid Aug 19, 2026")).toBeNull();
  });

  it("shows a full historical payment as Paid in the matching installment", async () => {
    const user = userEvent.setup();
    renderWorkspace(paymentDateTruthBatch({ draftAmount: "1000", normalizedAmountCents: 100_000 }));

    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    await screen.findByRole("heading", { name: "Review before creating" });
    expandReviewRow("Blue Hour");

    const heading = await screen.findByRole("heading", { name: "Blue Hour" });
    const card = heading.closest("article");
    if (!card) throw new Error("Expected a frozen review card");
    const review = within(card);
    expect(review.getByText("Due now · Paid")).not.toBeNull();
    expect(review.queryByText("Due now · Not paid")).toBeNull();
    expect(
      within(review.getByRole("article", { name: "Historical payment 1" })).getByText("$1,000"),
    ).not.toBeNull();
  });

  it("shows a partial historical payment as Partially paid in the matching installment", async () => {
    const user = userEvent.setup();
    renderWorkspace(paymentDateTruthBatch());

    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    await screen.findByRole("heading", { name: "Review before creating" });
    expandReviewRow("Blue Hour");

    const heading = await screen.findByRole("heading", { name: "Blue Hour" });
    const card = heading.closest("article");
    if (!card) throw new Error("Expected a frozen review card");
    const review = within(card);
    expect(review.getByText("Due now · Partially paid")).not.toBeNull();
    expect(review.queryByText("Due now · Not paid")).toBeNull();
    expect(
      within(review.getByRole("article", { name: "Historical payment 1" })).getByText("$100"),
    ).not.toBeNull();
  });

  it("shows exact commercial and payment facts, materializes, then keeps completed setup terminal", async () => {
    mocks.materializeRows.mockResolvedValue({
      ok: true,
      data: {
        outcomes: [
          {
            state: "created",
            rowId,
            clientContactId: "client-existing",
            projectId: "project-created",
            purchaseId: "purchase-created",
            created: true,
            materializedAtIso: "2026-08-20T10:00:00.000Z",
          },
        ],
        error: null,
      },
    });
    mocks.loadSetup.mockResolvedValue({ ok: true, data: freshSetupOptions() });
    const user = userEvent.setup();
    renderWorkspace(detailedBatch());

    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    await screen.findByRole("heading", { name: "Review before creating" });
    expandReviewRow("Blue Hour");

    const heading = await screen.findByRole("heading", { name: "Blue Hour" });
    const card = heading.closest("article");
    if (!card) throw new Error("Expected a frozen review card");
    const review = within(card);

    expect(review.getByText("Sep 15, 2026")).not.toBeNull();
    expect(review.getByText("Reuse existing client · +972 50 123 4567")).not.toBeNull();
    expect(review.getByText("Total").parentElement?.textContent).toContain("$1,170");
    expect(review.getByText("Agreed price (subtotal)").parentElement?.textContent).toContain(
      "$1,000",
    );
    expect(review.getByText("Tax mode").parentElement?.textContent).toContain("Added to subtotal");
    expect(review.getByText("Tax rate").parentElement?.textContent).toContain("17%");
    expect(review.getByText("Tax amount").parentElement?.textContent).toContain("$170");
    expect(review.getByText("Song spaces").parentElement?.textContent).toContain("3");
    expect(review.getByText("Revisions").parentElement?.textContent).toContain("2 revisions");
    expect(review.getByText("Master royalty").parentElement?.textContent).toContain(
      "12.5% master royalty",
    );
    expect(review.getByText("Composition royalty").parentElement?.textContent).toContain(
      "5% composition royalty · Composer · ASCAP",
    );
    expect(review.getByText("Producer share follows the existing agreement.")).not.toBeNull();
    expect(review.getByText("Due now · Partially paid")).not.toBeNull();
    expect(
      review.getByText("Due after the Artist approves the final version · Not paid"),
    ).not.toBeNull();

    const firstPayment = review.getByRole("article", { name: "Historical payment 1" });
    expect(within(firstPayment).getByText("Installment 1")).not.toBeNull();
    expect(within(firstPayment).getByText("Paid Jul 1, 2026")).not.toBeNull();
    expect(within(firstPayment).getByText("$300")).not.toBeNull();
    expect(within(firstPayment).getByText("Bank transfer")).not.toBeNull();
    expect(within(firstPayment).getByText("Proof: bank-transfer.pdf")).not.toBeNull();
    const secondPayment = review.getByRole("article", { name: "Historical payment 2" });
    expect(within(secondPayment).getByText("Paid Jul 3, 2026")).not.toBeNull();
    expect(within(secondPayment).getByText("$200")).not.toBeNull();
    expect(within(secondPayment).getByText("No proof attached")).not.toBeNull();
    expect(card.textContent).not.toContain("server-only-proof-token");

    await user.click(screen.getByRole("button", { name: "Create 1 ready item" }));
    await waitFor(() => {
      expect(mocks.materializeRows).toHaveBeenCalledWith({
        batchId,
        rows: [{ rowId, expectedCreationDigest: "ready-detailed" }],
      });
    });
    await screen.findByText(/1 client · 1 project and agreement added/);
    expect(screen.queryByRole("button", { name: "Back to items" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to active work items" })).toBeNull();
  });

  it("offers a newly created shared client to the next row without a reload", async () => {
    const secondReady = readyAssessment("digest-shared-two-ready");
    if (secondReady.state !== "ready") throw new Error("Test assessment must be ready");
    mocks.materializeRows.mockResolvedValue({
      ok: true,
      data: {
        outcomes: [
          {
            state: "created",
            rowId,
            clientContactId: "client-shared-created",
            projectId: "project-shared-one",
            purchaseId: "purchase-shared-one",
            created: true,
            materializedAtIso: "2026-08-20T10:00:00.000Z",
          },
          {
            state: "needs_info",
            rowId: sharedSecondRowId,
            reasons: [
              {
                code: "existing_client_reuse_required",
                field: "client.existingClientId",
                message: "This email already belongs to a client. Choose Use existing client.",
              },
            ],
          },
        ],
        error: null,
      },
    });
    mocks.loadSetup.mockResolvedValue({ ok: true, data: freshSetupOptions() });
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) => {
      const result = savedResult(input, { revision: 2, assessment: secondReady });
      return Promise.resolve({
        ...result,
        data: {
          ...result.data,
          row: { ...result.data.row, id: sharedSecondRowId },
        },
      });
    });
    const user = userEvent.setup();
    renderWorkspace(sharedNewClientBatch());

    await user.click(screen.getByRole("button", { name: "Review 2 ready items" }));
    await user.click(screen.getByRole("button", { name: "Create 2 ready items" }));

    await screen.findByRole("heading", { name: "Finish setup" });
    expect(mocks.materializeRows).toHaveBeenCalledWith({
      batchId,
      rows: [
        { rowId, expectedCreationDigest: "digest-shared-one" },
        { rowId: sharedSecondRowId, expectedCreationDigest: "digest-shared-two" },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Back to items" }));
    const queue = screen.getByRole("list", { name: "Active work items" });
    await user.click(within(queue).getAllByRole("button")[1] as HTMLElement);

    expect(await screen.findByRole("heading", { name: "Second shared project" })).not.toBeNull();
    expect(screen.getByText("This email belongs to Shared client")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Use existing client" }));

    await waitFor(() => {
      expect(mocks.saveRow).toHaveBeenCalledTimes(1);
    });
    expect(mocks.saveRow.mock.calls[0]?.[0]).toMatchObject({
      rowOperationKey: "row-shared-two",
      expectedRevision: 1,
      draftPayload: {
        client: {
          existingClientId: "client-shared-created",
          name: "Shared client",
          email: "shared@example.com",
        },
      },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Import progress").textContent).toContain("1 Ready");
    });
    expect(screen.getByRole("button", { name: "Review 1 ready item" })).not.toBeNull();
  });

  it("marks a failed creation Needs info until the producer deliberately retries it", async () => {
    const failedOutcome = {
      state: "failed" as const,
      rowId,
      code: "TEMPORARY_FAILURE",
      message: "This item was not created. Try again.",
    };
    const createdOutcome = {
      state: "created" as const,
      rowId,
      clientContactId: "client-created",
      projectId: "project-created",
      purchaseId: "purchase-created",
      created: true,
      materializedAtIso: "2026-08-20T10:00:00.000Z",
    };
    mocks.materializeRows
      .mockResolvedValueOnce({ ok: true, data: { outcomes: [failedOutcome], error: null } })
      .mockResolvedValueOnce({ ok: true, data: { outcomes: [createdOutcome], error: null } });
    mocks.loadSetup.mockResolvedValue({ ok: true, data: freshSetupOptions() });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    await user.click(screen.getByRole("button", { name: "Create 1 ready item" }));

    expect(
      (await screen.findAllByText("This item was not created. Try again.")).length,
    ).toBeGreaterThan(0);
    const status = screen.getByLabelText("Review status");
    expect(status.textContent).toContain("0 Ready");
    expect(status.textContent).toContain("0 Need info");
    expect(status.textContent).toContain("1 To retry");
    expect(screen.queryByRole("button", { name: "Create 1 ready item" })).toBeNull();
    const retry = screen.getByRole("button", { name: "Retry 1 failed item" });

    await user.click(retry);

    await waitFor(() => {
      expect(mocks.materializeRows).toHaveBeenCalledTimes(2);
    });
    expect(mocks.materializeRows.mock.calls[1]?.[0]).toEqual(
      mocks.materializeRows.mock.calls[0]?.[0],
    );
    expect(await screen.findByText(/1 client · 1 project and agreement added/)).not.toBeNull();
  });

  it("explains a saved PROOF_UPLOAD_MISSING failure in plain words on reload", async () => {
    const batch = initialBatch();
    const first = batch.rows[0];
    if (!first) throw new Error("Test batch needs one row");
    const user = userEvent.setup();
    renderWorkspace({
      ...batch,
      rows: [{ ...first, row: { ...first.row, lastErrorCode: "PROOF_UPLOAD_MISSING" } }],
    });

    await user.click(screen.getByRole("button", { name: "Review 1 item to retry" }));

    expect(
      (
        await screen.findAllByText(
          "The payment proof file is no longer available. Attach it again and retry.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Last create attempt failed/)).toBeNull();
  });

  it("maps a live PROOF_UPLOAD_MISSING outcome to the same sentence", async () => {
    mocks.materializeRows.mockResolvedValue({
      ok: true,
      data: {
        outcomes: [
          {
            state: "failed",
            rowId,
            code: "PROOF_UPLOAD_MISSING",
            message: "Proof upload missing",
          },
        ],
        error: null,
      },
    });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    await user.click(screen.getByRole("button", { name: "Create 1 ready item" }));

    expect(
      (
        await screen.findAllByText(
          "The payment proof file is no longer available. Attach it again and retry.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Proof upload missing")).toBeNull();
  });

  it("keeps created rows and explains the failure when a later chunk did not finish", async () => {
    mocks.materializeRows.mockResolvedValue({
      ok: true,
      data: {
        outcomes: [
          {
            state: "created",
            rowId,
            clientContactId: "client-created",
            projectId: "project-created",
            purchaseId: "purchase-created",
            created: true,
            materializedAtIso: "2026-08-20T10:00:00.000Z",
          },
        ],
        error: "Something went wrong on our side. Please try again.",
      },
    });
    mocks.loadSetup.mockResolvedValue({ ok: true, data: freshSetupOptions() });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    await user.click(screen.getByRole("button", { name: "Create 1 ready item" }));

    expect(await screen.findByText(/1 client · 1 project and agreement added/)).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Something went wrong on our side. Please try again.",
    );
  });

  it("keeps raw Ready client matches in Needs info and creates only the effective-ready row", async () => {
    mocks.materializeRows.mockResolvedValue({
      ok: true,
      data: {
        outcomes: [
          {
            state: "created",
            rowId,
            clientContactId: "client-valid",
            projectId: "project-valid",
            purchaseId: "purchase-valid",
            created: true,
            materializedAtIso: "2026-08-20T10:00:00.000Z",
          },
        ],
        error: null,
      },
    });
    mocks.loadSetup.mockResolvedValue({ ok: true, data: freshSetupOptions() });
    const user = userEvent.setup();
    renderWorkspace(mixedReadinessBatch(), {
      existingClients: [{ id: "client-active", name: "Active saved", email: "active@example.com" }],
      archivedClients: [
        { id: "client-archived", name: "Archived saved", email: "archived@example.com" },
      ],
    });

    expect(screen.getByRole("button", { name: "Review 1 ready item" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    const status = await screen.findByLabelText("Review status");
    expect(status.textContent).toContain("1 Ready");
    expect(status.textContent).toContain("2 Need info");
    expect(screen.getByRole("button", { name: "Create 1 ready item" })).not.toBeNull();

    const needsInfo = screen.getByRole("region", { name: "Needs info · 2" });
    const needsInfoItems = within(needsInfo).getAllByRole("article");
    expect(needsInfoItems.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Item 2 needs info",
      "Item 3 needs info",
    ]);
    expect(
      within(needsInfoItems[0] as HTMLElement).getByText(
        "This email already belongs to a client. Choose Use existing client.",
      ),
    ).not.toBeNull();
    expect(
      within(needsInfoItems[1] as HTMLElement).getByText(
        "Restore this client in Clients & Projects before adding active work.",
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Create 1 ready item" }));
    await waitFor(() => {
      expect(mocks.materializeRows).toHaveBeenCalledWith({
        batchId,
        rows: [{ rowId, expectedCreationDigest: "digest-valid" }],
      });
    });
    await screen.findByText("2 drafts still need attention. It stays saved for later.");
    expect(screen.getByRole("button", { name: "Back to items" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Back to items" }));
    expect(screen.getByRole("button", { name: "Add new client" })).not.toBeNull();
    expect(mocks.materializeRows.mock.calls[0]?.[0]?.rows).toHaveLength(1);
  });

  it("hides Add and Back-to-items for an initially completed batch", async () => {
    const user = userEvent.setup();
    renderWorkspace(
      { ...createdBatch(), status: "completed" },
      {
        initialSetupOptions: freshSetupOptions(),
      },
    );

    expect(screen.queryByRole("button", { name: "Add new client" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await screen.findByRole("heading", { name: "Finish setup" });
    expect(screen.getByRole("button", { name: "Finish setup" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Back to items" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to active work items" })).toBeNull();
  });
});

describe("ActiveWorkImportWorkspace agreement PDF", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches a dropped PDF, saves its signed reference, and removes it again", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(savedResult(input, { revision: 2, assessment: readyAssessment("v2") })),
    );
    mocks.prepareAgreementPdf.mockResolvedValue({
      ok: true,
      data: {
        uploadUrl: "https://r2.example/agreement",
        uploadToken: "agreement-tok",
        expiresInSeconds: 300,
      },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    await screen.findByRole("heading", { name: "Agreement" });

    const zone = screen.getByText("Drop the agreement PDF here").closest("label");
    if (!zone) throw new Error("Expected the agreement PDF drop zone");
    expect(within(zone).getByText("or click to choose a file")).not.toBeNull();
    const pdf = new File(["%PDF-1.4 deal"], "deal.pdf", { type: "application/pdf" });
    fireEvent.drop(zone, { dataTransfer: { files: [pdf] } });

    await waitFor(() => {
      expect(mocks.prepareAgreementPdf).toHaveBeenCalledWith({
        batchId,
        rowId,
        originalFileName: "deal.pdf",
        contentType: "application/pdf",
        sizeBytes: pdf.size,
      });
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://r2.example/agreement",
        expect.objectContaining({ method: "PUT" }),
      );
    });
    await waitFor(() => {
      const saved = mocks.saveRow.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      const agreement = saved?.draftPayload
        ? ((saved.draftPayload as Record<string, unknown>).agreement as Record<string, unknown>)
        : undefined;
      expect(agreement?.agreementPdf).toEqual({
        uploadToken: "agreement-tok",
        fileName: "deal.pdf",
        sizeBytes: pdf.size,
      });
    });
    expect(await screen.findByText("deal.pdf")).not.toBeNull();
    expect(screen.queryByText("Drop the agreement PDF here")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Remove PDF" }));
    await waitFor(() => {
      const saved = mocks.saveRow.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      const agreement = (saved?.draftPayload as Record<string, unknown> | undefined)?.agreement as
        | Record<string, unknown>
        | undefined;
      expect(agreement?.agreementPdf).toBeNull();
    });
    expect(screen.getByText("Drop the agreement PDF here")).not.toBeNull();
  });

  it("refuses a non-PDF file before asking the server", async () => {
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(savedResult(input, { revision: 2, assessment: readyAssessment("v2") })),
    );
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Continue to agreement" }));
    await screen.findByRole("heading", { name: "Agreement" });

    const zone = screen.getByText("Drop the agreement PDF here").closest("label");
    if (!zone) throw new Error("Expected the agreement PDF drop zone");
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["img"], "deal.png", { type: "image/png" })] },
    });

    expect((await screen.findByRole("alert")).textContent).toBe("Choose a PDF file.");
    expect(mocks.prepareAgreementPdf).not.toHaveBeenCalled();
  });
});

describe("ActiveWorkImportWorkspace proof upload errors", () => {
  async function attachProof(fetchImpl: () => Promise<unknown>) {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    mocks.saveRow.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(savedResult(input, { revision: 2, assessment: readyAssessment("v2") })),
    );
    mocks.prepareProof.mockResolvedValue({
      ok: true,
      data: { uploadUrl: "https://r2.example/upload", uploadToken: "tok", expiresInSeconds: 600 },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "03 Payments" }));
    const first = within(screen.getByRole("list", { name: "Installment schedule" })).getAllByRole(
      "listitem",
    )[0];
    if (!first) throw new Error("Expected Payment 1");
    await user.click(within(first).getByRole("button", { name: "Record" }));
    const input = screen
      .getByText("Drop proof of payment here")
      .closest("label")
      ?.querySelector("input[type=file]");
    if (!(input instanceof HTMLInputElement)) throw new Error("Expected a proof file input");
    await user.upload(input, new File(["%PDF-1.4"], "receipt.pdf", { type: "application/pdf" }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says the upload link expired on a 403 and logs the status", async () => {
    await attachProof(() => Promise.resolve({ ok: false, status: 403 }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The upload link expired. Attach the file again.",
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[active-work-import]"),
      expect.objectContaining({ status: 403 }),
    );
  });

  it("reports another refused upload with its status instead of blaming the connection", async () => {
    await attachProof(() => Promise.resolve({ ok: false, status: 500 }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The storage service refused the upload (status 500). Try again in a moment.",
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[active-work-import]"),
      expect.objectContaining({ status: 500 }),
    );
  });

  it("keeps the connection message for a request that never reached storage", async () => {
    await attachProof(() => Promise.reject(new TypeError("Failed to fetch")));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The proof upload did not finish. Check your connection and try again.",
    );
  });
});

describe("ActiveWorkImportWorkspace page notice", () => {
  it("shows a quiet status for a page notice and aligns the address with the shown setup", () => {
    window.history.replaceState(
      null,
      "",
      "/dashboard/clients-projects/bring-active-work?batch=stale",
    );
    render(
      <ActiveWorkImportWorkspace
        initialBatch={initialBatch()}
        initialNotice="This saved setup could not be found — showing your latest one"
        initialSetupOptions={null}
        existingClients={[]}
        archivedClients={[]}
        templates={[]}
        defaultCurrency="USD"
        defaultTaxMode="tax_free"
        defaultTaxRatePct={0}
      />,
    );

    const notice = screen.getByText(
      "This saved setup could not be found — showing your latest one",
    );
    expect(notice.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(new URL(window.location.href).searchParams.get("batch")).toBe(batchId);
  });
});

describe("ActiveWorkImportWorkspace when Skitza cannot be reached", () => {
  const unreachable = "Could not reach Skitza. Check your connection and try again.";

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("marks a draft save that never answered as an error instead of leaving it Saving", async () => {
    mocks.saveRow.mockRejectedValue(new Error("fetch failed"));
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Typed while offline" },
    });

    await screen.findByText("Could not save — try again");
    expect(screen.getByRole("alert").textContent).toContain(unreachable);
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("re-enables Create and explains the failure when creation never answered", async () => {
    mocks.materializeRows.mockRejectedValue(new Error("fetch failed"));
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Review 1 ready item" }));
    const create = screen.getByRole("button", { name: "Create 1 ready item" });
    await user.click(create);

    await screen.findByText(unreachable);
    await waitFor(() => {
      expect((create as HTMLButtonElement).disabled).toBe(false);
    });
    expect(screen.getByRole("button", { name: "Create 1 ready item" })).not.toBeNull();
  });

  it("re-enables Finish setup and explains the failure when finishing never answered", async () => {
    mocks.finishSetup.mockRejectedValue(new Error("fetch failed"));
    const user = userEvent.setup();
    renderWorkspace(createdBatch(), { initialSetupOptions: freshSetupOptions() });
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await screen.findByRole("heading", { name: "Finish setup" });
    const done = screen.getByRole("button", { name: "Finish setup" });

    await user.click(done);

    await screen.findByText(unreachable);
    await waitFor(() => {
      expect((done as HTMLButtonElement).disabled).toBe(false);
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("offers Try again when the next steps could not be loaded", async () => {
    mocks.loadSetup.mockRejectedValue(new Error("fetch failed"));
    const user = userEvent.setup();
    renderWorkspace(createdBatch(), { initialSetupOptions: null });

    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    await screen.findByText(unreachable);
    expect(screen.getByText("Could not load the next steps")).not.toBeNull();
    const retry = screen.getByRole("button", { name: "Try again" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ActiveWorkImportWorkspace required reminder setup", () => {
  async function openCreatedSetup(options = setupOptions()) {
    const user = userEvent.setup();
    renderWorkspace(createdBatch(), { initialSetupOptions: options });
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await screen.findByRole("heading", { name: "Finish setup" });
    return user;
  }

  it("keeps invitations optional and shows every eligible unpaid reminder as mandatory read-only work", async () => {
    await openCreatedSetup();

    const retry = screen.getByRole("checkbox", { name: /Retry client/ });
    const sent = screen.getByRole("checkbox", { name: /Sent client/ });
    expect((retry as HTMLInputElement).checked).toBe(false);
    expect((retry as HTMLInputElement).disabled).toBe(false);
    expect((sent as HTMLInputElement).checked).toBe(false);
    expect((sent as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("checkbox", { name: /Blue Hour/ })).toBeNull();
    expect(screen.getByText("Will turn on")).not.toBeNull();
    expect(
      screen.getByText(
        "A previous send is still pending or failed. Select it to check or retry safely.",
      ),
    ).not.toBeNull();
    expect(screen.getByText("Invitation email already sent.")).not.toBeNull();
    expect(screen.queryByText(/invitation was already accepted/i)).toBeNull();
    expect(
      screen.getByText(
        /Finish setup will turn on reminders for every eligible unpaid imported payment/,
      ),
    ).not.toBeNull();
    expect(screen.getByText(/No invitation emails will send/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Finish setup" })).not.toBeNull();
  });

  it("keeps invitations optional and plainly gates the final 50% reminder", async () => {
    const user = await openCreatedSetup(freshSetupOptions({ dueTrigger: "artist_approval" }));

    expect(screen.getByText(/1 client · 1 project and agreement added/)).not.toBeNull();
    expect(
      screen.getByText(
        "Creating these items contacted nobody. Your imported work is ready in Skitza.",
      ),
    ).not.toBeNull();
    expect(
      screen.getByText("Reminder delivery waits for Artist approval. It will not send early."),
    ).not.toBeNull();
    const invite = screen.getByRole("checkbox", { name: /Available client/ });
    expect((invite as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("checkbox", { name: /Blue Hour/ })).toBeNull();
    expect(screen.getByText("Will turn on")).not.toBeNull();

    await user.click(invite);
    expect(screen.getByRole("button", { name: "Finish setup" })).not.toBeNull();
    expect(
      screen.getByText(/Invitation emails will send only to the 1 selected client/),
    ).not.toBeNull();
    await user.click(invite);
    expect(screen.getByText(/No invitation emails will send/)).not.toBeNull();
  });

  it("shows an already-on final 50% reminder without an opt-out", async () => {
    const options = freshSetupOptions({ dueTrigger: "artist_approval" });
    const installment = options.installments[0];
    if (!installment) throw new Error("Test setup needs one installment");
    await openCreatedSetup({
      ...options,
      installments: [
        {
          ...installment,
          id: "installment-final-50",
          position: 2,
          amountCents: 58_500,
          remainingCents: 58_500,
          remindersEnabled: true,
        },
      ],
    });

    expect(screen.queryByRole("checkbox", { name: /Blue Hour · payment 2/ })).toBeNull();
    expect(screen.getByText("Already on")).not.toBeNull();
    expect(
      screen.getByText("Reminder delivery waits for Artist approval. It will not send early."),
    ).not.toBeNull();
  });

  it("reuses one operation key after an ambiguous finish failure", async () => {
    mocks.finishSetup.mockResolvedValue({ ok: false, error: "Could not confirm the result." });
    const user = await openCreatedSetup(freshSetupOptions());
    const done = screen.getByRole("button", { name: "Finish setup" });

    await user.click(done);
    await waitFor(() => {
      expect(mocks.finishSetup).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect((done as HTMLButtonElement).disabled).toBe(false);
    });
    expect(
      screen.queryByText(
        "Creating these items contacted nobody. Your imported work is ready in Skitza.",
      ),
    ).toBeNull();
    expect(
      screen.getByText(
        "Review the current status. Unpaid payment reminders are required; invitations are still your choice.",
      ),
    ).not.toBeNull();
    await user.click(done);
    await waitFor(() => {
      expect(mocks.finishSetup).toHaveBeenCalledTimes(2);
    });

    const firstKey = mocks.finishSetup.mock.calls[0]?.[0]?.operationKey;
    const secondKey = mocks.finishSetup.mock.calls[1]?.[0]?.operationKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
    expect(mocks.finishSetup.mock.calls[0]?.[0]).not.toHaveProperty("selectedInstallmentIds");
  });

  it("starts a new operation when the invitation choice changes after an ambiguous failure", async () => {
    mocks.finishSetup.mockResolvedValue({ ok: false, error: "Could not confirm the result." });
    const user = await openCreatedSetup(freshSetupOptions());
    const available = screen.getByRole("checkbox", { name: /Available client/ });
    await user.click(available);
    const done = screen.getByRole("button", { name: "Finish setup" });

    await user.click(done);
    await waitFor(() => {
      expect(mocks.finishSetup).toHaveBeenCalledTimes(1);
    });
    expect(mocks.finishSetup.mock.calls[0]?.[0]?.selectedClientContactIds).toEqual([
      "client-available",
    ]);

    // Unticking the client is a different reviewed choice, so it cannot reuse
    // the operation key of the attempt that included an invitation.
    await user.click(available);
    await user.click(done);
    await waitFor(() => {
      expect(mocks.finishSetup).toHaveBeenCalledTimes(2);
    });

    expect(mocks.finishSetup.mock.calls[1]?.[0]?.selectedClientContactIds).toEqual([]);
    expect(mocks.finishSetup.mock.calls[1]?.[0]?.operationKey).not.toBe(
      mocks.finishSetup.mock.calls[0]?.[0]?.operationKey,
    );
  });

  it("rotates the operation key after a successful partial result", async () => {
    mocks.finishSetup
      .mockResolvedValueOnce({
        ok: true,
        data: {
          distinctClientCount: 2,
          projectPurchaseCount: 1,
          invitations: [
            {
              clientContactId: "client-retry",
              status: "failed",
              providerAcceptedAtIso: null,
              reason: null,
            },
          ],
          reminders: [],
          batch: { completed: false, unfinishedDraftCount: null },
        },
      })
      .mockResolvedValueOnce({ ok: false, error: "Second request stopped." });
    const user = await openCreatedSetup();
    await user.click(screen.getByRole("checkbox", { name: /Retry client/ }));
    const done = screen.getByRole("button", { name: "Finish setup" });

    await user.click(done);
    await screen.findByText(
      "Some invitations or payment reminders did not finish. Created work is safe; review the status and try again.",
    );
    await user.click(done);
    await waitFor(() => {
      expect(mocks.finishSetup).toHaveBeenCalledTimes(2);
    });

    expect(mocks.finishSetup.mock.calls[1]?.[0]?.operationKey).not.toBe(
      mocks.finishSetup.mock.calls[0]?.[0]?.operationKey,
    );
  });

  it("stays on the setup screen while an invitation is still being sent", async () => {
    mocks.finishSetup.mockResolvedValue({
      ok: true,
      data: {
        distinctClientCount: 1,
        projectPurchaseCount: 1,
        invitations: [
          {
            clientContactId: "client-available",
            status: "requested",
            providerAcceptedAtIso: null,
            reason: null,
          },
        ],
        reminders: [],
        batch: { completed: false, unfinishedDraftCount: null },
      },
    });
    mocks.loadSetup.mockResolvedValue({
      ok: true,
      data: {
        ...freshSetupOptions(),
        clients: [
          {
            id: "client-available",
            name: "Available client",
            email: "available@example.com",
            connected: false,
            providerAcceptedAtIso: null,
            invitationEligible: true,
            invitationState: "send_in_progress_or_retryable",
          },
        ],
      },
    });
    const user = await openCreatedSetup(freshSetupOptions());
    await user.click(screen.getByRole("checkbox", { name: /Available client/ }));
    const done = screen.getByRole("button", { name: "Finish setup" });

    await user.click(done);

    expect((await screen.findAllByText("Still sending — check again in a moment")).length).toBe(2);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { name: "Finish setup" })).not.toBeNull();
    await waitFor(() => {
      expect(mocks.loadSetup).toHaveBeenCalledTimes(1);
    });
    const invite = screen.getByRole("checkbox", { name: /Available client/ });
    expect((invite as HTMLInputElement).checked).toBe(true);
    await waitFor(() => {
      expect((done as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("shows the server reason under a failed invitation and reminder", async () => {
    mocks.finishSetup.mockResolvedValue({
      ok: true,
      data: {
        distinctClientCount: 2,
        projectPurchaseCount: 1,
        invitations: [
          {
            clientContactId: "client-retry",
            status: "failed",
            providerAcceptedAtIso: null,
            reason: "The mailbox rejected this address.",
          },
        ],
        reminders: [
          {
            installmentId: "installment-1",
            purchaseId: "purchase-created",
            status: "failed",
            changed: false,
            reason: "This payment is already closed.",
          },
        ],
        batch: { completed: false, unfinishedDraftCount: null },
      },
    });
    const user = await openCreatedSetup();
    await user.click(screen.getByRole("checkbox", { name: /Retry client/ }));

    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    await screen.findByText(
      "Some invitations or payment reminders did not finish. Created work is safe; review the status and try again.",
    );
    const retryRow = screen.getByRole("checkbox", { name: /Retry client/ }).closest("label");
    expect(retryRow?.textContent).toContain("The mailbox rejected this address.");
    expect(screen.getByText("This payment is already closed.")).not.toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("explains that reminders to clients who have not joined include the join link", async () => {
    await openCreatedSetup();

    expect(
      screen.getByText(/Reminders to clients who have not joined yet include your join link/),
    ).not.toBeNull();
  });

  // Every invitation and reminder succeeded, but saved drafts kept the import
  // open. Leaving here is what made the wizard reappear with no explanation.
  it("stays and names the unfinished drafts when the import did not actually finish", async () => {
    mocks.finishSetup.mockResolvedValue({
      ok: true,
      data: {
        distinctClientCount: 2,
        projectPurchaseCount: 1,
        invitations: [],
        reminders: [],
        batch: { completed: false, unfinishedDraftCount: 2 },
      },
    });
    const user = await openCreatedSetup();

    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    await screen.findByText(
      "This import is not finished: 2 items are still saved as drafts and were never created, so it will still be here next time. Your created work, invitations and reminders are all safe. Go back, finish or remove those items, then press Finish setup again.",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("leaves for Clients & Projects only once the import is really closed", async () => {
    mocks.finishSetup.mockResolvedValue({
      ok: true,
      data: {
        distinctClientCount: 2,
        projectPurchaseCount: 1,
        invitations: [],
        reminders: [],
        batch: { completed: true, unfinishedDraftCount: 0 },
      },
    });
    const user = await openCreatedSetup();

    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/dashboard/clients-projects");
    });
  });

  it("reloads current setup and rotates the operation key after a conflict", async () => {
    mocks.loadSetup.mockResolvedValue({ ok: true, data: setupOptions("setup-v2") });
    mocks.finishSetup
      .mockResolvedValueOnce({
        ok: false,
        error: "The choices changed. Review them again.",
        code: "CONFLICT",
      })
      .mockResolvedValueOnce({ ok: false, error: "Second request stopped." });
    const user = await openCreatedSetup(setupOptions("setup-v1"));
    const done = screen.getByRole("button", { name: "Finish setup" });

    await user.click(done);
    await waitFor(() => {
      expect(mocks.loadSetup).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect((done as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(done);
    await waitFor(() => {
      expect(mocks.finishSetup).toHaveBeenCalledTimes(2);
    });

    const first = mocks.finishSetup.mock.calls[0]?.[0];
    const second = mocks.finishSetup.mock.calls[1]?.[0];
    expect(first?.expectedSetupDigest).toBe("setup-v1");
    expect(second?.expectedSetupDigest).toBe("setup-v2");
    expect(second?.operationKey).not.toBe(first?.operationKey);
  });
});

describe.each([360, 390, 768, 1023])("ActiveWorkImportWorkspace below 1024px at %ipx", (width) => {
  it("renders the editor once so labels point at the visible phone fields", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    installMatchMedia(true);
    const user = userEvent.setup();
    renderWorkspace();

    const list = screen.getByRole("list", { name: "Active work items" });
    await user.click(within(list).getAllByRole("button")[0] as HTMLButtonElement);
    const mobileEditor = await screen.findByRole("dialog", { name: "Edit item 1" });

    // Only one editor instance may exist: a hidden desktop copy would duplicate every
    // field id, so the phone labels and error messages would target the hidden copy.
    expect(document.querySelectorAll('[aria-label^="Edit item"]')).toHaveLength(1);
    const ids = Array.from(document.querySelectorAll("[id]"), (node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const clientName = within(mobileEditor).getByLabelText("Client name", { exact: true });
    expect(mobileEditor.contains(clientName)).toBe(true);
  });

  it("opens a modal editor, isolates the queue, and returns focus on close", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    installMatchMedia(true);
    const user = userEvent.setup();
    renderWorkspace();

    expect(window.innerWidth).toBe(width);
    const list = screen.getByRole("list", { name: "Active work items" });
    const queueRow = within(list).getAllByRole("button")[0] as HTMLButtonElement;
    const workspace = document.querySelector("[data-active-import-workspace]");
    await user.click(queueRow);
    const mobileEditor = await screen.findByRole("dialog", { name: "Edit item 1" });
    await waitFor(() => {
      expect(document.activeElement).toBe(mobileEditor);
    });
    expect(mobileEditor.className).toContain("fixed");
    expect(mobileEditor.parentElement).toBe(document.body);
    expect(workspace?.hasAttribute("inert")).toBe(true);
    expect(workspace?.getAttribute("aria-hidden")).toBe("true");
    const mobileDock = screen
      .getAllByRole("button", { name: "Continue to agreement" })
      .map((button) => button.closest("footer"))
      .find((footer) => footer?.className.includes("z-[80]"));
    expect(mobileDock?.className).toContain("fixed");
    const mobileScroll = mobileEditor.querySelector(".sk-native-scroll");
    expect(mobileScroll?.className).toContain("pb-36");
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 1023px)");

    const back = within(mobileEditor).getByRole("button", { name: "Back to items" });
    const continueButton = within(mobileEditor).getByRole("button", {
      name: "Continue to agreement",
    });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(continueButton);
    await user.tab();
    expect(document.activeElement).toBe(back);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(continueButton);

    await user.click(back);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit item 1" })).toBeNull();
      expect(document.activeElement).toBe(queueRow);
    });
    expect(workspace?.hasAttribute("inert")).toBe(false);
    expect(workspace?.getAttribute("aria-hidden")).toBeNull();
  });
});

describe("ActiveWorkImportWorkspace at the 1024px shell switch", () => {
  it("keeps the editor in the desktop surface instead of opening a dialog", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    installMatchMedia(false);
    const user = userEvent.setup();
    renderWorkspace();

    const queue = screen.getByRole("list", { name: "Active work items" });
    await user.click(within(queue).getAllByRole("button")[0] as HTMLButtonElement);

    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 1023px)");
    expect(screen.queryByRole("dialog", { name: "Edit item 1" })).toBeNull();
    const editor = document.querySelector('article[aria-label="Edit item 1"]');
    expect(editor?.className).toContain("h-full");
    expect(editor?.className).not.toContain("fixed");
  });
});
