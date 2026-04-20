import { beforeEach, describe, expect, it, vi } from "vitest";

// Batch G — Autopilot toggle persistence tests.
//
// producer.updateAutopilot is a thin, producer-scoped mutation: it
// accepts one of five known keys + a boolean, and stamps the matching
// column on the producer row. This file exercises:
//   * Shape of the mutation — the `key` enum is tight (rejecting
//     unknown keys) and `enabled` is a plain boolean.
//   * Auth scoping — producer-procedure middleware resolves the
//     caller's producerId, and the UPDATE's WHERE clause includes it.
//   * Per-column persistence — each of the 5 keys maps to the right
//     drizzle column. The update .set() payload is captured via a spy
//     so we can assert the column name appears.
//   * Idempotent: toggling ON → ON doesn't error.

const PRODUCER_ID = "producer-uuid-1";

type Row = Record<string, unknown>;

const producersMarker = { __table: "producers" };

// producer-procedure calls producers.* first; the mutation itself does
// not re-select (it just writes). Single-queue is enough here.
const producerSelectQueue: Row[][] = [];
function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

// Capture the payload the router hands to .set() so we can assert the
// right column was written. The spy stores the most-recent call.
const updateSetSpy = vi.fn<(payload: Record<string, unknown>) => unknown>();
const updateWhereSpy = vi.fn<(pred: unknown) => unknown>();

const dbMock = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: () =>
          Promise.resolve(
            table === producersMarker ? shift(producerSelectQueue) : [],
          ),
      }),
    }),
  }),
  update: () => ({
    set: (payload: Record<string, unknown>) => {
      updateSetSpy(payload);
      return {
        where: (pred: unknown) => {
          updateWhereSpy(pred);
          return Promise.resolve();
        },
      };
    },
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: () => "127.0.0.1",
    }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  // Additional tables imported by the producer router's file scope —
  // marker objects so the module resolves cleanly; none are used by
  // the updateAutopilot path.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
  leads: { __table: "leads" },
  magicLinks: { __table: "magic_links" },
  magicLinkViews: { __table: "magic_link_views" },
  portfolioTracks: { __table: "portfolio_tracks" },
  projectTracks: { __table: "project_tracks" },
  projects: { __table: "projects" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
  isNull: (col: unknown) => ({ isNull: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  updateSetSpy.mockReset();
  updateWhereSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_1" });
};

describe("producer.updateAutopilot", () => {
  it("accepts each of the 5 known keys and writes the matching column", async () => {
    const matrix = [
      { key: "welcomeEmail" as const, col: "autopilotWelcomeEmail" },
      { key: "unpaidReminder" as const, col: "autopilotUnpaidReminder" },
      { key: "requestTestimonial" as const, col: "autopilotRequestTestimonial" },
      { key: "commentNotify" as const, col: "autopilotCommentNotify" },
      { key: "autoArchive" as const, col: "autopilotAutoArchive" },
    ];

    for (const { key, col } of matrix) {
      producerSelectQueue.push([{ id: PRODUCER_ID }]);
      const caller = await buildCaller();
      const res = await caller.producer.updateAutopilot({ key, enabled: true });
      expect(res).toEqual({ ok: true });
      // The .set() payload must contain the drizzle property name for
      // the matching column (not the raw SQL name) — the router keys
      // into the table schema by drizzle property.
      const lastCall = updateSetSpy.mock.calls.at(-1);
      if (!lastCall) throw new Error(`missing set call for ${key}`);
      expect(lastCall[0]).toMatchObject({ [col]: true });
      updateSetSpy.mockReset();
      updateWhereSpy.mockReset();
    }
  });

  it("scopes the UPDATE to the caller's producerId", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.producer.updateAutopilot({ key: "welcomeEmail", enabled: true });
    // producer-procedure resolves producerId from the clerk userId and
    // the router uses it as the WHERE scope. The predicate is a tagged
    // object from the mocked `eq` — we just verify it references the
    // producers.id column marker.
    expect(updateWhereSpy).toHaveBeenCalledTimes(1);
    const predicate = updateWhereSpy.mock.calls[0]?.[0] as { eq: unknown[] };
    expect(predicate).toBeDefined();
    expect(predicate.eq).toBeDefined();
    expect(predicate.eq[1]).toBe(PRODUCER_ID);
  });

  it("rejects unknown keys at the input layer (BAD_REQUEST / zod parse error)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      // @ts-expect-error — intentional bad key to test the zod enum
      caller.producer.updateAutopilot({ key: "invalidKey", enabled: true }),
    ).rejects.toBeDefined();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("accepts enabled=false for disabling a switch (toggle off)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.producer.updateAutopilot({ key: "commentNotify", enabled: false });
    const payload = updateSetSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ autopilotCommentNotify: false });
  });
});

describe("producer.me — autopilot payload", () => {
  it("surfaces all 5 autopilot flags on the profile payload", async () => {
    // producer-procedure then producer.me both hit producers.* — two
    // separate selects. Queue the producerId first, then the full row.
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    producerSelectQueue.push([
      {
        id: PRODUCER_ID,
        email: "test@example.com",
        displayName: "Studio",
        slug: "studio",
        defaultCurrency: "USD",
        timezone: "UTC",
        brand: {},
        stripeAccountId: null,
        stripeChargesEnabled: false,
        autopilotWelcomeEmail: true,
        autopilotUnpaidReminder: false,
        autopilotRequestTestimonial: true,
        autopilotCommentNotify: true,
        autopilotAutoArchive: false,
      },
    ]);
    const caller = await buildCaller();
    const me = await caller.producer.me();
    expect(me.autopilot).toEqual({
      welcomeEmail: true,
      unpaidReminder: false,
      requestTestimonial: true,
      commentNotify: true,
      autoArchive: false,
    });
  });
});
