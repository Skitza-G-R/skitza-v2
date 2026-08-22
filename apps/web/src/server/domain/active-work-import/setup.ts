import {
  activeWorkImportBatches,
  activeWorkImportRows,
  activeWorkImportSetupOperations,
  and,
  clientContacts,
  eq,
  inArray,
  isNotNull,
  producers,
  projects,
  purchaseInstallments,
  purchases,
  type Db,
} from "@skitza/db";

import { emailHashFor } from "~/server/artist/identity";
import { EmailDeliveryError } from "~/server/email/delivery-error";
import {
  clientInvitationDeliveryRepository,
  loadCurrentClientInvitationStates,
  reserveActiveWorkImportClientInvitationEmail,
} from "../client-invitations/db";
import {
  ClientInvitationDomainError,
  deliverClientInvitation,
  hasActiveClientConnection,
  type ClientInvitationDeliveryRecord,
  type SendClientInvitation,
} from "../client-invitations/service";
import { purchaseLedgerRepository } from "../purchase-ledger/db";
import { PurchaseLedgerDomainError } from "../purchase-ledger/policy";
import {
  reconcilePurchaseLedger,
  setInstallmentRemindersEnabled,
  type ReconciledPurchaseLedger,
} from "../purchase-ledger/service";
import { digestCommercialSnapshot } from "../purchases/policy";
import { completeActiveWorkImportBatch } from "./db";
import { ActiveWorkImportDomainError } from "./service";

type MaterializedProjectPurchase = Readonly<{
  rowId: string;
  clientContactId: string;
  projectId: string;
  purchaseId: string;
  projectTitle: string;
  agreementName: string;
  refNumber: string;
}>;

type StoredInstallment = typeof purchaseInstallments.$inferSelect;

// Each reconciliation opens its own locked transaction (one WebSocket each).
const LEDGER_RECONCILE_CONCURRENCY = 5;

export type ActiveWorkImportSetupScope = Readonly<{
  clients: readonly Readonly<{
    id: string;
    name: string;
    email: string;
    emailHash: string;
    connected: boolean;
    providerAcceptedAt: Date | null;
    invitationEligible: boolean;
    invitationState:
      | "available"
      | "connected"
      | "provider_accepted"
      | "send_in_progress_or_retryable"
      | "invalid_email";
  }>[];
  projectPurchases: readonly MaterializedProjectPurchase[];
  installments: readonly Readonly<{
    id: string;
    rowId: string;
    projectId: string;
    purchaseId: string;
    projectTitle: string;
    agreementName: string;
    position: number;
    amountCents: number;
    remainingCents: number;
    currency: string;
    dueTrigger: StoredInstallment["dueTrigger"];
    dueAt: Date | null;
    triggeredAt: Date | null;
    status: StoredInstallment["status"];
    remindersEnabled: boolean;
    reminderEligible: boolean;
  }>[];
}>;

export type ActiveWorkImportSetupOptions = Readonly<{
  setupDigest: string;
  distinctClientCount: number;
  projectPurchaseCount: number;
  clients: readonly Readonly<{
    id: string;
    name: string;
    email: string;
    connected: boolean;
    providerAcceptedAt: Date | null;
    invitationEligible: boolean;
    invitationState: ActiveWorkImportSetupScope["clients"][number]["invitationState"];
  }>[];
  installments: ActiveWorkImportSetupScope["installments"];
}>;

export function activeWorkImportInvitationEligible(
  state: ActiveWorkImportSetupScope["clients"][number]["invitationState"],
): boolean {
  return state === "available" || state === "send_in_progress_or_retryable";
}

export type ActiveWorkImportInvitationStatus =
  | "requested"
  | "provider_accepted"
  | "failed"
  | "connected";

/** Every failed entry carries a short plain-English `reason` for the producer. */
export type ActiveWorkImportSetupInvitationResult =
  | Readonly<{
      clientContactId: string;
      status: Exclude<ActiveWorkImportInvitationStatus, "failed">;
      providerAcceptedAt: Date | null;
    }>
  | Readonly<{
      clientContactId: string;
      status: "failed";
      providerAcceptedAt: null;
      reason: string;
    }>;

export type ActiveWorkImportSetupReminderResult =
  | Readonly<{ installmentId: string; purchaseId: string; status: "enabled"; changed: boolean }>
  | Readonly<{
      installmentId: string;
      purchaseId: string;
      status: "failed";
      changed: false;
      reason: string;
    }>;

export type ActiveWorkImportSetupResult = Readonly<{
  distinctClientCount: number;
  projectPurchaseCount: number;
  invitations: readonly ActiveWorkImportSetupInvitationResult[];
  reminders: readonly ActiveWorkImportSetupReminderResult[];
}>;

type ReservedInvitation = Readonly<{
  clientContactId: string;
  delivery: ClientInvitationDeliveryRecord;
}>;

export interface ActiveWorkImportSetupRepository {
  loadScope(
    input: Readonly<{ producerId: string; batchId: string }>,
  ): Promise<ActiveWorkImportSetupScope>;
  reserveOperation(
    input: Readonly<{
      producerId: string;
      batchId: string;
      operationKey: string;
      operationDigest: string;
      requestedByClerkUserId: string;
      requestedAt: Date;
    }>,
  ): Promise<Readonly<{ created: boolean }>>;
  reserveInvitation(
    input: Readonly<{
      producerId: string;
      clientContactId: string;
      operationKey: string;
      requestedByClerkUserId: string;
      siteUrl: string;
      requestedAt: Date;
      expectedEmailHash: string;
    }>,
  ): Promise<
    | Readonly<{ state: "reserved"; delivery: ClientInvitationDeliveryRecord }>
    | Readonly<{ state: "connected" }>
    | Readonly<{ state: "provider_accepted"; providerAcceptedAt: Date }>
    | Readonly<{ state: "ineligible" }>
  >;
  deliverInvitation(
    delivery: ClientInvitationDeliveryRecord,
    attemptedAt: Date,
  ): Promise<
    | Readonly<{ status: "requested"; providerAcceptedAt: null }>
    | Readonly<{ status: "provider_accepted"; providerAcceptedAt: Date }>
    | Readonly<{ status: "failed"; providerAcceptedAt: null; reason: string }>
  >;
  enableReminder(
    input: Readonly<{
      producerId: string;
      purchaseId: string;
      installmentId: string;
    }>,
  ): Promise<Readonly<{ changed: boolean }>>;
  completeBatch(
    input: Readonly<{
      producerId: string;
      batchId: string;
      completedAt: Date;
    }>,
  ): Promise<Readonly<{ changed: boolean }>>;
}

function stableOperationKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new ActiveWorkImportDomainError(
      "INVALID_INPUT",
      "Setup operation key must be between 1 and 200 characters",
    );
  }
  return normalized;
}

function stableIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function activeWorkImportSetupInvitationOperationKey(
  bulkOperationKey: string,
  clientContactId: string,
): string {
  return `active-work-import-invite:${digestCommercialSnapshot({
    kind: "active-work-import-setup-invitation-v1",
    bulkOperationKey: stableOperationKey(bulkOperationKey),
    clientContactId,
  })}`;
}

export function activeWorkImportSetupDigest(scope: ActiveWorkImportSetupScope): string {
  return `sha256:${digestCommercialSnapshot({
    kind: "active-work-import-reviewed-setup-v1",
    // Bind the reviewed recipients, but not mutable delivery/connection state.
    // A successful finish action changes that state itself and must remain
    // safely replayable after a lost response.
    clients: scope.clients.map((client) => ({
      id: client.id,
      name: client.name,
      email: client.email,
      emailHash: client.emailHash,
    })),
    projectPurchases: scope.projectPurchases,
    installments: scope.installments.map((installment) => ({
      id: installment.id,
      rowId: installment.rowId,
      projectId: installment.projectId,
      purchaseId: installment.purchaseId,
      projectTitle: installment.projectTitle,
      agreementName: installment.agreementName,
      position: installment.position,
      amountCents: installment.amountCents,
      remainingCents: installment.remainingCents,
      currency: installment.currency,
      dueTrigger: installment.dueTrigger,
      dueAt: installment.dueAt?.toISOString() ?? null,
      triggeredAt: installment.triggeredAt?.toISOString() ?? null,
      status: installment.status,
      reminderEligible: installment.reminderEligible,
    })),
  })}`;
}

export function activeWorkImportSetupOperationDigest(
  input: Readonly<{
    batchId: string;
    expectedSetupDigest: string;
    selectedClientContactIds: readonly string[];
    mandatoryInstallmentIds: readonly string[];
  }>,
): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(input.expectedSetupDigest)) {
    throw new ActiveWorkImportDomainError("INVALID_INPUT", "Reviewed setup digest is invalid");
  }
  return `sha256:${digestCommercialSnapshot({
    kind: "active-work-import-finish-setup",
    version: 2,
    batchId: input.batchId,
    expectedSetupDigest: input.expectedSetupDigest,
    selectedClientContactIds: stableIds(input.selectedClientContactIds),
    mandatoryInstallmentIds: stableIds(input.mandatoryInstallmentIds),
  })}`;
}

export async function reserveActiveWorkImportSetupOperation(
  db: Db,
  input: Readonly<{
    producerId: string;
    batchId: string;
    operationKey: string;
    operationDigest: string;
    requestedByClerkUserId: string;
    requestedAt: Date;
  }>,
): Promise<Readonly<{ created: boolean }>> {
  const key = stableOperationKey(input.operationKey);
  const actor = input.requestedByClerkUserId.trim();
  if (!actor || actor !== input.requestedByClerkUserId || actor.length > 200) {
    throw new ActiveWorkImportDomainError("INVALID_INPUT", "Setup actor is invalid");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(input.operationDigest)) {
    throw new ActiveWorkImportDomainError("INVALID_INPUT", "Setup operation digest is invalid");
  }
  if (!(input.requestedAt instanceof Date) || Number.isNaN(input.requestedAt.getTime())) {
    throw new ActiveWorkImportDomainError("INVALID_INPUT", "Setup time must be valid");
  }
  return db.transaction(async (tx) => {
    const [ownedBatch] = await tx
      .select({ id: activeWorkImportBatches.id })
      .from(activeWorkImportBatches)
      .innerJoin(
        producers,
        and(eq(producers.id, activeWorkImportBatches.producerId), eq(producers.clerkUserId, actor)),
      )
      .where(
        and(
          eq(activeWorkImportBatches.id, input.batchId),
          eq(activeWorkImportBatches.producerId, input.producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (!ownedBatch) {
      throw new ActiveWorkImportDomainError("NOT_FOUND", "Import batch was not found");
    }
    const [inserted] = await tx
      .insert(activeWorkImportSetupOperations)
      .values({
        producerId: input.producerId,
        batchId: input.batchId,
        operationKey: key,
        operationDigest: input.operationDigest,
        requestedByClerkUserId: actor,
        createdAt: input.requestedAt,
      })
      .onConflictDoNothing({
        target: [
          activeWorkImportSetupOperations.producerId,
          activeWorkImportSetupOperations.batchId,
          activeWorkImportSetupOperations.operationKey,
        ],
      })
      .returning({ id: activeWorkImportSetupOperations.id });
    if (inserted) return { created: true };
    const [existing] = await tx
      .select({ operationDigest: activeWorkImportSetupOperations.operationDigest })
      .from(activeWorkImportSetupOperations)
      .where(
        and(
          eq(activeWorkImportSetupOperations.producerId, input.producerId),
          eq(activeWorkImportSetupOperations.batchId, input.batchId),
          eq(activeWorkImportSetupOperations.operationKey, key),
          eq(activeWorkImportSetupOperations.requestedByClerkUserId, actor),
        ),
      )
      .limit(1);
    if (!existing || existing.operationDigest !== input.operationDigest) {
      throw new ActiveWorkImportDomainError(
        "CONFLICT",
        "This setup action was already used with different choices.",
      );
    }
    return { created: false };
  });
}

export function activeWorkImportSetupOptions(
  scope: ActiveWorkImportSetupScope,
): ActiveWorkImportSetupOptions {
  return {
    setupDigest: activeWorkImportSetupDigest(scope),
    distinctClientCount: scope.clients.length,
    projectPurchaseCount: scope.projectPurchases.length,
    clients: scope.clients.map((client) => ({
      id: client.id,
      name: client.name,
      email: client.email,
      connected: client.connected,
      providerAcceptedAt: client.providerAcceptedAt,
      invitationEligible: client.invitationEligible,
      invitationState: client.invitationState,
    })),
    installments: scope.installments,
  };
}

function assertSelectedClients(
  scope: ActiveWorkImportSetupScope,
  selectedClientContactIds: readonly string[],
): void {
  const allowedClients = new Set(scope.clients.map((client) => client.id));
  if (selectedClientContactIds.some((id) => !allowedClients.has(id))) {
    throw new ActiveWorkImportDomainError(
      "NOT_FOUND",
      "A selected client is not part of this imported batch",
    );
  }
}

/**
 * Apply the one reviewed finish action. Invitations remain optional, while
 * every eligible unpaid imported installment is always included by the server.
 * All invitation intents are reserved before the first provider call, so a
 * stable-operation conflict cannot send a partial changed action. Provider
 * failures and reminder failures remain isolated and explicitly reported for
 * safe retry.
 */
export async function runActiveWorkImportSetup(
  repository: ActiveWorkImportSetupRepository,
  input: Readonly<{
    producerId: string;
    clerkUserId: string;
    batchId: string;
    operationKey: string;
    expectedSetupDigest: string;
    selectedClientContactIds: readonly string[];
    siteUrl: string;
    requestedAt?: Date;
    now?: () => Date;
  }>,
): Promise<ActiveWorkImportSetupResult> {
  const bulkOperationKey = stableOperationKey(input.operationKey);
  const requestedAt = input.requestedAt ?? input.now?.() ?? new Date();
  if (Number.isNaN(requestedAt.getTime())) {
    throw new ActiveWorkImportDomainError("INVALID_INPUT", "Setup time must be valid");
  }
  const scope = await repository.loadScope({
    producerId: input.producerId,
    batchId: input.batchId,
  });
  if (activeWorkImportSetupDigest(scope) !== input.expectedSetupDigest) {
    throw new ActiveWorkImportDomainError(
      "CONFLICT",
      "This setup changed. Review the latest details and try again.",
    );
  }
  const selectedClientContactIds = stableIds(input.selectedClientContactIds);
  assertSelectedClients(scope, selectedClientContactIds);
  const mandatoryInstallmentIds = stableIds(
    scope.installments
      .filter((installment) => installment.reminderEligible)
      .map((installment) => installment.id),
  );
  await repository.reserveOperation({
    producerId: input.producerId,
    batchId: input.batchId,
    operationKey: bulkOperationKey,
    operationDigest: activeWorkImportSetupOperationDigest({
      batchId: input.batchId,
      expectedSetupDigest: input.expectedSetupDigest,
      selectedClientContactIds,
      mandatoryInstallmentIds,
    }),
    requestedByClerkUserId: input.clerkUserId,
    requestedAt,
  });

  const clientById = new Map(scope.clients.map((client) => [client.id, client] as const));
  const installmentById = new Map(
    scope.installments.map((installment) => [installment.id, installment] as const),
  );
  const invitationResults: ActiveWorkImportSetupInvitationResult[] = [];
  const reserved: ReservedInvitation[] = [];

  // Reserve every non-connected recipient before any network call. The
  // outbox checks same-key/same-message replay and rejects changed details.
  for (const clientContactId of selectedClientContactIds) {
    const client = clientById.get(clientContactId);
    if (!client) {
      throw new ActiveWorkImportDomainError(
        "INTEGRITY_ERROR",
        "A selected client is missing from this imported batch",
      );
    }
    if (client.connected) {
      invitationResults.push({
        clientContactId,
        status: "connected",
        providerAcceptedAt: null,
      });
      continue;
    }
    if (client.providerAcceptedAt) {
      invitationResults.push({
        clientContactId,
        status: "provider_accepted",
        providerAcceptedAt: client.providerAcceptedAt,
      });
      continue;
    }
    // Do not trust the read-model eligibility flag here. The locked outbox
    // reservation distinguishes this exact operation's retry from another
    // operation already sending to the current email.
    const reservation = await repository.reserveInvitation({
      producerId: input.producerId,
      clientContactId,
      operationKey: activeWorkImportSetupInvitationOperationKey(bulkOperationKey, clientContactId),
      requestedByClerkUserId: input.clerkUserId,
      siteUrl: input.siteUrl,
      requestedAt,
      expectedEmailHash: client.emailHash,
    });
    if (reservation.state === "connected") {
      invitationResults.push({
        clientContactId,
        status: "connected",
        providerAcceptedAt: null,
      });
    } else if (reservation.state === "provider_accepted") {
      invitationResults.push({
        clientContactId,
        status: "provider_accepted",
        providerAcceptedAt: reservation.providerAcceptedAt,
      });
    } else if (reservation.state === "ineligible") {
      invitationResults.push({
        clientContactId,
        status: "failed",
        providerAcceptedAt: null,
        reason: "This client's email is not valid or changed since review.",
      });
    } else {
      reserved.push({ clientContactId, delivery: reservation.delivery });
    }
  }

  const reminderResults: ActiveWorkImportSetupReminderResult[] = [];
  for (const installmentId of mandatoryInstallmentIds) {
    const installment = installmentById.get(installmentId);
    if (!installment) {
      throw new ActiveWorkImportDomainError(
        "INTEGRITY_ERROR",
        "A selected payment is missing from this imported batch",
      );
    }
    if (!installment.reminderEligible) {
      reminderResults.push({
        installmentId,
        purchaseId: installment.purchaseId,
        status: "failed",
        changed: false,
        reason: "This payment is already paid, waived, or canceled.",
      });
      continue;
    }
    try {
      const result = await repository.enableReminder({
        producerId: input.producerId,
        purchaseId: installment.purchaseId,
        installmentId,
      });
      reminderResults.push({
        installmentId,
        purchaseId: installment.purchaseId,
        status: "enabled",
        changed: result.changed,
      });
    } catch (error) {
      if (!(error instanceof PurchaseLedgerDomainError)) throw error;
      reminderResults.push({
        installmentId,
        purchaseId: installment.purchaseId,
        status: "failed",
        changed: false,
        reason: error.message,
      });
    }
  }

  for (const reservation of reserved) {
    const attemptedAt = input.now?.() ?? new Date();
    if (Number.isNaN(attemptedAt.getTime())) {
      throw new ActiveWorkImportDomainError("INVALID_INPUT", "Setup time must be valid");
    }
    const delivery = await repository.deliverInvitation(reservation.delivery, attemptedAt);
    invitationResults.push({ clientContactId: reservation.clientContactId, ...delivery });
  }

  invitationResults.sort((left, right) =>
    left.clientContactId.localeCompare(right.clientContactId),
  );
  // A send the provider only "requested" (busy claim) is not finished yet;
  // the batch stays open until every invitation is accepted or resolved.
  const hasUnresolvedEffect =
    invitationResults.some(
      (invitation) => invitation.status === "failed" || invitation.status === "requested",
    ) || reminderResults.some((reminder) => reminder.status === "failed");
  if (!hasUnresolvedEffect) {
    await repository.completeBatch({
      producerId: input.producerId,
      batchId: input.batchId,
      completedAt: requestedAt,
    });
  }
  return {
    distinctClientCount: scope.clients.length,
    projectPurchaseCount: scope.projectPurchases.length,
    invitations: invitationResults,
    reminders: reminderResults,
  };
}

export async function loadActiveWorkImportSetupScope(
  db: Db,
  input: Readonly<{ producerId: string; batchId: string }>,
): Promise<ActiveWorkImportSetupScope> {
  const [batch] = await db
    .select({ id: activeWorkImportBatches.id })
    .from(activeWorkImportBatches)
    .where(
      and(
        eq(activeWorkImportBatches.id, input.batchId),
        eq(activeWorkImportBatches.producerId, input.producerId),
      ),
    )
    .limit(1);
  if (!batch) throw new ActiveWorkImportDomainError("NOT_FOUND", "Import batch was not found");

  const materializedRows = await db
    .select({
      rowId: activeWorkImportRows.id,
      clientContactId: activeWorkImportRows.createdClientContactId,
      projectId: activeWorkImportRows.createdProjectId,
      purchaseId: activeWorkImportRows.createdPurchaseId,
      projectTitle: projects.title,
      commercialSnapshot: purchases.commercialSnapshot,
      refNumber: purchases.refNumber,
    })
    .from(activeWorkImportRows)
    .innerJoin(
      projects,
      and(
        eq(projects.id, activeWorkImportRows.createdProjectId),
        eq(projects.producerId, activeWorkImportRows.producerId),
        eq(projects.clientContactId, activeWorkImportRows.createdClientContactId),
      ),
    )
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, activeWorkImportRows.createdPurchaseId),
        eq(purchases.projectId, activeWorkImportRows.createdProjectId),
        eq(purchases.producerId, activeWorkImportRows.producerId),
        eq(purchases.clientContactId, activeWorkImportRows.createdClientContactId),
      ),
    )
    .where(
      and(
        eq(activeWorkImportRows.batchId, input.batchId),
        eq(activeWorkImportRows.producerId, input.producerId),
        isNotNull(activeWorkImportRows.materializedAt),
      ),
    );
  if (materializedRows.some((row) => !row.clientContactId || !row.projectId || !row.purchaseId)) {
    throw new ActiveWorkImportDomainError(
      "INTEGRITY_ERROR",
      "An imported row is missing its created records",
    );
  }
  const projectPurchases: MaterializedProjectPurchase[] = materializedRows.map((row) => {
    if (!row.clientContactId || !row.projectId || !row.purchaseId) {
      throw new ActiveWorkImportDomainError(
        "INTEGRITY_ERROR",
        "An imported row is missing its created records",
      );
    }
    return {
      rowId: row.rowId,
      clientContactId: row.clientContactId,
      projectId: row.projectId,
      purchaseId: row.purchaseId,
      projectTitle: row.projectTitle,
      agreementName: row.commercialSnapshot.productOrOfferName,
      refNumber: row.refNumber,
    };
  });
  const clientIds = stableIds(projectPurchases.map((row) => row.clientContactId));
  const purchaseIds = stableIds(projectPurchases.map((row) => row.purchaseId));
  const clients =
    clientIds.length === 0
      ? []
      : await db
          .select({
            id: clientContacts.id,
            name: clientContacts.name,
            email: clientContacts.email,
            emailHash: clientContacts.emailHash,
            clerkUserId: clientContacts.clerkUserId,
            archivedAt: clientContacts.archivedAt,
          })
          .from(clientContacts)
          .where(
            and(
              eq(clientContacts.producerId, input.producerId),
              inArray(clientContacts.id, clientIds),
            ),
          );
  if (clients.length !== clientIds.length) {
    throw new ActiveWorkImportDomainError(
      "INTEGRITY_ERROR",
      "An imported client could not be loaded",
    );
  }
  const invitationStates = await loadCurrentClientInvitationStates(db, {
    producerId: input.producerId,
    clientContactIds: clientIds,
  });
  const ledgers: ReconciledPurchaseLedger[] = [];
  for (let offset = 0; offset < purchaseIds.length; offset += LEDGER_RECONCILE_CONCURRENCY) {
    ledgers.push(
      ...(await Promise.all(
        purchaseIds.slice(offset, offset + LEDGER_RECONCILE_CONCURRENCY).map((purchaseId) =>
          reconcilePurchaseLedger(purchaseLedgerRepository(db), {
            producerId: input.producerId,
            purchaseId,
          }),
        ),
      )),
    );
  }
  const projectPurchaseByPurchaseId = new Map(
    projectPurchases.map((row) => [row.purchaseId, row] as const),
  );
  const installments = ledgers.flatMap((ledger) => {
    const projectPurchase = projectPurchaseByPurchaseId.get(ledger.snapshot.purchase.id);
    if (!projectPurchase) {
      throw new ActiveWorkImportDomainError(
        "INTEGRITY_ERROR",
        "An imported Purchase is missing its batch row",
      );
    }
    const projectedById = new Map(
      ledger.projection.installments.map((installment) => [installment.id, installment] as const),
    );
    return ledger.snapshot.installments.map((installment) => {
      const projected = projectedById.get(installment.id);
      if (!projected) {
        throw new ActiveWorkImportDomainError(
          "INTEGRITY_ERROR",
          "An imported installment could not be reconciled",
        );
      }
      const reminderEligible =
        ledger.snapshot.purchase.lifecycleStatus !== "canceled" &&
        projected.remainingCents > 0 &&
        projected.status !== "confirmed" &&
        projected.status !== "waived" &&
        projected.status !== "canceled";
      return {
        id: installment.id,
        rowId: projectPurchase.rowId,
        projectId: projectPurchase.projectId,
        purchaseId: projectPurchase.purchaseId,
        projectTitle: projectPurchase.projectTitle,
        agreementName: projectPurchase.agreementName,
        position: installment.position,
        amountCents: installment.amountCents,
        remainingCents: projected.remainingCents,
        currency: installment.currency,
        dueTrigger: installment.dueTrigger,
        dueAt: installment.dueAt,
        triggeredAt: installment.triggeredAt,
        status: projected.status,
        remindersEnabled: installment.remindersEnabled,
        reminderEligible,
      };
    });
  });
  return {
    clients: clients
      .map((client) => {
        const email = client.email.trim().toLowerCase();
        const invitationState = invitationStates.get(client.id);
        const providerAcceptedAt = invitationState?.providerAcceptedAt ?? null;
        const connected = hasActiveClientConnection(client.clerkUserId, client.archivedAt);
        const validEmail =
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && emailHashFor(email) === client.emailHash;
        const state: ActiveWorkImportSetupScope["clients"][number]["invitationState"] = connected
          ? "connected"
          : providerAcceptedAt
            ? "provider_accepted"
            : !validEmail
              ? "invalid_email"
              : invitationState?.activeWorkBlocked
                ? "send_in_progress_or_retryable"
                : "available";
        return {
          id: client.id,
          name: client.name,
          email,
          emailHash: client.emailHash,
          connected,
          providerAcceptedAt,
          invitationEligible: activeWorkImportInvitationEligible(state),
          invitationState: state,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    projectPurchases: projectPurchases.sort((left, right) => left.rowId.localeCompare(right.rowId)),
    installments: installments.sort(
      (left, right) =>
        left.projectTitle.localeCompare(right.projectTitle) || left.position - right.position,
    ),
  };
}

function invitationFailureReason(error: unknown): string {
  if (error instanceof EmailDeliveryError) {
    switch (error.provider.name) {
      case "rate_limit_exceeded":
      case "daily_quota_exceeded":
      case "monthly_quota_exceeded":
      case "concurrent_idempotent_requests":
        return "The email service is busy. Try again in a few minutes.";
      case "validation_error":
      case "invalid_parameter":
      case "missing_required_field":
        return "The email service rejected this client's email address.";
      default:
        return "The email service could not send this invitation. Try again.";
    }
  }
  if (error instanceof ClientInvitationDomainError || error instanceof ActiveWorkImportDomainError) {
    return error.message;
  }
  return "This invitation could not be sent. Try again.";
}

export function activeWorkImportSetupRepository(
  db: Db,
  sendInvitation: SendClientInvitation,
): ActiveWorkImportSetupRepository {
  return {
    loadScope: (input) => loadActiveWorkImportSetupScope(db, input),
    reserveOperation: (input) => reserveActiveWorkImportSetupOperation(db, input),
    reserveInvitation: (input) => reserveActiveWorkImportClientInvitationEmail(db, input),
    deliverInvitation: async (delivery, attemptedAt) => {
      try {
        const outcome = await deliverClientInvitation(
          clientInvitationDeliveryRepository(db),
          sendInvitation,
          delivery,
          attemptedAt,
        );
        if (outcome.state === "provider_accepted") {
          if (!outcome.delivery.providerAcceptedAt) {
            throw new ActiveWorkImportDomainError(
              "INTEGRITY_ERROR",
              "Accepted invitation is missing provider evidence",
            );
          }
          return {
            status: "provider_accepted",
            providerAcceptedAt: outcome.delivery.providerAcceptedAt,
          };
        }
        if (outcome.state === "sending") return { status: "requested", providerAcceptedAt: null };
        return {
          status: "failed",
          providerAcceptedAt: null,
          reason: "The earlier send attempt expired. Try again.",
        };
      } catch (error) {
        console.error("[active-work-import] invitation delivery failed", {
          clientContactId: delivery.clientContactId,
          deliveryId: delivery.id,
          error,
        });
        // Provider and domain refusals are reported per recipient; anything
        // else is a bug or outage that must surface to the caller.
        if (
          error instanceof EmailDeliveryError ||
          error instanceof ClientInvitationDomainError ||
          error instanceof ActiveWorkImportDomainError
        ) {
          return {
            status: "failed",
            providerAcceptedAt: null,
            reason: invitationFailureReason(error),
          };
        }
        throw error;
      }
    },
    enableReminder: async (input) => {
      const result = await setInstallmentRemindersEnabled(purchaseLedgerRepository(db), {
        ...input,
        enabled: true,
      });
      return { changed: result.changed };
    },
    completeBatch: (input) => completeActiveWorkImportBatch(db, input),
  };
}
