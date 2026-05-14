import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ───────────────────────────────────────────────────
// Lightweight db mock for `producer.revenueTrend`. The router hits:
//   1. producers (producer-procedure → resolve ctx.producerId)
//   2. producers (defaultCurrency fetch)
//   3. invoices  (single SELECT over the 6-month window)
// We dispatch by table marker + call count. The invoices mock
// returns a canned row set; the router buckets in JS.

const PRODUCER_ID = "producer-uuid-1";

const {
  producersMarker,
  invoicesMarker,
  invoicesMock,
  invoicesWhereSpy,
  defaultCurrencyValue,
  setDefaultCurrency,
  dbMock,
} = vi.hoisted(() => {
  const invoicesMock = vi.fn<() => Promise<Record<string, unknown>[]>>();
  const invoicesWhereSpy = vi.fn<(arg: unknown) => void>();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
    defaultCurrency: { __column: "producers.default_currency" },
  };
  const invoicesMarker = {
    __table: "invoices",
    producerId: { __column: "invoices.producer_id" },
    status: { __column: "invoices.status" },
    amountCents: { __column: "invoices.amount_cents" },
    currency: { __column: "invoices.currency" },
    paidAt: { __column: "invoices.paid_at" },
  };

  // Mutable reference the tests can flip so a single mock module can
  // back both "USD producer" and "EUR producer" scenarios.
  const defaultCurrencyHolder = { value: "USD" };
  const setDefaultCurrency = (c: string) => {
    defaultCurrencyHolder.value = c;
  };

  const chain = (
    terminal: () => Promise<Record<string, unknown>[]>,
    whereSpy?: (arg: unknown) => void,
  ) => {
    let resolved: Promise<Record<string, unknown>[]> | null = null;
    const get = () => {
      resolved ??= terminal();
      return resolved;
    };
    type Link = {
      where: (arg: unknown) => Link;
      orderBy: () => Link;
      limit: () => Promise<Record<string, unknown>[]>;
      innerJoin: () => Link;
      leftJoin: () => Link;
      groupBy: () => Link;
      then: Promise<Record<string, unknown>[]>["then"];
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
      groupBy: () => link,
      get then() {
        const p = get();
        return p.then.bind(p);
      },
    };
    return link;
  };

  const counts = { producers: 0, invoices: 0 };
  const dbMock = {
    select: (cols?: unknown) => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          counts.producers += 1;
          // The producer-procedure middleware selects { id }, so its
          // projection key is `id`. The router's currency lookup
          // selects { defaultCurrency }, so we branch on the caller's
          // requested columns rather than raw call-count ordering —
          // the module caches resolved imports across tests, so
          // call-count gets brittle fast.
          const wantsId =
            cols !== undefined &&
            typeof cols === "object" &&
            cols !== null &&
            "id" in (cols as Record<string, unknown>);
          return {
            where: () => ({
              limit: () =>
                wantsId
                  ? Promise.resolve([{ id: PRODUCER_ID }])
                  : Promise.resolve([
                      { defaultCurrency: defaultCurrencyHolder.value },
                    ]),
            }),
          };
        }
        if (table === invoicesMarker) {
          counts.invoices += 1;
          return chain(() => invoicesMock(), invoicesWhereSpy);
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    // Router only uses select for revenueTrend, but the larger
    // producer module has update() paths; we stub them as no-ops so
    // the module still type-checks at import time.
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    producersMarker,
    invoicesMarker,
    invoicesMock,
    invoicesWhereSpy,
    defaultCurrencyValue: defaultCurrencyHolder,
    setDefaultCurrency,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_producer_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  invoices: invoicesMarker,
  // The producer module imports a lot of sibling tables too — stub
  // opaque markers for each so module evaluation doesn't choke.
  projects: { __table: "projects" },
  bookings: { __table: "bookings" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  projectTracks: { __table: "project_tracks" },
  portfolioTracks: { __table: "portfolio_tracks" },
  clientContacts: { __table: "client_contacts" },
  notifications: { __table: "notifications" },
  stripeCustomers: { __table: "stripe_customers" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  products: { __table: "products" },
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

import { invoices, producers } from "@skitza/db";

function findPredicate(
  where: unknown,
  operator: "eq" | "gte" | "lte",
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
  invoicesMock.mockReset().mockResolvedValue([]);
  invoicesWhereSpy.mockReset();
  setDefaultCurrency("USD");
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_producer_1" });
};

describe("producer.revenueTrend", () => {
  it("returns exactly 6 points, oldest first, zeroed when no invoices paid", async () => {
    const caller = await buildCaller();
    const result = await caller.producer.revenueTrend();

    expect(result.points).toHaveLength(6);
    expect(result.points.every((p) => p.cents === 0)).toBe(true);
    expect(result.currency).toBe("USD");

    // Months strictly increasing (YYYY-MM lexical order matches
    // chronological order for 2000-2099).
    const months = result.points.map((p) => p.month);
    const sorted = [...months].sort();
    expect(months).toEqual(sorted);
  });

  it("aggregates paid invoices into the right month bucket", async () => {
    const now = new Date();
    // Invoice 1: paid this month, 250 USD → current bucket (idx 5).
    // Invoice 2: paid last month, 100 USD → bucket idx 4.
    // Invoice 3: paid 3 months ago, 400 USD → bucket idx 2.
    const thisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15),
    );
    const oneMonthAgo = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
    );
    const threeMonthsAgo = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 15),
    );

    invoicesMock.mockResolvedValueOnce([
      { paidAt: thisMonth, amountCents: 25000, currency: "USD" },
      { paidAt: oneMonthAgo, amountCents: 10000, currency: "USD" },
      { paidAt: threeMonthsAgo, amountCents: 40000, currency: "USD" },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.revenueTrend();

    expect(result.points[5]?.cents).toBe(25000);
    expect(result.points[4]?.cents).toBe(10000);
    expect(result.points[2]?.cents).toBe(40000);
    // Untouched buckets remain zero.
    expect(result.points[0]?.cents).toBe(0);
    expect(result.points[1]?.cents).toBe(0);
    expect(result.points[3]?.cents).toBe(0);
  });

  it("ignores invoices whose currency mismatches the producer default", async () => {
    const now = new Date();
    const thisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10),
    );
    // 100 USD + 500 EUR → only USD counts; producer default is USD.
    invoicesMock.mockResolvedValueOnce([
      { paidAt: thisMonth, amountCents: 10000, currency: "USD" },
      { paidAt: thisMonth, amountCents: 50000, currency: "EUR" },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.revenueTrend();

    expect(result.points[5]?.cents).toBe(10000);
    expect(result.currency).toBe("USD");
  });

  it("honors the producer's non-USD default currency", async () => {
    setDefaultCurrency("EUR");
    const now = new Date();
    const thisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10),
    );
    invoicesMock.mockResolvedValueOnce([
      { paidAt: thisMonth, amountCents: 10000, currency: "USD" },
      { paidAt: thisMonth, amountCents: 50000, currency: "EUR" },
    ]);

    const caller = await buildCaller();
    const result = await caller.producer.revenueTrend();

    expect(result.currency).toBe("EUR");
    expect(result.points[5]?.cents).toBe(50000);
  });

  it("scopes the SELECT to ctx.producerId + status=paid (auth boundary)", async () => {
    const caller = await buildCaller();
    await caller.producer.revenueTrend();

    // Walk every recorded WHERE call. The router also does a
    // producers lookup for defaultCurrency, which routes through the
    // same chain mock — but that one doesn't pass through the
    // invoicesWhereSpy, so only the invoice predicate tree lands here.
    const whereCalls = invoicesWhereSpy.mock.calls.map((c) => c[0]);
    expect(whereCalls.length).toBeGreaterThan(0);
    const where = whereCalls[0];

    // producer_id = PRODUCER_ID
    const pidPred = findPredicate(where, "eq", invoices.producerId);
    expect(pidPred).not.toBeNull();
    if (Array.isArray(pidPred)) {
      expect(pidPred[1]).toBe(PRODUCER_ID);
    }
    // status = "paid"
    const statusPred = findPredicate(where, "eq", invoices.status);
    expect(statusPred).not.toBeNull();
    if (Array.isArray(statusPred)) {
      expect(statusPred[1]).toBe("paid");
    }

    // Touch producers import so the type-checker doesn't prune it.
    expect(producers).toBeDefined();
    // Touch holder so setDefaultCurrency default path is exercised too.
    expect(defaultCurrencyValue.value).toBe("USD");
  });
});
