// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostImportSummary } from "../post-import-summary";
import { newImportDraft, type SetupInstallmentOption, type WorkspaceImportRow } from "../model";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "post-import-summary.tsx"),
  "utf8",
);

const defaults = {
  defaultCurrency: "ILS",
  defaultTaxMode: "tax_included" as const,
  defaultTaxRatePct: 17,
};

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

const installment: SetupInstallmentOption = {
  id: "installment-1",
  rowId: "row-1",
  projectId: "project-row-1",
  purchaseId: "purchase-row-1",
  projectTitle: "Noya EP",
  agreementName: "Full production",
  position: 1,
  amountCents: 500_000,
  remainingCents: 250_000,
  currency: "ILS",
  dueTrigger: "producer_import",
  dueAtIso: "2026-10-15T00:00:00.000Z",
  triggeredAtIso: null,
  status: "partially_paid",
  remindersEnabled: true,
  reminderEligible: true,
  reminderWaitingForDueDate: false,
};

function renderSummary(onShared = vi.fn()) {
  render(
    <PostImportSummary
      rows={[createdRow("row-1", "client-1")]}
      installments={[installment]}
      clients={[
        {
          id: "client-1",
          name: "Noya Levi",
          email: "noya@example.com",
          connected: false,
          providerAcceptedAtIso: null,
          invitationEligible: true,
          invitationState: "available",
        },
      ]}
      producerSlug="gili"
      producerName="Gili"
      onShared={onShared}
      onDone={vi.fn()}
    />,
  );
  return onShared;
}

afterEach(cleanup);

describe("what the producer sees after the import", () => {
  it("shows the money owed, when it lands, and the armed reminder", () => {
    renderSummary();

    expect(screen.getByText("₪2,500")).toBeDefined();
    expect(screen.getByText("Oct 15, 2026")).toBeDefined();
    expect(
      screen.getByText(/Owes ₪2,500, due Oct 15, 2026\. Skitza will remind Noya about it\./),
    ).toBeDefined();
  });

  it("sends a named message, never the old placeholder", () => {
    renderSummary();

    const link = screen.getByRole("link", { name: /WhatsApp/ });
    const href = decodeURIComponent(link.getAttribute("href") ?? "");
    expect(href).toContain("Hi Noya, I moved our work on Noya EP into Skitza.");
    expect(href).toContain("https://wa.me/");
    expect(href).not.toContain("Join me on Skitza");
  });

  it("copies that same message rather than a bare link", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const onShared = renderSummary();

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Hi Noya, I moved our work on Noya EP");
    expect(onShared).toHaveBeenCalledWith("copy");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeDefined();
  });

  it("cannot mark anyone Invited, because it can send nothing", () => {
    // Invited means the email provider accepted a send. This screen only hands
    // the producer text, so it must not reach an invitation path at all.
    expect(SRC).not.toContain("bring-active-work/actions");
    expect(SRC).not.toMatch(/inviteClient|sendInvitation|finishImportSetup|markInvited/);
    // buildClientInviteUrl only composes the public join URL; it sends nothing.
    expect(SRC).toContain("buildClientInviteUrl");
  });
});
