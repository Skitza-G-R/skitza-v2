// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveWorkImportWorkspace } from "../active-work-import-workspace";
import type { ImportAssessmentView, StoreTemplateOption } from "../model";

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

const batchId = "00000000-0000-4000-8000-000000000299";
const rowId = "00000000-0000-4000-8000-000000000300";

const template: StoreTemplateOption = {
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
  revisionRule: null,
  royaltyTerms: null,
  rights: ["Artist owns the masters"],
  plans: [{ kind: "split_50_50" }],
  agreementText: "The agreement we already signed.",
  session: null,
};

function readyAssessment(): ImportAssessmentView {
  return { state: "ready", creationDigest: "digest-quick", normalized: {} as never };
}

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
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

function renderWorkspace() {
  return render(
    <ActiveWorkImportWorkspace
      initialBatch={null}
      initialSetupOptions={null}
      existingClients={[]}
      archivedClients={[]}
      templates={[template]}
      defaultCurrency="ILS"
      defaultTaxMode="tax_included"
      defaultTaxRatePct={17}
    />,
  );
}

/** Open a fresh quick row and fill the five fields. */
async function fillQuickRow(user: ReturnType<typeof userEvent.setup>, paidSoFar = "2500") {
  await user.click(screen.getByRole("button", { name: /add|start/i }));
  await screen.findByLabelText("Artist name");

  await user.type(screen.getByLabelText("Artist name"), "Noya Levi");
  await user.type(screen.getByLabelText("Email"), "noya@example.com");
  await user.type(screen.getByLabelText("Project name"), "Noya EP");
  await user.type(screen.getByLabelText("Agreed price"), "5000");
  if (paidSoFar) await user.type(screen.getByLabelText(/Paid so far/), paidSoFar);
}

beforeEach(() => {
  installMatchMedia();
  mocks.createBatch.mockReset().mockResolvedValue({ ok: true, data: { batchId } });
  mocks.deleteRow.mockReset().mockResolvedValue({ ok: true, data: { deleted: true } });
  mocks.finishSetup.mockReset();
  mocks.loadRows.mockReset().mockResolvedValue({ ok: true, data: { rows: [] } });
  mocks.loadSetup.mockReset();
  mocks.materializeRows.mockReset();
  mocks.prepareAgreementPdf.mockReset();
  mocks.prepareProof.mockReset();
  mocks.restoreClient.mockReset();
  mocks.push.mockReset();
  let revision = 0;
  mocks.saveRow.mockReset().mockImplementation((input) => {
    revision += 1;
    return Promise.resolve({
      ok: true as const,
      data: {
        row: {
          id: rowId,
          operationKey: input.rowOperationKey,
          draftRevision: revision,
          draftPayload: input.draftPayload,
          materializedAtIso: null,
          createdClientContactId: null,
          createdProjectId: null,
          createdPurchaseId: null,
          lastErrorCode: null,
        },
        assessment: readyAssessment(),
        assessmentError: null,
      },
    });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("quick row in the import workspace", () => {
  it("opens a new row as five fields, not the three-step editor", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: /add|start/i }));

    await screen.findByLabelText("Artist name");
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByLabelText("Project name")).toBeDefined();
    expect(screen.getByLabelText("Agreed price")).toBeDefined();
    expect(screen.getByLabelText(/Paid so far/)).toBeDefined();
    // The three-step editor's tabs must not be on screen.
    expect(screen.queryByRole("button", { name: /Agreement/ })).toBeNull();
  });

  it("shows every defaulted value in the line before anything is created", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await fillQuickRow(user);

    await user.click(screen.getByRole("button", { name: "Check this deal" }));

    // The product supplied the tax, the plan and the song count; the producer
    // only typed the ₪5,000 and the ₪2,500.
    await screen.findByText(
      "Full production · ₪5,000 incl. 17% tax · 50/50 · 3 songs · Noya has paid ₪2,500",
    );
    expect(screen.getByText("Is this the deal with Noya?")).toBeDefined();
    expect(mocks.materializeRows).not.toHaveBeenCalled();
  });

  it("creates only this row, through the shared action, when the line is confirmed", async () => {
    mocks.materializeRows.mockResolvedValue({
      ok: true,
      data: {
        outcomes: [
          {
            state: "created",
            rowId,
            clientContactId: "client-1",
            projectId: "project-1",
            purchaseId: "purchase-1",
            created: { client: true, project: true, purchase: true },
            materializedAtIso: "2026-09-04T10:00:00.000Z",
          },
        ],
        error: null,
      },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await fillQuickRow(user);
    await user.click(screen.getByRole("button", { name: "Check this deal" }));
    await screen.findByText("Is this the deal with Noya?");

    await user.click(screen.getByRole("button", { name: "Yes, save" }));

    await waitFor(() => {
      expect(mocks.materializeRows).toHaveBeenCalledWith({
        batchId,
        rows: [{ rowId, expectedCreationDigest: "digest-quick" }],
      });
    });
    // Silent creation: saving must not reach the invitation or reminder step.
    expect(mocks.finishSetup).not.toHaveBeenCalled();
  });

  it("refuses to guess a split when paid-so-far is past the first installment", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    // 50/50 on ₪5,000 makes the first payment ₪2,500; ₪3,000 fits nowhere.
    await fillQuickRow(user, "3000");
    await user.click(screen.getByRole("button", { name: "Check this deal" }));

    await screen.findByText(/is more than the first payment of this plan/);
    expect(screen.getByRole("button", { name: "Yes, save" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Yes, save" }));
    expect(mocks.materializeRows).not.toHaveBeenCalled();
  });

  it("hands the row to the full editor, prefilled, on Change details", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await fillQuickRow(user);

    await user.click(screen.getByRole("button", { name: "Change details" }));

    // The three-step editor is now on screen with what the quick row typed.
    await screen.findByText("Step 1 of 3");
    await waitFor(() => {
      expect(screen.getByLabelText("Client name")).toHaveProperty("value", "Noya Levi");
    });
    expect(screen.queryByRole("button", { name: "Check this deal" })).toBeNull();
    expect(mocks.materializeRows).not.toHaveBeenCalled();
  });

  it("stays on the three-step editor when there is no product to copy from", async () => {
    const user = userEvent.setup();
    render(
      <ActiveWorkImportWorkspace
        initialBatch={null}
        initialSetupOptions={null}
        existingClients={[]}
        archivedClients={[]}
        templates={[]}
        defaultCurrency="USD"
        defaultTaxMode="tax_free"
        defaultTaxRatePct={0}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add|start/i }));

    await screen.findByText("Step 1 of 3");
    expect(screen.queryByLabelText("Agreed price")).toBeNull();
  });
});
