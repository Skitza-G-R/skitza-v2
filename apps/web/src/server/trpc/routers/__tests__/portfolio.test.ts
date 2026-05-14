import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "producer-uuid-1";
const TRACK_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_TRACK_ID = "00000000-0000-0000-0000-000000000002";

// Marker objects so the dbMock can branch on which table the caller hit.
const producersMarker = { __table: "producers" };
const portfolioTracksMarker = { __table: "portfolio_tracks" };

// Per-mock return shapes are explicit so eslint's no-unsafe-return
// doesn't trip on the chained mock builders below.
type Row = Record<string, unknown>;
const producerSelectFromMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const trackSelectByIdMock = vi.fn<() => Promise<Array<{ producerId: string }>>>();
const trackListMock = vi.fn<() => Promise<Row[]>>();
const trackInsertReturningMock = vi.fn<() => Promise<Row[]>>();
const trackUpdateReturningMock = vi.fn<() => Promise<Row[]>>();
const trackDeleteWhereMock = vi.fn<() => Promise<void>>();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return { where: () => ({ limit: () => producerSelectFromMock() }) };
      }
      // portfolioTracks: list uses .where().orderBy(), by-id lookup
      // uses .where().limit(1) — the chain exposes both terminals.
      return {
        where: () => ({
          limit: () => trackSelectByIdMock(),
          orderBy: () => trackListMock(),
        }),
      };
    },
  }),
  insert: () => ({
    values: () => ({ returning: () => trackInsertReturningMock() }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({ returning: () => trackUpdateReturningMock() }),
    }),
  }),
  delete: () => ({ where: () => trackDeleteWhereMock() }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  portfolioTracks: portfolioTracksMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
}));

beforeEach(() => {
  producerSelectFromMock.mockReset().mockResolvedValue([{ id: PRODUCER_ID }]);
  trackSelectByIdMock.mockReset().mockResolvedValue([]);
  trackListMock.mockReset().mockResolvedValue([]);
  trackInsertReturningMock
    .mockReset()
    .mockResolvedValue([{ id: TRACK_ID, title: "x" }]);
  trackUpdateReturningMock.mockReset().mockResolvedValue([{ id: TRACK_ID }]);
  trackDeleteWhereMock.mockReset().mockResolvedValue(undefined);
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

describe("portfolio.list", () => {
  it("returns tracks for the caller's producer", async () => {
    trackListMock.mockResolvedValueOnce([
      { id: TRACK_ID, producerId: PRODUCER_ID, title: "Track 1", position: 0 },
    ]);
    const caller = await buildCaller();
    const tracks = await caller.portfolio.list();
    expect(tracks).toHaveLength(1);
    expect((tracks[0] as { title: string }).title).toBe("Track 1");
  });

  it("throws UNAUTHORIZED when ctx.userId is null", async () => {
    const caller = await buildCaller(null);
    await expect(caller.portfolio.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws NOT_FOUND when producer row is missing", async () => {
    producerSelectFromMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(caller.portfolio.list()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("portfolio.create", () => {
  it("inserts and returns the new row", async () => {
    const caller = await buildCaller();
    const row = await caller.portfolio.create({
      title: "New track",
      audioUrl: "https://example.com/a.mp3",
    });
    expect(row.id).toBe(TRACK_ID);
    expect(trackInsertReturningMock).toHaveBeenCalledOnce();
  });

  it("rejects bad input via zod", async () => {
    const caller = await buildCaller();
    // Cast through unknown to bypass tRPC's compile-time input typing —
    // we're explicitly testing runtime zod rejection of an invalid url.
    const badInput = { title: "x", audioUrl: "not-a-url" } as unknown as Parameters<
      typeof caller.portfolio.create
    >[0];
    await expect(caller.portfolio.create(badInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(trackInsertReturningMock).not.toHaveBeenCalled();
  });

  // F9 — `Add from music library` flow: server-side dedup pairs with
  // the picker's "Already added" disabled rows so the public playlist
  // can't accumulate the same R2 object twice.
  it("rejects when an existing portfolio row already has the same audioUrl", async () => {
    // The dedup lookup hits the same select-from-portfolio_tracks chain
    // the dbMock routes to `trackSelectByIdMock` — return a hit so the
    // create mutation throws before insert. Field shape mirrors the
    // mock's declared return type; the create code only branches on
    // whether the array has a row (truthy = dup found).
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.portfolio.create({
        title: "Already-added track",
        audioUrl: "https://example.com/a.mp3",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(trackInsertReturningMock).not.toHaveBeenCalled();
  });

  it("skips the dedup check when audioUrl is null (pre-upload placeholder)", async () => {
    // Even with a primed dup-hit mock, a null audioUrl input must
    // bypass the dedup query entirely — the audio.completeMultipart
    // flow patches in the URL after creating the placeholder row.
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.portfolio.create({
      title: "Pending upload",
      audioUrl: null,
    });
    expect(trackInsertReturningMock).toHaveBeenCalledOnce();
  });
});

describe("portfolio.update", () => {
  it("updates when caller owns the track", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    await caller.portfolio.update({ id: TRACK_ID, title: "Renamed" });
    expect(trackUpdateReturningMock).toHaveBeenCalledOnce();
  });

  it("throws FORBIDDEN when track belongs to a different producer", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: "other-producer" }]);
    const caller = await buildCaller();
    await expect(
      caller.portfolio.update({ id: TRACK_ID, title: "Renamed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(trackUpdateReturningMock).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when track id is unknown", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(
      caller.portfolio.update({ id: TRACK_ID, title: "Renamed" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(trackUpdateReturningMock).not.toHaveBeenCalled();
  });
});

describe("portfolio.delete", () => {
  it("deletes when caller owns the track", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();
    const res = await caller.portfolio.delete({ id: TRACK_ID });
    expect(res).toEqual({ ok: true });
    expect(trackDeleteWhereMock).toHaveBeenCalledOnce();
  });

  it("throws FORBIDDEN on cross-tenant id", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: "other-producer" }]);
    const caller = await buildCaller();
    await expect(caller.portfolio.delete({ id: TRACK_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(trackDeleteWhereMock).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when track id is unknown", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(caller.portfolio.delete({ id: TRACK_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(trackDeleteWhereMock).not.toHaveBeenCalled();
  });
});

describe("portfolio.reorder", () => {
  it("issues one update per id, scoped to caller's producer", async () => {
    const caller = await buildCaller();
    await caller.portfolio.reorder({ orderedIds: [TRACK_ID, OTHER_TRACK_ID] });
    expect(trackUpdateReturningMock).toHaveBeenCalledTimes(2);
  });

  it("throws UNAUTHORIZED when ctx.userId is null", async () => {
    const caller = await buildCaller(null);
    await expect(
      caller.portfolio.reorder({ orderedIds: [TRACK_ID] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(trackUpdateReturningMock).not.toHaveBeenCalled();
  });
});

describe("portfolio.togglePublicSample", () => {
  // Per Story 01 acceptance: the mutation uses a single-statement
  // UPDATE ... WHERE id = ? AND producer_id = ? RETURNING, so a
  // non-existent track OR a track owned by another producer both
  // land as the same NOT_FOUND outcome (enumeration-proof).
  it("flips is_public_sample when caller owns the track", async () => {
    trackUpdateReturningMock.mockResolvedValueOnce([
      { id: TRACK_ID, isPublicSample: true },
    ]);
    const caller = await buildCaller();
    const res = await caller.portfolio.togglePublicSample({
      trackId: TRACK_ID,
      enabled: true,
    });
    expect(res).toEqual({ ok: true });
    expect(trackUpdateReturningMock).toHaveBeenCalledOnce();
  });

  it("returns the { ok: true } shape literally", async () => {
    trackUpdateReturningMock.mockResolvedValueOnce([
      { id: TRACK_ID, isPublicSample: false },
    ]);
    const caller = await buildCaller();
    const res = await caller.portfolio.togglePublicSample({
      trackId: TRACK_ID,
      enabled: false,
    });
    expect(res).toStrictEqual({ ok: true });
  });

  it("throws NOT_FOUND when the track belongs to a different producer", async () => {
    // An auth-scoped UPDATE returns zero rows when the producer-scoped
    // predicate fails — indistinguishable from a non-existent id, on
    // purpose. Tested via an empty `.returning()` shape.
    trackUpdateReturningMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(
      caller.portfolio.togglePublicSample({ trackId: TRACK_ID, enabled: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the track id is unknown", async () => {
    trackUpdateReturningMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(
      caller.portfolio.togglePublicSample({ trackId: TRACK_ID, enabled: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws UNAUTHORIZED when ctx.userId is null", async () => {
    const caller = await buildCaller(null);
    await expect(
      caller.portfolio.togglePublicSample({ trackId: TRACK_ID, enabled: true }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(trackUpdateReturningMock).not.toHaveBeenCalled();
  });
});
