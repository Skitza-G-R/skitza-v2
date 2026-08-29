import { describe, expect, it } from "vitest";

import {
  activeWorkImportSetupDigest,
  type ActiveWorkImportSetupScope,
} from "../setup";

const REVIEWED_AT = new Date("2026-08-20T22:30:00.000Z");
const NEXT_MORNING = new Date("2026-08-21T07:10:00.000Z");

function scope(
  installmentOverrides: Partial<ActiveWorkImportSetupScope["installments"][number]> = {},
): ActiveWorkImportSetupScope {
  return {
    clients: [
      {
        id: "client-a",
        name: "Artist A",
        email: "a@example.com",
        emailHash: "a".repeat(64),
        connected: false,
        providerAcceptedAt: null,
        invitationEligible: true,
        invitationState: "available",
      },
    ],
    projectPurchases: [
      {
        rowId: "row-1",
        clientContactId: "client-a",
        projectId: "project-1",
        purchaseId: "purchase-1",
        projectTitle: "Blue Hour",
        agreementName: "Full production",
        refNumber: "REF-1",
      },
    ],
    installments: [
      {
        id: "installment-1",
        rowId: "row-1",
        projectId: "project-1",
        purchaseId: "purchase-1",
        projectTitle: "Blue Hour",
        agreementName: "Full production",
        position: 1,
        amountCents: 100_000,
        remainingCents: 100_000,
        currency: "USD",
        dueTrigger: "producer_import",
        dueAt: REVIEWED_AT,
        triggeredAt: REVIEWED_AT,
        status: "not_paid",
        remindersEnabled: false,
        reminderEligible: true,
        reminderWaitingForDueDate: false,
        ...installmentOverrides,
      },
    ],
  };
}

describe("reviewed setup digest", () => {
  // The producer opens the review at night and presses Finish setup in the
  // morning. Nothing they own changed, so the digest must still match.
  it("survives ledger state that moves on its own overnight", () => {
    const reviewed = scope();
    const nextMorning = scope({
      // An unpaid installment flips to overdue at local midnight.
      status: "overdue",
      // A payment landed elsewhere, or a correction was recorded.
      remainingCents: 40_000,
      // Reconciliation anchored the monthly schedule.
      dueAt: NEXT_MORNING,
      triggeredAt: NEXT_MORNING,
      // Everything above is derived, so eligibility moved too.
      reminderEligible: false,
      reminderWaitingForDueDate: false,
    });

    expect(activeWorkImportSetupDigest(nextMorning)).toBe(activeWorkImportSetupDigest(reviewed));
  });

  it("still notices a change to the terms the producer owns", () => {
    const reviewed = activeWorkImportSetupDigest(scope());

    expect(activeWorkImportSetupDigest(scope({ amountCents: 120_000 }))).not.toBe(reviewed);
    expect(activeWorkImportSetupDigest(scope({ currency: "ILS" }))).not.toBe(reviewed);
    expect(activeWorkImportSetupDigest(scope({ position: 2 }))).not.toBe(reviewed);
    expect(activeWorkImportSetupDigest(scope({ dueTrigger: "artist_approval" }))).not.toBe(
      reviewed,
    );
    expect(activeWorkImportSetupDigest(scope({ projectTitle: "Renamed" }))).not.toBe(reviewed);
    expect(activeWorkImportSetupDigest(scope({ agreementName: "Mix only" }))).not.toBe(reviewed);
    expect(activeWorkImportSetupDigest(scope({ id: "installment-2" }))).not.toBe(reviewed);
  });

  it("still notices when the reviewed set of installments changes", () => {
    const reviewed = scope();
    const withOneRemoved: ActiveWorkImportSetupScope = { ...reviewed, installments: [] };

    expect(activeWorkImportSetupDigest(withOneRemoved)).not.toBe(
      activeWorkImportSetupDigest(reviewed),
    );
  });
});
