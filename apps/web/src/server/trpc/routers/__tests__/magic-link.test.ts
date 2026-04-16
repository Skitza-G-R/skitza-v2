import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "producer-uuid-1";
const LINK_ID = "00000000-0000-0000-0000-000000000010";
const OTHER_LINK_ID = "00000000-0000-0000-0000-000000000011";
const LEAD_ID = "00000000-0000-0000-0000-000000000020";
const ISSUED_TOKEN = "fake.issued.token";

// Marker objects so the dbMock can branch on which table the caller hit
// (mirrors portfolio.test.ts pattern).
const producersMarker = { __table: "producers" };
const magicLinksMarker = { __table: "magic_links" };
const magicLinkViewsMarker = { __table: "magic_link_views" };

type Row = Record<string, unknown>;
const producerSelectFromMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const linkSelectByIdMock = vi.fn<() => Promise<Array<Row>>>();
const linkListMock = vi.fn<() => Promise<Row[]>>();
const linkInsertReturningMock = vi.fn<() => Promise<Row[]>>();
const linkUpdateReturningMock = vi.fn<() => Promise<Row[]>>();

// Captures so individual tests can assert the values drizzle saw.
let lastInsertValues: Row | undefined;
let lastUpdateSet: Row | undefined;

const dbMock = {
  // `select()` accepts an optional column-projection arg in real drizzle
  // (used by magicLink.list); the mock ignores it.
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return { where: () => ({ limit: () => producerSelectFromMock() }) };
      }
      // magicLinks: by-id lookup uses .where().limit(1); .list uses
      // .leftJoin().where().groupBy().orderBy() — terminal both ways.
      return {
        where: () => ({
          limit: () => linkSelectByIdMock(),
        }),
        leftJoin: () => ({
          where: () => ({
            groupBy: () => ({ orderBy: () => linkListMock() }),
          }),
        }),
      };
    },
  }),
  insert: () => ({
    values: (vals: Row) => {
      lastInsertValues = vals;
      return { returning: () => linkInsertReturningMock() };
    },
  }),
  update: () => ({
    set: (patch: Row) => {
      lastUpdateSet = patch;
      return { where: () => ({ returning: () => linkUpdateReturningMock() }) };
    },
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  magicLinks: magicLinksMarker,
  magicLinkViews: magicLinkViewsMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  desc: (col: unknown) => ({ desc: col }),
  // sql is a tagged-template tag in real drizzle; the router uses
  // sql<T>`max(${magicLinkViews.viewedAt})` only as a column projection
  // in select() — the dbMock's select() ignores its argument, so we just
  // need a function that doesn't throw when called as a tag.
  sql: () => ({ sql: true }),
}));
vi.mock("~/lib/magic-links/token", () => ({
  issueMagicToken: vi.fn(() => ISSUED_TOKEN),
}));

beforeEach(() => {
  producerSelectFromMock.mockReset().mockResolvedValue([{ id: PRODUCER_ID }]);
  linkSelectByIdMock.mockReset().mockResolvedValue([]);
  linkListMock.mockReset().mockResolvedValue([]);
  linkInsertReturningMock
    .mockReset()
    .mockResolvedValue([
      {
        id: LINK_ID,
        producerId: PRODUCER_ID,
        leadId: null,
        target: "portfolio",
        tokenHash: createHash("sha256").update(ISSUED_TOKEN).digest("hex"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        revokedAt: null,
        createdAt: new Date("2026-04-16T00:00:00Z"),
      },
    ]);
  linkUpdateReturningMock
    .mockReset()
    .mockResolvedValue([
      {
        id: LINK_ID,
        producerId: PRODUCER_ID,
        revokedAt: new Date("2026-04-16T01:00:00Z"),
      },
    ]);
  lastInsertValues = undefined;
  lastUpdateSet = undefined;
  process.env.DATABASE_URL = "postgresql://test/test";
  process.env.SITE_URL = "https://skitza.test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

describe("magicLink.issue", () => {
  it("returns the URL and persisted row (no tokenHash leaked)", async () => {
    const caller = await buildCaller();
    const res = await caller.magicLink.issue({ target: "portfolio", ttlHours: 24 });
    expect(res.url).toBe(`https://skitza.test/m/${ISSUED_TOKEN}`);
    expect(res.link.id).toBe(LINK_ID);
    // tokenHash must never reach the wire — token already in URL.
    expect(res.link).not.toHaveProperty("tokenHash");
    // The hash drizzle saw must equal sha256(token), hex-encoded.
    expect(lastInsertValues?.["tokenHash"]).toBe(
      createHash("sha256").update(ISSUED_TOKEN).digest("hex"),
    );
    expect(lastInsertValues?.["producerId"]).toBe(PRODUCER_ID);
    expect(lastInsertValues?.["target"]).toBe("portfolio");
    expect(lastInsertValues?.["expiresAt"]).toBeInstanceOf(Date);
  });

  it("strips a single trailing slash from SITE_URL", async () => {
    process.env.SITE_URL = "https://skitza.test/";
    const caller = await buildCaller();
    const res = await caller.magicLink.issue({ target: "booking", ttlHours: 1 });
    expect(res.url).toBe(`https://skitza.test/m/${ISSUED_TOKEN}`);
  });

  it("includes leadId on the persisted row when provided", async () => {
    const caller = await buildCaller();
    await caller.magicLink.issue({ target: "booking", ttlHours: 2, leadId: LEAD_ID });
    expect(lastInsertValues?.["leadId"]).toBe(LEAD_ID);
  });

  it("throws UNAUTHORIZED when ctx.userId is null", async () => {
    const caller = await buildCaller(null);
    await expect(
      caller.magicLink.issue({ target: "portfolio", ttlHours: 1 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws INTERNAL_SERVER_ERROR with 'missing SITE_URL' when env missing", async () => {
    delete process.env.SITE_URL;
    const caller = await buildCaller();
    await expect(
      caller.magicLink.issue({ target: "portfolio", ttlHours: 1 }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "missing SITE_URL",
    });
  });

  it("rejects an unknown target via zod", async () => {
    const caller = await buildCaller();
    const bad = { target: "bogus", ttlHours: 1 } as unknown as Parameters<
      typeof caller.magicLink.issue
    >[0];
    await expect(caller.magicLink.issue(bad)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(linkInsertReturningMock).not.toHaveBeenCalled();
  });

  it("rejects ttlHours over the 720 max via zod", async () => {
    const caller = await buildCaller();
    await expect(
      caller.magicLink.issue({ target: "portfolio", ttlHours: 721 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(linkInsertReturningMock).not.toHaveBeenCalled();
  });
});

describe("magicLink.list", () => {
  it("returns the producer's links with their lastViewedAt", async () => {
    linkListMock.mockResolvedValueOnce([
      {
        id: LINK_ID,
        target: "portfolio",
        leadId: null,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        revokedAt: null,
        createdAt: new Date("2026-04-15T00:00:00Z"),
        lastViewedAt: new Date("2026-04-15T12:00:00Z"),
      },
    ]);
    const caller = await buildCaller();
    const rows = await caller.magicLink.list();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe(LINK_ID);
    expect((rows[0] as { lastViewedAt: Date }).lastViewedAt).toBeInstanceOf(Date);
  });

  it("throws UNAUTHORIZED when ctx.userId is null", async () => {
    const caller = await buildCaller(null);
    await expect(caller.magicLink.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("magicLink.revoke", () => {
  it("sets revokedAt when caller owns the link", async () => {
    linkSelectByIdMock.mockResolvedValueOnce([
      { producerId: PRODUCER_ID, revokedAt: null },
    ]);
    const caller = await buildCaller();
    await caller.magicLink.revoke({ id: LINK_ID });
    expect(linkUpdateReturningMock).toHaveBeenCalledOnce();
    expect(lastUpdateSet?.["revokedAt"]).toBeInstanceOf(Date);
  });

  it("throws FORBIDDEN on a cross-tenant id", async () => {
    linkSelectByIdMock.mockResolvedValueOnce([
      { producerId: "other-producer", revokedAt: null },
    ]);
    const caller = await buildCaller();
    await expect(caller.magicLink.revoke({ id: OTHER_LINK_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(linkUpdateReturningMock).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the link id is unknown", async () => {
    linkSelectByIdMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(caller.magicLink.revoke({ id: LINK_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(linkUpdateReturningMock).not.toHaveBeenCalled();
  });

  it("short-circuits if already revoked (no UPDATE issued)", async () => {
    const original = new Date("2026-04-10T00:00:00Z");
    linkSelectByIdMock.mockResolvedValueOnce([
      { id: LINK_ID, producerId: PRODUCER_ID, revokedAt: original },
    ]);
    const caller = await buildCaller();
    const res = await caller.magicLink.revoke({ id: LINK_ID });
    expect(linkUpdateReturningMock).not.toHaveBeenCalled();
    expect((res as { revokedAt: Date }).revokedAt).toEqual(original);
  });
});
