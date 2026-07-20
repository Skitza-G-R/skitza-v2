import { beforeEach, describe, expect, it, vi } from "vitest";
import { SongManagementDomainError } from "~/server/domain/song-management/service";

const PRODUCER_ID = "producer-uuid-1";
const TRACK_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_TRACK_ID = "00000000-0000-0000-0000-000000000002";

// Marker objects so the dbMock can branch on which table the caller hit.
const producersMarker = { __table: "producers" };
const portfolioTracksMarker = { __table: "portfolio_tracks" };
const trackVersionsMarker = { __table: "track_versions" };

const songManagementMocks = vi.hoisted(() => ({
  createPortfolioTrackFromSongVersion: vi.fn(),
}));

// Per-mock return shapes are explicit so eslint's no-unsafe-return
// doesn't trip on the chained mock builders below.
type Row = Record<string, unknown>;
const producerSelectFromMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const trackSelectByIdMock = vi.fn<() => Promise<Array<{ producerId: string }>>>();
const storedAudioSelectMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const storedAudioWhereSpy = vi.fn<(condition: unknown) => void>();
const trackListMock = vi.fn<() => Promise<Row[]>>();
const trackInsertReturningMock = vi.fn<() => Promise<Row[]>>();
const trackInsertValuesSpy = vi.fn<(rec: unknown) => void>();
const trackUpdateReturningMock = vi.fn<() => Promise<Row[]>>();
const trackDeleteWhereMock = vi.fn<() => Promise<void>>();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return { where: () => ({ limit: () => producerSelectFromMock() }) };
      }
      if (table === trackVersionsMarker) {
        return {
          where: (condition: unknown) => {
            storedAudioWhereSpy(condition);
            return { limit: () => storedAudioSelectMock() };
          },
        };
      }
      // portfolioTracks chain shapes:
      //   - list:        .from().leftJoin().where().orderBy()  (peaks JOIN)
      //   - by-id lookup .from().where().limit(1)
      //   - update:      .from().where().returning() (handled separately)
      return {
        leftJoin: () => ({
          where: () => ({ orderBy: () => trackListMock() }),
        }),
        where: () => ({
          limit: () => trackSelectByIdMock(),
          orderBy: () => trackListMock(),
        }),
      };
    },
  }),
  insert: () => ({
    values: (rec: unknown) => {
      trackInsertValuesSpy(rec);
      return { returning: () => trackInsertReturningMock() };
    },
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
  trackVersions: trackVersionsMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
}));

vi.mock("~/server/domain/song-management/db", () => ({
  createPortfolioTrackFromSongVersion:
    songManagementMocks.createPortfolioTrackFromSongVersion,
  renameSongVersion: vi.fn(),
  setProducerFinalVersion: vi.fn(),
  setSongArchiveState: vi.fn(),
  setSongWorkflowStage: vi.fn(),
  tombstoneStoredAudioVersion: vi.fn(),
  updateSongMetadata: vi.fn(),
}));

beforeEach(() => {
  producerSelectFromMock.mockReset().mockResolvedValue([{ id: PRODUCER_ID }]);
  trackSelectByIdMock.mockReset().mockResolvedValue([]);
  storedAudioSelectMock.mockReset().mockResolvedValue([]);
  storedAudioWhereSpy.mockReset();
  trackListMock.mockReset().mockResolvedValue([]);
  trackInsertReturningMock
    .mockReset()
    .mockResolvedValue([{ id: TRACK_ID, title: "x" }]);
  trackInsertValuesSpy.mockReset();
  trackUpdateReturningMock.mockReset().mockResolvedValue([{ id: TRACK_ID }]);
  trackDeleteWhereMock.mockReset().mockResolvedValue(undefined);
  songManagementMocks.createPortfolioTrackFromSongVersion
    .mockReset()
    .mockResolvedValue({ id: TRACK_ID, title: "From version" });
  process.env.DATABASE_URL = "postgresql://test/test";
  process.env.R2_PUBLIC_BASE = "https://audio.example.test";
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

  it("uses the source version's private path for producer playback and picker dedup", async () => {
    trackListMock.mockResolvedValueOnce([
      {
        id: TRACK_ID,
        producerId: PRODUCER_ID,
        title: "Track 1",
        position: 0,
        audioUrl: `/api/audio/public/portfolio/${TRACK_ID}`,
        sourceAudioUrl: `/api/audio/stream/${OTHER_TRACK_ID}`,
      },
    ]);
    const caller = await buildCaller();

    const [track] = await caller.portfolio.list();

    expect(track?.audioUrl).toBe(`/api/audio/stream/${OTHER_TRACK_ID}`);
    expect(track).not.toHaveProperty("sourceAudioUrl");
  });

  it("masks a legacy permanent R2 URL when no live source version joins", async () => {
    trackListMock.mockResolvedValueOnce([
      {
        id: TRACK_ID,
        producerId: PRODUCER_ID,
        title: "Legacy track",
        position: 0,
        audioUrl: "https://audio.example.test/legacy/direct.wav",
        sourceAudioUrl: null,
      },
    ]);
    const caller = await buildCaller();

    const [track] = await caller.portfolio.list();

    expect(track?.audioUrl).toBeNull();
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
    expect(storedAudioWhereSpy).not.toHaveBeenCalled();
  });

  // Portfolio redesign 2026-05-17 §0.2 (Q1=B): new featured tracks added
  // through the producer's curated portfolio default to is_public_sample
  // = true. The "Public" badge on the redesigned panel renders this; the
  // /join page reads it to decide what plays for unsigned-in visitors.
  // Existing private rows stay private — no backfill.
  it("defaults isPublicSample to true on insert (Q1=B)", async () => {
    const caller = await buildCaller();
    await caller.portfolio.create({
      title: "Fresh add",
      audioUrl: "https://example.com/a.mp3",
    });
    expect(trackInsertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isPublicSample: true,
        producerId: PRODUCER_ID,
      }),
    );
  });

  it("defaults isPublicSample to true even when audioUrl is null", async () => {
    const caller = await buildCaller();
    await caller.portfolio.create({
      title: "Pending upload",
      audioUrl: null,
    });
    expect(trackInsertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ isPublicSample: true }),
    );
  });

  it("rejects every Skitza storage URL before a tenant-scoped lookup", async () => {
    const caller = await buildCaller();

    await expect(
      caller.portfolio.create({
        title: "Stale stored audio",
        audioUrl: "https://audio.example.test/%73tored.mp3?cache=stale#play",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(trackInsertReturningMock).not.toHaveBeenCalled();
    expect(storedAudioWhereSpy).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant-looking pending object without revealing ownership", async () => {
    const caller = await buildCaller();
    const pendingKey = `producers/other-tenant/tracks/${TRACK_ID}/pending.mp3`;

    await expect(
      caller.portfolio.create({
        title: "Pending stored audio",
        audioUrl: `https://audio.example.test/${pendingKey}?cache=stale`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(trackInsertReturningMock).not.toHaveBeenCalled();
    expect(storedAudioWhereSpy).not.toHaveBeenCalled();
  });

  it("keeps an external URL with a key-shaped path on the generic create path", async () => {
    const caller = await buildCaller();
    const externalUrl =
      `https://mirror.example.test/producers/${PRODUCER_ID}/tracks/${TRACK_ID}/external.mp3`;

    await caller.portfolio.create({ title: "External mirror", audioUrl: externalUrl });

    expect(trackInsertReturningMock).toHaveBeenCalledOnce();
    const where = storedAudioWhereSpy.mock.calls[0]?.[0] as
      | { and?: Array<{ or?: unknown[] }> }
      | undefined;
    expect(where?.and?.[1]?.or).toHaveLength(2);
  });
});

describe("portfolio.createFromVersion", () => {
  it("delegates the version id to the serialized song-management boundary", async () => {
    const caller = await buildCaller();
    const row = await caller.portfolio.createFromVersion({ versionId: TRACK_ID });

    expect(row).toMatchObject({ id: TRACK_ID, title: "From version" });
    expect(songManagementMocks.createPortfolioTrackFromSongVersion).toHaveBeenCalledWith(
      dbMock,
      { producerId: PRODUCER_ID, versionId: TRACK_ID },
    );
  });

  it("conceals unavailable, deleted, and cross-tenant versions as not found", async () => {
    songManagementMocks.createPortfolioTrackFromSongVersion.mockRejectedValueOnce(
      new SongManagementDomainError("NOT_FOUND", "sensitive scope detail"),
    );
    const caller = await buildCaller();

    await expect(
      caller.portfolio.createFromVersion({ versionId: TRACK_ID }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "The live version was not found.",
    });
  });

  it("returns a safe client error for an already-published version", async () => {
    songManagementMocks.createPortfolioTrackFromSongVersion.mockRejectedValueOnce(
      new SongManagementDomainError("INVALID_INPUT", "This track is already in your portfolio"),
    );
    const caller = await buildCaller();

    await expect(
      caller.portfolio.createFromVersion({ versionId: TRACK_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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

  it("rejects setting a producer-owned Skitza version URL through generic update", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    storedAudioSelectMock.mockResolvedValueOnce([{ id: TRACK_ID }]);
    const caller = await buildCaller();

    await expect(
      caller.portfolio.update({
        id: TRACK_ID,
        audioUrl: "https://audio.example.test/stored.mp3",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
