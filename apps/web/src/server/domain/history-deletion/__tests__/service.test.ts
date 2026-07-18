import { describe, expect, it } from "vitest";

import {
  permanentlyDeleteEmptyDraftClient,
  permanentlyDeleteEmptyDraftProject,
  type ClientDeletionSnapshot,
  type HistoricalDeletionRepository,
  type ProjectDeletionSnapshot,
} from "../service";

class Mutex {
  private tail = Promise.resolve();

  async run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

function repository(input?: {
  client?: ClientDeletionSnapshot | null;
  project?: ProjectDeletionSnapshot | null;
  clientHistory?: boolean;
  projectHistory?: boolean;
}): HistoricalDeletionRepository & {
  clientDeleted: boolean;
  projectDeleted: boolean;
  createClientHistory: () => Promise<"created" | "parent_missing">;
  createProjectHistory: () => Promise<"created" | "parent_missing">;
} {
  const mutex = new Mutex();
  let client = input?.client ?? null;
  let project = input?.project ?? null;
  let clientHistory = input?.clientHistory ?? false;
  let projectHistory = input?.projectHistory ?? false;
  const repo: HistoricalDeletionRepository & {
    clientDeleted: boolean;
    projectDeleted: boolean;
    createClientHistory: () => Promise<"created" | "parent_missing">;
    createProjectHistory: () => Promise<"created" | "parent_missing">;
  } = {
    clientDeleted: false,
    projectDeleted: false,
    atomically: async (_scope, work) =>
      mutex.run(() =>
        work({
          lockClient: () => Promise.resolve(client),
          lockProject: () => Promise.resolve(project),
          clientHasHistory: () => Promise.resolve(clientHistory),
          projectHasHistory: () => Promise.resolve(projectHistory),
          deleteClient: () => {
            if (!client) return Promise.resolve(false);
            client = null;
            repo.clientDeleted = true;
            return Promise.resolve(true);
          },
          deleteProject: () => {
            if (!project) return Promise.resolve(false);
            project = null;
            repo.projectDeleted = true;
            return Promise.resolve(true);
          },
        }),
      ),
    createClientHistory: () =>
      mutex.run(() => {
        if (!client) return Promise.resolve("parent_missing" as const);
        clientHistory = true;
        return Promise.resolve("created" as const);
      }),
    createProjectHistory: () =>
      mutex.run(() => {
        if (!project) return Promise.resolve("parent_missing" as const);
        projectHistory = true;
        clientHistory = true;
        return Promise.resolve("created" as const);
      }),
  };
  return repo;
}

const emptyClient = {
  id: "client-1",
  producerId: "producer-1",
  clerkUserId: null,
  invitedAt: null,
  artistArchivedAt: null,
  producerArchivedAt: null,
};

const emptyProject = {
  id: "project-1",
  producerId: "producer-1",
  lifecycleStatus: "waiting_for_payment" as const,
};

describe("historical client deletion", () => {
  it("permanently deletes only a truly empty unowned draft", async () => {
    const repo = repository({ client: emptyClient });
    await expect(
      permanentlyDeleteEmptyDraftClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
      }),
    ).resolves.toEqual({ deleted: true });
    expect(repo.clientDeleted).toBe(true);
  });

  it.each([
    ["connected", { clerkUserId: "user-1" }],
    ["invited", { invitedAt: new Date() }],
    ["artist-disconnected", { artistArchivedAt: new Date() }],
    ["producer-archived", { producerArchivedAt: new Date() }],
  ])("blocks a %s historical client", async (_label, patch) => {
    const repo = repository({ client: { ...emptyClient, ...patch } });
    await expect(
      permanentlyDeleteEmptyDraftClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_EMPTY_DRAFT" });
  });

  it("blocks any relational history and hides foreign ids", async () => {
    const historical = repository({ client: emptyClient, clientHistory: true });
    await expect(
      permanentlyDeleteEmptyDraftClient(historical, {
        producerId: "producer-1",
        clientId: "client-1",
      }),
    ).rejects.toMatchObject({ code: "HISTORY_EXISTS" });

    const foreign = repository({
      client: { ...emptyClient, producerId: "producer-2" },
    });
    await expect(
      permanentlyDeleteEmptyDraftClient(foreign, {
        producerId: "producer-1",
        clientId: "client-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("serializes deletion with concurrent history creation so one side fails", async () => {
    const repo = repository({ client: emptyClient });
    const [deletion, history] = await Promise.allSettled([
      permanentlyDeleteEmptyDraftClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
      }),
      repo.createClientHistory(),
    ]);

    expect(deletion.status).toBe("fulfilled");
    expect(history).toEqual({ status: "fulfilled", value: "parent_missing" });
    expect(repo.clientDeleted).toBe(true);
  });

  it("preserves client history when the concurrent creator wins the lock", async () => {
    const repo = repository({ client: emptyClient });
    await expect(repo.createClientHistory()).resolves.toBe("created");
    await expect(
      permanentlyDeleteEmptyDraftClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
      }),
    ).rejects.toMatchObject({ code: "HISTORY_EXISTS" });
    expect(repo.clientDeleted).toBe(false);
  });
});

describe("historical project deletion", () => {
  it("deletes an empty waiting-for-payment draft", async () => {
    const repo = repository({ project: emptyProject });
    await expect(
      permanentlyDeleteEmptyDraftProject(repo, {
        producerId: "producer-1",
        projectId: "project-1",
      }),
    ).resolves.toEqual({ deleted: true });
  });

  it.each(["active", "paused", "completed", "canceled"] as const)(
    "blocks a history-bearing %s lifecycle even when dependents are absent",
    async (lifecycleStatus) => {
      const repo = repository({ project: { ...emptyProject, lifecycleStatus } });
      await expect(
        permanentlyDeleteEmptyDraftProject(repo, {
          producerId: "producer-1",
          projectId: "project-1",
        }),
      ).rejects.toMatchObject({ code: "NOT_EMPTY_DRAFT" });
    },
  );

  it("serializes deletion with concurrent history creation so one side fails", async () => {
    const repo = repository({ project: emptyProject });
    const [deletion, history] = await Promise.allSettled([
      permanentlyDeleteEmptyDraftProject(repo, {
        producerId: "producer-1",
        projectId: "project-1",
      }),
      repo.createProjectHistory(),
    ]);

    expect(deletion.status).toBe("fulfilled");
    expect(history).toEqual({ status: "fulfilled", value: "parent_missing" });
    expect(repo.projectDeleted).toBe(true);
  });

  it("preserves history when the concurrent creator wins the lock", async () => {
    const repo = repository({ project: emptyProject });
    await expect(repo.createProjectHistory()).resolves.toBe("created");
    await expect(
      permanentlyDeleteEmptyDraftProject(repo, {
        producerId: "producer-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({ code: "HISTORY_EXISTS" });
    expect(repo.projectDeleted).toBe(false);
  });
});
