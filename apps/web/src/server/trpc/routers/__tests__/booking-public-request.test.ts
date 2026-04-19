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

// ─── monthly first charge: invoice ledger no duplicate (regression) ─
//
// The bug: booking.publicRequest used to write a booking-time invoice
// row with `kind: "installment"`, no payment_intent (subscription mode
// has session.payment_intent === null). Then `handleInvoicePaid` for
// the first month doesn't find a matching PI → INSERTs a NEW row.
// Two rows in the ledger for the first month's charge.
//
// Fix: skip the booking-time insert for monthly plans. The webhook
// becomes the sole writer for monthly invoice rows. Pay-in-full +
// 50/50 still get the booking-time row because session.payment_intent
// IS set in mode:"payment".
describe("booking.publicRequest invoice ledger writes (Critical 3 regression)", () => {
  // Monthly-capable product: priceCents > 0 + paymentPlans includes monthly.
  // The procedure does THREE producer lookups before reaching the plan
  // branch: (1) slug→id resolution, (2) email/displayName/timezone for
  // the request email, (3) stripeAccountId/chargesEnabled/slug for the
  // checkout-creation gate. Seed all three.
  function seedMonthlyProduct() {
    producerSelectQueue.push([{ id: PRODUCER_ID }]); // (1) slug → id
    productSelectQueue.push([
      {
        id: PRODUCT_ID,
        producerId: PRODUCER_ID,
        name: "Album mix",
        pricingModel: "flat",
        durationMin: 0,
        minLeadHours: 0,
        bufferMinutes: 0,
        depositModel: "flat",
        depositPct: 0,
        currency: "USD",
        priceCents: 100000, // $1000
        paymentPlans: [
          { kind: "full" },
          { kind: "monthly", installments: 4 },
        ],
      },
    ]);
    producerSelectQueue.push([
      // (2) email lookup for request-email — non-fatal if missing, but
      // the call still runs.
      { email: "producer@example.com", displayName: "Studio", timezone: "UTC" },
    ]);
    producerSelectQueue.push([
      // (3) the stripe-fields lookup that gates the plan-aware branch.
      {
        stripeAccountId: "acct_platform",
        stripeChargesEnabled: true,
        slug: PRODUCER_SLUG,
      },
    ]);
  }

  // Track every insert by which table it targeted. The mock above uses
  // a single insertValuesSpy that's table-blind; for THIS regression we
  // need to know how many invoices specifically were inserted, so we
  // re-wire the dbMock with a per-table counter via a vi.spyOn trick.
  //
  // Simpler: count how many times insertValuesSpy was called with a
  // payload that smells like an invoice (has `amountCents`).
  function countInvoiceInserts() {
    return insertValuesSpy.mock.calls.filter((c) => {
      const arg = c[0] as Record<string, unknown> | undefined;
      return Boolean(arg && "amountCents" in arg && "kind" in arg);
    }).length;
  }

  it("monthly plan: NO booking-time invoice row inserted (webhook is sole writer)", async () => {
    seedMonthlyProduct();
    // No paused-project guard hit
    projectSelectQueue.push([]);
    // Empty bookings query for slot-conflict check
    bookingSelectQueue.push([]);

    // calculateCharges + Stripe Customer + buildCheckoutSessionParams
    // are mocked — the procedure calls them but their behavior doesn't
    // affect the invoice-insert assertion. We just need them to return
    // sensible values so the function reaches the invoice-insert branch.
    const planMod = await import("~/server/payments/plan");
    (planMod.calculateCharges as ReturnType<typeof vi.fn>).mockReturnValue([
      25000, 25000, 25000, 25000,
    ]);
    const stripeCustomerMod = await import("~/server/stripe/customer");
    (stripeCustomerMod.getOrCreateStripeCustomer as ReturnType<
      typeof vi.fn
    >).mockResolvedValue("cus_abc");
    const checkoutMod = await import("~/server/payments/checkout");
    (checkoutMod.buildCheckoutSessionParams as ReturnType<
      typeof vi.fn
    >).mockReturnValue({ mode: "subscription" });
    // Override stripe client mock so checkout.sessions.create resolves.
    const stripeClient = await import("~/server/stripe/client");
    (
      stripeClient as unknown as {
        getStripe: ReturnType<typeof vi.fn>;
      }
    ).getStripe = vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: "cs_monthly_test",
            url: "https://stripe.test/cs_monthly_test",
          }),
        },
      },
    }));

    // The plan-driven branch needs `inserted[0]?.id` from clientContacts
    // and `[projectRow]` from projects. Make insertReturningSpy return a
    // plausible chain — the existing default returns the bookings row.
    // We intercept on a per-call basis: 1st call (bookings) → bookingId,
    // 2nd call (clientContacts) → contactId, 3rd call (projects) → projectId.
    const returningChain: Array<Record<string, unknown>[]> = [
      [{ id: "booking-row-1" }],
      [{ id: "client-contact-1" }],
      [{ id: "project-row-1" }],
    ];
    let returningIdx = 0;
    insertReturningSpy.mockReset().mockImplementation(() => {
      const r = returningChain[returningIdx] ?? [{ id: "fallback" }];
      returningIdx += 1;
      return Promise.resolve(r);
    });
    insertValuesSpy.mockReset().mockImplementation(() => ({
      returning: insertReturningSpy,
      onConflictDoUpdate: () => ({ returning: insertReturningSpy }),
    }));

    // Capture warnings — the publicRequest body wraps the checkout
    // path in a try/catch that logs failures to console.warn. We let
    // the test surface those so misconfigured mocks don't silently
    // swallow the path under test.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const caller = await buildCaller();
    await caller.booking.publicRequest({
      slug: PRODUCER_SLUG,
      productId: PRODUCT_ID,
      artistName: "Monthly Client",
      artistEmail: "monthly@example.com",
      paymentPlan: { kind: "monthly", installments: 4 },
    });

    // Sanity: the procedure DID reach the plan-driven branch — that
    // branch always creates a project row, so insertValuesSpy has
    // multiple calls. Without this, a guard above could short-circuit
    // and the invoice-count check would pass vacuously.
    const projectInserts = insertValuesSpy.mock.calls.filter((c) => {
      const arg = c[0] as Record<string, unknown> | undefined;
      return Boolean(arg && "paymentPlanKind" in arg);
    });
    if (projectInserts.length !== 1) {
      // Surface the swallowed checkout-path errors so the test failure
      // points to the misconfigured mock instead of the real bug.
      const checkoutWarn = warnSpy.mock.calls.find((c) =>
        String(c[0]).includes("checkout creation failed"),
      );
      throw new Error(
        `Plan branch not reached. Checkout-path warn: ${JSON.stringify(checkoutWarn)}`,
      );
    }
    expect(projectInserts.length).toBe(1);

    // The ledger should have ZERO invoice rows from booking time —
    // handleInvoicePaid will insert the canonical row when Stripe
    // settles the first month's charge.
    expect(countInvoiceInserts()).toBe(0);

    warnSpy.mockRestore();
  });

  it("split_50_50 plan: still inserts booking-time deposit invoice (control)", async () => {
    seedMonthlyProduct();
    projectSelectQueue.push([]);
    bookingSelectQueue.push([]);

    const planMod = await import("~/server/payments/plan");
    (planMod.calculateCharges as ReturnType<typeof vi.fn>).mockReturnValue([
      50000, 50000,
    ]);
    const stripeCustomerMod = await import("~/server/stripe/customer");
    (stripeCustomerMod.getOrCreateStripeCustomer as ReturnType<
      typeof vi.fn
    >).mockResolvedValue("cus_abc");
    const checkoutMod = await import("~/server/payments/checkout");
    (checkoutMod.buildCheckoutSessionParams as ReturnType<
      typeof vi.fn
    >).mockReturnValue({ mode: "payment" });
    const stripeClient = await import("~/server/stripe/client");
    (
      stripeClient as unknown as {
        getStripe: ReturnType<typeof vi.fn>;
      }
    ).getStripe = vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: "cs_50_50_test",
            url: "https://stripe.test/cs_50_50_test",
          }),
        },
      },
    }));

    const returningChain: Array<Record<string, unknown>[]> = [
      [{ id: "booking-row-2" }],
      [{ id: "client-contact-2" }],
      [{ id: "project-row-2" }],
    ];
    let returningIdx = 0;
    insertReturningSpy.mockReset().mockImplementation(() => {
      const r = returningChain[returningIdx] ?? [{ id: "fallback" }];
      returningIdx += 1;
      return Promise.resolve(r);
    });
    insertValuesSpy.mockReset().mockImplementation(() => ({
      returning: insertReturningSpy,
      onConflictDoUpdate: () => ({ returning: insertReturningSpy }),
    }));

    // Override the product seed to also offer split_50_50.
    productSelectQueue.length = 0;
    productSelectQueue.push([
      {
        id: PRODUCT_ID,
        producerId: PRODUCER_ID,
        name: "Album mix",
        pricingModel: "flat",
        durationMin: 0,
        minLeadHours: 0,
        bufferMinutes: 0,
        depositModel: "flat",
        depositPct: 0,
        currency: "USD",
        priceCents: 100000,
        paymentPlans: [
          { kind: "full" },
          { kind: "split_50_50" },
          { kind: "monthly", installments: 4 },
        ],
      },
    ]);
    // Re-seed producers (seedMonthlyProduct already pushed three;
    // since productSelectQueue was reset we wipe & re-push to keep
    // the FIFO order aligned).
    producerSelectQueue.length = 0;
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    producerSelectQueue.push([
      { email: "producer@example.com", displayName: "Studio", timezone: "UTC" },
    ]);
    producerSelectQueue.push([
      {
        stripeAccountId: "acct_platform",
        stripeChargesEnabled: true,
        slug: PRODUCER_SLUG,
      },
    ]);

    const caller = await buildCaller();
    await caller.booking.publicRequest({
      slug: PRODUCER_SLUG,
      productId: PRODUCT_ID,
      artistName: "Split Client",
      artistEmail: "split@example.com",
      paymentPlan: { kind: "split_50_50" },
    });

    // For split_50_50, mode:"payment" gives us session.payment_intent
    // at checkout.session.completed time, so the booking-time row CAN
    // be patched with the PI by the webhook. Inserting at booking time
    // is correct here.
    expect(countInvoiceInserts()).toBe(1);
  });
});
