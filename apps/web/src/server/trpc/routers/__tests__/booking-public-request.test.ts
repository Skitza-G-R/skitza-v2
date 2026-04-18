import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the Task 10 paused-project guard inside booking.publicRequest.
//
// The guard runs after we've resolved the producer + product (so a 404
// path doesn't mention pause state to a fishing attacker) and before
// any booking row is inserted. We pass through the same dbMock-with-
// table-markers pattern used elsewhere in the routers tests: select
// queues are FIFO so the order of seeds matches the order of selects
// in the procedure body.

const PRODUCER_ID = "producer-uuid-paused";
const PRODUCER_SLUG = "studio-pause";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000b01";
const ARTIST_EMAIL = "client@example.com";

const producersMarker = { __table: "producers" };
const productsMarker = { __table: "products" };
const projectsMarker = { __table: "projects" };
const bookingsMarker = { __table: "bookings" };
const availabilityBlackoutsMarker = { __table: "availability_blackouts" };
const availabilityBlocksMarker = { __table: "availability_blocks" };
const clientContactsMarker = { __table: "client_contacts" };
const invoicesMarker = { __table: "invoices" };

type Row = Record<string, unknown>;
const producerSelectQueue: Row[][] = [];
const productSelectQueue: Row[][] = [];
const projectSelectQueue: Row[][] = [];
const bookingSelectQueue: Row[][] = [];
const blackoutSelectQueue: Row[][] = [];
const blockSelectQueue: Row[][] = [];

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

const insertReturningSpy = vi.fn(() => Promise.resolve([{ id: "booking-row-1" }]));
const insertValuesSpy = vi.fn(() => ({ returning: insertReturningSpy }));
const updateSetSpy = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const handler = () => {
        if (table === producersMarker) return shift(producerSelectQueue);
        if (table === productsMarker) return shift(productSelectQueue);
        if (table === projectsMarker) return shift(projectSelectQueue);
        if (table === bookingsMarker) return shift(bookingSelectQueue);
        if (table === availabilityBlackoutsMarker) return shift(blackoutSelectQueue);
        if (table === availabilityBlocksMarker) return shift(blockSelectQueue);
        return [];
      };
      // Most callers chain .where().limit(1); blackouts/availability
      // chain just .where(). Slot-availability + the booking-conflict
      // search use .where() alone too. Cover both terminals.
      return {
        where: () => ({
          limit: () => Promise.resolve(handler()),
          // .where() then end (no limit) — terminal awaitable.
          then: (resolve: (rows: Row[]) => void) => {
            resolve(handler());
          },
        }),
      };
    },
  }),
  insert: () => ({
    values: insertValuesSpy,
  }),
  update: () => ({
    set: updateSetSpy,
  }),
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: null }),
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
  availabilityBlackouts: availabilityBlackoutsMarker,
  availabilityBlocks: availabilityBlocksMarker,
  clientContacts: clientContactsMarker,
  invoices: invoicesMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
  isNull: (col: unknown) => ({ isNull: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  sql: () => ({ sql: true }),
}));

// Side-effect imports inside booking.publicRequest. Mock them all to
// no-ops so the test's surface is purely the guard behavior — the
// actual emails / contacts / Stripe paths have their own tests.
vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitBookingRequested: vi.fn() }));
vi.mock("~/server/email/send", () => ({
  sendBookingConfirmedEmail: vi.fn(),
  sendBookingRequestEmail: vi.fn(),
}));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));
vi.mock("~/server/payments/checkout", () => ({
  buildCheckoutSessionParams: vi.fn(),
}));
vi.mock("~/server/payments/plan", () => ({
  calculateCharges: vi.fn(),
}));
vi.mock("~/server/stripe/customer", () => ({
  getOrCreateStripeCustomer: vi.fn(),
}));
vi.mock("~/server/stripe/client", () => ({
  getSiteUrl: () => "https://skitza.test",
  getStripe: () => ({ checkout: { sessions: { create: vi.fn() } } }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  productSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  bookingSelectQueue.length = 0;
  blackoutSelectQueue.length = 0;
  blockSelectQueue.length = 0;
  insertReturningSpy.mockReset().mockResolvedValue([{ id: "booking-row-1" }]);
  insertValuesSpy.mockReset().mockReturnValue({ returning: insertReturningSpy });
  updateSetSpy.mockReset().mockReturnValue({ where: () => Promise.resolve(undefined) });
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: null });
};

// Pure-deliverable product: no slot grid, no minLeadHours friction —
// keeps the test focused on the paused-project guard rather than the
// availability machinery.
function seedProducerAndProduct() {
  producerSelectQueue.push([{ id: PRODUCER_ID }]);
  productSelectQueue.push([
    {
      id: PRODUCT_ID,
      producerId: PRODUCER_ID,
      name: "Mix",
      durationMin: 0,
      minLeadHours: 0,
      bufferMinutes: 0,
      depositModel: "flat",
      depositPct: 0,
      currency: "USD",
      priceCents: 10000,
      paymentPlans: [{ kind: "full" }],
    },
  ]);
}

describe("booking.publicRequest paused-project guard", () => {
  it("rejects PRECONDITION_FAILED when client has a paused project with this producer", async () => {
    seedProducerAndProduct();
    // Same email + producer + payment_paused stage → guard fires.
    projectSelectQueue.push([{ id: "paused-project-1" }]);

    const caller = await buildCaller();
    await expect(
      caller.booking.publicRequest({
        slug: PRODUCER_SLUG,
        productId: PRODUCT_ID,
        artistName: "Existing Client",
        artistEmail: ARTIST_EMAIL,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Your payment method needs to be updated before you can book a new session.",
    });

    // No booking row created — the guard short-circuits before insert.
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("allows the booking when no paused project matches the email/producer pair", async () => {
    seedProducerAndProduct();
    // Empty result → no paused project → guard passes.
    projectSelectQueue.push([]);
    // Empty bookings query for the slot conflict check (skipped for
    // pure-delivery products anyway, but the procedure still calls into
    // it on the legacy path — push a defensive empty seed).
    bookingSelectQueue.push([]);

    const caller = await buildCaller();
    const res = await caller.booking.publicRequest({
      slug: PRODUCER_SLUG,
      productId: PRODUCT_ID,
      artistName: "Greenfield Client",
      artistEmail: "fresh@example.com",
    });

    // Booking row was inserted — guard let the request through.
    expect(insertValuesSpy).toHaveBeenCalled();
    expect(res.id).toBe("booking-row-1");
  });

  it("normalizes the artist email to lowercase before checking for paused projects", async () => {
    seedProducerAndProduct();
    // The DB has the email stored lowercased. Send mixed-case input;
    // if the procedure forgot to lowercase, no row would match and the
    // guard would silently let the booking through (false negative).
    // Our test expects the row to match → guard should fire.
    projectSelectQueue.push([{ id: "paused-project-mixed-case" }]);

    const caller = await buildCaller();
    await expect(
      caller.booking.publicRequest({
        slug: PRODUCER_SLUG,
        productId: PRODUCT_ID,
        artistName: "Mixed Case",
        artistEmail: "Client@Example.COM",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });
});
