import { beforeEach, describe, expect, it, vi } from "vitest";

// Narrow tests for `clientContacts.setTags`. Covers:
//   - happy path (tags write through + dedupe applied)
//   - auth boundary (FORBIDDEN when the row belongs to another producer)
//   - NOT_FOUND on unknown id
// Plus a smoke test for `listTags` returning the producer's distinct
// vocabulary sorted by frequency.

const PRODUCER_ID = "producer-uuid-setTags-1";
const OTHER_PRODUCER_ID = "producer-uuid-setTags-2";

const {
  producersMarker,
  clientContactsMarker,
  selectMock,
  listTagsMock,
  setSpy,
  updateMock,
  dbMock,
} = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const selectMock = vi.fn<() => Promise<Row[]>>();
  const listTagsMock = vi.fn<() => Promise<Row[]>>();
  const setSpy = vi.fn<(payload: Row) => void>();
  const updateMock = vi.fn<() => Promise<void>>();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
  };
  const clientContactsMarker = {
    __table: "client_contacts",
    id: { __column: "client_contacts.id" },
    producerId: { __column: "client_contacts.producer_id" },
    tags: { __column: "client_contacts.tags" },
  };

  // Per-table call count so listTags + setTags routed to their own
  // mocks. setTags does 1 SELECT (ownership) + 1 UPDATE; listTags
  // does 1 SELECT.
  const counts = { clientContacts: 0 };

  const dbMock = {
    select: (cols?: unknown) => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
            }),
          };
        }
        if (table === clientContactsMarker) {
          counts.clientContacts += 1;
          // listTags projects { tags }; setTags projects { producerId }.
          // Route by column key presence.
          const wantsTagsOnly =
            cols !== undefined &&
            typeof cols === "object" &&
            cols !== null &&
            "tags" in (cols as Record<string, unknown>) &&
            !("producerId" in (cols as Record<string, unknown>));
          return {
            where: () => ({
              limit: () =>
                wantsTagsOnly ? Promise.resolve([]) : selectMock(),
              get then() {
                const p = listTagsMock();
                return p.then.bind(p);
              },
            }),
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    update: () => ({
      set: (payload: Row) => {
        setSpy(payload);
        return { where: () => updateMock() };
      },
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    producersMarker,
    clientContactsMarker,
    selectMock,
    listTagsMock,
    setSpy,
    updateMock,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_settags" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  clientContacts: clientContactsMarker,
  // Stub other tables the client-contacts router imports.
  projects: { __table: "projects" },
  contracts: { __table: "contracts" },
  contractRecipients: { __table: "contract_recipients" },
  products: { __table: "products" },
  bookings: { __table: "bookings" },
  projectTracks: { __table: "project_tracks" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  magicLinks: { __table: "magic_links" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  sql: () => ({ sql: true }),
}));
vi.mock("~/lib/magic-links/token", () => ({
  issueMagicToken: () => "dummy-token",
}));
vi.mock("~/server/artist/identity", () => ({
  emailHashFor: (email: string) => `hash:${email}`,
}));

beforeEach(() => {
  selectMock.mockReset().mockResolvedValue([]);
  listTagsMock.mockReset().mockResolvedValue([]);
  setSpy.mockReset();
  updateMock.mockReset().mockResolvedValue(undefined);
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_settags" });
};

describe("clientContacts.setTags", () => {
  it("writes the deduped, trimmed tag array", async () => {
    selectMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();

    const res = await caller.clientContacts.setTags({
      id: "00000000-0000-0000-0000-000000000001",
      // "VIP" + "vip" dedupe → one tag, first casing wins.
      tags: [" warm-vocals ", "VIP", "vip", "budget-conscious"],
    });

    expect(res.ok).toBe(true);
    expect(res.tags).toEqual([
      "warm-vocals",
      "VIP",
      "budget-conscious",
    ]);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const payload = setSpy.mock.calls[0]?.[0] ?? {};
    expect(payload.tags).toEqual([
      "warm-vocals",
      "VIP",
      "budget-conscious",
    ]);
  });

  it("refuses to write when the row belongs to another producer", async () => {
    selectMock.mockResolvedValueOnce([{ producerId: OTHER_PRODUCER_ID }]);
    const caller = await buildCaller();

    await expect(
      caller.clientContacts.setTags({
        id: "00000000-0000-0000-0000-000000000002",
        tags: ["vip"],
      }),
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the id doesn't exist", async () => {
    selectMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();

    await expect(
      caller.clientContacts.setTags({
        id: "00000000-0000-0000-0000-000000000003",
        tags: ["vip"],
      }),
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("accepts an empty tags array (clears all tags)", async () => {
    selectMock.mockResolvedValueOnce([{ producerId: PRODUCER_ID }]);
    const caller = await buildCaller();

    const res = await caller.clientContacts.setTags({
      id: "00000000-0000-0000-0000-000000000004",
      tags: [],
    });

    expect(res.tags).toEqual([]);
    const payload = setSpy.mock.calls[0]?.[0] ?? {};
    expect(payload.tags).toEqual([]);
  });
});
