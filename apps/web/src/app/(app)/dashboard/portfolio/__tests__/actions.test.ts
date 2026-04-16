import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "producer-uuid-1";
const TRACK_ID = "00000000-0000-0000-0000-000000000001";

// Marker objects so dbMock can branch on which table the caller hit.
const producersMarker = { __table: "producers" };
const portfolioTracksMarker = { __table: "portfolio_tracks" };

type Row = Record<string, unknown>;
const producerSelectMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const trackSelectByIdMock = vi.fn<() => Promise<Array<{ producerId: string }>>>();
const trackInsertReturningMock = vi.fn<() => Promise<Row[]>>();
const trackUpdateReturningMock = vi.fn<() => Promise<Row[]>>();
const trackDeleteWhereMock = vi.fn<() => Promise<void>>();
const revalidatePathMock = vi.fn<(path: string) => void>();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return { where: () => ({ limit: () => producerSelectMock() }) };
      }
      return {
        where: () => ({
          limit: () => trackSelectByIdMock(),
          orderBy: () => Promise.resolve([] as Row[]),
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

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: mockUserId }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  portfolioTracks: portfolioTracksMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => { revalidatePathMock(path); },
}));

beforeEach(() => {
  mockUserId = "user_test_1";
  producerSelectMock.mockReset().mockResolvedValue([{ id: PRODUCER_ID }]);
  trackSelectByIdMock.mockReset().mockResolvedValue([]);
  trackInsertReturningMock
    .mockReset()
    .mockResolvedValue([{ id: TRACK_ID, title: "x" }]);
  trackUpdateReturningMock.mockReset().mockResolvedValue([{ id: TRACK_ID }]);
  trackDeleteWhereMock.mockReset().mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const validCreate = {
  title: "Demo track",
  artist: "Ada",
  audioUrl: "https://example.com/a.mp3",
  artworkUrl: "https://example.com/a.png",
};

describe("createTrack", () => {
  it("inserts the row and revalidates the portfolio path", async () => {
    const { createTrack } = await import("../actions");
    const res = await createTrack(validCreate);
    expect(res).toEqual({ ok: true });
    expect(trackInsertReturningMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/portfolio");
  });

  it("returns a zod error for invalid audioUrl", async () => {
    const { createTrack } = await import("../actions");
    const res = await createTrack({ ...validCreate, audioUrl: "not-a-url" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/audio/i);
    expect(trackInsertReturningMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns an unauthorized error when no userId", async () => {
    mockUserId = null;
    const { createTrack } = await import("../actions");
    const res = await createTrack(validCreate);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign in/i);
    expect(trackInsertReturningMock).not.toHaveBeenCalled();
  });
});

describe("updateTrack", () => {
  it("updates an owned track and revalidates", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    const { updateTrack } = await import("../actions");
    const res = await updateTrack({ id: TRACK_ID, title: "Renamed" });
    expect(res).toEqual({ ok: true });
    expect(trackUpdateReturningMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/portfolio");
  });

  it("returns a zod error for an invalid id", async () => {
    const { updateTrack } = await import("../actions");
    const res = await updateTrack({ id: "not-a-uuid", title: "x" });
    expect(res.ok).toBe(false);
    expect(trackUpdateReturningMock).not.toHaveBeenCalled();
  });

  it("returns an unauthorized error when no userId", async () => {
    mockUserId = null;
    const { updateTrack } = await import("../actions");
    const res = await updateTrack({ id: TRACK_ID, title: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign in/i);
    expect(trackUpdateReturningMock).not.toHaveBeenCalled();
  });
});

describe("deleteTrack", () => {
  it("deletes an owned track and revalidates", async () => {
    trackSelectByIdMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    const { deleteTrack } = await import("../actions");
    const res = await deleteTrack({ id: TRACK_ID });
    expect(res).toEqual({ ok: true });
    expect(trackDeleteWhereMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/portfolio");
  });

  it("returns a zod error for an invalid id", async () => {
    const { deleteTrack } = await import("../actions");
    const res = await deleteTrack({ id: "nope" });
    expect(res.ok).toBe(false);
    expect(trackDeleteWhereMock).not.toHaveBeenCalled();
  });

  it("returns an unauthorized error when no userId", async () => {
    mockUserId = null;
    const { deleteTrack } = await import("../actions");
    const res = await deleteTrack({ id: TRACK_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign in/i);
    expect(trackDeleteWhereMock).not.toHaveBeenCalled();
  });
});
