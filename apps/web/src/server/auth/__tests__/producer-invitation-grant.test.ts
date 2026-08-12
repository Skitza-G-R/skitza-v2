import { producerInvitationGrants, producers } from "@skitza/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emailHashFor } from "~/server/artist/identity";
import { invitationPlaceholderSlug } from "~/lib/slug";

import {
  claimProducerInvitationGrant,
  type ProducerInvitationGrantInput,
} from "../producer-invitation-grant";

const dbMocks = vi.hoisted(() => ({
  createDb: vi.fn(),
}));

vi.mock("@skitza/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skitza/db")>();
  return { ...actual, createDb: dbMocks.createDb };
});

type StoredReceipt = Readonly<{
  clerkInvitationId: string;
  clerkUserId: string;
  clerkInstanceId: string;
  invitedEmailHash: string;
  invitationCreatedAt: Date;
  providerUpdatedAt: Date;
  grantedAt: Date;
}>;

type FakeDatabaseOptions = Readonly<{
  initialProducer?: Readonly<{ clerkUserId: string }> | null;
  initialReceipt?: StoredReceipt | null;
  producerInsertConflict?: boolean;
  receiptInsertConflict?: boolean;
}>;

type StoredProducer = Readonly<{
  clerkUserId: string;
  email?: string;
  slug?: string;
}>;

const input: ProducerInvitationGrantInput = {
  invitationId: "inv_producer",
  clerkUserId: "user_artist",
  clerkInstanceId: "ins_skitza",
  emailAddress: "artist@example.test",
  emailHash: emailHashFor("artist@example.test"),
  createdAt: Date.parse("2026-08-12T00:00:00.000Z"),
  updatedAt: Date.parse("2026-08-12T00:01:00.000Z"),
};

function receiptFor(
  overrides: Partial<StoredReceipt> = {},
): StoredReceipt {
  return {
    clerkInvitationId: input.invitationId,
    clerkUserId: input.clerkUserId,
    clerkInstanceId: input.clerkInstanceId,
    invitedEmailHash: input.emailHash,
    invitationCreatedAt: new Date(input.createdAt),
    providerUpdatedAt: new Date(input.updatedAt),
    grantedAt: new Date("2026-08-12T00:02:00.000Z"),
    ...overrides,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("expected insert values");
  }
  return value as Record<string, unknown>;
}

function installFakeDatabase(options: FakeDatabaseOptions = {}) {
  const state: {
    producer: StoredProducer | null;
    receipt: StoredReceipt | null;
  } = {
    producer: options.initialProducer ?? null,
    receipt: options.initialReceipt ?? null,
  };
  const events: string[] = [];

  type TransactionWork = (transaction: unknown) => Promise<unknown>;
  const transaction = vi.fn(async (work: TransactionWork) => {
    events.push("transaction:start");
    const working = { ...state };

    const transactionDb = {
      execute() {
        events.push("lock");
        return Promise.resolve(undefined);
      },
      select() {
        let selectedTable: unknown;
        const chain = {
          from(table: unknown) {
            selectedTable = table;
            return chain;
          },
          where() {
            return chain;
          },
          limit() {
            if (selectedTable === producers) {
              events.push("select:producer");
              return Promise.resolve(working.producer ? [working.producer] : []);
            }
            if (selectedTable === producerInvitationGrants) {
              events.push("select:receipt");
              return Promise.resolve(working.receipt ? [working.receipt] : []);
            }
            throw new Error("unexpected select table");
          },
        };
        return chain;
      },
      insert(table: unknown) {
        let insertedValues: Record<string, unknown> | null = null;
        const chain = {
          values(value: unknown) {
            insertedValues = record(value);
            return chain;
          },
          onConflictDoNothing() {
            return chain;
          },
          returning() {
            if (!insertedValues) throw new Error("missing insert values");

            if (table === producerInvitationGrants) {
              events.push("insert:receipt");
              if (options.receiptInsertConflict || working.receipt) {
                return Promise.resolve([]);
              }
              working.receipt = {
                clerkInvitationId: String(insertedValues.clerkInvitationId),
                clerkUserId: String(insertedValues.clerkUserId),
                clerkInstanceId: String(insertedValues.clerkInstanceId),
                invitedEmailHash: String(insertedValues.invitedEmailHash),
                invitationCreatedAt: insertedValues.invitationCreatedAt as Date,
                providerUpdatedAt: insertedValues.providerUpdatedAt as Date,
                grantedAt: new Date("2026-08-12T00:02:00.000Z"),
              };
              return Promise.resolve([
                { clerkInvitationId: working.receipt.clerkInvitationId },
              ]);
            }

            if (table === producers) {
              events.push("insert:producer");
              if (options.producerInsertConflict || working.producer) {
                return Promise.resolve([]);
              }
              working.producer = {
                clerkUserId: String(insertedValues.clerkUserId),
                email: String(insertedValues.email),
                slug: String(insertedValues.slug),
              };
              return Promise.resolve([{ clerkUserId: working.producer.clerkUserId }]);
            }

            throw new Error("unexpected insert table");
          },
        };
        return chain;
      },
    };

    try {
      const result = await work(transactionDb);
      state.producer = working.producer;
      state.receipt = working.receipt;
      events.push("transaction:commit");
      return result;
    } catch (error) {
      events.push("transaction:rollback");
      throw error;
    }
  });

  dbMocks.createDb.mockReturnValue({ transaction });
  return { events, state, transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimProducerInvitationGrant", () => {
  it("atomically creates one receipt and Producer, then becomes idempotent", async () => {
    const fake = installFakeDatabase();

    await expect(claimProducerInvitationGrant("postgres://test", input)).resolves.toEqual({
      status: "created",
    });
    await expect(claimProducerInvitationGrant("postgres://test", input)).resolves.toEqual({
      status: "already_granted",
    });

    expect(fake.state.receipt).toEqual(receiptFor());
    expect(fake.state.producer).toEqual({
      clerkUserId: input.clerkUserId,
      email: input.emailAddress,
      slug: invitationPlaceholderSlug(input.emailAddress, input.invitationId),
    });
    expect(fake.events.filter((event) => event === "insert:receipt")).toHaveLength(1);
    expect(fake.events.filter((event) => event === "insert:producer")).toHaveLength(1);
    expect(fake.transaction).toHaveBeenCalledTimes(2);
  });

  it("denies an existing matching receipt when its Producer role is gone", async () => {
    const fake = installFakeDatabase({ initialReceipt: receiptFor() });

    await expect(claimProducerInvitationGrant("postgres://test", input)).resolves.toEqual({
      status: "conflict",
    });
    expect(fake.state.producer).toBeNull();
    expect(fake.events).not.toContain("insert:producer");
    expect(fake.events).not.toContain("insert:receipt");
  });

  it("rejects a receipt from a different Clerk instance", async () => {
    const fake = installFakeDatabase({
      initialProducer: { clerkUserId: input.clerkUserId },
      initialReceipt: receiptFor({ clerkInstanceId: "ins_other" }),
    });

    await expect(claimProducerInvitationGrant("postgres://test", input)).resolves.toEqual({
      status: "conflict",
    });
    expect(fake.events).not.toContain("insert:producer");
    expect(fake.events).not.toContain("insert:receipt");
  });

  it("does not attach a new grant receipt to an existing legacy Producer", async () => {
    const fake = installFakeDatabase({
      initialProducer: { clerkUserId: input.clerkUserId },
    });

    await expect(claimProducerInvitationGrant("postgres://test", input)).resolves.toEqual({
      status: "conflict",
    });
    expect(fake.state.receipt).toBeNull();
    expect(fake.events).not.toContain("insert:receipt");
  });

  it("returns conflict when another transaction already claimed the receipt", async () => {
    const fake = installFakeDatabase({ receiptInsertConflict: true });

    await expect(claimProducerInvitationGrant("postgres://test", input)).resolves.toEqual({
      status: "conflict",
    });
    expect(fake.state.receipt).toBeNull();
    expect(fake.state.producer).toBeNull();
    expect(fake.events).not.toContain("insert:producer");
  });

  it("rolls the receipt back when Producer creation loses a conflict", async () => {
    const fake = installFakeDatabase({ producerInsertConflict: true });

    await expect(claimProducerInvitationGrant("postgres://test", input)).rejects.toThrow(
      "PRODUCER_INVITATION_GRANT_CONFLICT",
    );
    expect(fake.events).toEqual([
      "transaction:start",
      "lock",
      "select:producer",
      "select:receipt",
      "insert:receipt",
      "insert:producer",
      "transaction:rollback",
    ]);
    expect(fake.state.receipt).toBeNull();
    expect(fake.state.producer).toBeNull();
  });
});
