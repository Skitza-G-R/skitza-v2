import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  statementNowAfter,
  storedStamp,
  type TimestampValue,
} from "~/server/__tests__/default-now-timestamp-shape";

// SK-284 regression — the ✕ on a "Needs you" row wrote a timestamp the
// database refused, so no row could ever be hidden.
//
// `producer_attention_dismissals` (migration 0060) carries
//   CHECK ("dismissed_at" >= "created_at")
// while `created_at` is filled by the table's own DEFAULT now(). The mutation
// sent its own `new Date()` for `dismissed_at` and left `created_at` to that
// default — but a JS clock reading happens in this process *before* the
// statement travels to Neon, so it is always older than the `created_at`
// Postgres stamps around it. Every first dismissal came back as
//   new row for relation "producer_attention_dismissals" violates check
//   constraint "producer_attention_dismissals_timestamp_shape"
// which `attention-actions.ts` then toasted at the producer verbatim.
//
// `default-now-timestamp-shape` stands in for the database it was rejected by:
// a `DEFAULT now()` column is stamped when the statement runs, and that instant
// is later than any Date the app put in the payload. Both shape tests below
// fail against a mutation that stamps the row from its own clock.

const PRODUCER_ID = "producer-uuid-attention-1";
const SUBJECT_ID = "00000000-0000-0000-0000-0000000000c1";

const {
  producersMarker,
  dismissalsMarker,
  insertValuesSpy,
  conflictSpy,
  returningMock,
  dbMock,
} = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const insertValuesSpy = vi.fn<(payload: Row) => void>();
  const conflictSpy = vi.fn<(config: Row) => void>();
  const returningMock = vi.fn<() => Promise<Row[]>>();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
    closedAt: { __column: "producers.closed_at" },
  };
  const dismissalsMarker = {
    __table: "producer_attention_dismissals",
    producerId: { __column: "producer_attention_dismissals.producer_id" },
    itemKind: { __column: "producer_attention_dismissals.item_kind" },
    subjectId: { __column: "producer_attention_dismissals.subject_id" },
    dismissedAt: { __column: "producer_attention_dismissals.dismissed_at" },
    createdAt: { __column: "producer_attention_dismissals.created_at" },
    updatedAt: { __column: "producer_attention_dismissals.updated_at" },
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          // producer-procedure middleware
          return {
            where: () => ({
              limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
            }),
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    insert: (table: unknown) => {
      if (table !== dismissalsMarker) {
        throw new Error(`unexpected insert(${String(table)})`);
      }
      return {
        values: (payload: Row) => {
          insertValuesSpy(payload);
          return {
            onConflictDoUpdate: (config: Row) => {
              conflictSpy(config);
              return { returning: () => returningMock() };
            },
          };
        },
      };
    },
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    producersMarker,
    dismissalsMarker,
    insertValuesSpy,
    conflictSpy,
    returningMock,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_attention_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  producerAttentionDismissals: dismissalsMarker,
  // Sibling tables the router modules reference at module-load time.
  projects: { __table: "projects" },
  bookings: { __table: "bookings" },
  trackVersions: { __table: "track_versions" },
  projectTracks: { __table: "project_tracks" },
  trackComments: { __table: "track_comments" },
  versionApprovalEvents: { __table: "version_approval_events" },
  portfolioTracks: { __table: "portfolio_tracks" },
  purchases: { __table: "purchases" },
  products: { __table: "products" },
  invoices: { __table: "invoices" },
  clientContacts: { __table: "client_contacts" },
  notifications: { __table: "notifications" },
  stripeCustomers: { __table: "stripe_customers" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  not: (cond: unknown) => ({ not: cond }),
  ne: (col: unknown, val: unknown) => ({ ne: [col, val] }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  gt: (col: unknown, val: unknown) => ({ gt: [col, val] }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lt: (col: unknown, val: unknown) => ({ lt: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  notInArray: (col: unknown, vals: unknown[]) => ({ notInArray: [col, vals] }),
  isNull: (col: unknown) => ({ isNull: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  // A template tag rather than a constant: the fake database has to be able
  // to tell a server-side `now()` from a Date this process computed.
  sql: (strings: TemplateStringsArray) => {
    const marker = {
      __sql: strings.raw.join("?"),
      as: () => marker,
      mapWith: () => marker,
    };
    return marker;
  },
}));

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_attention_1" });
};

beforeEach(() => {
  insertValuesSpy.mockReset();
  conflictSpy.mockReset();
  returningMock.mockReset().mockResolvedValue([{ dismissedAt: new Date() }]);
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("producer.attention.dismiss — timestamp shape", () => {
  it("writes a row the dismissed_at >= created_at CHECK accepts", async () => {
    const caller = await buildCaller();
    await caller.producer.attention.dismiss({
      kind: "urgent_project",
      subjectId: SUBJECT_ID,
    });

    const payload = (insertValuesSpy.mock.calls[0]?.[0] ?? {}) as Record<string, TimestampValue>;
    const statementNow = statementNowAfter(payload);
    const dismissedAt = storedStamp(payload.dismissedAt, statementNow);
    const createdAt = storedStamp(payload.createdAt, statementNow);

    expect(dismissedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
  });

  it("keeps the CHECK satisfied for a second tap that lands while the first is in flight", async () => {
    const caller = await buildCaller();
    await caller.producer.attention.dismiss({
      kind: "comment",
      subjectId: SUBJECT_ID,
    });

    const payload = (insertValuesSpy.mock.calls[0]?.[0] ?? {}) as Record<string, TimestampValue>;
    const config = conflictSpy.mock.calls[0]?.[0] as
      | { set?: Record<string, TimestampValue> }
      | undefined;
    const set = config?.set ?? {};

    expect(set.dismissedAt, "a re-dismissal has to bump the stamp").toBeDefined();

    // The tap that loses the race takes the conflict path. The row it collides
    // with was created by the winner's statement, which ran after this tap had
    // already read its own clock.
    const createdAt = statementNowAfter(payload, set);
    const dismissedAt = storedStamp(set.dismissedAt, new Date(createdAt.getTime() + 5));

    expect(dismissedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
  });

  it("reports the stamp the database wrote rather than one the app made up", async () => {
    const stored = new Date("2026-08-29T19:43:00.000Z");
    returningMock.mockResolvedValueOnce([{ dismissedAt: stored }]);

    const caller = await buildCaller();
    const result = await caller.producer.attention.dismiss({
      kind: "urgent_project",
      subjectId: SUBJECT_ID,
    });

    expect(result.dismissedAt).toEqual(stored);
  });
});
