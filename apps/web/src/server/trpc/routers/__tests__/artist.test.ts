import { beforeEach, describe, expect, it, vi } from "vitest";

// Marker objects so the dbMock can branch on which table the caller hit
// (mirrors portfolio.test.ts pattern).
const clientContactsMarker = { __table: "client_contacts" };
const producersMarker = { __table: "producers" };

type Row = Record<string, unknown>;
const studiosSelectMock = vi.fn<() => Promise<Row[]>>();

// The artist.studios chain shape is select.from.innerJoin.where — terminal
// is .where() returning rows. Other artist procedures (when added) can
// extend this routing.
const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === clientContactsMarker) {
        return {
          innerJoin: () => ({
            where: () => studiosSelectMock(),
          }),
        };
      }
      throw new Error(`unexpected from(${String(table)})`);
    },
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_artist_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  clientContacts: clientContactsMarker,
  producers: producersMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

beforeEach(() => {
  studiosSelectMock.mockReset().mockResolvedValue([]);
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_artist_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

describe("artist.studios", () => {
  it("rejects UNAUTHORIZED when no userId in context", async () => {
    const caller = await buildCaller(null);
    await expect(caller.artist.studios()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(studiosSelectMock).not.toHaveBeenCalled();
  });

  it("returns deduped + sorted studios for the signed-in artist", async () => {
    // 3 rows across 2 producers — p1 has two rows (most-recent wins),
    // p2 has one. Expect 2 entries sorted by lastSeenAt desc with
    // brand.logoUrl flattened to a scalar.
    studiosSelectMock.mockResolvedValueOnce([
      {
        producerId: "p1",
        producerName: "Gili Asraf Studio",
        producerSlug: "giasraf",
        producerLogoUrl: { logoUrl: "https://x/g-old.png" },
        lastSeenAt: new Date("2026-04-10"),
      },
      {
        producerId: "p2",
        producerName: "Yossi Productions",
        producerSlug: "yossi",
        producerLogoUrl: { logoUrl: "https://x/y.png", primary: "#ff0" },
        lastSeenAt: new Date("2026-04-18"),
      },
      {
        producerId: "p1",
        producerName: "Gili Asraf Studio (renamed)",
        producerSlug: "giasraf",
        producerLogoUrl: { logoUrl: "https://x/g-new.png" },
        lastSeenAt: new Date("2026-04-15"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.studios();

    expect(result.studios).toEqual([
      {
        producerId: "p2",
        name: "Yossi Productions",
        slug: "yossi",
        logoUrl: "https://x/y.png",
      },
      {
        producerId: "p1",
        name: "Gili Asraf Studio (renamed)",
        slug: "giasraf",
        logoUrl: "https://x/g-new.png",
      },
    ]);
  });

  it("returns [] when artist has no studios yet (brand-new sign-in)", async () => {
    studiosSelectMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    const result = await caller.artist.studios();
    expect(result).toEqual({ studios: [] });
  });

  it("falls back to 'Untitled Studio' when producer.displayName is null", async () => {
    studiosSelectMock.mockResolvedValueOnce([
      {
        producerId: "p3",
        producerName: null,
        producerSlug: "anon",
        producerLogoUrl: null,
        lastSeenAt: new Date("2026-04-18"),
      },
    ]);
    const caller = await buildCaller();
    const result = await caller.artist.studios();
    expect(result.studios).toEqual([
      { producerId: "p3", name: "Untitled Studio", slug: "anon", logoUrl: null },
    ]);
  });

  it("normalizes brand jsonb without logoUrl to null", async () => {
    studiosSelectMock.mockResolvedValueOnce([
      {
        producerId: "p4",
        producerName: "Brandless",
        producerSlug: "brandless",
        producerLogoUrl: { primary: "#fff" }, // no logoUrl key
        lastSeenAt: new Date("2026-04-18"),
      },
    ]);
    const caller = await buildCaller();
    const result = await caller.artist.studios();
    expect(result.studios[0]?.logoUrl).toBeNull();
  });
});
