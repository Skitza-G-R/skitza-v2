import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted() runs these definitions before the hoisted vi.mock() factory
// below, so the factory can reference them safely. We keep all marker
// objects + spies in here so they're shared between (a) the mock factory,
// (b) the dbMock chain, and (c) the test bodies that assert against them.
//
// clientContactsMarker.clerkUserId is the EXACT object identity that the
// router will pass into eq(). The auth-boundary test relies on object
// identity to verify the WHERE clause references the right column on the
// right table (not producers.clerkUserId — that would be a wrong-table
// regression that data-shape tests cannot catch).
const {
  clientContactsMarker,
  producersMarker,
  studiosSelectMock,
  whereSpy,
  dbMock,
} = vi.hoisted(() => {
  const studiosSelectMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const whereSpy = vi.fn<(arg: unknown) => void>();

  const clientContactsMarker = {
    __table: "client_contacts",
    clerkUserId: { __column: "client_contacts.clerk_user_id" },
    archivedAt: { __column: "client_contacts.archived_at" },
  };
  const producersMarker = {
    __table: "producers",
    clerkUserId: { __column: "producers.clerk_user_id" },
  };

  // The artist.studios chain shape is select.from.innerJoin.where —
  // terminal is .where() returning rows. Other artist procedures (when
  // added) can extend this routing.
  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === clientContactsMarker) {
          return {
            innerJoin: () => ({
              where: (arg: unknown) => {
                whereSpy(arg);
                return studiosSelectMock();
              },
            }),
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    clientContactsMarker,
    producersMarker,
    studiosSelectMock,
    whereSpy,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_artist_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  clientContacts: clientContactsMarker,
  producers: producersMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...args: unknown[]) => ({ and: args }),
  isNull: (col: unknown) => ({ isNull: col }),
}));

// Re-import the mocked symbol so the auth-boundary test asserts the
// router's WHERE clause references the same `clientContacts.clerkUserId`
// the rest of the codebase imports — not the test-local marker. Both
// resolve to the same object via the vi.mock factory above.
import { clientContacts } from "@skitza/db";

beforeEach(() => {
  studiosSelectMock.mockReset().mockResolvedValue([]);
  whereSpy.mockReset();
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

  it("scopes WHERE to clientContacts.clerkUserId = ctx.userId AND archivedAt IS NULL (auth boundary)", async () => {
    // Locks three invariants the data-shaping tests cannot:
    //   1. The WHERE column is clientContacts.clerkUserId (the
    //      client_contacts table) — a regression to producers.clerkUserId
    //      would silently pass shape tests. We assert by object identity
    //      because the router imports `clientContacts` from "@skitza/db",
    //      which is mocked to clientContactsMarker — same reference here.
    //   2. The WHERE value is ctx.userId verbatim — no .toLowerCase(),
    //      no truncation, no hardcoded string.
    //   3. Archived rows (artist disconnected from this studio) are
    //      excluded — without the isNull guard, a disconnected studio
    //      would still appear in the switcher.
    studiosSelectMock.mockResolvedValueOnce([]);
    const caller = await buildCaller("user_alice");
    await caller.artist.studios();

    const whereArg = whereSpy.mock.calls[0]?.[0];
    expect(whereArg).toEqual({
      and: [
        { eq: [clientContacts.clerkUserId, "user_alice"] },
        { isNull: clientContacts.archivedAt },
      ],
    });
  });
});
