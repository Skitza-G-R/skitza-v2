import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInstallmentSchedule: vi.fn<(...args: unknown[]) => unknown>(),
  assertCommercialSnapshotMatchesAcceptance: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock("../../purchases/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../purchases/ledger")>();
  mocks.createInstallmentSchedule.mockImplementation(actual.createInstallmentSchedule);
  return {
    ...actual,
    createInstallmentSchedule: (...args: unknown[]) => mocks.createInstallmentSchedule(...args),
  };
});

vi.mock("../../purchases/commercial-snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../purchases/commercial-snapshot")>();
  mocks.assertCommercialSnapshotMatchesAcceptance.mockImplementation(
    actual.assertCommercialSnapshotMatchesAcceptance,
  );
  return {
    ...actual,
    assertCommercialSnapshotMatchesAcceptance: (...args: unknown[]) =>
      mocks.assertCommercialSnapshotMatchesAcceptance(...args),
  };
});

import { assessActiveWorkImportDraft } from "../service";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function draft(): Record<string, unknown> {
  return {
    client: { name: "Noga Artist", email: "noga@example.com" },
    project: { title: "Existing EP" },
    agreement: {
      name: "EP production",
      deliverables: ["4 produced tracks"],
      rights: ["Artist owns the masters"],
      agreementText: "Our signed agreement remains the source of truth.",
      subtotalCents: 100_00,
      taxMode: "tax_free",
      taxRatePct: 0,
      taxAmountCents: 0,
      totalCents: 100_00,
      currency: "USD",
      includedSongSpaces: 4,
      plan: { kind: "full" },
    },
    payments: [],
  };
}

describe("active work import assessment failure isolation", () => {
  it("reports rejected schedule terms as Needs info but surfaces programming errors", () => {
    mocks.createInstallmentSchedule.mockImplementationOnce(() => {
      throw new Error("A 50/50 purchase needs at least two cents");
    });
    const rejected = assessActiveWorkImportDraft(draft(), NOW);
    expect(rejected.state).toBe("needs_info");
    if (rejected.state !== "needs_info") throw new Error("Expected Needs info");
    expect(rejected.reasons).toContainEqual({
      code: "plan_invalid",
      field: "agreement.plan",
      message: "The payment plan is not valid.",
    });

    mocks.createInstallmentSchedule.mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'kind')");
    });
    expect(() => assessActiveWorkImportDraft(draft(), NOW)).toThrow(TypeError);
  });

  it("reports rejected snapshot terms as Needs info but surfaces programming errors", () => {
    mocks.assertCommercialSnapshotMatchesAcceptance.mockImplementationOnce(() => {
      throw new Error("Commercial snapshot total must match the accepted purchase total");
    });
    const rejected = assessActiveWorkImportDraft(draft(), NOW);
    expect(rejected.state).toBe("needs_info");
    if (rejected.state !== "needs_info") throw new Error("Expected Needs info");
    expect(rejected.reasons.map((reason) => reason.code)).toEqual(["amount_invalid"]);

    mocks.assertCommercialSnapshotMatchesAcceptance.mockImplementationOnce(() => {
      throw new RangeError("Invalid array length");
    });
    expect(() => assessActiveWorkImportDraft(draft(), NOW)).toThrow(RangeError);
  });
});
