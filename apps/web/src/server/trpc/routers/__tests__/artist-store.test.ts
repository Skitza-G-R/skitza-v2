import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Tests for artist.store.{products, product}. Same
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
// Auth-boundary tests pry open the WHERE clauses to verify the gating
// predicate is pinned to the signed-in user's clerkUserId.

type Row = Record<string, unknown>;

const {
  clientContactsMarker,
  productsMarker,
  producersMarker,
  projectsMarker,
  invoicesMarker,
  bookingsMarker,
  contactsSelectQueue,
  productsSelectQueue,
  producersSelectQueue,
  projectsSelectQueue,
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
    royaltyTerms: { __column: "products.royalty_terms" },
    agreementText: { __column: "products.agreement_text" },
    position: { __column: "products.position" },
    active: { __column: "products.active" },
    archivedAt: { __column: "products.archived_at" },
    volumeTiers: { __column: "products.volume_tiers" },
  };
  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    displayName: { __column: "producers.display_name" },
    slug: { __column: "producers.slug" },
  };
  const projectsMarker = { __table: "projects" };
  const invoicesMarker = { __table: "invoices" };
  const bookingsMarker = { __table: "bookings" };

  const shift = <T>(q: T[][]): T[] => q.shift() ?? [];

  // Chain helper mirrors artist-book.test.ts — supports the mixed
  // chain terminals (.where().limit(1) | .where().orderBy() |
  // .where() alone | direct await).
  const chain = (terminal: () => Promise<Row[]>, whereSpy?: (arg: unknown) => void) => {
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
    execute: () => Promise.resolve({ rows: [{ columnCount: 2 }] }),
    select: () => ({
      from: (table: unknown) => {
        if (table === clientContactsMarker) {
          return chain(() => Promise.resolve(shift(contactsSelectQueue)), contactsWhereSpy);
        }
        if (table === productsMarker) {
          return chain(() => Promise.resolve(shift(productsSelectQueue)), productsWhereSpy);
        }
        if (table === producersMarker) {
          return chain(() => Promise.resolve(shift(producersSelectQueue)));
        }
        if (table === projectsMarker) {
          return chain(() => Promise.resolve(shift(projectsSelectQueue)));
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
  };

  return {
    clientContactsMarker,
    productsMarker,
    producersMarker,
    projectsMarker,
    invoicesMarker,
    bookingsMarker,
    contactsSelectQueue,
    productsSelectQueue,
    producersSelectQueue,
    projectsSelectQueue,
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

// Re-import the mocked symbols so auth-boundary tests assert column
// marker identity against the same objects the router references.
import { clientContacts, products } from "@skitza/db";

beforeEach(() => {
  contactsSelectQueue.length = 0;
  productsSelectQueue.length = 0;
  producersSelectQueue.length = 0;
  projectsSelectQueue.length = 0;
  contactsWhereSpy.mockReset();
  productsWhereSpy.mockReset();
  insertValuesSpy.mockReset();
  insertReturningSpy.mockReset().mockResolvedValue([]);
  updateSetSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
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

  // Test 5b — every active, non-archived product remains visible.
  // The Store catalog must not use a payment processor's former
  // capabilities to decide which producer offerings an artist can see.
  it("store.products lists every pricing model without a processor gate", async () => {
    seedValidContact();
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
      {
        id: "hourly-1",
        name: "Hourly Session",
        description: null,
        priceCents: 0,
        currency: "USD",
        durationMin: 60,
        sessionCount: 1,
        kind: "session",
        pricingModel: "hourly",
        paymentPlans: [{ kind: "full" }],
        position: 2,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
      },
      {
        id: "bundle-1",
        name: "Bundle",
        description: null,
        priceCents: 30000,
        currency: "USD",
        durationMin: 0,
        sessionCount: 3,
        kind: "production",
        pricingModel: "bundle",
        paymentPlans: [{ kind: "full" }],
        position: 3,
        producerId: PRODUCER_ID,
        producerName: "Alpha",
        producerSlug: "alpha",
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.artist.store.products({
      producerId: PRODUCER_ID,
    });

    expect(result.products.map((product) => product.pricingModel)).toEqual([
      "flat",
      "per_song",
      "hourly",
      "bundle",
    ]);
    expect(result.products[1]?.volumeTiers).toEqual([
      { minQty: 1, pricePerUnitCents: 20000 },
      { minQty: 5, pricePerUnitCents: 15000 },
    ]);

    // Producer scoping still uses inArray, but pricingModel must not.
    const where = productsWhereSpy.mock.calls[0]?.[0];
    expect(findPredicate(where, "inArray", products.pricingModel)).toBeNull();
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
        royaltyTerms: {
          master: { mode: "percentage", bps: 250 },
          composition: { mode: "agreement" },
        },
        agreementText: "Inline agreement terms",
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
    expect(result.royaltyTerms).toEqual({
      master: { mode: "percentage", bps: 250 },
      composition: { mode: "agreement" },
    });
    expect(result.agreementText).toBe("Inline agreement terms");
  });

  it("returns legacy encoded agreement text and null royalty terms safely", async () => {
    productsSelectQueue.push([
      {
        id: PRODUCT_ID,
        name: "Legacy Mix",
        description: "Legacy tagline\n---\nrevisions: 2\ncontract_text: Legacy inline terms",
        priceCents: 10000,
        currency: "USD",
        durationMin: 60,
        sessionCount: 1,
        kind: "mix",
        pricingModel: "flat",
        paymentPlans: [{ kind: "full" }],
        royaltyTerms: null,
        agreementText: null,
        position: 0,
        producerId: PRODUCER_ID,
        producerName: "Alpha Studio",
        producerSlug: "alpha",
      },
    ]);
    seedValidContact();

    const caller = await buildCaller();
    const result = await caller.artist.store.product({ productId: PRODUCT_ID });

    expect(result.description).toBe("Legacy tagline");
    expect(result.revisions).toBe(2);
    expect(result.royaltyTerms).toBeNull();
    expect(result.agreementText).toBe("Legacy inline terms");
  });

  // Test 8
  it("throws NOT_FOUND when product doesn't exist", async () => {
    productsSelectQueue.push([]); // no product row

    const caller = await buildCaller();
    await expect(caller.artist.store.product({ productId: PRODUCT_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
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
    await expect(caller.artist.store.product({ productId: PRODUCT_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
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
    const clerkPred = findPredicate(where, "eq", clientContacts.clerkUserId);
    const producerPred = findPredicate(where, "eq", clientContacts.producerId);
    expect(clerkPred).not.toBeNull();
    expect(clerkPred?.[1]).toBe("user_alice");
    expect(producerPred).not.toBeNull();
    expect(producerPred?.[1]).toBe(PRODUCER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────
