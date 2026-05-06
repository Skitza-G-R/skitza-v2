import { beforeEach, describe, expect, it, vi } from "vitest";

// Marketing meta editor — `producer.updateMarketing` mutation +
// `producer.me().marketing` payload.
//
// Behavior contract:
//   * Each field is independently optional. Omitted fields aren't
//     written.
//   * Explicit null clears a field on the column (vs. omitted = "leave
//     alone"). This is how the producer's "Hidden" response-time
//     selection drops the response stat from the public page.
//   * Empty string on releasedSummary / streamsSummary is treated as
//     null (cleared). Producers might submit "" instead of clicking a
//     clear button.
//   * responseHours is constrained to {24, 48, 168, null} at the input
//     layer — bad values (e.g. 12) reject before touching the DB.
//   * No-op patches (no fields changed) early-return without bumping
//     updatedAt.
//   * UPDATE is scoped to the caller's producerId (auth boundary).

const PRODUCER_ID = "producer-uuid-marketing";

type Row = Record<string, unknown>;

const producersMarker = { __table: "producers" };

const producerSelectQueue: Row[][] = [];
function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

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
  auth: () => Promise.resolve({ userId: "user_test_marketing" }),
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
  // Other tables imported at file-scope by producer.ts — marker objects
  // so module resolution succeeds; not exercised in these tests.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
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
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  sql: Object.assign(() => ({ raw: "<mock-sql>" }), { raw: "<mock-sql>" }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  updateSetSpy.mockReset();
  updateWhereSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_marketing" });
};

describe("producer.updateMarketing — write path", () => {
  it("writes only the fields the caller supplied (minimal patch)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    const res = await caller.producer.updateMarketing({
      genres: ["indie", "alt-pop"],
      // releasedSummary / streamsSummary / responseHours intentionally
      // omitted — the .set() payload must NOT contain those columns.
    });
    expect(res).toEqual({ ok: true });
    const payload = updateSetSpy.mock.calls.at(-1)?.[0];
    expect(payload).toBeDefined();
    expect(payload).toMatchObject({ genres: ["indie", "alt-pop"] });
    if (payload) {
      expect(payload).not.toHaveProperty("releasedSummary");
      expect(payload).not.toHaveProperty("streamsSummary");
      expect(payload).not.toHaveProperty("responseHours");
    }
  });

  it("accepts explicit null for clearing a field (vs. omitted)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.producer.updateMarketing({
      releasedSummary: null,
      responseHours: null,
    });
    const payload = updateSetSpy.mock.calls.at(-1)?.[0];
    expect(payload).toMatchObject({
      releasedSummary: null,
      responseHours: null,
    });
  });

  it("trims whitespace on summaries and treats empty string as null", async () => {
    // A producer might paste "   " or "" instead of clicking a clear
    // button. Either form should land as a real null in the column,
    // so the public strip's "hide when null" logic fires.
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.producer.updateMarketing({
      releasedSummary: "  3 LPs  ",
      streamsSummary: "   ",
    });
    const payload = updateSetSpy.mock.calls.at(-1)?.[0];
    expect(payload).toMatchObject({
      releasedSummary: "3 LPs",
      streamsSummary: null,
    });
  });

  it("rejects responseHours outside the {24, 48, 168, null} set", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      // @ts-expect-error — intentionally pass a bad value to test zod
      caller.producer.updateMarketing({ responseHours: 12 }),
    ).rejects.toBeDefined();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when no fields are supplied (no DB write, no updatedAt bump)", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    const res = await caller.producer.updateMarketing({});
    expect(res).toEqual({ ok: true });
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("scopes the UPDATE to the caller's producerId", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.producer.updateMarketing({ genres: ["techno"] });
    expect(updateWhereSpy).toHaveBeenCalledTimes(1);
    const predicate = updateWhereSpy.mock.calls[0]?.[0] as { eq: unknown[] };
    expect(predicate.eq[1]).toBe(PRODUCER_ID);
  });

  it("caps the genres array at 8 entries (zod max) and rejects longer arrays", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    const tooMany = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    await expect(
      caller.producer.updateMarketing({ genres: tooMany }),
    ).rejects.toBeDefined();
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});

describe("producer.me — marketing payload", () => {
  it("surfaces all 4 marketing fields, defaulting null genres to null", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    producerSelectQueue.push([
      {
        id: PRODUCER_ID,
        email: "marketing@example.com",
        displayName: "Studio",
        slug: "studio",
        defaultCurrency: "USD",
        timezone: "UTC",
        brand: {},
        stripeAccountId: null,
        stripeChargesEnabled: false,
        autopilotWelcomeEmail: false,
        autopilotUnpaidReminder: false,
        autopilotRequestTestimonial: false,
        autopilotCommentNotify: true,
        autopilotAutoArchive: false,
        genres: ["indie"],
        releasedSummary: "A few EPs",
        streamsSummary: null,
        responseHours: 24,
      },
    ]);
    const caller = await buildCaller();
    const me = await caller.producer.me();
    expect(me.marketing).toEqual({
      genres: ["indie"],
      releasedSummary: "A few EPs",
      streamsSummary: null,
      responseHours: 24,
    });
  });
});
