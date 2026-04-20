import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the "auto-create project on booking.confirm" side effect.
//
// When a producer confirms a pending booking, we want a projects row
// to pop into existence so the producer never has to fill an "add new
// client" form in the common IG-bio → /join/<slug> → artist-app Book
// tab flow. (The legacy public /p/<slug> self-booking flow was removed
// in Story 03 per PRD §6.6.)
//
// Pattern mirrors booking-public-request.test.ts: marker objects per
// table, a per-table FIFO select queue, insert + update spies so we
// can assert which tables were written and with what values. Producer
// middleware always queries producers first (to resolve ctx.producerId
// from ctx.userId); bookings.confirm then reads the booking, checks
// ownership, transitions status, and finally (the new piece) inserts
// a projects row + optional client_contacts upsert, and patches
// bookings.projectId with the new id.

const PRODUCER_ID = "producer-uuid-confirm";
const OTHER_PRODUCER_ID = "producer-uuid-other";
const BOOKING_ID = "00000000-0000-0000-0000-000000000c01";
const NEW_PROJECT_ID = "00000000-0000-0000-0000-000000000d01";
const EXISTING_PROJECT_ID = "00000000-0000-0000-0000-000000000d02";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000b01";

const producersMarker = {
  __table: "producers",
  id: { __column: "producers.id" },
  clerkUserId: { __column: "producers.clerk_user_id" },
};
const productsMarker = {
  __table: "products",
  id: { __column: "products.id" },
};
const projectsMarker = {
  __table: "projects",
  id: { __column: "projects.id" },
  producerId: { __column: "projects.producer_id" },
  bookingId: { __column: "projects.booking_id" },
};
const bookingsMarker = {
  __table: "bookings",
  id: { __column: "bookings.id" },
  producerId: { __column: "bookings.producer_id" },
  projectId: { __column: "bookings.project_id" },
  status: { __column: "bookings.status" },
};
const clientContactsMarker = {
  __table: "client_contacts",
  producerId: { __column: "client_contacts.producer_id" },
  emailHash: { __column: "client_contacts.email_hash" },
};

type Row = Record<string, unknown>;
const producerSelectQueue: Row[][] = [];
const productSelectQueue: Row[][] = [];
const projectSelectQueue: Row[][] = [];
const bookingSelectQueue: Row[][] = [];

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

// Records every insert + update so the tests can assert project
// creation, projectId stamping, and client_contact upsert happened.
const insertCalls: Array<{ table: unknown; values: Row; onConflict?: unknown }> = [];
const updateCalls: Array<{ table: unknown; set: Row; where?: unknown }> = [];

const insertReturningSpy = vi.fn<() => Promise<Row[]>>(() =>
  Promise.resolve([{ id: NEW_PROJECT_ID }]),
);

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const handler = () => {
        if (table === producersMarker) return shift(producerSelectQueue);
        if (table === productsMarker) return shift(productSelectQueue);
        if (table === projectsMarker) return shift(projectSelectQueue);
        if (table === bookingsMarker) return shift(bookingSelectQueue);
        return [];
      };
      return {
        where: () => ({
          limit: () => Promise.resolve(handler()),
          then: (resolve: (rows: Row[]) => void) => {
            resolve(handler());
          },
        }),
      };
    },
  }),
  insert: (table: unknown) => ({
    values: (values: Row) => {
      const record = { table, values } as {
        table: unknown;
        values: Row;
        onConflict?: unknown;
      };
      insertCalls.push(record);
      const chain = {
        returning: insertReturningSpy,
        onConflictDoUpdate: (cfg: unknown) => {
          record.onConflict = cfg;
          return {
            returning: insertReturningSpy,
            // Allow awaiting without `.returning()` (client_contacts
            // upsert doesn't need the row back).
            then: (resolve: (v: unknown) => void) => {
              resolve(undefined);
            },
          };
        },
        // Direct await (insert without returning / onConflict).
        then: (resolve: (v: unknown) => void) => {
          resolve(undefined);
        },
      };
      return chain;
    },
  }),
  update: (table: unknown) => ({
    set: (set: Row) => {
      const record = { table, set } as {
        table: unknown;
        set: Row;
        where?: unknown;
      };
      updateCalls.push(record);
      return {
        where: (whereArg: unknown) => {
          record.where = whereArg;
          return Promise.resolve(undefined);
        },
      };
    },
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_confirm" }),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: () => "127.0.0.1",
    }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  products: productsMarker,
  projects: projectsMarker,
  bookings: bookingsMarker,
  clientContacts: clientContactsMarker,
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  invoices: { __table: "invoices" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
  isNull: (col: unknown) => ({ isNull: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  sql: () => ({ sql: true }),
}));

// Side-effect mocks — the email path inside booking.confirm still
// runs, but we don't care about it for these tests; mock to no-ops.
vi.mock("~/server/email/send", () => ({
  sendBookingConfirmedEmail: vi.fn(() => Promise.resolve()),
  sendBookingRequestEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/server/contacts/record", () => ({
  recordContact: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/server/notifications/emit", () => ({
  emitBookingRequested: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));

// Walks an arbitrarily nested `and(...)` tree to find an (operator,
// column) pair. Mirrors producer-today.test.ts's findPredicate.
function findPredicate(
  where: unknown,
  operator: "eq" | "inArray",
  columnMarker: unknown,
): unknown {
  if (!where || typeof where !== "object") return null;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const p of (where as { and: unknown[] }).and) {
      const found = findPredicate(p, operator, columnMarker);
      if (found) return found;
    }
    return null;
  }
  if (operator in where) {
    const args = (where as Record<string, unknown>)[operator];
    if (Array.isArray(args) && args[0] === columnMarker) return args;
  }
  return null;
}

beforeEach(() => {
  producerSelectQueue.length = 0;
  productSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  bookingSelectQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  insertReturningSpy.mockReset().mockResolvedValue([{ id: NEW_PROJECT_ID }]);
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_confirm") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

// Seeds the happy-path queues: producer middleware + booking row (no
// existing project link) + product (for the email side-effect).
function seedPendingBookingNoProject(overrides: { booking?: Partial<Row> } = {}) {
  producerSelectQueue.push([{ id: PRODUCER_ID }]);
  bookingSelectQueue.push([
    {
      id: BOOKING_ID,
      producerId: PRODUCER_ID,
      status: "pending",
      artistName: "Alice Artist",
      artistEmail: "alice@example.com",
      startsAt: new Date("2026-05-01T15:00:00Z"),
      durationMin: 120,
      productId: PRODUCT_ID,
      packageNameSnapshot: "Mix — 2 hours",
      projectId: null,
      ...(overrides.booking ?? {}),
    },
  ]);
  // The email-path fetches producers (displayName/timezone/currency)
  // and products (name/priceCents/currency/depositPct) after status
  // transition. Seed both so the path doesn't unwind.
  producerSelectQueue.push([
    { displayName: "Bob Producer", timezone: "UTC", defaultCurrency: "USD" },
  ]);
  productSelectQueue.push([
    { name: "Mix — 2 hours", priceCents: 20000, currency: "USD", depositPct: 50 },
  ]);
}

describe("booking.confirm auto-project creation", () => {
  it("creates a projects row when the booking has no linked project", async () => {
    seedPendingBookingNoProject();
    const caller = await buildCaller();

    const result = await caller.booking.confirm({ id: BOOKING_ID });
    expect(result).toEqual({ ok: true });

    // Assert: one insert targets the projects table.
    const projectInserts = insertCalls.filter((c) => c.table === projectsMarker);
    expect(projectInserts).toHaveLength(1);
    const projectValues = projectInserts[0]?.values as Row;
    expect(projectValues["producerId"]).toBe(PRODUCER_ID);
    expect(projectValues["bookingId"]).toBe(BOOKING_ID);
    expect(projectValues["title"]).toBe("Mix — 2 hours");
    expect(projectValues["artistName"]).toBe("Alice Artist");
    expect(projectValues["artistEmail"]).toBe("alice@example.com");
    expect(projectValues["stage"]).toBe("booked");
    expect(projectValues["depositPaid"]).toBe(false);
    expect(projectValues["finalPaid"]).toBe(false);
  });

  it("stamps bookings.projectId with the new project's id", async () => {
    seedPendingBookingNoProject();
    const caller = await buildCaller();

    await caller.booking.confirm({ id: BOOKING_ID });

    // At least one bookings update for projectId stamping (alongside
    // the status transition update). Find the one whose set has
    // projectId set.
    const bookingUpdates = updateCalls.filter((c) => c.table === bookingsMarker);
    const projectIdStamp = bookingUpdates.find(
      (c) => c.set["projectId"] === NEW_PROJECT_ID,
    );
    expect(projectIdStamp).toBeDefined();
  });

  it("upserts a client_contacts row keyed on (producerId, emailHash)", async () => {
    seedPendingBookingNoProject();
    const caller = await buildCaller();

    await caller.booking.confirm({ id: BOOKING_ID });

    // One insert targeting client_contacts with an onConflictDoUpdate.
    const contactInserts = insertCalls.filter(
      (c) => c.table === clientContactsMarker,
    );
    expect(contactInserts).toHaveLength(1);
    const contact = contactInserts[0];
    expect(contact).toBeDefined();
    if (!contact) return;
    const v = contact.values;
    expect(v["producerId"]).toBe(PRODUCER_ID);
    // Email hash is sha256 of trim+lowercase "alice@example.com".
    // We don't hardcode the digest — just assert the row has an
    // emailHash string and the lowercased raw email.
    expect(typeof v["emailHash"]).toBe("string");
    expect((v["emailHash"] as string).length).toBeGreaterThan(16);
    expect(v["email"]).toBe("alice@example.com");
    // The upsert conflict target is producerId + emailHash.
    expect(contact.onConflict).toBeDefined();
  });

  it("is idempotent — when booking already has a linked project, no duplicate is inserted", async () => {
    // Producer middleware + booking row that already has projectId.
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    bookingSelectQueue.push([
      {
        id: BOOKING_ID,
        producerId: PRODUCER_ID,
        status: "pending",
        artistName: "Alice Artist",
        artistEmail: "alice@example.com",
        startsAt: new Date("2026-05-01T15:00:00Z"),
        durationMin: 120,
        productId: PRODUCT_ID,
        packageNameSnapshot: "Mix — 2 hours",
        projectId: EXISTING_PROJECT_ID,
      },
    ]);
    // Email path selects still run.
    producerSelectQueue.push([
      { displayName: "Bob Producer", timezone: "UTC", defaultCurrency: "USD" },
    ]);
    productSelectQueue.push([
      { name: "Mix — 2 hours", priceCents: 20000, currency: "USD", depositPct: 50 },
    ]);

    const caller = await buildCaller();
    await caller.booking.confirm({ id: BOOKING_ID });

    const projectInserts = insertCalls.filter((c) => c.table === projectsMarker);
    expect(projectInserts).toHaveLength(0);
  });

  it("scopes the booking lookup via ctx.producerId and throws FORBIDDEN for cross-producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    // Seed a booking that belongs to a different producer.
    bookingSelectQueue.push([
      {
        id: BOOKING_ID,
        producerId: OTHER_PRODUCER_ID,
        status: "pending",
        artistName: "Alice Artist",
        artistEmail: "alice@example.com",
        startsAt: new Date("2026-05-01T15:00:00Z"),
        durationMin: 120,
        productId: PRODUCT_ID,
        packageNameSnapshot: "Mix — 2 hours",
        projectId: null,
      },
    ]);

    const caller = await buildCaller();
    await expect(
      caller.booking.confirm({ id: BOOKING_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // No project insert or client_contact upsert should have happened.
    const projectInserts = insertCalls.filter((c) => c.table === projectsMarker);
    expect(projectInserts).toHaveLength(0);
    const contactInserts = insertCalls.filter(
      (c) => c.table === clientContactsMarker,
    );
    expect(contactInserts).toHaveLength(0);
  });

  it("derives the project title from packageNameSnapshot and falls back to artist name when missing", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    bookingSelectQueue.push([
      {
        id: BOOKING_ID,
        producerId: PRODUCER_ID,
        status: "pending",
        artistName: "Zoe Artist",
        artistEmail: "zoe@example.com",
        startsAt: new Date("2026-05-01T15:00:00Z"),
        durationMin: 120,
        productId: null,
        packageNameSnapshot: null,
        projectId: null,
      },
    ]);
    producerSelectQueue.push([
      { displayName: "Bob Producer", timezone: "UTC", defaultCurrency: "USD" },
    ]);

    const caller = await buildCaller();
    await caller.booking.confirm({ id: BOOKING_ID });

    const projectInserts = insertCalls.filter((c) => c.table === projectsMarker);
    expect(projectInserts).toHaveLength(1);
    const v = projectInserts[0]?.values as Row;
    // No packageNameSnapshot → fallback to "Session with <artistName>".
    expect(v["title"]).toBe("Session with Zoe Artist");
  });

  it("references bookings.id on the stamping update WHERE clause", async () => {
    seedPendingBookingNoProject();
    const caller = await buildCaller();

    await caller.booking.confirm({ id: BOOKING_ID });

    const bookingUpdates = updateCalls.filter((c) => c.table === bookingsMarker);
    // At least one update should target bookings.id = BOOKING_ID.
    const hasIdEq = bookingUpdates.some((c) =>
      Boolean(findPredicate(c.where, "eq", bookingsMarker.id)),
    );
    expect(hasIdEq).toBe(true);
  });
});
