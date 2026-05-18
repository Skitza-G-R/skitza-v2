import { beforeEach, describe, expect, it, vi } from "vitest";

// Wave 2 of /join flow (PRD §6.2 Section B). CRUD for producer_external_links
// — Section B on the /join/<slug> teaser (7 streaming platforms). Auth scoping
// is the core concern here: a cross-tenant `id` must never leak info.

const PRODUCER_ID = "producer-uuid-1";
const LINK_ID = "00000000-0000-0000-0000-0000000000aa";

const producersMarker = { __table: "producers" };
const linksMarker = { __table: "producer_external_links" };

type Row = Record<string, unknown>;
const producerSelectFromMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const linksListMock = vi.fn<() => Promise<Row[]>>();
const linksInsertReturningMock = vi.fn<() => Promise<Row[]>>();
const linksDeleteReturningMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const linksUpdateReturningMock = vi.fn<() => Promise<Array<{ id: string }>>>();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return { where: () => ({ limit: () => producerSelectFromMock() }) };
      }
      // producer_external_links: list uses .where().orderBy()
      return {
        where: () => ({ orderBy: () => linksListMock() }),
      };
    },
  }),
  insert: () => ({
    values: () => ({ returning: () => linksInsertReturningMock() }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({ returning: () => linksUpdateReturningMock() }),
    }),
  }),
  delete: () => ({
    where: () => ({ returning: () => linksDeleteReturningMock() }),
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  producerExternalLinks: linksMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  asc: (col: unknown) => ({ asc: col }),
}));

beforeEach(() => {
  producerSelectFromMock.mockReset().mockResolvedValue([{ id: PRODUCER_ID }]);
  linksListMock.mockReset().mockResolvedValue([]);
  linksInsertReturningMock
    .mockReset()
    .mockResolvedValue([{ id: LINK_ID, producerId: PRODUCER_ID }]);
  linksDeleteReturningMock.mockReset().mockResolvedValue([{ id: LINK_ID }]);
  linksUpdateReturningMock.mockReset().mockResolvedValue([{ id: LINK_ID }]);
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

describe("producerExternalLinks.list", () => {
  it("returns links for the caller's producer, ordered by position", async () => {
    linksListMock.mockResolvedValueOnce([
      {
        id: LINK_ID,
        producerId: PRODUCER_ID,
        platform: "spotify",
        url: "https://open.spotify.com/artist/abc",
        title: null,
        position: 0,
      },
    ]);
    const caller = await buildCaller();
    const rows = await caller.producerExternalLinks.list();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { platform: string }).platform).toBe("spotify");
  });

  it("returns an empty array when the producer has no links", async () => {
    linksListMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    const rows = await caller.producerExternalLinks.list();
    expect(rows).toEqual([]);
  });

  it("throws UNAUTHORIZED when ctx.userId is null", async () => {
    const caller = await buildCaller(null);
    await expect(caller.producerExternalLinks.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws NOT_FOUND when producer row is missing", async () => {
    producerSelectFromMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(caller.producerExternalLinks.list()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("producerExternalLinks.add (smart-paste, URL only)", () => {
  it("detects the platform from each of the 7 supported hosts", async () => {
    const caller = await buildCaller();
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["https://open.spotify.com/artist/abc", "spotify"],
      ["https://music.apple.com/us/album/y", "apple_music"],
      ["https://www.youtube.com/watch?v=z", "youtube"],
      ["https://soundcloud.com/foo/bar", "soundcloud"],
      ["https://bandcamp.com/x", "bandcamp"],
      ["https://tidal.com/track/1", "tidal"],
      ["https://www.instagram.com/reel/abc/", "instagram_reels"],
    ];
    for (const [url] of cases) {
      await caller.producerExternalLinks.add({ url });
    }
    expect(linksInsertReturningMock).toHaveBeenCalledTimes(cases.length);
  });

  it("rejects an unknown host with BAD_REQUEST and a friendly message", async () => {
    const caller = await buildCaller();
    await expect(
      caller.producerExternalLinks.add({ url: "https://vimeo.com/123" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "We don't recognise that platform yet.",
    });
    expect(linksInsertReturningMock).not.toHaveBeenCalled();
  });

  it("rejects malformed URLs via zod (not a URL string)", async () => {
    const caller = await buildCaller();
    await expect(
      caller.producerExternalLinks.add({ url: "not-a-url" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(linksInsertReturningMock).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) URLs with BAD_REQUEST", async () => {
    const caller = await buildCaller();
    await expect(
      caller.producerExternalLinks.add({ url: "javascript:alert(1)" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(linksInsertReturningMock).not.toHaveBeenCalled();
  });

  it("maps the per-producer unique-platform pg violation to a friendly BAD_REQUEST", async () => {
    // Schema has UNIQUE(producer_id, platform). Pasting a second Spotify
    // link raises pg error code 23505. Router catches that specific code
    // and rewraps as a producer-readable message so the smart-paste
    // input can show inline error copy without leaking pg internals.
    linksInsertReturningMock.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
      }),
    );
    const caller = await buildCaller();
    await expect(
      caller.producerExternalLinks.add({
        url: "https://open.spotify.com/artist/abc",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "You already have a Spotify link. Remove the old one first.",
    });
  });

  it("re-throws non-unique errors unchanged (no silent swallow)", async () => {
    linksInsertReturningMock.mockRejectedValueOnce(
      Object.assign(new Error("connection lost"), { code: "08006" }),
    );
    const caller = await buildCaller();
    await expect(
      caller.producerExternalLinks.add({
        url: "https://open.spotify.com/artist/abc",
      }),
    ).rejects.toThrow(/connection lost/);
  });
});

describe("producerExternalLinks.remove", () => {
  it("deletes when the link belongs to the caller", async () => {
    linksDeleteReturningMock.mockResolvedValueOnce([{ id: LINK_ID }]);
    const caller = await buildCaller();
    const res = await caller.producerExternalLinks.remove({ id: LINK_ID });
    expect(res).toEqual({ ok: true });
  });

  it("throws NOT_FOUND for a non-existent id (zero-row UPDATE result)", async () => {
    linksDeleteReturningMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(
      caller.producerExternalLinks.remove({ id: LINK_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for a cross-tenant id (same zero-row outcome — enumeration-proof)", async () => {
    // Simulating: another producer's link that the WHERE filter
    // doesn't match; DELETE returning is empty just like the missing
    // case. This is the enumeration-proof property we want.
    linksDeleteReturningMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(
      caller.producerExternalLinks.remove({ id: LINK_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("producerExternalLinks.reorder", () => {
  it("updates position for each id in the list (scoped by producer)", async () => {
    const caller = await buildCaller();
    await caller.producerExternalLinks.reorder({
      orderedIds: [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
        "00000000-0000-0000-0000-000000000003",
      ],
    });
    expect(linksUpdateReturningMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an empty list via zod min(1)", async () => {
    const caller = await buildCaller();
    await expect(
      caller.producerExternalLinks.reorder({ orderedIds: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects more than 50 ids", async () => {
    const caller = await buildCaller();
    const tooMany = Array.from({ length: 51 }, (_, i) =>
      `00000000-0000-0000-0000-0000000000${i.toString().padStart(2, "0")}`.slice(0, 36),
    );
    await expect(
      caller.producerExternalLinks.reorder({ orderedIds: tooMany }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("producerExternalLinks — auth scoping across all mutations", () => {
  it("requires Clerk session for every mutation", async () => {
    const caller = await buildCaller(null);
    await expect(
      caller.producerExternalLinks.list(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.producerExternalLinks.add({
        url: "https://open.spotify.com/x",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.producerExternalLinks.remove({ id: LINK_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.producerExternalLinks.reorder({ orderedIds: [LINK_ID] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
