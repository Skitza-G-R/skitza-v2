import { describe, expect, it, vi, type Mock } from "vitest";

import type { ClientInvitationDeliveryRecord } from "../../client-invitations/service";
import { PurchaseLedgerDomainError } from "../../purchase-ledger/policy";
import { ActiveWorkImportDomainError } from "../service";
import {
  activeWorkImportSetupInvitationOperationKey,
  activeWorkImportSetupDigest,
  activeWorkImportSetupOperationDigest,
  activeWorkImportSetupOptions,
  activeWorkImportInvitationEligible,
  runActiveWorkImportSetup,
  type ActiveWorkImportSetupRepository,
  type ActiveWorkImportSetupScope,
} from "../setup";

type SetupRepositoryMocks = {
  loadScope: Mock<ActiveWorkImportSetupRepository["loadScope"]>;
  reserveOperation: Mock<ActiveWorkImportSetupRepository["reserveOperation"]>;
  reserveInvitation: Mock<ActiveWorkImportSetupRepository["reserveInvitation"]>;
  deliverInvitation: Mock<ActiveWorkImportSetupRepository["deliverInvitation"]>;
  enableReminder: Mock<ActiveWorkImportSetupRepository["enableReminder"]>;
  completeBatch: Mock<ActiveWorkImportSetupRepository["completeBatch"]>;
};

const NOW = new Date("2026-08-20T12:00:00.000Z");
const ACCEPTED_AT = new Date("2026-08-20T12:00:03.000Z");

function scope(): ActiveWorkImportSetupScope {
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
      {
        id: "client-b",
        name: "Artist B",
        email: "b@example.com",
        emailHash: "b".repeat(64),
        connected: true,
        providerAcceptedAt: null,
        invitationEligible: false,
        invitationState: "connected",
      },
    ],
    projectPurchases: [
      {
        rowId: "row-1",
        clientContactId: "client-a",
        projectId: "project-1",
        purchaseId: "purchase-1",
        projectTitle: "Project 1",
        agreementName: "Agreement 1",
        refNumber: "REF-1",
      },
      {
        rowId: "row-2",
        clientContactId: "client-a",
        projectId: "project-2",
        purchaseId: "purchase-2",
        projectTitle: "Project 2",
        agreementName: "Agreement 2",
        refNumber: "REF-2",
      },
      {
        rowId: "row-3",
        clientContactId: "client-b",
        projectId: "project-3",
        purchaseId: "purchase-3",
        projectTitle: "Project 3",
        agreementName: "Agreement 3",
        refNumber: "REF-3",
      },
    ],
    installments: [
      {
        id: "installment-first",
        rowId: "row-1",
        projectId: "project-1",
        purchaseId: "purchase-1",
        projectTitle: "Project 1",
        agreementName: "Agreement 1",
        position: 1,
        amountCents: 5_000,
        remainingCents: 5_000,
        currency: "USD",
        dueTrigger: "producer_import",
        dueAt: NOW,
        triggeredAt: NOW,
        status: "not_paid",
        remindersEnabled: false,
        reminderEligible: true,
        reminderWaitingForDueDate: false,
      },
      {
        id: "installment-final-before-approval",
        rowId: "row-1",
        projectId: "project-1",
        purchaseId: "purchase-1",
        projectTitle: "Project 1",
        agreementName: "Agreement 1",
        position: 2,
        amountCents: 5_000,
        remainingCents: 5_000,
        currency: "USD",
        // Approved, so the ledger has given the final 50 its date. A payment
        // with no date at all is not reminder-eligible and is covered by
        // setup-scope.test.ts, which owns that rule.
        dueTrigger: "artist_approval",
        dueAt: NOW,
        triggeredAt: NOW,
        status: "not_paid",
        remindersEnabled: false,
        reminderEligible: true,
        reminderWaitingForDueDate: false,
      },
    ],
  };
}

function delivery(clientContactId: string, operationKey: string): ClientInvitationDeliveryRecord {
  return {
    id: `delivery-${clientContactId}`,
    clientContactId,
    producerId: "producer-1",
    operationKey,
    operationDigest: `sha256:${"a".repeat(64)}`,
    recipientEmail: `${clientContactId}@example.com`,
    recipientEmailHash: "b".repeat(64),
    messageSnapshot: {
      to: `${clientContactId}@example.com`,
      artistName: clientContactId,
      producerName: "Producer",
      inviteUrl: "https://example.com/join",
    },
    requestedByClerkUserId: "user-1",
    providerIdempotencyKey: `provider-${clientContactId}`,
    status: "reserved",
    claimToken: null,
    claimUntil: null,
    attemptCount: 0,
    firstAttemptAt: null,
    lastAttemptAt: null,
    providerDedupeExpiresAt: null,
    providerMessageId: null,
    providerAcceptedAt: null,
    lastFailedAt: null,
    failureCode: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function repository(overrides: Partial<SetupRepositoryMocks> = {}) {
  const calls: string[] = [];
  const loadScope =
    overrides.loadScope ??
    vi.fn<ActiveWorkImportSetupRepository["loadScope"]>(() => Promise.resolve(scope()));
  const reserveOperation =
    overrides.reserveOperation ??
    vi.fn<ActiveWorkImportSetupRepository["reserveOperation"]>(() =>
      Promise.resolve({ created: true }),
    );
  const reserveInvitation =
    overrides.reserveInvitation ??
    vi.fn<ActiveWorkImportSetupRepository["reserveInvitation"]>((input) => {
      calls.push(`reserve:${input.clientContactId}`);
      return Promise.resolve({
        state: "reserved" as const,
        delivery: delivery(input.clientContactId, input.operationKey),
      });
    });
  const deliverInvitation =
    overrides.deliverInvitation ??
    vi.fn<ActiveWorkImportSetupRepository["deliverInvitation"]>((record) => {
      calls.push(`deliver:${record.clientContactId}`);
      return Promise.resolve({
        status: "provider_accepted" as const,
        providerAcceptedAt: ACCEPTED_AT,
      });
    });
  const enableReminder =
    overrides.enableReminder ??
    vi.fn<ActiveWorkImportSetupRepository["enableReminder"]>((input) => {
      calls.push(`reminder:${input.installmentId}`);
      return Promise.resolve({ changed: true });
    });
  const completeBatch =
    overrides.completeBatch ??
    vi.fn<ActiveWorkImportSetupRepository["completeBatch"]>(() =>
      Promise.resolve({ changed: true, completed: true, unfinishedDraftCount: 0 }),
    );
  const value: ActiveWorkImportSetupRepository = {
    loadScope,
    reserveOperation,
    reserveInvitation,
    deliverInvitation,
    enableReminder,
    completeBatch,
  };
  return {
    value,
    calls,
    loadScope,
    reserveOperation,
    reserveInvitation,
    deliverInvitation,
    enableReminder,
    completeBatch,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  const currentScope = scope();
  return {
    producerId: "producer-1",
    clerkUserId: "user-1",
    batchId: "batch-1",
    operationKey: "finish-click-1",
    expectedSetupDigest: activeWorkImportSetupDigest(currentScope),
    selectedClientContactIds: ["client-b", "client-a", "client-a"],
    siteUrl: "https://example.com",
    requestedAt: NOW,
    ...overrides,
  } as Parameters<typeof runActiveWorkImportSetup>[1];
}

describe("active work import reviewed setup", () => {
  it("keeps internal email hashes out of public setup options", () => {
    const options = activeWorkImportSetupOptions(scope());

    expect(options.clients[0]).toMatchObject({
      id: "client-a",
      name: "Artist A",
      email: "a@example.com",
      invitationEligible: true,
      invitationState: "available",
    });
    expect(options.clients[0]).not.toHaveProperty("emailHash");
    expect(JSON.stringify(options)).not.toContain("emailHash");
  });

  it("keeps a durable retryable invitation selectable after reload", () => {
    expect(activeWorkImportInvitationEligible("send_in_progress_or_retryable")).toBe(true);
    expect(activeWorkImportInvitationEligible("provider_accepted")).toBe(false);
    expect(activeWorkImportInvitationEligible("connected")).toBe(false);
    const retryable: ActiveWorkImportSetupScope = {
      ...scope(),
      clients: scope().clients.map((client) =>
        client.id === "client-a"
          ? {
              ...client,
              invitationEligible: true,
              invitationState: "send_in_progress_or_retryable" as const,
            }
          : client,
      ),
    };

    expect(activeWorkImportSetupOptions(retryable).clients[0]).toMatchObject({
      id: "client-a",
      invitationEligible: true,
      invitationState: "send_in_progress_or_retryable",
    });
  });

  it("keeps the reviewed digest stable across invitation acceptance and reminder enabling", () => {
    const before = scope();
    const afterOwnEffects: ActiveWorkImportSetupScope = {
      ...before,
      clients: before.clients.map((client) =>
        client.id === "client-a"
          ? {
              ...client,
              providerAcceptedAt: ACCEPTED_AT,
              invitationEligible: false,
              invitationState: "provider_accepted" as const,
            }
          : client,
      ),
      installments: before.installments.map((installment) => ({
        ...installment,
        remindersEnabled: true,
      })),
    };

    expect(activeWorkImportSetupDigest(afterOwnEffects)).toBe(activeWorkImportSetupDigest(before));
    expect(
      activeWorkImportSetupDigest({
        ...afterOwnEffects,
        clients: afterOwnEffects.clients.map((client) =>
          client.id === "client-a" ? { ...client, email: "changed@example.com" } : client,
        ),
      }),
    ).not.toBe(activeWorkImportSetupDigest(before));
  });

  it("binds a bulk operation to sorted, deduplicated reviewed choices", () => {
    const first = activeWorkImportSetupOperationDigest({
      batchId: "batch-1",
      expectedSetupDigest: activeWorkImportSetupDigest(scope()),
      selectedClientContactIds: ["client-b", "client-a", "client-a"],
      mandatoryInstallmentIds: ["installment-first", "installment-final-before-approval"],
    });
    expect(first).toBe(
      activeWorkImportSetupOperationDigest({
        batchId: "batch-1",
        expectedSetupDigest: activeWorkImportSetupDigest(scope()),
        selectedClientContactIds: ["client-a", "client-b"],
        mandatoryInstallmentIds: ["installment-final-before-approval", "installment-first"],
      }),
    );
    expect(first).not.toBe(
      activeWorkImportSetupOperationDigest({
        batchId: "batch-1",
        expectedSetupDigest: activeWorkImportSetupDigest(scope()),
        selectedClientContactIds: ["client-a"],
        mandatoryInstallmentIds: ["installment-final-before-approval", "installment-first"],
      }),
    );
    expect(first).not.toBe(
      activeWorkImportSetupOperationDigest({
        batchId: "batch-1",
        expectedSetupDigest: activeWorkImportSetupDigest(scope()),
        selectedClientContactIds: ["client-b", "client-a"],
        mandatoryInstallmentIds: ["installment-first"],
      }),
    );
  });

  it("rejects one bulk key reused with changed choices before any setup effect", async () => {
    const reserved = new Map<string, string>();
    const fake = repository({
      reserveOperation: vi.fn<ActiveWorkImportSetupRepository["reserveOperation"]>((operation) => {
        const existing = reserved.get(operation.operationKey);
        if (existing && existing !== operation.operationDigest) {
          throw new ActiveWorkImportDomainError(
            "CONFLICT",
            "This setup action was already used with different choices.",
          );
        }
        reserved.set(operation.operationKey, operation.operationDigest);
        return Promise.resolve({ created: existing === undefined });
      }),
    });
    const empty = input({ selectedClientContactIds: [] });

    await runActiveWorkImportSetup(fake.value, empty);
    expect(fake.enableReminder).toHaveBeenCalledTimes(2);
    await expect(
      runActiveWorkImportSetup(fake.value, {
        ...empty,
        selectedClientContactIds: ["client-a"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(fake.reserveOperation).toHaveBeenCalledTimes(2);
    expect(fake.reserveInvitation).not.toHaveBeenCalled();
    expect(fake.deliverInvitation).not.toHaveBeenCalled();
    expect(fake.enableReminder).toHaveBeenCalledTimes(2);
    expect(fake.completeBatch).toHaveBeenCalledTimes(1);
  });

  it("replays the exact bulk key after completion without a second provider effect", async () => {
    let currentScope = scope();
    const operationReceipts = new Map<string, string>();
    let providerCalls = 0;
    let completed = false;
    const completionChanges: boolean[] = [];
    const fake = repository({
      loadScope: vi.fn<ActiveWorkImportSetupRepository["loadScope"]>(() =>
        Promise.resolve(currentScope),
      ),
      reserveOperation: vi.fn<ActiveWorkImportSetupRepository["reserveOperation"]>((operation) => {
        const existing = operationReceipts.get(operation.operationKey);
        if (existing && existing !== operation.operationDigest) {
          throw new ActiveWorkImportDomainError("CONFLICT", "changed choices");
        }
        operationReceipts.set(operation.operationKey, operation.operationDigest);
        return Promise.resolve({ created: existing === undefined });
      }),
      deliverInvitation: vi.fn<ActiveWorkImportSetupRepository["deliverInvitation"]>(() => {
        providerCalls += 1;
        currentScope = {
          ...currentScope,
          clients: currentScope.clients.map((client) =>
            client.id === "client-a"
              ? {
                  ...client,
                  providerAcceptedAt: ACCEPTED_AT,
                  invitationEligible: false,
                  invitationState: "provider_accepted" as const,
                }
              : client,
          ),
        };
        return Promise.resolve({
          status: "provider_accepted" as const,
          providerAcceptedAt: ACCEPTED_AT,
        });
      }),
      enableReminder: vi.fn<ActiveWorkImportSetupRepository["enableReminder"]>(
        ({ installmentId }) => {
          const changed = currentScope.installments.some(
            (installment) => installment.id === installmentId && !installment.remindersEnabled,
          );
          currentScope = {
            ...currentScope,
            installments: currentScope.installments.map((installment) =>
              installment.id === installmentId
                ? { ...installment, remindersEnabled: true }
                : installment,
            ),
          };
          return Promise.resolve({ changed });
        },
      ),
      completeBatch: vi.fn<ActiveWorkImportSetupRepository["completeBatch"]>(() => {
        const changed = !completed;
        completed = true;
        completionChanges.push(changed);
        return Promise.resolve({ changed, completed: true, unfinishedDraftCount: 0 });
      }),
    });
    const exact = input({
      selectedClientContactIds: ["client-a"],
    });

    const first = await runActiveWorkImportSetup(fake.value, exact);
    const replay = await runActiveWorkImportSetup(fake.value, exact);

    expect(first.invitations[0]?.status).toBe("provider_accepted");
    expect(replay).toMatchObject({
      invitations: [{ clientContactId: "client-a", status: "provider_accepted" }],
      reminders: [
        {
          installmentId: "installment-final-before-approval",
          status: "enabled",
          changed: false,
        },
        { installmentId: "installment-first", status: "enabled", changed: false },
      ],
    });
    expect(fake.reserveOperation).toHaveBeenCalledTimes(2);
    expect(operationReceipts.size).toBe(1);
    expect(providerCalls).toBe(1);
    expect(fake.reserveInvitation).toHaveBeenCalledTimes(1);
    expect(fake.completeBatch).toHaveBeenCalledTimes(2);
    expect(completionChanges).toEqual([true, false]);
  });

  it("needs no reminder selection and enables every unpaid installment with a due date", async () => {
    const fake = repository();

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result).toEqual({
      distinctClientCount: 2,
      projectPurchaseCount: 3,
      invitations: [
        {
          clientContactId: "client-a",
          status: "provider_accepted",
          providerAcceptedAt: ACCEPTED_AT,
        },
        {
          clientContactId: "client-b",
          status: "connected",
          providerAcceptedAt: null,
        },
      ],
      reminders: [
        {
          installmentId: "installment-final-before-approval",
          purchaseId: "purchase-1",
          status: "enabled",
          changed: true,
        },
        {
          installmentId: "installment-first",
          purchaseId: "purchase-1",
          status: "enabled",
          changed: true,
        },
      ],
      batch: { completed: true, unfinishedDraftCount: 0 },
    });
    expect(fake.reserveInvitation).toHaveBeenCalledTimes(1);
    expect(fake.deliverInvitation).toHaveBeenCalledTimes(1);
    expect(fake.enableReminder).toHaveBeenCalledTimes(2);
    expect(fake.completeBatch).toHaveBeenCalledWith({
      producerId: "producer-1",
      batchId: "batch-1",
      completedAt: NOW,
    });
  });

  // Silently returning "done" here is what bounces the producer back into the
  // wizard on the next visit with no explanation.
  it("finishes successful effects and says the batch is still open because drafts remain", async () => {
    const fake = repository({
      completeBatch: vi.fn<ActiveWorkImportSetupRepository["completeBatch"]>(() =>
        Promise.resolve({ changed: false, completed: false, unfinishedDraftCount: 2 }),
      ),
    });

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result.invitations).toHaveLength(2);
    expect(result.reminders).toHaveLength(2);
    expect(fake.completeBatch).toHaveBeenCalledTimes(1);
    expect(result.batch).toEqual({ completed: false, unfinishedDraftCount: 2 });
  });

  it("reports a closed batch when this run closed it", async () => {
    const fake = repository();

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result.batch).toEqual({ completed: true, unfinishedDraftCount: 0 });
  });

  // A replay after a lost response changes nothing, but the batch is closed.
  it("reports a closed batch when an earlier run already closed it", async () => {
    const fake = repository({
      completeBatch: vi.fn<ActiveWorkImportSetupRepository["completeBatch"]>(() =>
        Promise.resolve({ changed: false, completed: true, unfinishedDraftCount: 0 }),
      ),
    });

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result.batch).toEqual({ completed: true, unfinishedDraftCount: 0 });
  });

  it("does not claim a closed batch while an invitation is still sending", async () => {
    const fake = repository({
      deliverInvitation: vi.fn<ActiveWorkImportSetupRepository["deliverInvitation"]>(() =>
        Promise.resolve({ status: "requested" as const, providerAcceptedAt: null }),
      ),
    });

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(fake.completeBatch).not.toHaveBeenCalled();
    expect(result.batch).toEqual({ completed: false, unfinishedDraftCount: null });
  });

  it("fails closed before side effects when a selected Client is not a materialized output of this batch", async () => {
    const fake = repository();

    await expect(
      runActiveWorkImportSetup(
        fake.value,
        input({ selectedClientContactIds: ["unrelated-client"] }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.reserveInvitation).not.toHaveBeenCalled();
    expect(fake.deliverInvitation).not.toHaveBeenCalled();
    expect(fake.enableReminder).not.toHaveBeenCalled();
  });

  it("reserves every recipient before delivery so an operation conflict sends nothing", async () => {
    const first = delivery(
      "client-a",
      activeWorkImportSetupInvitationOperationKey("finish-click-1", "client-a"),
    );
    const baseScope = scope();
    const [firstClient, secondClient] = baseScope.clients;
    if (!firstClient || !secondClient) throw new Error("Expected two client fixtures");
    const fake = repository({
      loadScope: vi.fn<ActiveWorkImportSetupRepository["loadScope"]>(() =>
        Promise.resolve({
          ...baseScope,
          clients: [
            { ...firstClient, connected: false, invitationEligible: true },
            { ...secondClient, connected: false, invitationEligible: true },
          ],
        }),
      ),
      reserveInvitation: vi.fn<ActiveWorkImportSetupRepository["reserveInvitation"]>(
        (reservation) => {
          if (reservation.clientContactId === "client-b") {
            throw Object.assign(new Error("changed recipient"), {
              code: "OPERATION_KEY_CONFLICT",
            });
          }
          return Promise.resolve({ state: "reserved" as const, delivery: first });
        },
      ),
    });

    const changedScope = await fake.loadScope({
      producerId: "producer-1",
      batchId: "batch-1",
    });
    await expect(
      runActiveWorkImportSetup(
        fake.value,
        input({ expectedSetupDigest: activeWorkImportSetupDigest(changedScope) }),
      ),
    ).rejects.toMatchObject({
      code: "OPERATION_KEY_CONFLICT",
    });
    expect(fake.deliverInvitation).not.toHaveBeenCalled();
    expect(fake.enableReminder).not.toHaveBeenCalled();
  });

  it("uses recipient-stable operation keys and isolates provider/reminder failures", async () => {
    expect(activeWorkImportSetupInvitationOperationKey(" action ", "client-a")).toBe(
      activeWorkImportSetupInvitationOperationKey("action", "client-a"),
    );
    expect(activeWorkImportSetupInvitationOperationKey("action", "client-a")).not.toBe(
      activeWorkImportSetupInvitationOperationKey("action", "client-b"),
    );
    const fake = repository({
      deliverInvitation: vi.fn<ActiveWorkImportSetupRepository["deliverInvitation"]>(() =>
        Promise.resolve({
          status: "failed" as const,
          providerAcceptedAt: null,
          reason: "The email service is busy. Try again in a few minutes.",
        }),
      ),
      enableReminder: vi.fn<ActiveWorkImportSetupRepository["enableReminder"]>((reminder) => {
        if (reminder.installmentId === "installment-first") {
          throw new PurchaseLedgerDomainError("CONFLICT", "already paid");
        }
        return Promise.resolve({ changed: false });
      }),
    });

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result.invitations).toContainEqual({
      clientContactId: "client-a",
      status: "failed",
      providerAcceptedAt: null,
      reason: "The email service is busy. Try again in a few minutes.",
    });
    expect(result.reminders).toEqual([
      {
        installmentId: "installment-final-before-approval",
        purchaseId: "purchase-1",
        status: "enabled",
        changed: false,
      },
      {
        installmentId: "installment-first",
        purchaseId: "purchase-1",
        status: "failed",
        changed: false,
        reason: "already paid",
      },
    ]);
    expect(fake.completeBatch).not.toHaveBeenCalled();
  });

  it("keeps the batch open when an invitation fails but every reminder succeeds", async () => {
    const fake = repository({
      deliverInvitation: vi.fn<ActiveWorkImportSetupRepository["deliverInvitation"]>(() =>
        Promise.resolve({
          status: "failed" as const,
          providerAcceptedAt: null,
          reason: "The email service could not send this invitation. Try again.",
        }),
      ),
    });

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result.invitations.some((invitation) => invitation.status === "failed")).toBe(true);
    expect(result.reminders.every((reminder) => reminder.status === "enabled")).toBe(true);
    expect(fake.completeBatch).not.toHaveBeenCalled();
  });

  it("keeps the batch open while an invitation is still only requested from the provider", async () => {
    const fake = repository({
      deliverInvitation: vi.fn<ActiveWorkImportSetupRepository["deliverInvitation"]>(() =>
        Promise.resolve({ status: "requested" as const, providerAcceptedAt: null }),
      ),
    });

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result.invitations).toContainEqual({
      clientContactId: "client-a",
      status: "requested",
      providerAcceptedAt: null,
    });
    expect(result.reminders.every((reminder) => reminder.status === "enabled")).toBe(true);
    expect(fake.completeBatch).not.toHaveBeenCalled();
  });

  it("explains an ineligible reservation in plain words without a provider call", async () => {
    const fake = repository({
      reserveInvitation: vi.fn<ActiveWorkImportSetupRepository["reserveInvitation"]>(() =>
        Promise.resolve({ state: "ineligible" as const }),
      ),
    });

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result.invitations).toContainEqual({
      clientContactId: "client-a",
      status: "failed",
      providerAcceptedAt: null,
      reason: "This client's email is not valid or changed since review.",
    });
    expect(result.reminders.every((reminder) => reminder.status === "enabled")).toBe(true);
    expect(fake.deliverInvitation).not.toHaveBeenCalled();
    expect(fake.completeBatch).not.toHaveBeenCalled();
  });

  it("keeps the batch open when a reminder fails but every invitation succeeds", async () => {
    const fake = repository({
      enableReminder: vi.fn<ActiveWorkImportSetupRepository["enableReminder"]>((reminder) => {
        if (reminder.installmentId === "installment-first") {
          throw new PurchaseLedgerDomainError("CONFLICT", "changed concurrently");
        }
        return Promise.resolve({ changed: true });
      }),
    });

    const result = await runActiveWorkImportSetup(fake.value, input());

    expect(result.invitations.every((invitation) => invitation.status !== "failed")).toBe(true);
    expect(result.reminders.some((reminder) => reminder.status === "failed")).toBe(true);
    expect(fake.completeBatch).not.toHaveBeenCalled();
  });

  it("excludes a current-email provider-accepted Client and never sends a duplicate", async () => {
    const acceptedScope: ActiveWorkImportSetupScope = {
      ...scope(),
      clients: scope().clients.map((client) =>
        client.id === "client-a"
          ? {
              ...client,
              providerAcceptedAt: ACCEPTED_AT,
              invitationEligible: false,
              invitationState: "provider_accepted" as const,
            }
          : client,
      ),
    };
    const fake = repository({
      loadScope: vi.fn<ActiveWorkImportSetupRepository["loadScope"]>(() =>
        Promise.resolve(acceptedScope),
      ),
    });

    const result = await runActiveWorkImportSetup(
      fake.value,
      input({
        expectedSetupDigest: activeWorkImportSetupDigest(acceptedScope),
        selectedClientContactIds: ["client-a"],
      }),
    );

    expect(result.invitations).toEqual([
      {
        clientContactId: "client-a",
        status: "provider_accepted",
        providerAcceptedAt: ACCEPTED_AT,
      },
    ]);
    expect(fake.reserveInvitation).not.toHaveBeenCalled();
    expect(fake.deliverInvitation).not.toHaveBeenCalled();
  });

  it("skips a paid installment while still enabling every unpaid installment", async () => {
    const paidScope: ActiveWorkImportSetupScope = {
      ...scope(),
      installments: scope().installments.map((installment) =>
        installment.id === "installment-first"
          ? {
              ...installment,
              remainingCents: 0,
              status: "confirmed",
              reminderEligible: false,
            }
          : installment,
      ),
    };
    const fake = repository({
      loadScope: vi.fn<ActiveWorkImportSetupRepository["loadScope"]>(() =>
        Promise.resolve(paidScope),
      ),
    });

    const result = await runActiveWorkImportSetup(
      fake.value,
      input({
        expectedSetupDigest: activeWorkImportSetupDigest(paidScope),
        selectedClientContactIds: [],
      }),
    );

    expect(result.reminders).toEqual([
      {
        installmentId: "installment-final-before-approval",
        purchaseId: "purchase-1",
        status: "enabled",
        changed: true,
      },
    ]);
    expect(fake.enableReminder).toHaveBeenCalledTimes(1);
    expect(fake.enableReminder).toHaveBeenCalledWith({
      producerId: "producer-1",
      purchaseId: "purchase-1",
      installmentId: "installment-final-before-approval",
    });
  });

  it("rejects a stale reviewed setup digest before any side effect", async () => {
    const fake = repository();

    await expect(
      runActiveWorkImportSetup(
        fake.value,
        input({ expectedSetupDigest: `sha256:${"f".repeat(64)}` }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fake.reserveInvitation).not.toHaveBeenCalled();
    expect(fake.deliverInvitation).not.toHaveBeenCalled();
    expect(fake.enableReminder).not.toHaveBeenCalled();
  });

  it("rechecks connection state under the invitation reservation lock", async () => {
    const fake = repository({
      reserveInvitation: vi.fn<ActiveWorkImportSetupRepository["reserveInvitation"]>(() =>
        Promise.resolve({ state: "connected" as const }),
      ),
    });

    const result = await runActiveWorkImportSetup(
      fake.value,
      input({
        selectedClientContactIds: ["client-a"],
      }),
    );

    expect(result.invitations).toEqual([
      {
        clientContactId: "client-a",
        status: "connected",
        providerAcceptedAt: null,
      },
    ]);
    expect(fake.deliverInvitation).not.toHaveBeenCalled();
  });

  it("safely replays the same finish action after its first response is lost", async () => {
    let currentScope = scope();
    const reservedDelivery = delivery(
      "client-a",
      activeWorkImportSetupInvitationOperationKey("finish-click-1", "client-a"),
    );
    let providerCalls = 0;
    const fake = repository({
      loadScope: vi.fn<ActiveWorkImportSetupRepository["loadScope"]>(() =>
        Promise.resolve(currentScope),
      ),
      reserveInvitation: vi.fn<ActiveWorkImportSetupRepository["reserveInvitation"]>(() =>
        Promise.resolve({
          state: "reserved" as const,
          delivery: reservedDelivery,
        }),
      ),
      deliverInvitation: vi.fn<ActiveWorkImportSetupRepository["deliverInvitation"]>(() => {
        providerCalls += 1;
        currentScope = {
          ...currentScope,
          clients: currentScope.clients.map((client) =>
            client.id === "client-a"
              ? {
                  ...client,
                  providerAcceptedAt: ACCEPTED_AT,
                  invitationEligible: false,
                  invitationState: "provider_accepted" as const,
                }
              : client,
          ),
        };
        return Promise.resolve({
          status: "provider_accepted" as const,
          providerAcceptedAt: ACCEPTED_AT,
        });
      }),
      enableReminder: vi.fn<ActiveWorkImportSetupRepository["enableReminder"]>((selected) => {
        const changed = currentScope.installments.some(
          (installment) =>
            installment.id === selected.installmentId && !installment.remindersEnabled,
        );
        currentScope = {
          ...currentScope,
          installments: currentScope.installments.map((installment) =>
            installment.id === selected.installmentId
              ? { ...installment, remindersEnabled: true }
              : installment,
          ),
        };
        return Promise.resolve({ changed });
      }),
    });
    const reviewedDigest = activeWorkImportSetupDigest(currentScope);
    const reviewedInput = input({
      expectedSetupDigest: reviewedDigest,
      selectedClientContactIds: ["client-a"],
    });

    const first = await runActiveWorkImportSetup(fake.value, reviewedInput);
    const replay = await runActiveWorkImportSetup(fake.value, {
      ...reviewedInput,
      operationKey: "finish-click-after-success-reload",
    });

    expect(activeWorkImportSetupDigest(currentScope)).toBe(reviewedDigest);
    expect(first.invitations[0]).toMatchObject({ status: "provider_accepted" });
    expect(replay).toMatchObject({
      invitations: [{ clientContactId: "client-a", status: "provider_accepted" }],
      reminders: [
        {
          installmentId: "installment-final-before-approval",
          status: "enabled",
          changed: false,
        },
        {
          installmentId: "installment-first",
          status: "enabled",
          changed: false,
        },
      ],
    });
    expect(providerCalls).toBe(1);
    expect(fake.reserveInvitation).toHaveBeenCalledTimes(1);
    expect(fake.enableReminder).toHaveBeenCalledTimes(4);
  });

  it("retries its own failed delivery with the same recipient operation and provider key", async () => {
    let currentScope = scope();
    const exactOperation = activeWorkImportSetupInvitationOperationKey(
      "finish-click-1",
      "client-a",
    );
    const sameDelivery = delivery("client-a", exactOperation);
    let attempts = 0;
    const fake = repository({
      loadScope: vi.fn<ActiveWorkImportSetupRepository["loadScope"]>(() =>
        Promise.resolve(currentScope),
      ),
      reserveInvitation: vi.fn<ActiveWorkImportSetupRepository["reserveInvitation"]>(() =>
        Promise.resolve({
          state: "reserved" as const,
          delivery: sameDelivery,
        }),
      ),
      deliverInvitation: vi.fn<ActiveWorkImportSetupRepository["deliverInvitation"]>((record) => {
        attempts += 1;
        if (attempts === 1) {
          currentScope = {
            ...currentScope,
            clients: currentScope.clients.map((client) =>
              client.id === "client-a"
                ? {
                    ...client,
                    invitationEligible: false,
                    invitationState: "send_in_progress_or_retryable" as const,
                  }
                : client,
            ),
          };
          return Promise.resolve({
            status: "failed" as const,
            providerAcceptedAt: null,
            reason: "The email service could not send this invitation. Try again.",
          });
        }
        expect(record.id).toBe(sameDelivery.id);
        expect(record.providerIdempotencyKey).toBe(sameDelivery.providerIdempotencyKey);
        return Promise.resolve({
          status: "provider_accepted" as const,
          providerAcceptedAt: ACCEPTED_AT,
        });
      }),
    });
    const reviewedInput = input({
      expectedSetupDigest: activeWorkImportSetupDigest(currentScope),
      selectedClientContactIds: ["client-a"],
    });

    const first = await runActiveWorkImportSetup(fake.value, reviewedInput);
    const retry = await runActiveWorkImportSetup(fake.value, {
      ...reviewedInput,
      operationKey: "finish-click-after-reload",
    });

    expect(first.invitations[0]?.status).toBe("failed");
    expect(retry.invitations[0]?.status).toBe("provider_accepted");
    expect(fake.reserveInvitation).toHaveBeenCalledTimes(2);
    const firstOperation = fake.reserveInvitation.mock.calls[0]?.[0].operationKey;
    const retryOperation = fake.reserveInvitation.mock.calls[1]?.[0].operationKey;
    expect(firstOperation).toBe(exactOperation);
    expect(retryOperation).toBe(
      activeWorkImportSetupInvitationOperationKey("finish-click-after-reload", "client-a"),
    );
    expect(retryOperation).not.toBe(firstOperation);
    expect(sameDelivery.providerIdempotencyKey).toBe("provider-client-a");
  });

  it("uses a fresh claim time for each sequential provider delivery", async () => {
    const twoRecipients: ActiveWorkImportSetupScope = {
      ...scope(),
      clients: scope().clients.map((client) => ({
        ...client,
        connected: false,
        invitationEligible: true,
        invitationState: "available" as const,
      })),
    };
    const attemptTimes = [
      new Date("2026-08-20T12:04:59.000Z"),
      new Date("2026-08-20T12:10:00.000Z"),
    ];
    const clock = vi.fn(() => attemptTimes.shift() ?? new Date("2026-08-20T12:11:00.000Z"));
    const fake = repository({
      loadScope: vi.fn<ActiveWorkImportSetupRepository["loadScope"]>(() =>
        Promise.resolve(twoRecipients),
      ),
    });

    await runActiveWorkImportSetup(
      fake.value,
      input({
        expectedSetupDigest: activeWorkImportSetupDigest(twoRecipients),
        selectedClientContactIds: ["client-a", "client-b"],
        requestedAt: NOW,
        now: clock,
      }),
    );

    expect(fake.reserveInvitation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ requestedAt: NOW }),
    );
    expect(fake.reserveInvitation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestedAt: NOW }),
    );
    expect(fake.deliverInvitation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      new Date("2026-08-20T12:04:59.000Z"),
    );
    expect(fake.deliverInvitation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      new Date("2026-08-20T12:10:00.000Z"),
    );
  });
});
