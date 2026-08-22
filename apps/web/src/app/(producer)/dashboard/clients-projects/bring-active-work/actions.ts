"use server";

import { TRPCError } from "@trpc/server";
import { auth } from "~/server/auth/clerk-identity";

import type {
  ImportAssessmentView,
  SetupOptionsView,
  StoredImportRowView,
} from "~/components/dashboard/active-work-import/model";
import { mapPublicImportAssessment } from "~/components/dashboard/active-work-import/model";
import { appRouter } from "~/server/trpc/routers/_app";

export type ImportActionResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: string; code?: string }>;

async function callerOrError(): Promise<
  | Readonly<{ ok: true; caller: ReturnType<typeof appRouter.createCaller> }>
  | Readonly<{ ok: false; error: string }>
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

const GENERIC_ERROR = "Something went wrong on our side. Please try again.";
const CHANGED_ERROR = "Something changed. Review the latest details and try again.";

// tRPC fills a missing message with the code itself ("INTERNAL_SERVER_ERROR")
// and zod failures arrive as a JSON array. Neither is a sentence a producer
// should read, so only a real sentence is forwarded.
function humanMessage(error: TRPCError): string | null {
  const message = error.message.trim();
  if (!message || message === error.code || /^[[{]/.test(message)) return null;
  return message;
}

function actionError(error: unknown): Readonly<{ error: string; code?: string }> {
  if (error instanceof TRPCError) {
    if (error.code === "UNAUTHORIZED") {
      return { error: "Please sign in to continue.", code: error.code };
    }
    if (error.code === "NOT_FOUND") {
      return { error: "This saved setup could not be found.", code: error.code };
    }
    if (error.code === "BAD_REQUEST" || error.code === "CONFLICT") {
      return { error: humanMessage(error) ?? CHANGED_ERROR, code: error.code };
    }
    console.error("[active-work-import] unexpected action failure", {
      code: error.code,
      message: error.message,
    });
    return { error: GENERIC_ERROR, code: error.code };
  }
  console.error("[active-work-import] unexpected action failure", {
    error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
  });
  return { error: GENERIC_ERROR, code: "INTERNAL" };
}

function mapRow(row: {
  id: string;
  operationKey: string;
  draftRevision: number;
  draftPayload: Record<string, unknown>;
  materializedAt: Date | null;
  createdClientContactId: string | null;
  createdProjectId: string | null;
  createdPurchaseId: string | null;
  lastErrorCode: string | null;
}): StoredImportRowView {
  return {
    id: row.id,
    operationKey: row.operationKey,
    draftRevision: row.draftRevision,
    draftPayload: row.draftPayload,
    materializedAtIso: row.materializedAt?.toISOString() ?? null,
    createdClientContactId: row.createdClientContactId,
    createdProjectId: row.createdProjectId,
    createdPurchaseId: row.createdPurchaseId,
    lastErrorCode: row.lastErrorCode,
  };
}

export async function createImportBatchAction(input: {
  operationKey: string;
}): Promise<ImportActionResult<{ batchId: string }>> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    const result = await context.caller.activeWorkImport.createBatch(input);
    return { ok: true, data: { batchId: result.batch.id } };
  } catch (error) {
    return { ok: false, ...actionError(error) };
  }
}

export async function saveImportRowAction(input: {
  batchId: string;
  rowOperationKey: string;
  expectedRevision: number | null;
  draftPayload: Record<string, unknown>;
}): Promise<
  ImportActionResult<{
    row: StoredImportRowView;
    assessment: ImportAssessmentView | null;
    assessmentError: string | null;
  }>
> {
  const context = await callerOrError();
  if (!context.ok) return context;
  let saved: Awaited<ReturnType<typeof context.caller.activeWorkImport.saveRow>>;
  try {
    saved = await context.caller.activeWorkImport.saveRow(input);
  } catch (error) {
    return { ok: false, ...actionError(error) };
  }

  try {
    const assessment = await context.caller.activeWorkImport.assessRow({
      batchId: input.batchId,
      rowId: saved.row.id,
    });
    return {
      ok: true,
      data: {
        row: mapRow(saved.row),
        assessment: mapPublicImportAssessment(assessment),
        assessmentError: null,
      },
    };
  } catch (error) {
    console.error("[active-work-import] assessment failed after a successful save", {
      rowId: saved.row.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
    });
    return {
      ok: true,
      data: {
        row: mapRow(saved.row),
        assessment: null,
        assessmentError: "Saved, but not checked yet. Edit or try again.",
      },
    };
  }
}

/**
 * Re-reads the stored rows of a batch. The workspace uses it to adopt the
 * server's current draft revision after a CONFLICT caused by a lost response
 * (single-producer surface, last write wins).
 */
export async function loadImportBatchRowsAction(input: {
  batchId: string;
}): Promise<ImportActionResult<{ rows: readonly StoredImportRowView[] }>> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    const loaded = await context.caller.activeWorkImport.loadBatch(input);
    return { ok: true, data: { rows: loaded.rows.map(mapRow) } };
  } catch (error) {
    return { ok: false, ...actionError(error) };
  }
}

export async function restoreImportClientAction(input: {
  id: string;
}): Promise<ImportActionResult<{ id: string; changed: boolean }>> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    const result = await context.caller.clientContacts.restore(input);
    return { ok: true, data: { id: result.id, changed: result.changed } };
  } catch (error) {
    return { ok: false, ...actionError(error) };
  }
}

export async function deleteImportRowAction(input: {
  batchId: string;
  rowId: string;
}): Promise<ImportActionResult<{ deleted: true }>> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    return { ok: true, data: await context.caller.activeWorkImport.deleteRow(input) };
  } catch (error) {
    return { ok: false, ...actionError(error) };
  }
}

export async function prepareImportProofAction(input: {
  batchId: string;
  rowId: string;
  paymentOperationKey: string;
  originalFileName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "application/pdf";
  sizeBytes: number;
}): Promise<
  ImportActionResult<{ uploadUrl: string; uploadToken: string; expiresInSeconds: number }>
> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    return { ok: true, data: await context.caller.activeWorkImport.prepareProof(input) };
  } catch (error) {
    return { ok: false, ...actionError(error) };
  }
}

export type MaterializeImportOutcome =
  | Readonly<{
      state: "created";
      rowId: string;
      clientContactId: string;
      projectId: string;
      purchaseId: string;
      created: boolean;
      materializedAtIso: string;
    }>
  | Readonly<{
      state: "needs_info";
      rowId: string;
      reasons: readonly Readonly<{ code: string; field: string; message: string }>[];
    }>
  | Readonly<{ state: "failed"; rowId: string; code: string; message: string }>;

const MATERIALIZE_ROWS_CHUNK_SIZE = 100;

/**
 * Rows are created in router-safe chunks. A chunk that fails stops the run,
 * but the outcomes already returned by earlier chunks are real created work,
 * so they travel back together with the error instead of being dropped.
 */
export async function materializeImportRowsAction(input: {
  batchId: string;
  rows: readonly Readonly<{ rowId: string; expectedCreationDigest: string }>[];
}): Promise<
  ImportActionResult<{ outcomes: readonly MaterializeImportOutcome[]; error: string | null }>
> {
  const context = await callerOrError();
  if (!context.ok) return context;
  const materializedOutcomes: MaterializeImportOutcome[] = [];
  for (let offset = 0; offset < input.rows.length; offset += MATERIALIZE_ROWS_CHUNK_SIZE) {
    let outcomes: Awaited<ReturnType<typeof context.caller.activeWorkImport.materializeRows>>;
    try {
      outcomes = await context.caller.activeWorkImport.materializeRows({
        batchId: input.batchId,
        rows: input.rows.slice(offset, offset + MATERIALIZE_ROWS_CHUNK_SIZE),
      });
    } catch (error) {
      return {
        ok: true,
        data: { outcomes: materializedOutcomes, error: actionError(error).error },
      };
    }
    materializedOutcomes.push(
      ...outcomes.map((outcome): MaterializeImportOutcome => {
        if (outcome.state === "created") {
          return {
            state: "created",
            rowId: outcome.result.rowId,
            clientContactId: outcome.result.clientContactId,
            projectId: outcome.result.projectId,
            purchaseId: outcome.result.purchaseId,
            created: outcome.result.created,
            materializedAtIso: outcome.result.materializedAt.toISOString(),
          };
        }
        if (outcome.state === "needs_info") {
          return { state: "needs_info", rowId: outcome.rowId, reasons: outcome.reasons };
        }
        return outcome;
      }),
    );
  }
  return { ok: true, data: { outcomes: materializedOutcomes, error: null } };
}

export async function loadImportSetupOptionsAction(input: {
  batchId: string;
}): Promise<ImportActionResult<SetupOptionsView>> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    const options = await context.caller.activeWorkImport.setupOptions(input);
    return {
      ok: true,
      data: {
        setupDigest: options.setupDigest,
        distinctClientCount: options.distinctClientCount,
        projectPurchaseCount: options.projectPurchaseCount,
        clients: options.clients.map((client) => ({
          ...client,
          providerAcceptedAtIso: client.providerAcceptedAt?.toISOString() ?? null,
        })),
        installments: options.installments.map((installment) => ({
          ...installment,
          dueAtIso: installment.dueAt?.toISOString() ?? null,
          triggeredAtIso: installment.triggeredAt?.toISOString() ?? null,
        })),
      },
    };
  } catch (error) {
    return { ok: false, ...actionError(error) };
  }
}

export type FinishImportSetupView = Readonly<{
  distinctClientCount: number;
  projectPurchaseCount: number;
  invitations: readonly Readonly<{
    clientContactId: string;
    status: "requested" | "provider_accepted" | "failed" | "connected";
    providerAcceptedAtIso: string | null;
  }>[];
  reminders: readonly Readonly<{
    installmentId: string;
    purchaseId: string;
    status: "enabled" | "failed";
    changed: boolean;
  }>[];
}>;

export async function finishImportSetupAction(input: {
  batchId: string;
  operationKey: string;
  expectedSetupDigest: string;
  selectedClientContactIds: readonly string[];
}): Promise<ImportActionResult<FinishImportSetupView>> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    const result = await context.caller.activeWorkImport.finishSetup({
      ...input,
      selectedClientContactIds: [...input.selectedClientContactIds],
    });
    return {
      ok: true,
      data: {
        ...result,
        invitations: result.invitations.map((invitation) => ({
          ...invitation,
          providerAcceptedAtIso: invitation.providerAcceptedAt?.toISOString() ?? null,
        })),
      },
    };
  } catch (error) {
    return { ok: false, ...actionError(error) };
  }
}
