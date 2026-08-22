import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createCaller: vi.fn(),
}));

vi.mock("~/server/auth/clerk-identity", () => ({ auth: mocks.auth }));
vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: { createCaller: mocks.createCaller },
}));

import { materializeImportRowsAction, saveImportRowAction } from "../actions";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "..", "page.tsx"), "utf8");
const actionSource = readFileSync(join(here, "..", "actions.ts"), "utf8");

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ userId: "producer-user" });
  mocks.createCaller.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Bring active work route shell", () => {
  it("bootstraps through the producer-scoped typed caller and public assessment shape", () => {
    expect(pageSource).toContain("appRouter.createCaller({ userId })");
    expect(pageSource).toContain("caller.activeWorkImport.latestOpenBatch()");
    expect(pageSource).toContain("caller.activeWorkImport.loadBatch");
    expect(pageSource).toContain("caller.activeWorkImport.assessRow");
    expect(pageSource).toContain("mapPublicImportAssessment(result)");
    expect(pageSource).toContain('clientContacts.listWithProjects({ view: "by-client" })');
    expect(pageSource).toContain("client.producerArchivedAt === null");
    expect(pageSource).toContain("client.producerArchivedAt !== null");
    expect(pageSource).not.toContain("privateOffers.recipients");
    expect(pageSource).not.toMatch(/proofCapabilities|proofUploadToken|emailHash/);
  });

  it("keeps mutations behind route-local server actions and the typed router", () => {
    expect(actionSource).toContain('"use server"');
    expect(actionSource).toContain("appRouter.createCaller({ userId })");
    expect(actionSource).toContain("context.caller.activeWorkImport.saveRow(input)");
    expect(actionSource).toContain("context.caller.activeWorkImport.assessRow");
    expect(actionSource).toContain("context.caller.clientContacts.restore(input)");
    expect(actionSource).not.toMatch(/fetch\(|\/api\/trpc/);
  });

  it("uses mandatory server-derived reminder setup with no installment selection contract", () => {
    expect(actionSource).toContain("context.caller.activeWorkImport.finishSetup");
    expect(actionSource).not.toContain("selectedInstallmentIds");
  });

  it("materializes 101 rows through router-safe chunks from one action", async () => {
    type MaterializeInput = Readonly<{
      batchId: string;
      rows: readonly Readonly<{ rowId: string; expectedCreationDigest: string }>[];
    }>;
    type CreatedOutcome = Readonly<{
      state: "created";
      result: Readonly<{
        rowId: string;
        clientContactId: string;
        projectId: string;
        purchaseId: string;
        created: boolean;
        materializedAt: Date;
      }>;
    }>;
    const rows = Array.from({ length: 101 }, (_, index) => ({
      rowId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      expectedCreationDigest: `digest-${String(index + 1)}`,
    }));
    const outcomeFor = (row: (typeof rows)[number], index: number): CreatedOutcome => ({
      state: "created",
      result: {
        rowId: row.rowId,
        clientContactId: `client-${String(index + 1)}`,
        projectId: `project-${String(index + 1)}`,
        purchaseId: `purchase-${String(index + 1)}`,
        created: true,
        materializedAt: new Date("2026-08-20T10:00:00.000Z"),
      },
    });
    const materializeRows =
      vi.fn<(input: MaterializeInput) => Promise<readonly CreatedOutcome[]>>();
    materializeRows
      .mockResolvedValueOnce(rows.slice(0, 100).map(outcomeFor))
      .mockResolvedValueOnce(rows.slice(100).map((row, index) => outcomeFor(row, index + 100)));
    mocks.createCaller.mockReturnValue({ activeWorkImport: { materializeRows } });

    const result = await materializeImportRowsAction({
      batchId: "00000000-0000-4000-8000-000000000254",
      rows,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.outcomes).toHaveLength(101);
    expect(result.data.error).toBeNull();
    expect(result.data.outcomes[0]?.rowId).toBe(rows[0]?.rowId);
    expect(result.data.outcomes[100]?.rowId).toBe(rows[100]?.rowId);
    expect(materializeRows).toHaveBeenCalledTimes(2);
    const firstChunk = materializeRows.mock.calls[0]?.[0];
    const secondChunk = materializeRows.mock.calls[1]?.[0];
    if (!firstChunk || !secondChunk) throw new Error("Expected two materialize chunks.");
    expect(firstChunk.batchId).toBe("00000000-0000-4000-8000-000000000254");
    expect(firstChunk.rows).toHaveLength(100);
    expect(secondChunk.rows).toHaveLength(1);
  });

  it("returns the saved revision when the follow-up assessment fails", async () => {
    const saveRow = vi.fn().mockResolvedValue({
      row: {
        id: "00000000-0000-4000-8000-000000000255",
        operationKey: "row-operation",
        draftRevision: 7,
        draftPayload: { client: { name: "Maya" } },
        materializedAt: null,
        createdClientContactId: null,
        createdProjectId: null,
        createdPurchaseId: null,
        lastErrorCode: null,
      },
    });
    const assessRow = vi.fn().mockRejectedValue(new Error("temporary check failure"));
    mocks.createCaller.mockReturnValue({
      activeWorkImport: { saveRow, assessRow },
    });

    const result = await saveImportRowAction({
      batchId: "00000000-0000-4000-8000-000000000254",
      rowOperationKey: "row-operation",
      expectedRevision: 6,
      draftPayload: { client: { name: "Maya" } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.row).toMatchObject({
      id: "00000000-0000-4000-8000-000000000255",
      draftRevision: 7,
    });
    expect(result.data.assessment).toBeNull();
    expect(result.data.assessmentError).toBe("Saved, but not checked yet. Edit or try again.");
    expect(saveRow).toHaveBeenCalledTimes(1);
    expect(assessRow).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[active-work-import]"),
      expect.anything(),
    );
  });

  it("never forwards a raw error token and logs the unknown branch", async () => {
    const saveRow = vi.fn().mockRejectedValue(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }));
    mocks.createCaller.mockReturnValue({ activeWorkImport: { saveRow } });

    const result = await saveImportRowAction({
      batchId: "00000000-0000-4000-8000-000000000254",
      rowOperationKey: "row-operation",
      expectedRevision: null,
      draftPayload: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a failure result.");
    expect(result.error).toBe("Something went wrong on our side. Please try again.");
    expect(result.error).not.toMatch(/INTERNAL_SERVER_ERROR/);
    expect(result.code).toBe("INTERNAL_SERVER_ERROR");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[active-work-import]"),
      expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
    );
  });

  it("forwards the exact message only for expected client-facing codes", async () => {
    const conflict = vi
      .fn()
      .mockRejectedValue(
        new TRPCError({ code: "CONFLICT", message: "This draft changed in another save." }),
      );
    mocks.createCaller.mockReturnValue({ activeWorkImport: { saveRow: conflict } });
    const conflictResult = await saveImportRowAction({
      batchId: "00000000-0000-4000-8000-000000000254",
      rowOperationKey: "row-operation",
      expectedRevision: 1,
      draftPayload: {},
    });
    expect(conflictResult).toEqual({
      ok: false,
      error: "This draft changed in another save.",
      code: "CONFLICT",
    });

    const timeout = vi
      .fn()
      .mockRejectedValue(new TRPCError({ code: "TIMEOUT", message: "TIMEOUT" }));
    mocks.createCaller.mockReturnValue({ activeWorkImport: { saveRow: timeout } });
    const timeoutResult = await saveImportRowAction({
      batchId: "00000000-0000-4000-8000-000000000254",
      rowOperationKey: "row-operation",
      expectedRevision: 1,
      draftPayload: {},
    });
    expect(timeoutResult).toEqual({
      ok: false,
      error: "Something went wrong on our side. Please try again.",
      code: "TIMEOUT",
    });

    const bareConflict = vi.fn().mockRejectedValue(new TRPCError({ code: "CONFLICT" }));
    mocks.createCaller.mockReturnValue({ activeWorkImport: { saveRow: bareConflict } });
    const bareResult = await saveImportRowAction({
      batchId: "00000000-0000-4000-8000-000000000254",
      rowOperationKey: "row-operation",
      expectedRevision: 1,
      draftPayload: {},
    });
    if (bareResult.ok) throw new Error("Expected a failure result.");
    expect(bareResult.error).not.toBe("CONFLICT");
    expect(bareResult.error).toBe("Something changed. Review the latest details and try again.");
  });

  it("keeps the outcomes of earlier chunks when a later chunk fails", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      rowId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      expectedCreationDigest: `digest-${String(index + 1)}`,
    }));
    const materializeRows = vi
      .fn()
      .mockResolvedValueOnce(
        rows.slice(0, 100).map((row) => ({
          state: "created",
          result: {
            rowId: row.rowId,
            clientContactId: "client",
            projectId: "project",
            purchaseId: "purchase",
            created: true,
            materializedAt: new Date("2026-08-20T10:00:00.000Z"),
          },
        })),
      )
      .mockRejectedValueOnce(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }));
    mocks.createCaller.mockReturnValue({ activeWorkImport: { materializeRows } });

    const result = await materializeImportRowsAction({
      batchId: "00000000-0000-4000-8000-000000000254",
      rows,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.outcomes).toHaveLength(100);
    expect(result.data.error).toBe("Something went wrong on our side. Please try again.");
    expect(materializeRows).toHaveBeenCalledTimes(2);
  });

  it("reports a failed first chunk with no outcomes", async () => {
    const materializeRows = vi
      .fn()
      .mockRejectedValue(new TRPCError({ code: "CONFLICT", message: "Details changed." }));
    mocks.createCaller.mockReturnValue({ activeWorkImport: { materializeRows } });

    const result = await materializeImportRowsAction({
      batchId: "00000000-0000-4000-8000-000000000254",
      rows: [{ rowId: "00000000-0000-4000-8000-000000000001", expectedCreationDigest: "d" }],
    });

    expect(result).toEqual({ ok: true, data: { outcomes: [], error: "Details changed." } });
  });
});
