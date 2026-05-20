import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Tests for artist.store.{products, product, checkout}. Same
// FIFO-queue-per-table pattern as the other artist router tests. The
// store sub-router fans out:
//
// store.products
//   1. clientContacts  — scope by clerkUserId (producerId filter optional)
//   2. products ⨝ producers — rows for one or many producers
//
// store.product
//   1. products ⨝ producers — the single row by productId
//   2. clientContacts  — ownership check (clerkUserId + producerId)
//
// store.checkout
//   1. products        — load + verify active + non-archived
//   2. clientContacts  — (clerkUserId, producerId) ownership + customer data
//   3. producers       — stripeAccountId + stripeChargesEnabled + slug
//   4. INSERT projects — plan-state row (lead stage)
//   5. INSERT invoices — pending row (skipped for monthly)
//
// Auth-boundary tests pry open the WHERE clauses to verify the gating
// predicate is pinned to the signed-in user's clerkUserId. Checkout
// relies on the shared initiatePaidPlanCheckout helper (Task 11 step
// 11.3) — calls into the mocked Stripe client + customer resolver.

type Row = Record<string, unknown>;

const {
  clientContactsMarker,
  productsMarker,
  producersMarker,
  projectsMarker,
  invoicesMarker,
  bookingsMarker,
  stripeCustomersMarker,
  storePurchaseIntentsMarker,
  contactsSelectQueue,
  productsSelectQueue,
  producersSelectQueue,
  projectsSelectQueue,
  intentsSelectQueue,
  contactsWhereSpy,
  productsWhereSpy,
  insertValuesSpy,
  insertReturningSpy,
  updateSetSpy,
  dbMock,
} = vi.hoisted(() => {
  type Queue = Row[][];
  const contactsSelectQueue: Queue = [];
  const productsSelectQueue: Queue = [];
  const producersSelectQueue: Queue = [];
  const projectsSelectQueue: Queue = [];
  const intentsSelectQueue: Queue = [];

  const contactsWhereSpy = vi.fn<(arg: unknown) => void>();
  const productsWhereSpy = vi.fn<(arg: unknown) => void>();
  const insertValuesSpy = vi.fn<(payload: Row) => unknown>();
  const insertReturningSpy = vi.fn<() => Promise<Row[]>>();
  const updateSetSpy = vi.fn<(payload: Row) => unknown>();

  const clientContactsMarker = {
    __table: "client_contacts",
    id: { __column: "client_contacts.id" },
    clerkUserId: { __column: "client_contacts.clerk_user_id" },
    producerId: { __column: "client_contacts.producer_id" },
    email: { __column: "client_contacts.email" },
    name: { __column: "client_contacts.name" },
    archivedAt: { __column: "client_contacts.archived_at" },
  };
  const productsMarker = {
    __table: "products",
    id: { __column: "products.id" },
    producerId: { __column: "products.producer_id" },
    name: { __column: "products.name" },
    description: { __column: "products.description" },
    priceCents: { __column: "products.price_cents" },
    currency: { __column: "products.currency" },
    durationMin: { __column: "products.duration_min" },
    sessionCount: { __column: "products.session_count" },
    kind: { __column: "products.kind" },
    pricingModel: { __column: "products.pricing_model" },
    paymentPlans: { __column: "products.payment_plans" },
    position: { __column: "products.position" },
    active: { __column: "products.active" },
    archivedAt: { __column: "products.archived_at" },
    volumeTiers: { __column: "products.volume_tiers" },
    hourlyRateCents: { __column: "products.hourly_rate_cents" },
  };
  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    displayName: { __column: "producers.display_name" },
    slug: { __column: "producers.slug" },
    stripeAccountId: { __column: "producers.stripe_account_id" },
    stripeChargesEnabled: { __column: "producers.stripe_charges_enabled" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    artistEmail: { __column: "projects.artist_email" },
    totalAmountCents: { __column: "projects.total_amount_cents" },
    createdAt: { __column: "projects.created_at" },
  };
  const invoicesMarker = { __table: "invoices" };
  const bookingsMarker = { __table: "bookings" };
  const stripeCustomersMarker = { __table: "stripe_customers" };
  const storePurchaseIntentsMarker = {
    __table: "store_purchase_intents",
    id: { __column: "store_purchase_intents.id" },
    consumedAt: { __column: "store_purchase_intents.consumed_at" },
  };

  const shift = <T,>(q: T[][]): T[] => q.shift() ?? [];

  // Chain helper mirrors artist-book.test.ts — supports the mixed
  // chain terminals (.where().limit(1) | .where().orderBy() |
  // .where() alone | direct await).
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
        if (table === productsMarker) {
          return chain(
            () => Promise.resolve(shift(productsSelectQueue)),
            productsWhereSpy,
          );
        }
        if (table === producersMarker) {
          return chain(() => Promise.resolve(shift(producersSelectQueue)));
        }
        if (table === projectsMarker) {
          return chain(() => Promise.resolve(shift(projectsSelectQueue)));
        }
        if (table === storePurchaseIntentsMarker) {
          return chain(() => Promise.resolve(shift(intentsSelectQueue)));
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    insert: () => ({
      values: (payload: Row) => {
        insertValuesSpy(payload);
        return {
          returning: () => insertReturningSpy(),
          onConflictDoUpdate: () => ({
            returning: () => insertReturningSpy(),
          }),
          onConflictDoNothing: () => ({
            returning: () => insertReturningSpy(),
          }),
        };
      },
    }),
    update: () => ({
      set: (payload: Row) => {
        updateSetSpy(payload);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    // store.confirmAfterPayment wraps project-insert + intent-update in
    // a transaction. The tx callback gets a handle with the same shape
    // as the outer db; for tests we just hand the same dbMock back.
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(dbMock),
  };

  return {
    clientContactsMarker,
    productsMarker,
    producersMarker,
    projectsMarker,
    invoicesMarker,
    bookingsMarker,
    stripeCustomersMarker,
    storePurchaseIntentsMarker,
    contactsSelectQueue,
    productsSelectQueue,
    producersSelectQueue,
    projectsSelectQueue,
    intentsSelectQueue,
    contactsWhereSpy,
    productsWhereSpy,
    insertValuesSpy,
    insertReturningSpy,
    updateSetSpy,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_artist_1" }),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: () => "127.0.0.1",
    }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  clientContacts: clientContactsMarker,
  products: productsMarker,
  producers: producersMarker,
  projects: projectsMarker,
  invoices: invoicesMarker,
  bookings: bookingsMarker,
  stripeCustomers: stripeCustomersMarker,
  storePurchaseIntents: storePurchaseIntentsMarker,
  // Other tables the broader router modules import — opaque markers.
  projectTracks: { __table: "project_tracks" },
  trackVersions: { __table: "track_versions" },
  trackComments: { __table: "track_comments" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  notifications: { __table: "notifications" },
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

// Side-effect imports inside the broader router module / shared
// helpers — mock to no-ops so tests are focused.
vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitBookingRequested: vi.fn() }));
vi.mock("~/server/email/send", () => ({
  sendBookingConfirmedEmail: vi.fn(),
  sendBookingRequestEmail: vi.fn(),
}));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));

// Stripe helpers — mocked so checkout tests can drive them without
// hitting Stripe.
vi.mock("~/server/payments/checkout", () => ({
  buildCheckoutSessionParams: vi.fn(() => ({ mode: "payment" })),
}));
vi.mock("~/server/payments/plan", async () => {
  const actual = await vi.importActual<
    typeof import("~/server/payments/plan")
  >("~/server/payments/plan");
  return {
    ...actual,
    calculateCharges: vi.fn(actual.calculateCharges),
  };
});
const stripeSessionCreateMock = vi.fn(async () =>
  Promise.resolve({
    id: "cs_test_123",
    url: "https://stripe.test/cs_test_123",
  }),
);
vi.mock("~/server/stripe/client", () => ({
  getSiteUrl: () => "https://skitza.test",
  getStripe: () => ({
    checkout: { sessions: { create: stripeSessionCreateMock } },
  }),
}));
vi.mock("~/server/stripe/customer", () => ({
  getOrCreateStripeCustomer: vi.fn(async () => Promise.resolve("cus_test")),
}));

// Re-import the mocked symbols so auth-boundary tests assert column
// marker identity against the same objects the router references.
import { clientContacts, products } from "@skitza/db";

beforeEach(() => {
  contactsSelectQueue.length = 0;
  productsSelectQueue.length = 0;
  producersSelectQueue.length = 0;
  projectsSelectQueue.length = 0;
  intentsSelectQueue.length = 0;
  contactsWhereSpy.mockReset();
  productsWhereSpy.mockReset();
  insertValuesSpy.mockReset();
  insertReturningSpy.mockReset().mockResolvedValue([]);
  updateSetSpy.mockReset();
  stripeSessionCreateMock.mockClear();
  process.env.DATABASE_URL = "postgresql://test/test";
  // SK-18 — store flow now redirects to Tranzila. The URL builder
  // requires a terminal name; seed a deterministic value so tests can
  // assert the resulting URL shape without hitting the env fallback.
  process.env.TRANZILA_TERMINAL_NAME = "skitza_master";
  process.env.NEXT_PUBLIC_SITE_URL = "https://skitza.test";
});

const buildCaller = async (userId: string | null = "user_test_artist_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

const PRODUCER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_PRODUCER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PRODUCT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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
describe("artist.store.products (query)", () => {
  // Test 1
  it("returns [] when artist has no studios", async () => {
    contactsSelectQueue.push([]); // no studios

    const caller = await buildCaller();
    const result = await caller.artist.store.products({});

    expect(result).toEqual({ products: [] });
  });

  // Test 2
  it("returns products across all studios when producerId undefined", async () => {
    // Two studios.
    contactsSelectQueue.push([
      {
        id: "c1",
        producerId: PRODUCER_ID,
        email: "dan@x.com",
        clerkUserId: "user_test_artist_1",
      },
      {
        id: "c2",
        producerId: OTHER_PRODUCER_ID,
        email: "dan@x.com",
        clerkUserId: "user_test_artist_1",
      },
    ]);
    // Mixed products from both studios.
    productsSelectQueue.push([
      {
        id: "prod-a",
        name: "Mix",
        description: "A mix",
        priceCents: 10000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 1,
        producerId: PRODUCER_ID,
        producerName: "Alpha Studio",
        producerSlug: "alpha",
      },
      {
        id: "prod-b",
        name: "Master",
        description: null,
        priceCents: 20000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "master",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: OTHER_PRODUCER_ID,
        producerName: "Bravo Studio",
        producerSlug: "bravo",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.store.products({});

    expect(result.products).toHaveLength(2);
    // Sort order: producerName asc, then position asc.
    expect(result.products[0]?.id).toBe("prod-a"); // Alpha
    expect(result.products[1]?.id).toBe("prod-b"); // Bravo
    expect(result.products[0]?.producerName).toBe("Alpha Studio");
    expect(result.products[0]?.producerSlug).toBe("alpha");
    expect(result.products[1]?.producerName).toBe("Bravo Studio");
  });

  // Test 3
  it("filters to one studio when producerId provided", async () => {
    seedValidContact(); // the producer the artist is asking about
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Mix",
        description: "A mix",
        priceCents: 10000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha Studio",
        producerSlug: "alpha",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.store.products({
      producerId: PRODUCER_ID,
    });

    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.producerId).toBe(PRODUCER_ID);
  });

  // Test 4
  it("throws NOT_FOUND when producerId isn't one of artist's studios", async () => {
    contactsSelectQueue.push([]); // no contact for OTHER_PRODUCER_ID

    const caller = await buildCaller();
    await expect(
      caller.artist.store.products({ producerId: OTHER_PRODUCER_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Test 5
  it("excludes archived and inactive products via WHERE clause", async () => {
    seedValidContact();
    // Router SHOULD filter these out at the DB layer.
    productsSelectQueue.push([
      {
        id: "active",
        name: "Active Mix",
        description: null,
        priceCents: 10000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
      },
    ]);

    const caller = await buildCaller();
    await caller.artist.store.products({ producerId: PRODUCER_ID });

    // Assert the WHERE clause references archivedAt (isNull) + active (eq true).
    const where = productsWhereSpy.mock.calls[0]?.[0];
    // active=true predicate
    const activePred = findPredicate(where, "eq", products.active);
    expect(activePred).not.toBeNull();
    expect(activePred?.[1]).toBe(true);
    // archivedAt IS NULL predicate — walk the and(...) and look for
    // an isNull entry pointing at products.archivedAt.
    const hasIsNullArchived = JSON.stringify(where).includes(
      '"isNull":{"__column":"products.archived_at"}',
    );
    expect(hasIsNullArchived).toBe(true);
  });

  // Test 5b — Store catalog visibility rule. Flat AND per_song
  // products list (per_song landed with the per-song-pricing feature
  // 2026-05-16 — the rate-card products go through a song-count
  // stepper in the detail page before the booking action). hourly /
  // bundle stay hidden until their flows ship. store.checkout
  // enforces the same gate server-side so a hand-crafted productId
  // can't bypass the flat-only Stripe self-checkout path.
  it("store.products lists flat + per_song, hides hourly + bundle", async () => {
    seedValidContact();
    // The DB-layer filter returns flat + per_song; reflect that in
    // the seeded response. The assertion below checks the WHERE
    // predicate so a regression that removes the gate but happens
    // to match tight fixtures still fails.
    productsSelectQueue.push([
      {
        id: "flat-1",
        name: "Flat Mix",
        description: null,
        priceCents: 10000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
      },
      {
        id: "per-song-1",
        name: "Per-song Mix",
        description: null,
        priceCents: 20000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 20000 },
          { minQty: 5, pricePerUnitCents: 15000 },
        ],
        paymentPlans: [{ kind: "full" }],
        position: 1,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.store.products({
      producerId: PRODUCER_ID,
    });

    // Both rows came through.
    expect(result.products).toHaveLength(2);
    expect(result.products[0]?.pricingModel).toBe("flat");
    expect(result.products[1]?.pricingModel).toBe("per_song");
    expect(result.products[1]?.volumeTiers).toEqual([
      { minQty: 1, pricePerUnitCents: 20000 },
      { minQty: 5, pricePerUnitCents: 15000 },
    ]);

    // WHERE predicate uses inArray over the allowed set so hourly +
    // bundle stay hidden. Walk the and(...) tree and look for an
    // inArray entry pointing at products.pricing_model.
    const where = productsWhereSpy.mock.calls[0]?.[0];
    const whereJson = JSON.stringify(where);
    expect(whereJson).toContain('"inArray":');
    expect(whereJson).toContain('"products.pricing_model"');
    expect(whereJson).toContain('"flat"');
    expect(whereJson).toContain('"per_song"');
    // Defensive: confirm the excluded models are not present.
    expect(whereJson).not.toContain('"hourly"');
    expect(whereJson).not.toContain('"bundle"');
  });

  // Test 6
  it("scopes by clerkUserId in the gating contacts SELECT (auth boundary)", async () => {
    contactsSelectQueue.push([
      {
        id: "c1",
        producerId: PRODUCER_ID,
        email: "dan@x.com",
        clerkUserId: "user_alice",
      },
    ]);
    productsSelectQueue.push([]);

    const caller = await buildCaller("user_alice");
    await caller.artist.store.products({});

    const contactsArg = contactsWhereSpy.mock.calls[0]?.[0];
    expect(contactsArg).toEqual({
      and: [
        { eq: [clientContacts.clerkUserId, "user_alice"] },
        { isNull: clientContacts.archivedAt },
      ],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("artist.store.product (query)", () => {
  // Test 7
  it("returns product detail", async () => {
    // Product + producer joined
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Album Mix",
        description: "Premium",
        priceCents: 500000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [
          { kind: "full" },
          { kind: "split_50_50" },
          { kind: "monthly", installments: 4 },
        ],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha Studio",
        producerSlug: "alpha",
      },
    ]);
    // Ownership check — artist has a clientContacts row for this producer.
    seedValidContact();

    const caller = await buildCaller();
    const result = await caller.artist.store.product({ productId: PRODUCT_ID });

    expect(result.id).toBe(PRODUCT_ID);
    expect(result.name).toBe("Album Mix");
    expect(result.priceCents).toBe(500000);
    expect(result.producerId).toBe(PRODUCER_ID);
    expect(result.producerName).toBe("Alpha Studio");
    expect(result.paymentPlans).toHaveLength(3);
  });

  // Test 8
  it("throws NOT_FOUND when product doesn't exist", async () => {
    productsSelectQueue.push([]); // no product row

    const caller = await buildCaller();
    await expect(
      caller.artist.store.product({ productId: PRODUCT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Test 9
  it("throws NOT_FOUND when artist doesn't have clientContacts for product's producer", async () => {
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Foreign Mix",
        description: null,
        priceCents: 10000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: OTHER_PRODUCER_ID,
        producerName: "Bravo",
        producerSlug: "bravo",
      },
    ]);
    // No clientContacts row → NOT_FOUND on ownership check.
    contactsSelectQueue.push([]);

    const caller = await buildCaller();
    await expect(
      caller.artist.store.product({ productId: PRODUCT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Test 10
  it("scopes ownership check by clerkUserId + producerId (auth boundary)", async () => {
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Mix",
        description: null,
        priceCents: 10000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
      },
    ]);
    contactsSelectQueue.push([
      {
        id: "c1",
        producerId: PRODUCER_ID,
        email: "dan@x.com",
        clerkUserId: "user_alice",
      },
    ]);

    const caller = await buildCaller("user_alice");
    await caller.artist.store.product({ productId: PRODUCT_ID });

    // Second contacts SELECT is the ownership check. Ensure it scopes
    // by both clerkUserId AND producerId.
    const where = contactsWhereSpy.mock.calls[0]?.[0];
    const clerkPred = findPredicate(
      where,
      "eq",
      clientContacts.clerkUserId,
    );
    const producerPred = findPredicate(
      where,
      "eq",
      clientContacts.producerId,
    );
    expect(clerkPred).not.toBeNull();
    expect(clerkPred?.[1]).toBe("user_alice");
    expect(producerPred).not.toBeNull();
    expect(producerPred?.[1]).toBe(PRODUCER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("artist.store.checkout (mutation)", () => {
  // Seeds a product + contact + producer with Stripe enabled.
  function seedCheckoutReady(opts?: { paymentPlans?: unknown }) {
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Mix",
        description: null,
        priceCents: 100000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: opts?.paymentPlans ?? [
          { kind: "full" },
          { kind: "split_50_50" },
          { kind: "monthly", installments: 4 },
        ],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
        active: true,
        archivedAt: null,
        depositPct: 0,
      },
    ]);
    seedValidContact();
    // SK-18 — store flow no longer reads stripe fields off producers;
    // it pulls slug + tranzilaTerminalName instead. Null terminal means
    // the URL builder falls back to TRANZILA_TERMINAL_NAME from env.
    producersSelectQueue.push([
      {
        slug: "alpha",
        tranzilaTerminalName: null,
      },
    ]);
    // The router INSERTs a store_purchase_intents row at checkout
    // (project is materialized later by store.confirmAfterPayment).
    insertReturningSpy.mockImplementation(() =>
      Promise.resolve([{ id: "intent-new-1" }]),
    );
  }

  // Test 11
  it("throws NOT_FOUND when product doesn't exist", async () => {
    productsSelectQueue.push([]); // no product

    const caller = await buildCaller();
    await expect(
      caller.artist.store.checkout({
        productId: PRODUCT_ID,
        paymentPlan: { kind: "full" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Test 11b
  it("throws NOT_FOUND when artist isn't linked to product's producer", async () => {
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Foreign Mix",
        description: null,
        priceCents: 100000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: OTHER_PRODUCER_ID,
        producerName: "Bravo",
        producerSlug: "bravo",
        active: true,
        archivedAt: null,
        depositPct: 0,
      },
    ]);
    contactsSelectQueue.push([]); // not my studio

    const caller = await buildCaller();
    await expect(
      caller.artist.store.checkout({
        productId: PRODUCT_ID,
        paymentPlan: { kind: "full" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Test 13 (SK-18) — happy path now redirects to Tranzila, not Stripe.
  // No payment-provider gate on the producer row (the Stripe-era
  // "not connected" guard is gone), and the mutation returns a URL on
  // direct.tranzila.com instead of a Stripe Checkout session URL.
  it("happy path: inserts intent + returns Tranzila redirect URL", async () => {
    seedCheckoutReady();

    const caller = await buildCaller();
    const result = await caller.artist.store.checkout({
      productId: PRODUCT_ID,
      paymentPlan: { kind: "full" },
    });

    expect(result.checkoutUrl).toMatch(
      /^https:\/\/direct\.tranzila\.com\/skitza_master\/iframenew\.php\?/,
    );
    expect(result.intentId).toBe("intent-new-1");
    expect(stripeSessionCreateMock).not.toHaveBeenCalled();

    // pdesc carries the intent id so the notify_url callback can look
    // it up + materialize the project.
    expect(result.checkoutUrl).toContain("pdesc=intent-new-1");
    // notify_url points at the store-callback route, not the booking one.
    expect(result.checkoutUrl).toContain(
      encodeURIComponent("/api/tranzila/store-callback").replace(/%2F/g, "%2F"),
    );

    // No project row inserted at checkout time — only the intent.
    // The intent insert lacks `stage` (a project-only column), so a
    // search for `stage` in any insert payload must come up empty.
    const projectInsert = insertValuesSpy.mock.calls.find(
      (c) => "stage" in c[0],
    );
    expect(projectInsert).toBeUndefined();
  });

  // Test 13b (SK-18) — intent insert carries the materialization
  // payload: amountCents, sessionCount, payment plan snapshot, per-song
  // fields, package name. The callback later copies these onto the
  // minted project row.
  it("inserts intent with full materialization payload", async () => {
    seedCheckoutReady();

    const caller = await buildCaller();
    await caller.artist.store.checkout({
      productId: PRODUCT_ID,
      paymentPlan: { kind: "split_50_50" },
    });

    const intentInsert = insertValuesSpy.mock.calls.find(
      (c) => "packageNameSnapshot" in c[0],
    );
    expect(intentInsert).toBeDefined();
    const payload = intentInsert?.[0] as Row;
    expect(payload.amountCents).toBe(100000);
    expect(payload.currency).toBe("USD");
    expect(payload.sessionCount).toBe(1);
    expect(payload.paymentPlanKind).toBe("split_50_50");
    expect(payload.packageNameSnapshot).toBe("Mix");
    expect(payload.songQty).toBe(null);
    expect(payload.unitPriceCents).toBe(null);
  });

  // Test 14 (SK-18) — auth boundary still holds against the post-Stripe
  // mutation: the contacts SELECT scopes by clerkUserId + producerId.
  it("scopes ownership check by clerkUserId + producerId (auth boundary)", async () => {
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Mix",
        description: null,
        priceCents: 100000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
        active: true,
        archivedAt: null,
        depositPct: 0,
      },
    ]);
    contactsSelectQueue.push([
      {
        id: "c1",
        producerId: PRODUCER_ID,
        email: "dan@x.com",
        name: "Dan",
        clerkUserId: "user_bob",
      },
    ]);
    producersSelectQueue.push([
      {
        slug: "alpha",
        tranzilaTerminalName: null,
      },
    ]);
    insertReturningSpy.mockImplementation(() =>
      Promise.resolve([{ id: "intent-new-1" }]),
    );

    const caller = await buildCaller("user_bob");
    await caller.artist.store.checkout({
      productId: PRODUCT_ID,
      paymentPlan: { kind: "full" },
    });

    // The ownership-check contacts SELECT must scope by clerkUserId=user_bob
    // and producerId=PRODUCER_ID (the product's producer).
    const where = contactsWhereSpy.mock.calls[0]?.[0];
    const clerkPred = findPredicate(where, "eq", clientContacts.clerkUserId);
    const producerPred = findPredicate(where, "eq", clientContacts.producerId);
    expect(clerkPred?.[1]).toBe("user_bob");
    expect(producerPred?.[1]).toBe(PRODUCER_ID);
  });

  // Test 15 — defense-in-depth at the mutation layer.
  // Store list filters to flat + per_song at the DB. A hand-crafted
  // productId URL (or a client skipping the list) could still hit
  // this mutation for hourly/bundle products. We reject those with
  // BAD_REQUEST *before* calling into calculateCharges — the shared
  // helper would otherwise throw "totalCents must be a positive
  // integer" since hourly/bundle products have priceCents=0.
  // Per-song products are valid here when songQty + unitPriceCents
  // are provided (Test 15c covers the happy path).
  it("store.checkout rejects hourly + bundle pricing with BAD_REQUEST", async () => {
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Hourly Session",
        description: null,
        priceCents: 0,
        currency: "USD",
        durationMin: 60,
        sessionCount: 1,
        kind: "session",
        pricingModel: "hourly",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
        active: true,
        archivedAt: null,
        depositPct: 0,
        hourlyRateCents: 10000,
      },
    ]);
    // Ownership check passes — the artist *is* linked to this producer.
    seedValidContact();

    const caller = await buildCaller();
    await expect(
      caller.artist.store.checkout({
        productId: PRODUCT_ID,
        paymentPlan: { kind: "full" },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("self-checkout") as unknown,
    });
    // No Stripe session minted — we short-circuited before the helper.
    expect(stripeSessionCreateMock).not.toHaveBeenCalled();
  });

  // Test 15c — per-song happy path. Artist picked 5 songs at $150
  // each on the stepper; the mutation computes the locked-in total
  // (75000 cents) and passes it to the shared helper, which in turn
  // inserts a project row with the right total and mints a Stripe
  // Checkout session.
  it("store.checkout accepts per_song with songQty + unitPriceCents and uses the locked-in total", async () => {
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Per-song Mix",
        description: null,
        priceCents: 20000, // mirrors the base tier
        currency: "USD",
        durationMin: 0,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "per_song",
        paymentPlans: [{ kind: "full" }],
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
        active: true,
        archivedAt: null,
        depositPct: 0,
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 20000 },
          { minQty: 5, pricePerUnitCents: 15000 },
        ],
      },
    ]);
    seedValidContact();
    producersSelectQueue.push([
      {
        slug: "alpha",
        tranzilaTerminalName: null,
      },
    ]);
    insertReturningSpy.mockImplementation(() =>
      Promise.resolve([{ id: "intent-new-1" }]),
    );

    const caller = await buildCaller();
    const result = await caller.artist.store.checkout({
      productId: PRODUCT_ID,
      paymentPlan: { kind: "full" },
      songQty: 5,
      unitPriceCents: 15000,
    });

    // SK-18 — Tranzila URL, not Stripe. The amount embedded in the URL
    // is the locked-in per-song total (75000 cents = $750.00).
    expect(result.checkoutUrl).toMatch(
      /^https:\/\/direct\.tranzila\.com\/skitza_master\/iframenew\.php\?/,
    );
    expect(result.checkoutUrl).toContain("sum=750.00");
    expect(stripeSessionCreateMock).not.toHaveBeenCalled();

    // The intent row carries amountCents = 75000 (= songQty ×
    // unitPriceCents), not the product's base priceCents (20000), plus
    // the per-song fields so the callback can copy them onto the
    // minted project row.
    const intentInsert = insertValuesSpy.mock.calls.find(
      (c) => "amountCents" in c[0],
    );
    expect(intentInsert).toBeDefined();
    const payload = intentInsert?.[0] as Row;
    expect(payload.amountCents).toBe(75000);
    expect(payload.songQty).toBe(5);
    expect(payload.unitPriceCents).toBe(15000);
    // computeProjectSessionCount(per_song, 5) = 1 × 5 = 5
    expect(payload.sessionCount).toBe(5);
  });

  // Test 16 (SK-18) — abandoned checkout: store.checkout inserts the
  // intent row, no project row is created. The producer's CRM never
  // sees an orphan lead because the project only exists after the
  // callback materializes it.
  it("abandoned checkout inserts intent only, never a project", async () => {
    seedCheckoutReady();

    const caller = await buildCaller();
    await caller.artist.store.checkout({
      productId: PRODUCT_ID,
      paymentPlan: { kind: "full" },
    });

    // Exactly one insert — the intent — and it carries the materialization
    // payload shape, not a project shape (no `stage`, `depositPaid`).
    expect(insertValuesSpy.mock.calls.length).toBe(1);
    const payload = insertValuesSpy.mock.calls[0]?.[0] as Row;
    expect(payload).toHaveProperty("packageNameSnapshot");
    expect(payload).not.toHaveProperty("stage");
    expect(payload).not.toHaveProperty("depositPaid");
  });

  // Test 17 (SK-18) — idempotency: a redelivered Tranzila notify_url
  // POST should NOT materialize a second project. The intent's
  // consumed_at gate is what makes this safe; on re-fire we look up
  // the existing project and return its id without writing again.
  it("confirmAfterPayment is idempotent when intent.consumedAt is set", async () => {
    // First call: intent is unconsumed → materialize project.
    intentsSelectQueue.push([
      {
        id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        producerId: PRODUCER_ID,
        productId: PRODUCT_ID,
        artistUserId: "user_test_artist_1",
        artistEmail: "dan@x.com",
        artistName: "Dan The Artist",
        songQty: null,
        unitPriceCents: null,
        amountCents: 100000,
        currency: "USD",
        paymentPlanKind: "full",
        packageNameSnapshot: "Mix",
        sessionCount: 1,
        createdAt: new Date(),
        consumedAt: null,
      },
    ]);
    // Producer email lookup after the transaction.
    producersSelectQueue.push([
      {
        email: "alpha@studios.com",
        displayName: "Alpha Studios",
        defaultCurrency: "USD",
      },
    ]);
    insertReturningSpy.mockResolvedValueOnce([{ id: "project-mat-1" }]);

    const caller = await buildCaller();
    const first = await caller.artist.store.confirmAfterPayment({
      intentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    });
    expect(first.projectId).toBe("project-mat-1");

    const insertsAfterFirst = insertValuesSpy.mock.calls.length;
    // The first call should have inserted exactly one project row.
    expect(insertsAfterFirst).toBe(1);

    // Second call: intent is now consumed → return the existing
    // project id without re-inserting.
    intentsSelectQueue.push([
      {
        id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        producerId: PRODUCER_ID,
        productId: PRODUCT_ID,
        artistUserId: "user_test_artist_1",
        artistEmail: "dan@x.com",
        artistName: "Dan The Artist",
        songQty: null,
        unitPriceCents: null,
        amountCents: 100000,
        currency: "USD",
        paymentPlanKind: "full",
        packageNameSnapshot: "Mix",
        sessionCount: 1,
        createdAt: new Date(),
        consumedAt: new Date(),
      },
    ]);
    // The consumed-branch lookup: return the previously-materialized
    // project so the procedure can echo its id back.
    projectsSelectQueue.push([{ id: "project-mat-1" }]);

    const second = await caller.artist.store.confirmAfterPayment({
      intentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    });
    expect(second.projectId).toBe("project-mat-1");

    // CRITICAL: no second project insert. The total insert count is
    // still the count from the first call.
    expect(insertValuesSpy.mock.calls.length).toBe(insertsAfterFirst);
  });
});

