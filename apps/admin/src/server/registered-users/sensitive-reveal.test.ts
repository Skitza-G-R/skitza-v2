import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Db } from "@skitza/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordSensitiveRevealCommand } from "~/server/data-foundation/service";

const foundation = vi.hoisted(() => ({
  purge: vi.fn<(tx: unknown, environment: "live" | "test") => Promise<number>>(),
  record:
    vi.fn<
      (
        tx: unknown,
        environment: "live" | "test",
        audit: RecordSensitiveRevealCommand,
      ) => Promise<Readonly<{ id: string; replayed: boolean }>>
    >(),
}));

vi.mock("~/server/data-foundation/repository", () => ({
  purgeAdminHistoryInTransaction: foundation.purge,
  recordSensitiveRevealInTransaction: foundation.record,
}));

import { createRegisteredUserSensitiveRevealService } from "./sensitive-reveal";

type AwaitableQuery<T> = {
  for: () => AwaitableQuery<T>;
  from: () => AwaitableQuery<T>;
  limit: () => AwaitableQuery<T>;
  then: Promise<T[]>["then"];
  where: () => AwaitableQuery<T>;
};

function query<T>(
  rows: T[],
  event: string,
  events: string[],
): AwaitableQuery<T> {
  const builder = {
    for: () => builder,
    from: () => builder,
    limit: () => builder,
    then: (
      resolve: (value: T[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      events.push(event);
      return Promise.resolve(rows).then(resolve, reject);
    },
    where: () => builder,
  } as AwaitableQuery<T>;
  return builder;
}

function database(input: Readonly<{
  account?: Readonly<{ clerkUserId: string; providerState: string }>;
  body?: string;
  events: string[];
  noteAuthorized?: boolean;
}>): Db {
  const selected = [
    query(input.account ? [input.account] : [], "account", input.events),
    query(
      input.noteAuthorized === false
        ? []
        : [{ id: "00000000-0000-4000-8000-000000000001" }],
      "ownership",
      input.events,
    ),
    query(
      [
        {
          body: input.body ?? "private note",
          createdAt: new Date("2026-07-30T00:00:00.000Z"),
        },
      ],
      "body",
      input.events,
    ),
  ];
  const transaction = {
    select: vi.fn(() => {
      const next = selected.shift();
      if (!next) throw new Error("UNEXPECTED_SELECT");
      return next;
    }),
  };
  const runTransaction = vi.fn(
    (
      callback: (value: typeof transaction) => Promise<unknown>,
    ): Promise<unknown> => callback(transaction),
  );
  return {
    transaction: runTransaction,
  } as unknown as Db;
}

const command = {
  actorClerkUserId: "user_founder",
  clerkUserId: "user_target",
  noteId: "00000000-0000-4000-8000-000000000001",
  operationKey: "reveal-note-1",
  reason: "support_investigation" as const,
};

describe("registered-user sensitive reveal composition", () => {
  beforeEach(() => {
    foundation.purge.mockReset();
    foundation.record.mockReset();
    foundation.purge.mockResolvedValue(0);
    foundation.record.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000099",
      replayed: false,
    });
  });

  it("checks ownership, purges, audits, and only then selects the body", async () => {
    const events: string[] = [];
    foundation.purge.mockImplementation(() => {
      events.push("purge");
      return Promise.resolve(0);
    });
    foundation.record.mockImplementation((_tx, _environment, audit) => {
      events.push("audit");
      expect(audit).toMatchObject({
        targetAccountClerkUserId: "user_target",
        targetId: command.noteId,
        targetType: "registered_account_support_note",
      });
      return Promise.resolve({
        id: "00000000-0000-4000-8000-000000000099",
        replayed: false,
      });
    });
    const service = createRegisteredUserSensitiveRevealService({
      database: database({
        account: {
          clerkUserId: "user_target",
          providerState: "active",
        },
        events,
      }),
      environment: "test",
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    });

    const result = await service.revealSupportNote(command);

    expect(events).toEqual(["account", "ownership", "purge", "audit", "body"]);
    expect(result.body).toBe("private note");
  });

  it.each([
    [undefined, true],
    [{ clerkUserId: "user_target", providerState: "deleted" }, true],
    [{ clerkUserId: "user_target", providerState: "active" }, false],
  ] as const)(
    "denies missing, deleted, or wrongly-owned notes before audit/content",
    async (account, noteAuthorized) => {
      const events: string[] = [];
      const service = createRegisteredUserSensitiveRevealService({
        database: database({
          ...(account ? { account } : {}),
          events,
          noteAuthorized,
        }),
        environment: "live",
      });

      await expect(service.revealSupportNote(command)).rejects.toThrow(
        "REGISTERED_USER_REVEAL_NOT_FOUND",
      );
      expect(events).not.toContain("body");
      expect(foundation.purge).not.toHaveBeenCalled();
      expect(foundation.record).not.toHaveBeenCalled();
    },
  );

  it.each(["purge", "audit"] as const)(
    "never selects content when %s fails",
    async (failure) => {
      const events: string[] = [];
      if (failure === "purge") {
        foundation.purge.mockRejectedValue(new Error("PURGE_FAILED"));
      } else {
        foundation.record.mockRejectedValue(new Error("AUDIT_FAILED"));
      }
      const service = createRegisteredUserSensitiveRevealService({
        database: database({
          account: {
            clerkUserId: "user_target",
            providerState: "active",
          },
          events,
        }),
        environment: "test",
      });

      await expect(service.revealSupportNote(command)).rejects.toThrow();
      expect(events).not.toContain("body");
    },
  );

  it("conflicts on same operation key for another note before its body", async () => {
    let claimedDigest: string | null = null;
    foundation.record.mockImplementation((_tx, _environment, audit) => {
      if (claimedDigest !== null && claimedDigest !== audit.operationDigest) {
        return Promise.reject(new Error("IDEMPOTENCY_CONFLICT"));
      }
      const replayed = claimedDigest !== null;
      claimedDigest ??= audit.operationDigest;
      return Promise.resolve({
        id: "00000000-0000-4000-8000-000000000099",
        replayed,
      });
    });
    const firstEvents: string[] = [];
    const first = createRegisteredUserSensitiveRevealService({
      database: database({
        account: {
          clerkUserId: "user_target",
          providerState: "active",
        },
        events: firstEvents,
      }),
      environment: "test",
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    });
    await first.revealSupportNote(command);

    const secondEvents: string[] = [];
    const second = createRegisteredUserSensitiveRevealService({
      database: database({
        account: {
          clerkUserId: "user_target",
          providerState: "active",
        },
        events: secondEvents,
      }),
      environment: "test",
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    });
    await expect(
      second.revealSupportNote({
        ...command,
        noteId: "00000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(secondEvents).not.toContain("body");
  });

  it("returns the same audited result for an exact replay", async () => {
    let calls = 0;
    foundation.record.mockImplementation(() => {
      calls += 1;
      return Promise.resolve({
        id: "00000000-0000-4000-8000-000000000099",
        replayed: calls > 1,
      });
    });
    const reveal = () => {
      const events: string[] = [];
      const service = createRegisteredUserSensitiveRevealService({
        database: database({
          account: {
            clerkUserId: "user_target",
            providerState: "active",
          },
          events,
        }),
        environment: "test",
      });
      return { events, result: service.revealSupportNote(command) };
    };

    const first = reveal();
    const second = reveal();
    await expect(first.result).resolves.toMatchObject({
      auditId: "00000000-0000-4000-8000-000000000099",
      replayed: false,
    });
    await expect(second.result).resolves.toMatchObject({
      auditId: "00000000-0000-4000-8000-000000000099",
      replayed: true,
    });
    expect(first.events.at(-1)).toBe("body");
    expect(second.events.at(-1)).toBe("body");
  });

  it("binds the ownership query to environment, account, and exact note", () => {
    const source = readFileSync(
      join(process.cwd(), "src/server/registered-users/sensitive-reveal.ts"),
      "utf8",
    );

    expect(source).toContain("eq(adminSupportNotes.environment, input.environment)");
    expect(source).toContain(
      'eq(adminSupportNotes.targetType, "registered_account")',
    );
    expect(source).toContain(
      "eq(adminSupportNotes.targetId, command.clerkUserId)",
    );
    expect(source).toContain("eq(adminSupportNotes.id, command.noteId)");
  });

  it("rejects a malformed 36-character note ID before opening a transaction", async () => {
    const db = database({
      account: { clerkUserId: "user_target", providerState: "active" },
      events: [],
    });
    const service = createRegisteredUserSensitiveRevealService({
      database: db,
      environment: "test",
    });

    await expect(
      service.revealSupportNote({
        ...command,
        noteId: "a".repeat(36),
      }),
    ).rejects.toThrow("REGISTERED_USER_REVEAL_NOT_FOUND");
    expect(foundation.purge).not.toHaveBeenCalled();
    expect(foundation.record).not.toHaveBeenCalled();
  });
});
