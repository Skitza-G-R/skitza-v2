import { describe, expect, it } from "vitest";

import {
  archiveClient,
  editClient,
  inviteClient,
  restoreClient,
  type ClientManagementRecord,
  type ClientManagementRepository,
  type ClientManagementWriteResult,
} from "../service";
import { emailHashFor } from "~/server/artist/identity";

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

type ProjectStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

const baseClient = (patch: Partial<ClientManagementRecord> = {}): ClientManagementRecord => ({
  id: "client-1",
  producerId: "producer-1",
  name: "Maya",
  email: "maya@example.test",
  emailHash: emailHashFor("maya@example.test"),
  phone: null,
  notes: null,
  tags: [],
  clerkUserId: "artist-user-1",
  invitedAt: new Date("2026-07-01T10:00:00.000Z"),
  artistArchivedAt: null,
  producerArchivedAt: null,
  ...patch,
});

function repository(input?: {
  clients?: readonly ClientManagementRecord[];
  projectStatuses?: Readonly<Record<string, readonly ProjectStatus[]>>;
  forceDuplicateOnWrite?: boolean;
}): ClientManagementRepository & {
  clients: Map<string, ClientManagementRecord>;
  editPatches: Array<Record<string, unknown>>;
  archivePatches: Array<{ producerArchivedAt: Date | null }>;
  invitePatches: Array<{ invitedAt: Date }>;
} {
  const mutex = new Mutex();
  const clients = new Map(
    (input?.clients ?? [baseClient()]).map((client) => [client.id, client] as const),
  );
  const editPatches: Array<Record<string, unknown>> = [];
  const archivePatches: Array<{ producerArchivedAt: Date | null }> = [];
  const invitePatches: Array<{ invitedAt: Date }> = [];

  return {
    clients,
    editPatches,
    archivePatches,
    invitePatches,
    atomically: (_scope, work) =>
      mutex.run(() =>
        work({
          lockClient: ({ producerId, clientId }) => {
            const client = clients.get(clientId);
            return Promise.resolve(client?.producerId === producerId ? client : null);
          },
          findClientByEmailHash: ({ producerId, emailHash }) =>
            Promise.resolve(
              [...clients.values()].find(
                (client) =>
                  client.producerId === producerId && client.emailHash === emailHash,
              ) ?? null,
            ),
          clientHasBlockingProject: ({ clientId }) =>
            Promise.resolve(
              (input?.projectStatuses?.[clientId] ?? []).some(
                (status) => status === "active" || status === "waiting_for_payment",
              ),
            ),
          updateClient: ({ producerId, clientId, patch }) => {
            if (input?.forceDuplicateOnWrite) {
              return Promise.resolve({ kind: "duplicate_email" } as const);
            }
            const client = clients.get(clientId);
            if (!client || client.producerId !== producerId) {
              return Promise.resolve({ kind: "not_found" } as const);
            }
            if (patch.emailHash !== undefined) {
              const duplicate = [...clients.values()].find(
                (candidate) =>
                  candidate.id !== clientId &&
                  candidate.producerId === producerId &&
                  candidate.emailHash === patch.emailHash,
              );
              if (duplicate) {
                return Promise.resolve({ kind: "duplicate_email" } as const);
              }
            }
            editPatches.push(patch);
            const updated = { ...client, ...patch };
            clients.set(clientId, updated);
            return Promise.resolve({ kind: "updated", client: updated } as const);
          },
          setProducerArchivedAt: ({ producerId, clientId, producerArchivedAt }) => {
            const client = clients.get(clientId);
            if (!client || client.producerId !== producerId) {
              return Promise.resolve(null);
            }
            archivePatches.push({ producerArchivedAt });
            const updated = { ...client, producerArchivedAt };
            clients.set(clientId, updated);
            return Promise.resolve(updated);
          },
          setInvitedAt: ({ producerId, clientId, invitedAt }) => {
            const client = clients.get(clientId);
            if (!client || client.producerId !== producerId) {
              return Promise.resolve(null);
            }
            invitePatches.push({ invitedAt });
            const updated = { ...client, invitedAt };
            clients.set(clientId, updated);
            return Promise.resolve(updated);
          },
        }),
      ),
  };
}

describe("client invite", () => {
  it("commits invite intent before delivery and does not hold the lock during network I/O", async () => {
    const repo = repository();
    let releaseDelivery!: () => void;
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    let deliveryStarted!: () => void;
    const deliveryHasStarted = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    const events: string[] = [];

    const invite = inviteClient(repo, {
      producerId: "producer-1",
      clientId: "client-1",
      via: "email",
      invitedAt: new Date("2026-07-18T14:00:00.000Z"),
      deliverEmail: async (client) => {
        events.push(`send:${client.email}`);
        deliveryStarted();
        await deliveryReleased;
      },
    });
    await deliveryHasStarted;
    expect(repo.invitePatches).toEqual([
      { invitedAt: new Date("2026-07-18T14:00:00.000Z") },
    ]);

    await archiveClient(repo, {
      producerId: "producer-1",
      clientId: "client-1",
      archivedAt: new Date("2026-07-18T14:01:00.000Z"),
    }).then(() => events.push("archive"));
    expect(events).toEqual(["send:maya@example.test", "archive"]);
    expect(repo.archivePatches).toHaveLength(1);

    releaseDelivery();
    await invite;
    expect(events).toEqual(["send:maya@example.test", "archive"]);
  });

  it("keeps failed delivery non-deletable and never delivers for link invites", async () => {
    const emailRepo = repository();
    await expect(
      inviteClient(emailRepo, {
        producerId: "producer-1",
        clientId: "client-1",
        via: "email",
        invitedAt: new Date("2026-07-18T14:00:00.000Z"),
        deliverEmail: () => Promise.reject(new Error("delivery failed")),
      }),
    ).rejects.toThrow("delivery failed");
    expect(emailRepo.invitePatches).toEqual([
      { invitedAt: new Date("2026-07-18T14:00:00.000Z") },
    ]);

    const linkRepo = repository();
    const deliverEmail = () => Promise.reject(new Error("must not send"));
    await expect(
      inviteClient(linkRepo, {
        producerId: "producer-1",
        clientId: "client-1",
        via: "link",
        invitedAt: new Date("2026-07-18T14:00:00.000Z"),
        deliverEmail,
      }),
    ).resolves.toMatchObject({ via: "link" });
    expect(linkRepo.invitePatches).toHaveLength(1);
  });
});

describe("client edit", () => {
  it("edits every approved field and normalizes contact data", async () => {
    const repo = repository();

    const result = await editClient(repo, {
      producerId: "producer-1",
      clientId: "client-1",
      name: "  Maya Stone  ",
      email: "  MAYA.STONE@Example.Test ",
      phone: "  +972 50 123 4567  ",
      notes: "  Prefers evening sessions  ",
      tags: [" VIP ", "vip", " Warm vocals "],
    });

    expect(result.changed).toBe(true);
    expect(result.client).toMatchObject({
      name: "Maya Stone",
      email: "maya.stone@example.test",
      phone: "+972 50 123 4567",
      notes: "Prefers evening sessions",
      tags: ["VIP", "Warm vocals"],
      clerkUserId: "artist-user-1",
      artistArchivedAt: null,
    });
    expect(result.client.emailHash).not.toBe(emailHashFor("maya@example.test"));
    expect(repo.editPatches).toHaveLength(1);
    expect(repo.editPatches[0]).not.toHaveProperty("producerId");
    expect(repo.editPatches[0]).not.toHaveProperty("clerkUserId");
    expect(repo.editPatches[0]).not.toHaveProperty("producerArchivedAt");
  });

  it("clears optional values and returns unchanged for an empty patch", async () => {
    const repo = repository({
      clients: [
        baseClient({ phone: "+1 555", notes: "Old", tags: ["VIP"] }),
      ],
    });

    await expect(
      editClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
        phone: "   ",
        notes: null,
        tags: [],
      }),
    ).resolves.toMatchObject({
      changed: true,
      client: { phone: null, notes: null, tags: [] },
    });

    await expect(
      editClient(repo, { producerId: "producer-1", clientId: "client-1" }),
    ).resolves.toMatchObject({ changed: false });
  });

  it("blocks a duplicate email for the same producer but allows it across producers", async () => {
    const sameProducer = baseClient({
      id: "client-2",
      email: "taken@example.test",
      emailHash: emailHashFor("taken@example.test"),
    });
    const repo = repository({ clients: [baseClient(), sameProducer] });

    await expect(
      editClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
        email: "TAKEN@example.test",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_EMAIL" });

    const crossProducer = repository({
      clients: [
        baseClient(),
        baseClient({
          id: "foreign-client",
          producerId: "producer-2",
          email: "shared@example.test",
          emailHash: emailHashFor("shared@example.test"),
        }),
      ],
    });
    await expect(
      editClient(crossProducer, {
        producerId: "producer-1",
        clientId: "client-1",
        email: "shared@example.test",
      }),
    ).resolves.toMatchObject({ changed: true });
  });

  it("maps a database unique-constraint race to the same duplicate error", async () => {
    const repo = repository({ forceDuplicateOnWrite: true });

    await expect(
      editClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
        email: "race@example.test",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_EMAIL" });
  });

  it("serializes two clients racing for the same email so exactly one wins", async () => {
    const repo = repository({
      clients: [
        baseClient(),
        baseClient({
          id: "client-2",
          email: "other@example.test",
          emailHash: emailHashFor("other@example.test"),
        }),
      ],
    });

    const results = await Promise.allSettled([
      editClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
        email: "winner@example.test",
      }),
      editClient(repo, {
        producerId: "producer-1",
        clientId: "client-2",
        email: "winner@example.test",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "DUPLICATE_EMAIL" },
    });
  });

  it("hides missing and cross-producer ids behind the same NOT_FOUND error", async () => {
    const repo = repository();
    for (const clientId of ["missing", "client-1"]) {
      await expect(
        editClient(repo, {
          producerId: clientId === "client-1" ? "producer-2" : "producer-1",
          clientId,
          name: "Hidden",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(repo.editPatches).toHaveLength(0);
  });
});

describe("client archive and restore", () => {
  it.each(["active", "waiting_for_payment"] as const)(
    "blocks archive when a client has a %s project",
    async (status) => {
      const repo = repository({ projectStatuses: { "client-1": [status] } });
      await expect(
        archiveClient(repo, {
          producerId: "producer-1",
          clientId: "client-1",
          archivedAt: new Date("2026-07-18T12:00:00.000Z"),
        }),
      ).rejects.toMatchObject({ code: "BLOCKING_PROJECT" });
      expect(repo.archivePatches).toHaveLength(0);
    },
  );

  it.each(["paused", "completed", "canceled"] as const)(
    "allows archive when the only project is %s",
    async (status) => {
      const repo = repository({ projectStatuses: { "client-1": [status] } });
      const archivedAt = new Date("2026-07-18T12:00:00.000Z");
      await expect(
        archiveClient(repo, {
          producerId: "producer-1",
          clientId: "client-1",
          archivedAt,
        }),
      ).resolves.toMatchObject({
        changed: true,
        client: {
          producerArchivedAt: archivedAt,
          clerkUserId: "artist-user-1",
          artistArchivedAt: null,
        },
      });
      expect(repo.archivePatches).toEqual([{ producerArchivedAt: archivedAt }]);
      expect(repo.editPatches).toHaveLength(0);
    },
  );

  it("archives a client with no projects and is idempotent", async () => {
    const repo = repository();
    const archivedAt = new Date("2026-07-18T12:00:00.000Z");

    await expect(
      archiveClient(repo, { producerId: "producer-1", clientId: "client-1", archivedAt }),
    ).resolves.toMatchObject({ changed: true });
    await expect(
      archiveClient(repo, {
        producerId: "producer-1",
        clientId: "client-1",
        archivedAt: new Date("2026-07-18T13:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ changed: false, client: { producerArchivedAt: archivedAt } });
    expect(repo.archivePatches).toHaveLength(1);
  });

  it("restores by clearing only producer archive state and is idempotent", async () => {
    const repo = repository({
      clients: [
        baseClient({
          artistArchivedAt: new Date("2026-07-05T10:00:00.000Z"),
          producerArchivedAt: new Date("2026-07-10T10:00:00.000Z"),
        }),
      ],
    });

    await expect(
      restoreClient(repo, { producerId: "producer-1", clientId: "client-1" }),
    ).resolves.toMatchObject({
      changed: true,
      client: {
        producerArchivedAt: null,
        artistArchivedAt: new Date("2026-07-05T10:00:00.000Z"),
        clerkUserId: "artist-user-1",
      },
    });
    await expect(
      restoreClient(repo, { producerId: "producer-1", clientId: "client-1" }),
    ).resolves.toMatchObject({ changed: false });
    expect(repo.archivePatches).toEqual([{ producerArchivedAt: null }]);
  });

  it("hides missing and cross-producer archive/restore targets", async () => {
    const repo = repository();
    await expect(
      archiveClient(repo, {
        producerId: "producer-2",
        clientId: "client-1",
        archivedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      restoreClient(repo, { producerId: "producer-1", clientId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repo.archivePatches).toHaveLength(0);
  });
});

// Keep the repository result union referenced directly in this test module so
// changes to its race outcome cannot silently widen to an unhandled shape.
const _writeResultExhaustiveness: ClientManagementWriteResult | null = null;
void _writeResultExhaustiveness;
