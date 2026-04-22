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

describe("producerExternalLinks.add", () => {
  it("inserts with all 7 supported platforms", async () => {
    const caller = await buildCaller();
    for (const platform of [
      "spotify",
      "apple_music",
      "youtube",
      "soundcloud",
      "bandcamp",
      "tidal",
      "instagram_reels",
    ] as const) {
      await caller.producerExternalLinks.add({
        platform,
        url: "https://example.com/valid-url",
        title: null,
      });
    }
    expect(linksInsertReturningMock).toHaveBeenCalledTimes(7);
  });

  it("rejects unknown platforms via zod", async () => {
    const caller = await buildCaller();
    const bad = {
      platform: "myspace",
      url: "https://example.com/a",
    } as unknown as Parameters<typeof caller.producerExternalLinks.add>[0];
    await expect(caller.producerExternalLinks.add(bad)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(linksInsertReturningMock).not.toHaveBeenCalled();
  });

  it("rejects malformed URLs via zod", async () => {
    const caller = await buildCaller();
    const bad = {
      platform: "spotify",
      url: "not-a-url",
    } as unknown as Parameters<typeof caller.producerExternalLinks.add>[0];
    await expect(caller.producerExternalLinks.add(bad)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(linksInsertReturningMock).not.toHaveBeenCalled();
  });

  it("rejects titles longer than 120 chars", async () => {
    const caller = await buildCaller();
    const bad = {
      platform: "spotify" as const,
      url: "https://open.spotify.com/artist/abc",
      title: "x".repeat(121),
    };
    await expect(caller.producerExternalLinks.add(bad)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(linksInsertReturningMock).not.toHaveBeenCalled();
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
        platform: "spotify",
        url: "https://example.com/x",
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
