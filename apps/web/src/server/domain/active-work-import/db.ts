import {
  activeWorkImportBatches,
  activeWorkImportRows,
  and,
  asc,
  clientContacts,
  desc,
  eq,
  inArray,
  isNull,
  paymentProofs,
  products,
  projects,
  purchaseImportAttestations,
  purchaseInstallments,
  purchases,
  sql,
  type Db,
} from "@skitza/db";

import { emailHashFor } from "~/server/artist/identity";
import { generateRefNumber } from "~/lib/purchase/request-helpers";
import {
  lockPurchaseLedgerScope,
  purchaseLedgerRepositoryForTransaction,
} from "../purchase-ledger/db";
import {
  reconcilePurchaseLedger,
  recordConfirmedPurchasePayment,
} from "../purchase-ledger/service";
import { digestCommercialSnapshot } from "../purchases/policy";
import type { FinalizedProofObject } from "../payment-proofs/storage";
import type { ActiveWorkImportProofCapability } from "./proof-capability";
import {
  ActiveWorkImportDomainError,
  activeWorkImportExistingClientReason,
  assessActiveWorkImportDraft,
  type ActiveWorkImportAssessment,
  type NormalizedActiveWorkImport,
} from "./service";

type ImportTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type StoredActiveWorkImportRow = Readonly<{
  id: string;
  batchId: string;
  producerId: string;
  operationKey: string;
  draftRevision: number;
  draftPayload: Record<string, unknown>;
  creationDigest: string | null;
  createdClientContactId: string | null;
  createdProjectId: string | null;
  createdPurchaseId: string | null;
  materializedAt: Date | null;
  lastAttemptedAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ActiveWorkImportRowResult = Readonly<{
  rowId: string;
  clientContactId: string;
  projectId: string;
  purchaseId: string;
  creationDigest: string;
  materializedAt: Date;
  created: boolean;
}>;

function operationKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new ActiveWorkImportDomainError(
      "INVALID_INPUT",
      "Operation key must be between 1 and 200 characters",
    );
  }
  return normalized;
}

function rowSelection() {
  return {
    id: activeWorkImportRows.id,
    batchId: activeWorkImportRows.batchId,
    producerId: activeWorkImportRows.producerId,
    operationKey: activeWorkImportRows.operationKey,
    draftRevision: activeWorkImportRows.draftRevision,
    draftPayload: activeWorkImportRows.draftPayload,
    creationDigest: activeWorkImportRows.creationDigest,
    createdClientContactId: activeWorkImportRows.createdClientContactId,
    createdProjectId: activeWorkImportRows.createdProjectId,
    createdPurchaseId: activeWorkImportRows.createdPurchaseId,
    materializedAt: activeWorkImportRows.materializedAt,
    lastAttemptedAt: activeWorkImportRows.lastAttemptedAt,
    lastErrorCode: activeWorkImportRows.lastErrorCode,
    createdAt: activeWorkImportRows.createdAt,
    updatedAt: activeWorkImportRows.updatedAt,
  };
}

async function lockBatch(
  tx: ImportTransaction,
  input: Readonly<{ producerId: string; batchId: string }>,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`active-work-import-batch:${input.batchId}`}, 0))`,
  );
  const [batch] = await tx
    .select()
    .from(activeWorkImportBatches)
    .where(
      and(
        eq(activeWorkImportBatches.id, input.batchId),
        eq(activeWorkImportBatches.producerId, input.producerId),
      ),
    )
    .limit(1)
    .for("update");
  return batch ?? null;
}

export async function createActiveWorkImportBatch(
  db: Db,
  input: Readonly<{
    producerId: string;
    clerkUserId: string;
    operationKey: string;
    now?: Date;
  }>,
) {
  const key = operationKey(input.operationKey);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`active-work-import-batch-operation:${input.producerId}:${key}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(activeWorkImportBatches)
      .where(
        and(
          eq(activeWorkImportBatches.producerId, input.producerId),
          eq(activeWorkImportBatches.operationKey, key),
        ),
      )
      .limit(1);
    if (existing) return { batch: existing, created: false } as const;
    const [batch] = await tx
      .insert(activeWorkImportBatches)
      .values({
        producerId: input.producerId,
        operationKey: key,
        createdByClerkUserId: input.clerkUserId,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!batch) throw new Error("Import batch insert did not return a row");
    return { batch, created: true } as const;
  });
}

export async function loadActiveWorkImportBatch(
  db: Db,
  input: Readonly<{ producerId: string; batchId: string }>,
) {
  const [batch] = await db
    .select()
    .from(activeWorkImportBatches)
    .where(
      and(
        eq(activeWorkImportBatches.id, input.batchId),
        eq(activeWorkImportBatches.producerId, input.producerId),
      ),
    )
    .limit(1);
  if (!batch) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import batch was not found");
  const rows = await db
    .select(rowSelection())
    .from(activeWorkImportRows)
    .where(
      and(
        eq(activeWorkImportRows.batchId, input.batchId),
        eq(activeWorkImportRows.producerId, input.producerId),
      ),
    )
    .orderBy(asc(activeWorkImportRows.createdAt), asc(activeWorkImportRows.id));
  return { batch, rows: rows as StoredActiveWorkImportRow[] };
}

/**
 * Rediscover the producer's most recently touched unfinished import. Draft
 * discovery is server-owned so leaving the setup never makes a saved batch
 * depend on browser storage. A fully materialized batch stays in progress and
 * discoverable until mandatory Finish setup succeeds. Completed batches remain
 * addressable through the exact-id loader for an idempotent finish replay.
 */
export async function loadLatestOpenActiveWorkImportBatch(
  db: Db,
  input: Readonly<{ producerId: string }>,
) {
  const [batch] = await db
    .select({ id: activeWorkImportBatches.id })
    .from(activeWorkImportBatches)
    .where(
      and(
        eq(activeWorkImportBatches.producerId, input.producerId),
        inArray(activeWorkImportBatches.status, ["draft", "in_progress"]),
      ),
    )
    .orderBy(desc(activeWorkImportBatches.updatedAt), desc(activeWorkImportBatches.id))
    .limit(1);
  return batch
    ? loadActiveWorkImportBatch(db, { producerId: input.producerId, batchId: batch.id })
    : null;
}

export async function saveActiveWorkImportRow(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowOperationKey: string;
    expectedRevision: number | null;
    draftPayload: Record<string, unknown>;
    now?: Date;
  }>,
): Promise<Readonly<{ row: StoredActiveWorkImportRow; created: boolean; changed: boolean }>> {
  const key = operationKey(input.rowOperationKey);
  const now = input.now ?? new Date();
  const payloadDigest = digestCommercialSnapshot(input.draftPayload);
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, input);
    if (!batch || batch.status === "completed") {
      throw new ActiveWorkImportDomainError("NOT_FOUND", "Import batch was not found");
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`active-work-import-row-operation:${input.producerId}:${key}`}, 0))`,
    );
    const [existing] = await tx
      .select(rowSelection())
      .from(activeWorkImportRows)
      .where(
        and(
          eq(activeWorkImportRows.producerId, input.producerId),
          eq(activeWorkImportRows.operationKey, key),
        ),
      )
      .limit(1)
      .for("update");
    if (existing) {
      if (existing.batchId !== input.batchId) {
        throw new ActiveWorkImportDomainError(
          "OPERATION_KEY_CONFLICT",
          "This row operation key belongs to another import batch",
        );
      }
      if (existing.materializedAt !== null) {
        throw new ActiveWorkImportDomainError("CONFLICT", "Created import rows cannot be changed");
      }
      const samePayload = digestCommercialSnapshot(existing.draftPayload) === payloadDigest;
      if (input.expectedRevision !== existing.draftRevision) {
        if (samePayload) {
          return { row: existing as StoredActiveWorkImportRow, created: false, changed: false };
        }
        throw new ActiveWorkImportDomainError(
          "CONFLICT",
          "This draft changed in another save. Refresh and try again.",
        );
      }
      if (samePayload) {
        return { row: existing as StoredActiveWorkImportRow, created: false, changed: false };
      }
      const [updated] = await tx
        .update(activeWorkImportRows)
        .set({
          draftRevision: existing.draftRevision + 1,
          draftPayload: input.draftPayload,
          lastAttemptedAt: null,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(activeWorkImportRows.id, existing.id),
            eq(activeWorkImportRows.producerId, input.producerId),
            eq(activeWorkImportRows.draftRevision, existing.draftRevision),
            isNull(activeWorkImportRows.materializedAt),
          ),
        )
        .returning(rowSelection());
      if (!updated) {
        throw new ActiveWorkImportDomainError("CONFLICT", "This draft changed. Refresh and retry.");
      }
      await tx
        .update(activeWorkImportBatches)
        .set({ updatedAt: now })
        .where(
          and(
            eq(activeWorkImportBatches.id, input.batchId),
            eq(activeWorkImportBatches.producerId, input.producerId),
          ),
        );
      return { row: updated as StoredActiveWorkImportRow, created: false, changed: true };
    }
    if (input.expectedRevision !== null) {
      throw new ActiveWorkImportDomainError("NOT_FOUND", "Import row was not found");
    }
    const [row] = await tx
      .insert(activeWorkImportRows)
      .values({
        batchId: input.batchId,
        producerId: input.producerId,
        operationKey: key,
        draftRevision: 1,
        draftPayload: input.draftPayload,
        createdAt: now,
        updatedAt: now,
      })
      .returning(rowSelection());
    if (!row) throw new Error("Import row insert did not return a row");
    await tx
      .update(activeWorkImportBatches)
      .set({ updatedAt: now })
      .where(
        and(
          eq(activeWorkImportBatches.id, input.batchId),
          eq(activeWorkImportBatches.producerId, input.producerId),
        ),
      );
    return { row: row as StoredActiveWorkImportRow, created: true, changed: true };
  });
}

export async function deleteActiveWorkImportRow(
  db: Db,
  input: Readonly<{ producerId: string; batchId: string; rowId: string; now?: Date }>,
): Promise<{ deleted: true }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, input);
    if (!batch) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import batch was not found");
    const [row] = await tx
      .select(rowSelection())
      .from(activeWorkImportRows)
      .where(
        and(
          eq(activeWorkImportRows.id, input.rowId),
          eq(activeWorkImportRows.batchId, input.batchId),
          eq(activeWorkImportRows.producerId, input.producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import row was not found");
    if (row.materializedAt !== null) {
      throw new ActiveWorkImportDomainError("CONFLICT", "Created import rows cannot be deleted");
    }
    const deleted = await tx
      .delete(activeWorkImportRows)
      .where(
        and(
          eq(activeWorkImportRows.id, input.rowId),
          eq(activeWorkImportRows.producerId, input.producerId),
          isNull(activeWorkImportRows.materializedAt),
        ),
      )
      .returning({ id: activeWorkImportRows.id });
    if (deleted.length !== 1) {
      throw new ActiveWorkImportDomainError("CONFLICT", "Import row changed. Refresh and retry.");
    }
    await tx
      .update(activeWorkImportBatches)
      .set({ updatedAt: now })
      .where(
        and(
          eq(activeWorkImportBatches.id, input.batchId),
          eq(activeWorkImportBatches.producerId, input.producerId),
        ),
      );
    return { deleted: true };
  });
}

export async function loadUnmaterializedImportRow(
  db: Db,
  input: Readonly<{ producerId: string; batchId: string; rowId: string }>,
): Promise<StoredActiveWorkImportRow> {
  const [row] = await db
    .select(rowSelection())
    .from(activeWorkImportRows)
    .innerJoin(
      activeWorkImportBatches,
      and(
        eq(activeWorkImportBatches.id, activeWorkImportRows.batchId),
        eq(activeWorkImportBatches.producerId, activeWorkImportRows.producerId),
      ),
    )
    .where(
      and(
        eq(activeWorkImportRows.id, input.rowId),
        eq(activeWorkImportRows.batchId, input.batchId),
        eq(activeWorkImportRows.producerId, input.producerId),
        isNull(activeWorkImportRows.materializedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import row was not found");
  return row as StoredActiveWorkImportRow;
}

export async function assessStoredActiveWorkImportRow(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    asOf?: Date;
  }>,
): Promise<ActiveWorkImportAssessment> {
  const row = await loadUnmaterializedImportRow(db, input);
  const assessment = assessActiveWorkImportDraft(row.draftPayload, input.asOf);
  if (assessment.state === "needs_info") return assessment;
  const normalized = assessment.normalized;
  const reasons: Extract<ActiveWorkImportAssessment, { state: "needs_info" }>["reasons"][number][] =
    [];
  if (normalized.existingClientId) {
    const [client] = await db
      .select({
        emailHash: clientContacts.emailHash,
        producerArchivedAt: clientContacts.producerArchivedAt,
      })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, normalized.existingClientId),
          eq(clientContacts.producerId, input.producerId),
        ),
      )
      .limit(1);
    if (!client) {
      reasons.push({
        code: "existing_client_not_found",
        field: "client.existingClientId",
        message: "Choose a client that belongs to your studio.",
      });
    } else {
      const reason = activeWorkImportExistingClientReason({
        explicitlySelected: true,
        emailMatches: client.emailHash === emailHashFor(normalized.clientEmail),
        producerArchivedAt: client.producerArchivedAt,
      });
      if (reason) reasons.push(reason);
    }
  } else {
    const [matchingClient] = await db
      .select({
        id: clientContacts.id,
        producerArchivedAt: clientContacts.producerArchivedAt,
      })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.producerId, input.producerId),
          eq(clientContacts.emailHash, emailHashFor(normalized.clientEmail)),
        ),
      )
      .limit(1);
    if (matchingClient) {
      const reason = activeWorkImportExistingClientReason({
        explicitlySelected: false,
        emailMatches: true,
        producerArchivedAt: matchingClient.producerArchivedAt,
      });
      if (reason) reasons.push(reason);
    }
  }
  if (normalized.templateProductId) {
    const [template] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.id, normalized.templateProductId),
          eq(products.producerId, input.producerId),
        ),
      )
      .limit(1);
    if (!template) {
      reasons.push({
        code: "template_not_found",
        field: "agreement.templateProductId",
        message: "Choose a Store template that belongs to your studio.",
      });
    }
  }
  return reasons.length > 0 ? { state: "needs_info", reasons } : assessment;
}

export async function markActiveWorkImportRowFailure(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    errorCode: string;
    attemptedAt: Date;
  }>,
): Promise<void> {
  await db
    .update(activeWorkImportRows)
    .set({
      lastAttemptedAt: input.attemptedAt,
      lastErrorCode: input.errorCode.slice(0, 200),
      updatedAt: input.attemptedAt,
    })
    .where(
      and(
        eq(activeWorkImportRows.id, input.rowId),
        eq(activeWorkImportRows.batchId, input.batchId),
        eq(activeWorkImportRows.producerId, input.producerId),
        isNull(activeWorkImportRows.materializedAt),
      ),
    );
}

/**
 * A proof object that is gone or changed cannot be finalized by retrying the
 * same signed token. Drop that payment's token so the next attempt asks for the
 * file again (the UI keeps the file name for the prompt), and bump the draft
 * revision so a stale client save cannot resurrect the dead token.
 */
export async function clearActiveWorkImportProofUploadToken(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    paymentOperationKey: string;
    now: Date;
  }>,
): Promise<Readonly<{ cleared: boolean }>> {
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, input);
    if (!batch) return { cleared: false };
    const [row] = await tx
      .select(rowSelection())
      .from(activeWorkImportRows)
      .where(
        and(
          eq(activeWorkImportRows.id, input.rowId),
          eq(activeWorkImportRows.batchId, input.batchId),
          eq(activeWorkImportRows.producerId, input.producerId),
          isNull(activeWorkImportRows.materializedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) return { cleared: false };
    const rawPayments: unknown[] = Array.isArray(row.draftPayload.payments)
      ? row.draftPayload.payments
      : [];
    const payments = rawPayments.map((raw) => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const payment = raw as Record<string, unknown>;
      if (
        payment.operationKey !== input.paymentOperationKey ||
        payment.proofUploadToken === null ||
        payment.proofUploadToken === undefined
      ) {
        return raw;
      }
      return { ...payment, proofUploadToken: null };
    });
    if (payments.every((payment, index) => payment === rawPayments[index])) {
      return { cleared: false };
    }
    const [updated] = await tx
      .update(activeWorkImportRows)
      .set({
        draftRevision: row.draftRevision + 1,
        draftPayload: { ...row.draftPayload, payments },
        updatedAt: input.now,
      })
      .where(
        and(
          eq(activeWorkImportRows.id, row.id),
          eq(activeWorkImportRows.producerId, input.producerId),
          eq(activeWorkImportRows.draftRevision, row.draftRevision),
          isNull(activeWorkImportRows.materializedAt),
        ),
      )
      .returning({ id: activeWorkImportRows.id });
    if (!updated) {
      throw new ActiveWorkImportDomainError("CONFLICT", "This draft changed. Refresh and retry.");
    }
    await tx
      .update(activeWorkImportBatches)
      .set({ updatedAt: input.now })
      .where(
        and(
          eq(activeWorkImportBatches.id, input.batchId),
          eq(activeWorkImportBatches.producerId, input.producerId),
        ),
      );
    return { cleared: true };
  });
}

/**
 * Compensate a finalized proof only while holding the same batch/row lock as
 * materialization. This closes the gap where a concurrent retry could start
 * using the deterministic proof object after a failed transaction but before
 * an unlocked cleanup deleted it.
 *
 * Any missing scope, committed materialization, persisted proof, or cleanup
 * error fails closed by preserving the object.
 */
export async function cleanupUnpersistedActiveWorkImportProof(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    storageKey: string;
    deleteProof: (storageKey: string) => Promise<void>;
  }>,
): Promise<"deleted" | "preserved"> {
  try {
    return await db.transaction(async (tx) => {
      const batch = await lockBatch(tx, input);
      if (!batch) return "preserved" as const;
      const [row] = await tx
        .select({ materializedAt: activeWorkImportRows.materializedAt })
        .from(activeWorkImportRows)
        .where(
          and(
            eq(activeWorkImportRows.id, input.rowId),
            eq(activeWorkImportRows.batchId, input.batchId),
            eq(activeWorkImportRows.producerId, input.producerId),
          ),
        )
        .limit(1)
        .for("update");
      if (!row || row.materializedAt !== null) return "preserved" as const;
      const [persisted] = await tx
        .select({ id: paymentProofs.id })
        .from(paymentProofs)
        .where(
          and(
            eq(paymentProofs.storageKey, input.storageKey),
            eq(paymentProofs.producerId, input.producerId),
          ),
        )
        .limit(1);
      if (persisted) return "preserved" as const;
      await input.deleteProof(input.storageKey);
      return "deleted" as const;
    });
  } catch (error) {
    console.error("[active-work-import] proof cleanup preserved object", {
      storageKey: input.storageKey,
      error,
    });
    return "preserved";
  }
}

export async function materializeActiveWorkImportRowTransaction(
  db: Db,
  input: Readonly<{
    producerId: string;
    clerkUserId: string;
    batchId: string;
    rowId: string;
    expectedDraftRevision: number;
    expectedDraftDigest: string;
    creationDigest: string;
    normalized: NormalizedActiveWorkImport;
    proofCapabilities: ReadonlyMap<string, ActiveWorkImportProofCapability>;
    finalizeProof: (capability: ActiveWorkImportProofCapability) => Promise<FinalizedProofObject>;
    importedAt: Date;
  }>,
): Promise<ActiveWorkImportRowResult> {
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, input);
    if (!batch) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import batch was not found");
    const [row] = await tx
      .select(rowSelection())
      .from(activeWorkImportRows)
      .where(
        and(
          eq(activeWorkImportRows.id, input.rowId),
          eq(activeWorkImportRows.batchId, input.batchId),
          eq(activeWorkImportRows.producerId, input.producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import row was not found");
    if (row.materializedAt !== null) {
      if (
        row.creationDigest !== input.creationDigest ||
        !row.createdClientContactId ||
        !row.createdProjectId ||
        !row.createdPurchaseId
      ) {
        throw new ActiveWorkImportDomainError(
          "OPERATION_KEY_CONFLICT",
          "This import row was already created with different details",
        );
      }
      return {
        rowId: row.id,
        clientContactId: row.createdClientContactId,
        projectId: row.createdProjectId,
        purchaseId: row.createdPurchaseId,
        creationDigest: row.creationDigest,
        materializedAt: row.materializedAt,
        created: false,
      };
    }
    if (
      row.draftRevision !== input.expectedDraftRevision ||
      digestCommercialSnapshot(row.draftPayload) !== input.expectedDraftDigest
    ) {
      throw new ActiveWorkImportDomainError(
        "CONFLICT",
        "This draft changed before it was created. Review it and try again.",
      );
    }
    if (input.normalized.templateProductId) {
      const [template] = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.id, input.normalized.templateProductId),
            eq(products.producerId, input.producerId),
          ),
        )
        .limit(1)
        .for("update");
      if (!template) {
        throw new ActiveWorkImportDomainError("INVALID_INPUT", "Store template was not found");
      }
    }

    const emailHash = emailHashFor(input.normalized.clientEmail);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`client-email:${input.producerId}:${emailHash}`}, 0))`,
    );
    let client = input.normalized.existingClientId
      ? (
          await tx
            .select()
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.id, input.normalized.existingClientId),
                eq(clientContacts.producerId, input.producerId),
              ),
            )
            .limit(1)
            .for("update")
        )[0]
      : (
          await tx
            .select()
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.producerId, input.producerId),
                eq(clientContacts.emailHash, emailHash),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
    if (!input.normalized.existingClientId && client) {
      throw new ActiveWorkImportDomainError(
        "CONFLICT",
        "This email is already a Client. Review the row and choose that Client.",
      );
    }
    if (input.normalized.existingClientId && !client) {
      throw new ActiveWorkImportDomainError(
        "NOT_FOUND",
        "The chosen Client no longer exists. Review the row and choose a Client again.",
      );
    }
    if (client && client.producerArchivedAt !== null) {
      throw new ActiveWorkImportDomainError(
        "INVALID_INPUT",
        "Restore this client in Clients & Projects before adding active work.",
      );
    }
    if (client && client.emailHash !== emailHash) {
      throw new ActiveWorkImportDomainError(
        "INVALID_INPUT",
        "The chosen client uses a different email",
      );
    }
    if (!client) {
      const [inserted] = await tx
        .insert(clientContacts)
        .values({
          producerId: input.producerId,
          emailHash,
          email: input.normalized.clientEmail,
          name: input.normalized.clientName,
          phone: input.normalized.clientPhone,
          firstSeenAt: input.importedAt,
          lastSeenAt: input.importedAt,
        })
        .onConflictDoNothing()
        .returning();
      client = inserted;
      if (!client) {
        throw new ActiveWorkImportDomainError(
          "CONFLICT",
          "This email became an existing Client. Review the row and choose that Client.",
        );
      }
    }
    if (client.producerId !== input.producerId || client.emailHash !== emailHash) {
      throw new ActiveWorkImportDomainError(
        "INTEGRITY_ERROR",
        "Client identity could not be saved",
      );
    }

    const [project] = await tx
      .insert(projects)
      .values({
        producerId: input.producerId,
        clientContactId: client.id,
        title: input.normalized.projectTitle,
        lifecycleStatus: "waiting_for_payment",
        lifecycleChangedAt: input.importedAt,
        clientName: client.name,
        clientEmail: client.email,
        artistName: client.name,
        artistEmail: client.email,
        deadlineAt: input.normalized.deadlineAt,
        createdAt: input.importedAt,
        updatedAt: input.importedAt,
      })
      .returning();
    if (!project) throw new Error("Imported project insert did not return a row");

    const purchaseOperationDigest = digestCommercialSnapshot({
      kind: "active-work-import-purchase-v1",
      rowOperationKey: row.operationKey,
      projectId: project.id,
      clientContactId: client.id,
      snapshotDigest: input.normalized.snapshotDigest,
      plan: input.normalized.plan,
    });
    const [purchase] = await tx
      .insert(purchases)
      .values({
        producerId: input.producerId,
        projectId: project.id,
        clientContactId: client.id,
        productId: null,
        privateOfferId: null,
        purchaseRequestId: null,
        sourceKind: "imported_existing_work",
        operationKey: row.operationKey,
        operationDigest: purchaseOperationDigest,
        refNumber: generateRefNumber(),
        lifecycleStatus: "waiting_for_payment",
        paymentPlanKind: input.normalized.plan.kind,
        snapshotVersion: input.normalized.commercialSnapshot.version,
        snapshotDigest: input.normalized.snapshotDigest,
        commercialSnapshot: input.normalized.commercialSnapshot,
        subtotalCents: input.normalized.commercialSnapshot.subtotalCents,
        taxCents: input.normalized.commercialSnapshot.tax.amountCents,
        totalCents: input.normalized.commercialSnapshot.totalCents,
        currency: input.normalized.commercialSnapshot.currency,
        acceptedAt: null,
        commercialEstablishedAt: input.importedAt,
        createdAt: input.importedAt,
        updatedAt: input.importedAt,
      })
      .returning();
    if (!purchase) throw new Error("Imported purchase insert did not return a row");
    const installmentRows = await tx
      .insert(purchaseInstallments)
      .values(
        input.normalized.schedule.map((installment) => ({
          purchaseId: purchase.id,
          producerId: input.producerId,
          position: installment.sequence,
          amountCents: installment.amountCents,
          currency: input.normalized.commercialSnapshot.currency,
          dueTrigger: installment.trigger,
          dueAt: installment.sequence === 1 ? input.importedAt : null,
          triggeredAt: installment.sequence === 1 ? input.importedAt : null,
          requiredForActivation: installment.sequence === 1,
          status: "not_paid" as const,
          remindersEnabled: false,
          createdAt: input.importedAt,
          updatedAt: input.importedAt,
        })),
      )
      .returning({ id: purchaseInstallments.id, position: purchaseInstallments.position });
    if (installmentRows.length !== input.normalized.schedule.length) {
      throw new Error("Imported installment schedule was not saved exactly");
    }
    // The attestation seals the imported schedule in SQL. Every installment
    // must exist before this immutable provenance row is inserted.
    const [attestation] = await tx
      .insert(purchaseImportAttestations)
      .values({
        purchaseId: purchase.id,
        producerId: input.producerId,
        clientContactId: client.id,
        importedByClerkUserId: input.clerkUserId,
        importedSnapshot: input.normalized.commercialSnapshot,
        snapshotDigest: input.normalized.snapshotDigest,
        importedAt: input.importedAt,
        createdAt: input.importedAt,
      })
      .returning({ id: purchaseImportAttestations.id });
    if (!attestation) throw new Error("Purchase import attestation insert did not return a row");
    const installmentByPosition = new Map(
      installmentRows.map((installment) => [installment.position, installment.id]),
    );

    const ledgerScope = { producerId: input.producerId, purchaseId: purchase.id };
    await lockPurchaseLedgerScope(tx, ledgerScope);
    const ledgerRepository = purchaseLedgerRepositoryForTransaction(tx, ledgerScope);
    const orderedPayments = [...input.normalized.payments].sort(
      (left, right) =>
        left.installmentPosition - right.installmentPosition ||
        left.paidAt.getTime() - right.paidAt.getTime() ||
        left.operationKey.localeCompare(right.operationKey),
    );
    const expectedProofOperations = new Set(
      orderedPayments
        .filter((payment) => payment.proofUploadToken !== null)
        .map((payment) => payment.operationKey),
    );
    if (
      input.proofCapabilities.size !== expectedProofOperations.size ||
      [...input.proofCapabilities.keys()].some((key) => !expectedProofOperations.has(key))
    ) {
      throw new ActiveWorkImportDomainError(
        "INVALID_INPUT",
        "Imported payment proof capability does not match the saved draft",
      );
    }
    for (const payment of orderedPayments) {
      const installmentId = installmentByPosition.get(payment.installmentPosition);
      if (!installmentId) {
        throw new ActiveWorkImportDomainError("INTEGRITY_ERROR", "Payment lost its installment");
      }
      const capability = input.proofCapabilities.get(payment.operationKey) ?? null;
      if ((payment.proofUploadToken !== null) !== (capability !== null)) {
        throw new ActiveWorkImportDomainError("INVALID_INPUT", "Imported payment proof is invalid");
      }
      let proofId: string | null = null;
      if (capability) {
        const stored = await input.finalizeProof(capability);
        const [proof] = await tx
          .insert(paymentProofs)
          .values({
            purchaseId: purchase.id,
            installmentId,
            producerId: input.producerId,
            projectId: project.id,
            clientContactId: client.id,
            amountCents: payment.amountCents,
            currency: input.normalized.commercialSnapshot.currency,
            storageBucket: "docs",
            storageKey: stored.storageKey,
            objectEtag: stored.objectEtag,
            originalFileName: capability.originalFileName,
            contentType: stored.contentType,
            sizeBytes: stored.sizeBytes,
            status: "confirmed",
            note: payment.note,
            confirmedAt: input.importedAt,
            createdAt: input.importedAt,
          })
          .returning({ id: paymentProofs.id });
        if (!proof) throw new Error("Imported payment proof insert did not return a row");
        proofId = proof.id;
      }
      await recordConfirmedPurchasePayment(ledgerRepository, {
        producerId: input.producerId,
        purchaseId: purchase.id,
        installmentId,
        operationKey: payment.operationKey,
        source: proofId ? "proof" : "manual",
        proofId,
        amountCents: payment.amountCents,
        currency: input.normalized.commercialSnapshot.currency,
        paidAt: payment.paidAt,
        actorId: input.clerkUserId,
        note: payment.note,
        occurredAt: input.importedAt,
      });
    }
    if (orderedPayments.length === 0) {
      await reconcilePurchaseLedger(ledgerRepository, {
        producerId: input.producerId,
        purchaseId: purchase.id,
        asOf: input.importedAt,
      });
    }

    const [materialized] = await tx
      .update(activeWorkImportRows)
      .set({
        creationDigest: input.creationDigest,
        createdClientContactId: client.id,
        createdProjectId: project.id,
        createdPurchaseId: purchase.id,
        materializedAt: input.importedAt,
        lastAttemptedAt: input.importedAt,
        lastErrorCode: null,
        updatedAt: input.importedAt,
      })
      .where(
        and(
          eq(activeWorkImportRows.id, row.id),
          eq(activeWorkImportRows.producerId, input.producerId),
          isNull(activeWorkImportRows.materializedAt),
        ),
      )
      .returning({ id: activeWorkImportRows.id });
    if (!materialized) {
      throw new ActiveWorkImportDomainError("CONFLICT", "Import row changed. Refresh and retry.");
    }
    await tx
      .update(activeWorkImportBatches)
      .set(activeWorkImportBatchMaterializedState(input.importedAt))
      .where(
        and(
          eq(activeWorkImportBatches.id, input.batchId),
          eq(activeWorkImportBatches.producerId, input.producerId),
        ),
      );
    return {
      rowId: row.id,
      clientContactId: client.id,
      projectId: project.id,
      purchaseId: purchase.id,
      creationDigest: input.creationDigest,
      materializedAt: input.importedAt,
      created: true,
    };
  });
}

export function activeWorkImportBatchMaterializedState(materializedAt: Date) {
  return {
    status: "in_progress" as const,
    completedAt: null,
    updatedAt: materializedAt,
  };
}

/**
 * Finish is the only transition to completed. The shared batch lock serializes
 * this check with row saves, deletes, and materialization. Exact replay keeps
 * the original completion timestamp and reports no change.
 */
export async function completeActiveWorkImportBatch(
  db: Db,
  input: Readonly<{ producerId: string; batchId: string; completedAt: Date }>,
): Promise<Readonly<{ changed: boolean }>> {
  if (!(input.completedAt instanceof Date) || Number.isNaN(input.completedAt.getTime())) {
    throw new ActiveWorkImportDomainError("INVALID_INPUT", "Setup completion time must be valid");
  }
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, input);
    if (!batch) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import batch was not found");
    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        remaining: sql<number>`count(*) filter (where ${activeWorkImportRows.materializedAt} is null)::int`,
      })
      .from(activeWorkImportRows)
      .where(
        and(
          eq(activeWorkImportRows.batchId, input.batchId),
          eq(activeWorkImportRows.producerId, input.producerId),
        ),
      );
    // A producer may finish communication/reminder setup for the rows that
    // were created while keeping incomplete drafts for later. Such a batch
    // must remain discoverable through latestOpen instead of failing after
    // external effects already ran.
    if ((counts?.total ?? 0) === 0 || (counts?.remaining ?? 0) !== 0) {
      return { changed: false };
    }
    if (batch.status === "completed") return { changed: false };
    const [updated] = await tx
      .update(activeWorkImportBatches)
      .set({
        status: "completed",
        completedAt: input.completedAt,
        updatedAt: input.completedAt,
      })
      .where(
        and(
          eq(activeWorkImportBatches.id, input.batchId),
          eq(activeWorkImportBatches.producerId, input.producerId),
        ),
      )
      .returning({ id: activeWorkImportBatches.id });
    if (!updated) {
      throw new ActiveWorkImportDomainError("CONFLICT", "Import setup changed. Refresh and retry.");
    }
    return { changed: true };
  });
}
