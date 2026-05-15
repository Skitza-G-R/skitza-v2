import { beforeEach, describe, expect, it, vi } from "vitest";

// Project.create — Phase 1 (G7) New Project modal inputs.
//
// The redesigned modal sends four new optional fields alongside the
// existing title/artistName/artistEmail:
//   - productId: uuid          (FK to the picked store product)
//   - deadlineAt: ISO 8601     (parsed → Date)
//   - engagementTotalCents: int (snapshot of total fee)
//   - depositCents: int        (snapshot of upfront deposit)
//
// The tests below mock the DB so we can assert exactly which keys flow
// into the .values(...) call. We also assert backward-compat: a caller
// passing only the legacy fields still succeeds, and none of the new
// columns appear in the insert payload (no spurious null writes).

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000c01";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000d01";

const producersMarker = { __table: "producers" };
const projectsMarker = { __table: "projects" };

// Captures the .values(...) payload for each insert so tests can
// assert exact key/value pairs. .returning() resolves to a single row
// shaped like the row produced by Drizzle's insert+returning.
type Row = Record<string, unknown>;
const insertValuesSpy = vi.fn<(payload: Row) => void>();

const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
      }),
    }),
  }),
  insert: () => ({
    values: (payload: Row) => {
      insertValuesSpy(payload);
      return {
        returning: () =>
          Promise.resolve([{ id: PROJECT_ID, ...payload }]),
      };
    },
  }),
  update: () => ({
    set: () => ({ where: () => Promise.resolve() }),
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  // Other tables the router references — opaque markers are fine.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
  projectTracks: { __table: "project_tracks" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  notifications: { __table: "notifications" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  sql: () => ({ sql: true }),
}));

vi.mock("~/server/contacts/record", () => ({
  recordContact: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/server/notifications/emit", () => ({
  emitCommentCreated: vi.fn(),
}));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));
vi.mock("~/server/stripe/client", () => ({
  getStripe: () => ({
    paymentIntents: { create: vi.fn() },
    subscriptionSchedules: { cancel: vi.fn() },
  }),
  getSiteUrl: () => "https://skitza.test",
}));

beforeEach(() => {
  insertValuesSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_1" });
};

describe("project.create — Phase 1 G7 modal fields", () => {
  it("backward-compat: legacy callers (no new fields) still succeed and do NOT write the new columns", async () => {
    const caller = await buildCaller();
    const res = await caller.project.create({
      title: "Album mixing",
      artistName: "Test Artist",
      artistEmail: "ARTIST@example.com",
    });
    expect(res.project.id).toBe(PROJECT_ID);
    expect(insertValuesSpy).toHaveBeenCalledTimes(1);
    const payload = insertValuesSpy.mock.calls[0]![0]!;
    expect(payload.title).toBe("Album mixing");
    expect(payload.artistName).toBe("Test Artist");
    expect(payload.artistEmail).toBe("artist@example.com");
    // None of the G7 columns appear when the caller didn't ask.
    expect(payload.productId).toBeUndefined();
    expect(payload.deadlineAt).toBeUndefined();
    expect(payload.engagementTotalCents).toBeUndefined();
    expect(payload.depositCents).toBeUndefined();
  });

  it("accepts productId and writes it into the insert payload", async () => {
    const caller = await buildCaller();
    await caller.project.create({
      title: "Mix the album",
      artistName: "Cool Band",
      artistEmail: "band@example.com",
      productId: PRODUCT_ID,
    });
    const payload = insertValuesSpy.mock.calls[0]![0]!;
    expect(payload.productId).toBe(PRODUCT_ID);
  });

  it("accepts deadlineAt (ISO string) and converts it to a Date for the insert", async () => {
    const caller = await buildCaller();
    await caller.project.create({
      title: "Mix the album",
      artistName: "Cool Band",
      artistEmail: "band@example.com",
      deadlineAt: "2026-06-15T00:00:00.000Z",
    });
    const payload = insertValuesSpy.mock.calls[0]![0]!;
    expect(payload.deadlineAt).toBeInstanceOf(Date);
    expect((payload.deadlineAt as Date).toISOString()).toBe(
      "2026-06-15T00:00:00.000Z",
    );
  });

  it("rejects invalid deadlineAt (non-ISO string)", async () => {
    const caller = await buildCaller();
    await expect(
      caller.project.create({
        title: "Mix the album",
        artistName: "Cool Band",
        artistEmail: "band@example.com",
        deadlineAt: "not-a-date",
      }),
    ).rejects.toBeDefined();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("accepts engagementTotalCents + depositCents and writes them through", async () => {
    const caller = await buildCaller();
    await caller.project.create({
      title: "Mix the album",
      artistName: "Cool Band",
      artistEmail: "band@example.com",
      engagementTotalCents: 200_000,
      depositCents: 50_000,
    });
    const payload = insertValuesSpy.mock.calls[0]![0]!;
    expect(payload.engagementTotalCents).toBe(200_000);
    expect(payload.depositCents).toBe(50_000);
  });

  it("rejects negative engagementTotalCents (min 0)", async () => {
    const caller = await buildCaller();
    await expect(
      caller.project.create({
        title: "Mix the album",
        artistName: "Cool Band",
        artistEmail: "band@example.com",
        engagementTotalCents: -100,
      }),
    ).rejects.toBeDefined();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects negative depositCents (min 0)", async () => {
    const caller = await buildCaller();
    await expect(
      caller.project.create({
        title: "Mix the album",
        artistName: "Cool Band",
        artistEmail: "band@example.com",
        depositCents: -1,
      }),
    ).rejects.toBeDefined();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("full payload: all 4 G7 fields land in the insert together", async () => {
    const caller = await buildCaller();
    await caller.project.create({
      title: "Mix the album",
      artistName: "Cool Band",
      artistEmail: "band@example.com",
      productId: PRODUCT_ID,
      deadlineAt: "2026-07-01T10:00:00.000Z",
      engagementTotalCents: 300_000,
      depositCents: 75_000,
    });
    const payload = insertValuesSpy.mock.calls[0]![0]!;
    expect(payload.productId).toBe(PRODUCT_ID);
    expect(payload.deadlineAt).toBeInstanceOf(Date);
    expect(payload.engagementTotalCents).toBe(300_000);
    expect(payload.depositCents).toBe(75_000);
  });
});
