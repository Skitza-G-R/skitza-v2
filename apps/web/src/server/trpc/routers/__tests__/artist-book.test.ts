import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Same hoisted-mock pattern as artist-music-project.test.ts. The
// artist.book sub-router fans out into several SELECTs per call:
//
// For `availability`:
//   1. clientContacts   — resolve the artist's (clerkUserId, producerId)
//      link; guards access + surfaces artist's email.
//   2. availabilityBlocks — producer's weekly morning/evening rows.
//   3. bookings         — existing reservations for the next 14 days
//      (for conflict detection).
//   4. projects         — free-booking project for this (producer,
//      artistEmail) if any.
//
// For `confirm`:
//   1. clientContacts   — same access guard.
//   2. bookings         — conflict check for the specific slot.
//   3. INSERT into bookings.
//
// Each SELECT type has its own FIFO queue so a single test can seed
// multiple parallel or sequential calls without interference. The
// auth-boundary tests pry open the WHERE arg to assert the gating
// predicate is pinned to the signed-in user's clerkUserId.

type Row = Record<string, unknown>;

const {
  clientContactsMarker,
  availabilityBlocksMarker,
  bookingsMarker,
  projectsMarker,
  producersMarker,
  contactsSelectQueue,
  availabilityBlocksSelectQueue,
  bookingsSelectQueue,
  projectsSelectQueue,
  producersSelectQueue,
  contactsWhereSpy,
  bookingsWhereSpy,
  projectsWhereSpy,
  insertValuesSpy,
  insertReturningMock,
  dbMock,
} = vi.hoisted(() => {
  type Queue = Row[][];
  const contactsSelectQueue: Queue = [];
  const availabilityBlocksSelectQueue: Queue = [];
  const bookingsSelectQueue: Queue = [];
  const projectsSelectQueue: Queue = [];
  const producersSelectQueue: Queue = [];

  const contactsWhereSpy = vi.fn<(arg: unknown) => void>();
  const bookingsWhereSpy = vi.fn<(arg: unknown) => void>();
  const projectsWhereSpy = vi.fn<(arg: unknown) => void>();
  const insertValuesSpy = vi.fn<(payload: Row) => void>();
  const insertReturningMock = vi.fn<() => Promise<Row[]>>();

  const clientContactsMarker = {
    __table: "client_contacts",
    id: { __column: "client_contacts.id" },
    clerkUserId: { __column: "client_contacts.clerk_user_id" },
    producerId: { __column: "client_contacts.producer_id" },
    email: { __column: "client_contacts.email" },
    name: { __column: "client_contacts.name" },
  };
  const availabilityBlocksMarker = {
    __table: "availability_blocks",
    id: { __column: "availability_blocks.id" },
    producerId: { __column: "availability_blocks.producer_id" },
    weekday: { __column: "availability_blocks.weekday" },
    startMin: { __column: "availability_blocks.start_min" },
    endMin: { __column: "availability_blocks.end_min" },
  };
  const bookingsMarker = {
    __table: "bookings",
    id: { __column: "bookings.id" },
    producerId: { __column: "bookings.producer_id" },
    artistEmail: { __column: "bookings.artist_email" },
    artistName: { __column: "bookings.artist_name" },
    status: { __column: "bookings.status" },
    startsAt: { __column: "bookings.starts_at" },
    durationMin: { __column: "bookings.duration_min" },
    projectId: { __column: "bookings.project_id" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    artistEmail: { __column: "projects.artist_email" },
    title: { __column: "projects.title" },
    stage: { __column: "projects.stage" },
    depositPaid: { __column: "projects.deposit_paid" },
    finalPaid: { __column: "projects.final_paid" },
  };
  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    displayName: { __column: "producers.display_name" },
    timezone: { __column: "producers.timezone" },
  };

  const shift = <T,>(q: T[][]): T[] => q.shift() ?? [];

  const chain = (
    terminal: () => Promise<Row[]>,
    whereSpy?: (arg: unknown) => void,
  ) => {
    let resolved: Promise<Row[]> | null = null;
    const get = () => {
      resolved ??= terminal();
      return resolved;
    };
    type Link = {
      where: (arg: unknown) => Link;
      orderBy: () => Link;
      limit: () => Promise<Row[]>;
      innerJoin: () => Link;
      leftJoin: () => Link;
      then: Promise<Row[]>["then"];
    };
    const link: Link = {
      where: (arg: unknown) => {
        whereSpy?.(arg);
        return link;
      },
      orderBy: () => link,
      limit: () => get(),
      innerJoin: () => link,
      leftJoin: () => link,
      get then() {
        const p = get();
        return p.then.bind(p);
      },
    };
    return link;
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === clientContactsMarker) {
          return chain(
            () => Promise.resolve(shift(contactsSelectQueue)),
            contactsWhereSpy,
          );
        }
        if (table === availabilityBlocksMarker) {
          return chain(() => Promise.resolve(shift(availabilityBlocksSelectQueue)));
        }
        if (table === bookingsMarker) {
          return chain(
            () => Promise.resolve(shift(bookingsSelectQueue)),
            bookingsWhereSpy,
          );
        }
        if (table === projectsMarker) {
          return chain(
            () => Promise.resolve(shift(projectsSelectQueue)),
            projectsWhereSpy,
          );
        }
        if (table === producersMarker) {
          return chain(() => Promise.resolve(shift(producersSelectQueue)));
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    insert: () => ({
      values: (payload: Row) => {
        insertValuesSpy(payload);
        return {
          returning: () => insertReturningMock(),
        };
      },
    }),
  };

  return {
    clientContactsMarker,
    availabilityBlocksMarker,
    bookingsMarker,
    projectsMarker,
    producersMarker,
    contactsSelectQueue,
    availabilityBlocksSelectQueue,
    bookingsSelectQueue,
    projectsSelectQueue,
    producersSelectQueue,
    contactsWhereSpy,
    bookingsWhereSpy,
    projectsWhereSpy,
    insertValuesSpy,
    insertReturningMock,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_artist_1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  clientContacts: clientContactsMarker,
  availabilityBlocks: availabilityBlocksMarker,
  bookings: bookingsMarker,
  projects: projectsMarker,
  producers: producersMarker,
  // Other tables referenced by the artist router — opaque markers so
  // the module loads under the test.
  projectTracks: { __table: "project_tracks" },
  trackVersions: { __table: "track_versions" },
  trackComments: { __table: "track_comments" },
  invoices: { __table: "invoices" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  products: { __table: "products" },
  notifications: { __table: "notifications" },
  stripeCustomers: { __table: "stripe_customers" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  not: (cond: unknown) => ({ not: cond }),
  ne: (col: unknown, val: unknown) => ({ ne: [col, val] }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  notInArray: (col: unknown, vals: unknown[]) => ({ notInArray: [col, vals] }),
  isNull: (col: unknown) => ({ isNull: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  sql: () => ({ sql: true }),
}));

// Re-import the mocked symbols for the auth-boundary identity checks.
import { clientContacts } from "@skitza/db";

beforeEach(() => {
  contactsSelectQueue.length = 0;
  availabilityBlocksSelectQueue.length = 0;
  bookingsSelectQueue.length = 0;
  projectsSelectQueue.length = 0;
  producersSelectQueue.length = 0;
  contactsWhereSpy.mockReset();
  bookingsWhereSpy.mockReset();
  projectsWhereSpy.mockReset();
  insertValuesSpy.mockReset();
  insertReturningMock.mockReset().mockResolvedValue([]);
  process.env.DATABASE_URL = "postgresql://test/test";
  // Freeze time for deterministic 14-day window assertions. 2026-04-19
  // is a Sunday (weekday 0 in JS) — picked to line up with the first
  // "active" block on the seeded weekly schedule.
  vi.setSystemTime(new Date("2026-04-19T10:00:00Z"));
});

const buildCaller = async (userId: string | null = "user_test_artist_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

const PRODUCER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_PRODUCER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROJECT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// Walk an arbitrarily nested and(...) tree for a (operator, column)
// predicate — copied verbatim from artist-music-project.test.ts.
function findPredicate(
  where: unknown,
  operator: "eq" | "inArray",
  columnMarker: unknown,
): unknown[] | null {
  if (!where || typeof where !== "object") return null;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const p of (where as { and: unknown[] }).and) {
      const found = findPredicate(p, operator, columnMarker);
      if (found) return found;
    }
    return null;
  }
  if (operator in where) {
    const args = (where as Record<string, unknown[]>)[operator];
    if (Array.isArray(args) && args[0] === columnMarker) return args;
  }
  return null;
}

// Seeds a valid (clerkUserId, producerId) contact. Push this BEFORE
// any test that wants to move past the access guard.
function seedValidContact(overrides?: Partial<Row>) {
  contactsSelectQueue.push([
    {
      id: "c1",
      producerId: PRODUCER_ID,
      email: "dan@x.com",
      name: "Dan The Artist",
      clerkUserId: "user_test_artist_1",
      ...(overrides ?? {}),
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────
describe("artist.book.availability (query)", () => {
  it("throws NOT_FOUND when producer isn't one of the artist's studios", async () => {
    contactsSelectQueue.push([]); // no contact → not my studio

    const caller = await buildCaller();
    await expect(
      caller.artist.book.availability({ producerId: OTHER_PRODUCER_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The contacts SELECT must have fired — this is the auth boundary.
    // Without this assertion the test passes vacuously when the
    // procedure doesn't exist at all (tRPC's own NOT_FOUND).
    expect(contactsWhereSpy).toHaveBeenCalled();
  });

  it("returns 14 days starting from today", async () => {
    seedValidContact();
    // Empty weekly schedule + no bookings + no free project — the
    // minimal "you have access, but there's nothing to book" shape.
    availabilityBlocksSelectQueue.push([]);
    bookingsSelectQueue.push([]);
    projectsSelectQueue.push([]);

    const caller = await buildCaller();
    const result = await caller.artist.book.availability({
      producerId: PRODUCER_ID,
    });

    expect(result.days).toHaveLength(14);
    // Today is 2026-04-19 (Sunday = weekday 0).
    expect(result.days[0]?.date).toBe("2026-04-19");
    expect(result.days[0]?.weekday).toBe(0);
    expect(result.days[13]?.date).toBe("2026-05-02");
    expect(result.days[13]?.weekday).toBe(6);
  });

  it("populates morning/evening blocks from availabilityBlocks config", async () => {
    seedValidContact();
    // Producer publishes two blocks on each weekday:
    //   morning 09:00-13:00 (540-780)
    //   evening 18:00-22:00 (1080-1320)
    // We seed only weekday 0 (Sunday) so we can isolate that one day's
    // shape without caring about the other 13.
    availabilityBlocksSelectQueue.push([
      { producerId: PRODUCER_ID, weekday: 0, startMin: 540, endMin: 780 },
      { producerId: PRODUCER_ID, weekday: 0, startMin: 1080, endMin: 1320 },
    ]);
    bookingsSelectQueue.push([]);
    projectsSelectQueue.push([]);

    const caller = await buildCaller();
    const result = await caller.artist.book.availability({
      producerId: PRODUCER_ID,
    });

    const sunday = result.days[0];
    expect(sunday?.weekday).toBe(0);
    expect(sunday?.morning).toEqual({
      startMin: 540,
      endMin: 780,
      available: true,
    });
    expect(sunday?.evening).toEqual({
      startMin: 1080,
      endMin: 1320,
      available: true,
    });

    // Monday has no blocks seeded → morning + evening are both null.
    const monday = result.days[1];
    expect(monday?.weekday).toBe(1);
    expect(monday?.morning).toBeNull();
    expect(monday?.evening).toBeNull();
  });

  it("marks a block unavailable when there's a conflicting booking", async () => {
    seedValidContact();
    availabilityBlocksSelectQueue.push([
      { producerId: PRODUCER_ID, weekday: 0, startMin: 540, endMin: 780 },
      { producerId: PRODUCER_ID, weekday: 0, startMin: 1080, endMin: 1320 },
    ]);
    // An existing booking on today (2026-04-19) at 10:00 UTC for 2h.
    // 10:00 UTC = minute 600 → inside the 540-780 morning block.
    // Must mark today's morning block as unavailable.
    bookingsSelectQueue.push([
      {
        id: "bk-existing",
        startsAt: new Date("2026-04-19T10:00:00Z"),
        durationMin: 120,
        producerId: PRODUCER_ID,
      },
    ]);
    projectsSelectQueue.push([]);

    const caller = await buildCaller();
    const result = await caller.artist.book.availability({
      producerId: PRODUCER_ID,
    });

    const today = result.days[0];
    expect(today?.morning?.available).toBe(false);
    // Evening on the same day is untouched.
    expect(today?.evening?.available).toBe(true);
    // Next Sunday (2026-04-26) has no conflict → morning still free.
    const nextSunday = result.days[7];
    expect(nextSunday?.morning?.available).toBe(true);
  });

  it("returns freeBookingProjectId when artist has an active paid project with this producer", async () => {
    seedValidContact();
    availabilityBlocksSelectQueue.push([]);
    bookingsSelectQueue.push([]);
    // Artist has a deposit-paid project that is NOT fully paid and
    // still in active production — the "free session included" case.
    projectsSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        artistEmail: "dan@x.com",
        title: "Summer EP",
        stage: "in_production",
        depositPaid: true,
        finalPaid: false,
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.book.availability({
      producerId: PRODUCER_ID,
    });

    expect(result.freeBookingProjectId).toBe(PROJECT_ID);
    expect(result.freeBookingProjectTitle).toBe("Summer EP");
  });

  it("returns null freeBookingProjectId when project is already fully paid", async () => {
    seedValidContact();
    availabilityBlocksSelectQueue.push([]);
    bookingsSelectQueue.push([]);
    // Router's WHERE excludes finalPaid=true rows at the DB layer, so
    // the empty result here mirrors the production SQL — the fully-
    // paid project simply doesn't come back.
    projectsSelectQueue.push([]);

    const caller = await buildCaller();
    const result = await caller.artist.book.availability({
      producerId: PRODUCER_ID,
    });

    expect(result.freeBookingProjectId).toBeNull();
    expect(result.freeBookingProjectTitle).toBeNull();
  });

  it("clientContacts WHERE is scoped by clerkUserId + producerId (auth boundary)", async () => {
    seedValidContact();
    availabilityBlocksSelectQueue.push([]);
    bookingsSelectQueue.push([]);
    projectsSelectQueue.push([]);

    const caller = await buildCaller("user_alice");
    // user_alice won't find a contact because contactsSelectQueue was
    // seeded with clerkUserId: user_test_artist_1 — but this test is
    // about the WHERE predicates, not the row shape. Replace the seed
    // with an alice-owned contact so the happy path proceeds past the
    // guard and we still get to assert the WHERE.
    contactsSelectQueue.length = 0;
    contactsSelectQueue.push([
      {
        id: "c1",
        producerId: PRODUCER_ID,
        email: "alice@x.com",
        name: "Alice",
        clerkUserId: "user_alice",
      },
    ]);

    await caller.artist.book.availability({ producerId: PRODUCER_ID });

    const contactsArg = contactsWhereSpy.mock.calls[0]?.[0];

    // (a) clerkUserId — the signed-in user's Clerk id.
    const clerkPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.clerkUserId,
    );
    expect(clerkPred).not.toBeNull();
    expect(clerkPred?.[1]).toBe("user_alice");

    // (b) producerId — the producer the artist is booking with. A
    // refactor that drops this predicate would let a contact for any
    // OTHER producer satisfy the access guard → cross-producer leak.
    const producerPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.producerId,
    );
    expect(producerPred).not.toBeNull();
    expect(producerPred?.[1]).toBe(PRODUCER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("artist.book.confirm (mutation)", () => {
  const todayDate = "2026-04-19";
  const validInput = {
    producerId: PRODUCER_ID,
    date: todayDate,
    block: "morning" as const,
    startMin: 540, // 09:00
    durationMin: 120,
    projectId: null as string | null,
    productId: null as string | null,
  };

  it("throws NOT_FOUND when producer isn't one of the artist's studios", async () => {
    contactsSelectQueue.push([]); // no contact → not my studio

    const caller = await buildCaller();
    await expect(
      caller.artist.book.confirm({ ...validInput, producerId: OTHER_PRODUCER_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(insertValuesSpy).not.toHaveBeenCalled();
    // Auth boundary: contacts SELECT must fire before we bail with
    // NOT_FOUND. Asserting this ensures we're testing the router's
    // NOT_FOUND path, not tRPC's "no such procedure" NOT_FOUND.
    expect(contactsWhereSpy).toHaveBeenCalled();
  });

  it("inserts booking with status=pending_approval + artistEmail + artistName from clientContacts", async () => {
    seedValidContact();
    // No conflicting bookings.
    bookingsSelectQueue.push([]);
    insertReturningMock.mockResolvedValue([
      {
        id: "bk-new",
        producerId: PRODUCER_ID,
        artistEmail: "dan@x.com",
        artistName: "Dan The Artist",
        startsAt: new Date("2026-04-19T09:00:00Z"),
        durationMin: 120,
        status: "pending_approval",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.book.confirm(validInput);

    expect(insertValuesSpy).toHaveBeenCalledTimes(1);
    const payload = insertValuesSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.producerId).toBe(PRODUCER_ID);
    expect(payload.artistEmail).toBe("dan@x.com");
    expect(payload.artistName).toBe("Dan The Artist");
    expect(payload.durationMin).toBe(120);
    expect(payload.status).toBe("pending_approval");
    expect(payload.startsAt).toBeInstanceOf(Date);

    expect(result.id).toBe("bk-new");
  });

  it("links booking to projectId when provided", async () => {
    seedValidContact();
    bookingsSelectQueue.push([]);
    insertReturningMock.mockResolvedValue([
      {
        id: "bk-new",
        producerId: PRODUCER_ID,
        artistEmail: "dan@x.com",
        artistName: "Dan The Artist",
        startsAt: new Date("2026-04-19T09:00:00Z"),
        durationMin: 120,
        status: "pending_approval",
        projectId: PROJECT_ID,
      },
    ]);

    const caller = await buildCaller();
    await caller.artist.book.confirm({ ...validInput, projectId: PROJECT_ID });

    const payload = insertValuesSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.projectId).toBe(PROJECT_ID);
  });

  it("clientContacts WHERE is scoped by clerkUserId + producerId (auth boundary)", async () => {
    contactsSelectQueue.push([
      {
        id: "c1",
        producerId: PRODUCER_ID,
        email: "alice@x.com",
        name: "Alice",
        clerkUserId: "user_alice",
      },
    ]);
    bookingsSelectQueue.push([]);
    insertReturningMock.mockResolvedValue([
      {
        id: "bk-new",
        producerId: PRODUCER_ID,
        artistEmail: "alice@x.com",
        artistName: "Alice",
        startsAt: new Date("2026-04-19T09:00:00Z"),
        durationMin: 120,
        status: "pending_approval",
      },
    ]);

    const caller = await buildCaller("user_alice");
    await caller.artist.book.confirm(validInput);

    const contactsArg = contactsWhereSpy.mock.calls[0]?.[0];

    const clerkPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.clerkUserId,
    );
    expect(clerkPred).not.toBeNull();
    expect(clerkPred?.[1]).toBe("user_alice");

    const producerPred = findPredicate(
      contactsArg,
      "eq",
      clientContacts.producerId,
    );
    expect(producerPred).not.toBeNull();
    expect(producerPred?.[1]).toBe(PRODUCER_ID);
  });
});
