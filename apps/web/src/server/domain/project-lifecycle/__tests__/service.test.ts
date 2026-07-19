import { describe, expect, it } from "vitest";

import {
  cancelProject,
  cancelProjectPurchase,
  completeProject,
  editProject,
  PROJECT_REOPEN_ARCHIVED_CLIENT_MESSAGE,
  reopenProject,
  type ProjectLifecycleAtomicScope,
  type ProjectLifecycleClientRecord,
  type ProjectLifecycleProjectRecord,
  type ProjectLifecyclePurchaseRecord,
  type ProjectLifecycleRepository,
  type ProjectLifecycleTransaction,
} from "../service";

type Installment = {
  id: string;
  purchaseId: string;
  producerId: string;
  status:
    | "not_paid"
    | "awaiting_review"
    | "partially_paid"
    | "confirmed"
    | "overdue"
    | "waived"
    | "canceled";
  dueAt: Date | null;
  triggeredAt: Date | null;
  dueTrigger: "acceptance" | "monthly_anniversary" | "artist_approval";
  requiredForActivation: boolean;
  remindersEnabled: boolean;
};

type Allowance = {
  id: string;
  purchaseId: string;
  producerId: string;
  closedAt: Date | null;
  closeReason: "project_completed" | "project_canceled" | "purchase_canceled" | null;
};

type Cancellation = {
  purchaseId: string;
  producerId: string;
  reason: string;
  actorId: string;
  canceledAt: Date;
};

type State = {
  clients: Map<string, ProjectLifecycleClientRecord>;
  projects: Map<string, ProjectLifecycleProjectRecord>;
  purchases: Map<string, ProjectLifecyclePurchaseRecord>;
  installments: Installment[];
  allowances: Allowance[];
  cancellations: Cancellation[];
};

const PROJECT_ID = "project-1";
const PRODUCER_ID = "producer-1";
const CLIENT_ID = "client-1";
const PURCHASE_1 = "purchase-1";
const PURCHASE_2 = "purchase-2";
const PURCHASE_3 = "purchase-3";
const BASE_TIME = new Date("2026-07-18T08:00:00.000Z");

function client(producerArchivedAt: Date | null = null): ProjectLifecycleClientRecord {
  return {
    id: CLIENT_ID,
    producerId: PRODUCER_ID,
    producerArchivedAt,
  };
}

function project(
  lifecycleStatus: ProjectLifecycleProjectRecord["lifecycleStatus"] = "active",
): ProjectLifecycleProjectRecord {
  return {
    id: PROJECT_ID,
    producerId: PRODUCER_ID,
    clientContactId: CLIENT_ID,
    title: "Album",
    deadlineAt: null,
    workflowStage: "production",
    lifecycleStatus,
    lifecycleChangedAt: new Date(BASE_TIME),
    updatedAt: new Date(BASE_TIME),
  };
}

function purchase(
  id: string,
  lifecycleStatus: ProjectLifecyclePurchaseRecord["lifecycleStatus"] = "active",
): ProjectLifecyclePurchaseRecord {
  return {
    id,
    producerId: PRODUCER_ID,
    projectId: PROJECT_ID,
    lifecycleStatus,
    canceledAt: lifecycleStatus === "canceled" ? new Date(BASE_TIME) : null,
    updatedAt: new Date(BASE_TIME),
  };
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value);
}

function cloneState(state: State): State {
  return {
    clients: new Map(
      [...state.clients].map(([id, row]) => [
        id,
        {
          ...row,
          producerArchivedAt: cloneDate(row.producerArchivedAt),
        },
      ]),
    ),
    projects: new Map(
      [...state.projects].map(([id, row]) => [
        id,
        {
          ...row,
          deadlineAt: cloneDate(row.deadlineAt),
          lifecycleChangedAt: new Date(row.lifecycleChangedAt),
          updatedAt: new Date(row.updatedAt),
        },
      ]),
    ),
    purchases: new Map(
      [...state.purchases].map(([id, row]) => [
        id,
        { ...row, canceledAt: cloneDate(row.canceledAt), updatedAt: new Date(row.updatedAt) },
      ]),
    ),
    installments: state.installments.map((row) => ({
      ...row,
      dueAt: cloneDate(row.dueAt),
      triggeredAt: cloneDate(row.triggeredAt),
    })),
    allowances: state.allowances.map((row) => ({ ...row, closedAt: cloneDate(row.closedAt) })),
    cancellations: state.cancellations.map((row) => ({
      ...row,
      canceledAt: new Date(row.canceledAt),
    })),
  };
}

class MemoryRepository implements ProjectLifecycleRepository {
  state: State;
  rejectCancellationInsert = false;
  private queue = Promise.resolve();

  constructor(input: Partial<State> = {}) {
    this.state = {
      clients: input.clients ?? new Map([[CLIENT_ID, client()]]),
      projects: input.projects ?? new Map([[PROJECT_ID, project()]]),
      purchases: input.purchases ?? new Map<string, ProjectLifecyclePurchaseRecord>(),
      installments: input.installments ?? [],
      allowances: input.allowances ?? [],
      cancellations: input.cancellations ?? [],
    };
  }

  async atomically<T>(
    scope: ProjectLifecycleAtomicScope,
    work: (transaction: ProjectLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const draft = cloneState(this.state);

    try {
      const scopedProject = draft.projects.get(scope.projectId);
      const ownedProject = scopedProject?.producerId === scope.producerId ? scopedProject : null;
      const scopedClient =
        scope.kind === "reopen" && ownedProject
          ? draft.clients.get(ownedProject.clientContactId)
          : undefined;
      const ownedClient = scopedClient?.producerId === scope.producerId ? scopedClient : null;
      const scopedPurchases = [...draft.purchases.values()]
        .filter(
          (row) =>
            row.projectId === scope.projectId &&
            row.producerId === scope.producerId &&
            (scope.kind !== "purchase" || row.id === scope.purchaseId),
        )
        .sort((left, right) => left.id.localeCompare(right.id));

      const transaction: ProjectLifecycleTransaction = {
        project: ownedProject,
        reopenClient: ownedClient,
        purchases: scopedPurchases,
        updateProjectMetadata: (input) => {
          const current = draft.projects.get(input.projectId);
          if (!current || current.producerId !== input.producerId) return Promise.resolve(null);
          const updated = {
            ...current,
            ...input.patch,
            deadlineAt:
              input.patch.deadlineAt === undefined
                ? current.deadlineAt
                : cloneDate(input.patch.deadlineAt),
            updatedAt: new Date(input.changedAt),
          };
          draft.projects.set(updated.id, updated);
          return Promise.resolve(updated);
        },
        transitionProject: (input) => {
          const current = draft.projects.get(input.projectId);
          if (
            !current ||
            current.producerId !== input.producerId ||
            current.lifecycleStatus !== input.from
          ) {
            return Promise.resolve(null);
          }
          const updated = {
            ...current,
            lifecycleStatus: input.to,
            lifecycleChangedAt: new Date(input.changedAt),
            updatedAt: new Date(input.changedAt),
          };
          draft.projects.set(updated.id, updated);
          return Promise.resolve(updated);
        },
        cancelPurchase: (input) => {
          const current = draft.purchases.get(input.purchaseId);
          if (
            !current ||
            current.producerId !== input.producerId ||
            current.projectId !== input.projectId ||
            current.lifecycleStatus !== input.from
          ) {
            return Promise.resolve(null);
          }
          const updated = {
            ...current,
            lifecycleStatus: "canceled" as const,
            canceledAt: new Date(input.canceledAt),
            updatedAt: new Date(input.canceledAt),
          };
          draft.purchases.set(updated.id, updated);
          return Promise.resolve(updated);
        },
        cancelFutureInstallments: (input) => {
          let changed = 0;
          for (const row of draft.installments) {
            if (
              row.purchaseId !== input.purchaseId ||
              row.producerId !== input.producerId ||
              row.status !== "not_paid"
            ) {
              continue;
            }
            const future =
              !row.requiredForActivation &&
              row.dueTrigger !== "acceptance" &&
              ((row.dueAt !== null && row.dueAt > input.canceledAt) ||
                (row.dueAt === null && row.triggeredAt === null));
            if (!future) continue;
            row.status = "canceled";
            row.remindersEnabled = false;
            changed += 1;
          }
          return Promise.resolve(changed);
        },
        closeOpenAllowances: (input) => {
          let changed = 0;
          const purchaseIds = new Set(input.purchaseIds);
          for (const row of draft.allowances) {
            if (
              row.producerId !== input.producerId ||
              !purchaseIds.has(row.purchaseId) ||
              row.closedAt !== null
            ) {
              continue;
            }
            row.closedAt = new Date(input.closedAt);
            row.closeReason = input.reason;
            changed += 1;
          }
          return Promise.resolve(changed);
        },
        insertPurchaseCancellation: (input) => {
          if (
            this.rejectCancellationInsert ||
            draft.cancellations.some((row) => row.purchaseId === input.purchaseId)
          ) {
            return Promise.resolve(false);
          }
          draft.cancellations.push({
            purchaseId: input.purchaseId,
            producerId: input.producerId,
            reason: input.reason,
            actorId: input.actorId,
            canceledAt: new Date(input.canceledAt),
          });
          return Promise.resolve(true);
        },
      };

      const result = await work(transaction);
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }
}

function installment(
  id: string,
  purchaseId: string,
  patch: Partial<Installment> = {},
): Installment {
  return {
    id,
    purchaseId,
    producerId: PRODUCER_ID,
    status: "not_paid",
    dueAt: null,
    triggeredAt: null,
    dueTrigger: "monthly_anniversary",
    requiredForActivation: false,
    remindersEnabled: true,
    ...patch,
  };
}

function allowance(id: string, purchaseId: string): Allowance {
  return {
    id,
    purchaseId,
    producerId: PRODUCER_ID,
    closedAt: null,
    closeReason: null,
  };
}

describe("project lifecycle edits", () => {
  it("edits only mutable project metadata and treats an exact retry as unchanged", async () => {
    const repository = new MemoryRepository();
    const changedAt = new Date("2026-07-18T09:00:00.000Z");
    const deadlineAt = new Date("2026-08-01T18:00:00.000Z");

    const first = await editProject(repository, {
      producerId: PRODUCER_ID,
      projectId: PROJECT_ID,
      title: "  New album name  ",
      deadlineAt,
      workflowStage: "mixing",
      changedAt,
    });

    expect(first).toMatchObject({ changed: true });
    expect(first.project).toMatchObject({
      title: "New album name",
      deadlineAt,
      workflowStage: "mixing",
      clientContactId: CLIENT_ID,
      lifecycleStatus: "active",
    });

    const retry = await editProject(repository, {
      producerId: PRODUCER_ID,
      projectId: PROJECT_ID,
      title: "New album name",
      deadlineAt,
      workflowStage: "mixing",
      changedAt: new Date("2026-07-18T10:00:00.000Z"),
    });
    expect(retry).toMatchObject({ changed: false });
    expect(retry.project.updatedAt).toEqual(changedAt);
  });

  it("rejects invalid edits and hides foreign ownership", async () => {
    const repository = new MemoryRepository();
    await expect(
      editProject(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        title: "   ",
        changedAt: BASE_TIME,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      editProject(repository, {
        producerId: "producer-2",
        projectId: PROJECT_ID,
        title: "Foreign",
        changedAt: BASE_TIME,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repository.state.projects.get(PROJECT_ID)?.title).toBe("Album");
  });
});

describe("project completion", () => {
  it.each(["active", "paused"] as const)(
    "completes a %s project, closes open allowances, and preserves purchase history",
    async (status) => {
      const installments = [installment("due", PURCHASE_1, { dueAt: BASE_TIME })];
      const repository = new MemoryRepository({
        projects: new Map([[PROJECT_ID, project(status)]]),
        purchases: new Map([[PURCHASE_1, purchase(PURCHASE_1)]]),
        installments,
        allowances: [allowance("allowance-1", PURCHASE_1)],
      });
      const beforePurchase = cloneState(repository.state).purchases.get(PURCHASE_1);

      const result = await completeProject(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        completedAt: new Date("2026-07-18T11:00:00.000Z"),
      });

      expect(result).toMatchObject({ changed: true, closedAllowances: 1 });
      expect(result.project.lifecycleStatus).toBe("completed");
      expect(repository.state.purchases.get(PURCHASE_1)).toEqual(beforePurchase);
      expect(repository.state.installments[0]).toMatchObject({
        status: "not_paid",
        remindersEnabled: true,
      });
      expect(repository.state.allowances[0]).toMatchObject({
        closeReason: "project_completed",
      });
      expect(repository.state.cancellations).toHaveLength(0);

      await expect(
        completeProject(repository, {
          producerId: PRODUCER_ID,
          projectId: PROJECT_ID,
          completedAt: new Date("2026-07-18T12:00:00.000Z"),
        }),
      ).resolves.toMatchObject({ changed: false, closedAllowances: 0 });
    },
  );

  it("rejects waiting and canceled projects without closing allowances", async () => {
    for (const status of ["waiting_for_payment", "canceled"] as const) {
      const repository = new MemoryRepository({
        projects: new Map([[PROJECT_ID, project(status)]]),
        purchases: new Map([[PURCHASE_1, purchase(PURCHASE_1)]]),
        allowances: [allowance("allowance-1", PURCHASE_1)],
      });
      await expect(
        completeProject(repository, {
          producerId: PRODUCER_ID,
          projectId: PROJECT_ID,
          completedAt: BASE_TIME,
        }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      expect(repository.state.allowances[0]?.closedAt).toBeNull();
    }
  });
});

describe("project cancellation", () => {
  it("cancels purchases and only genuinely future untouched installments", async () => {
    const canceledAt = new Date("2026-07-18T12:00:00.000Z");
    const repository = new MemoryRepository({
      purchases: new Map([
        [PURCHASE_1, purchase(PURCHASE_1, "active")],
        [PURCHASE_2, purchase(PURCHASE_2, "waiting_for_payment")],
        [PURCHASE_3, purchase(PURCHASE_3, "canceled")],
      ]),
      installments: [
        installment("future-date", PURCHASE_1, {
          dueAt: new Date("2026-07-19T12:00:00.000Z"),
        }),
        installment("exact-due", PURCHASE_1, { dueAt: new Date(canceledAt) }),
        installment("past-due", PURCHASE_1, {
          dueAt: new Date("2026-07-17T12:00:00.000Z"),
        }),
        installment("future-trigger", PURCHASE_1),
        installment("acceptance-due", PURCHASE_1, {
          dueTrigger: "acceptance",
        }),
        installment("activation-required", PURCHASE_1, {
          requiredForActivation: true,
        }),
        installment("already-triggered", PURCHASE_1, {
          triggeredAt: new Date("2026-07-18T10:00:00.000Z"),
        }),
        installment("partial-future", PURCHASE_1, {
          status: "partially_paid",
          dueAt: new Date("2026-07-19T12:00:00.000Z"),
        }),
        installment("second-purchase-future", PURCHASE_2, {
          dueAt: new Date("2026-08-01T12:00:00.000Z"),
        }),
      ],
      allowances: [
        allowance("allowance-1", PURCHASE_1),
        allowance("allowance-2", PURCHASE_2),
        allowance("allowance-3", PURCHASE_3),
      ],
      cancellations: [
        {
          purchaseId: PURCHASE_3,
          producerId: PRODUCER_ID,
          reason: "Earlier cancellation",
          actorId: "user-earlier",
          canceledAt: BASE_TIME,
        },
      ],
    });

    const result = await cancelProject(repository, {
      producerId: PRODUCER_ID,
      projectId: PROJECT_ID,
      actorId: "user-producer",
      reason: "Client ended the project",
      canceledAt,
    });

    expect(result).toMatchObject({
      changed: true,
      canceledPurchaseIds: [PURCHASE_1, PURCHASE_2],
      canceledInstallments: 3,
      closedAllowances: 3,
    });
    expect(result.project.lifecycleStatus).toBe("canceled");
    expect(repository.state.purchases.get(PURCHASE_1)).toMatchObject({
      lifecycleStatus: "canceled",
      canceledAt,
    });
    expect(repository.state.purchases.get(PURCHASE_2)).toMatchObject({
      lifecycleStatus: "canceled",
      canceledAt,
    });
    expect(repository.state.cancellations).toHaveLength(3);

    const byId = new Map(repository.state.installments.map((row) => [row.id, row]));
    for (const id of ["future-date", "future-trigger", "second-purchase-future"]) {
      expect(byId.get(id)).toMatchObject({ status: "canceled", remindersEnabled: false });
    }
    for (const id of [
      "exact-due",
      "past-due",
      "acceptance-due",
      "activation-required",
      "already-triggered",
      "partial-future",
    ]) {
      expect(byId.get(id)).not.toMatchObject({ status: "canceled" });
      expect(byId.get(id)?.remindersEnabled).toBe(true);
    }
    expect(repository.state.allowances.every((row) => row.closeReason === "project_canceled")).toBe(
      true,
    );

    await expect(
      cancelProject(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        actorId: "different-retry-actor",
        reason: "Retry",
        canceledAt: new Date("2026-07-18T13:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      changed: false,
      canceledPurchaseIds: [],
      canceledInstallments: 0,
      closedAllowances: 0,
    });
    expect(repository.state.cancellations).toHaveLength(3);
  });

  it("rolls back every child write when immutable cancellation history cannot be inserted", async () => {
    const repository = new MemoryRepository({
      purchases: new Map([[PURCHASE_1, purchase(PURCHASE_1)]]),
      installments: [installment("future", PURCHASE_1)],
      allowances: [allowance("allowance-1", PURCHASE_1)],
    });
    repository.rejectCancellationInsert = true;
    const before = cloneState(repository.state);

    await expect(
      cancelProject(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        actorId: "user-producer",
        reason: "Cancel",
        canceledAt: BASE_TIME,
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
    expect(repository.state).toEqual(before);
  });
});

describe("single purchase cancellation and reopen", () => {
  it("cancels one exact purchase without changing the project or its sibling", async () => {
    const repository = new MemoryRepository({
      purchases: new Map([
        [PURCHASE_1, purchase(PURCHASE_1)],
        [PURCHASE_2, purchase(PURCHASE_2)],
      ]),
      installments: [installment("future-1", PURCHASE_1), installment("future-2", PURCHASE_2)],
      allowances: [allowance("allowance-1", PURCHASE_1), allowance("allowance-2", PURCHASE_2)],
    });

    const result = await cancelProjectPurchase(repository, {
      producerId: PRODUCER_ID,
      projectId: PROJECT_ID,
      purchaseId: PURCHASE_1,
      actorId: "user-producer",
      reason: "Remove add-on",
      canceledAt: new Date("2026-07-18T12:00:00.000Z"),
    });

    expect(result).toMatchObject({ changed: true, canceledInstallments: 1, closedAllowances: 1 });
    expect(result.project.lifecycleStatus).toBe("active");
    expect(result.purchase.lifecycleStatus).toBe("canceled");
    expect(repository.state.purchases.get(PURCHASE_2)?.lifecycleStatus).toBe("active");
    expect(repository.state.installments.find((row) => row.id === "future-2")?.status).toBe(
      "not_paid",
    );
    expect(
      repository.state.allowances.find((row) => row.id === "allowance-2")?.closedAt,
    ).toBeNull();

    await expect(
      cancelProjectPurchase(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        purchaseId: PURCHASE_1,
        actorId: "user-producer",
        reason: "Retry",
        canceledAt: new Date("2026-07-18T13:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ changed: false, canceledInstallments: 0, closedAllowances: 0 });
    expect(repository.state.cancellations).toHaveLength(1);
  });

  it("reopens only the project and never restores canceled child state", async () => {
    const repository = new MemoryRepository({
      projects: new Map([[PROJECT_ID, project("canceled")]]),
      purchases: new Map([[PURCHASE_1, purchase(PURCHASE_1, "canceled")]]),
      installments: [installment("future", PURCHASE_1, { status: "canceled" })],
      allowances: [
        {
          ...allowance("allowance-1", PURCHASE_1),
          closedAt: BASE_TIME,
          closeReason: "project_canceled",
        },
      ],
    });

    const result = await reopenProject(repository, {
      producerId: PRODUCER_ID,
      projectId: PROJECT_ID,
      reopenedAt: new Date("2026-07-18T14:00:00.000Z"),
    });
    expect(result).toMatchObject({ changed: true });
    expect(result.project.lifecycleStatus).toBe("active");
    expect(repository.state.purchases.get(PURCHASE_1)?.lifecycleStatus).toBe("canceled");
    expect(repository.state.installments[0]?.status).toBe("canceled");
    expect(repository.state.allowances[0]).toMatchObject({
      closedAt: BASE_TIME,
      closeReason: "project_canceled",
    });

    await expect(
      reopenProject(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        reopenedAt: new Date("2026-07-18T15:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ changed: false });
  });

  it("requires the stable client to be restored before reopening", async () => {
    const archivedAt = new Date("2026-07-18T13:30:00.000Z");
    const repository = new MemoryRepository({
      clients: new Map([[CLIENT_ID, client(archivedAt)]]),
      projects: new Map([[PROJECT_ID, project("completed")]]),
    });

    await expect(
      reopenProject(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        reopenedAt: new Date("2026-07-18T14:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      message: PROJECT_REOPEN_ARCHIVED_CLIENT_MESSAGE,
    });
    expect(repository.state.projects.get(PROJECT_ID)?.lifecycleStatus).toBe("completed");
    expect(repository.state.clients.get(CLIENT_ID)?.producerArchivedAt).toEqual(archivedAt);
  });

  it("fails closed when the locked client does not match the stable project owner", async () => {
    const repository = new MemoryRepository({
      projects: new Map([
        [PROJECT_ID, { ...project("completed"), clientContactId: "different-client" }],
      ]),
    });

    await expect(
      reopenProject(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        reopenedAt: new Date("2026-07-18T14:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
    expect(repository.state.projects.get(PROJECT_ID)?.lifecycleStatus).toBe("completed");
  });

  it("fails closed for foreign project and purchase scopes", async () => {
    const repository = new MemoryRepository({
      purchases: new Map([[PURCHASE_1, purchase(PURCHASE_1)]]),
    });
    await expect(
      cancelProjectPurchase(repository, {
        producerId: "producer-2",
        projectId: PROJECT_ID,
        purchaseId: PURCHASE_1,
        actorId: "foreign-user",
        reason: "Foreign",
        canceledAt: BASE_TIME,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      cancelProjectPurchase(repository, {
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        purchaseId: "missing-purchase",
        actorId: "user-producer",
        reason: "Missing",
        canceledAt: BASE_TIME,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      reopenProject(repository, {
        producerId: "producer-2",
        projectId: PROJECT_ID,
        reopenedAt: BASE_TIME,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "The project was not found" });
    expect(repository.state.purchases.get(PURCHASE_1)?.lifecycleStatus).toBe("active");
  });

  it("rejects illegal reopen transitions", async () => {
    for (const status of ["waiting_for_payment", "paused"] as const) {
      const repository = new MemoryRepository({
        projects: new Map([[PROJECT_ID, project(status)]]),
      });
      await expect(
        reopenProject(repository, {
          producerId: PRODUCER_ID,
          projectId: PROJECT_ID,
          reopenedAt: BASE_TIME,
        }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    }
  });
});
