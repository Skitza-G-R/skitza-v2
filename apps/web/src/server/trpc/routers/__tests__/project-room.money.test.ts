import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// projectRoom.money returns the existing money-tab payload — paid +
// outstanding totals, invoices list, contract summary, and (for
// split-50/50 / future-charge plans) any saved Stripe payment method
// that's relevant to this project.
//
// The base scope mirrors today's project.money procedure but expands
// to include the invoices + contractSummary subtrees so the Money
// sub-tab can render without a second roundtrip.

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";

const {
  projectsMarker,
  producersMarker,
  invoicesMarker,
  contractsMarker,
  producerSelectQueue,
  projectSelectQueue,
  invoicesMock,
  contractsMock,
  projectsWhereSpy,
  invoicesWhereSpy,
  contractsWhereSpy,
  dbMock,
} = vi.hoisted(() => {
  const projectsMarker: Record<string, unknown> = { __table: "projects" };
  projectsMarker.id = { __column: "projects.id" };
  projectsMarker.producerId = { __column: "projects.producer_id" };

  const producersMarker = { __table: "producers" };
  const invoicesMarker: Record<string, unknown> = { __table: "invoices" };
  invoicesMarker.projectId = { __column: "invoices.project_id" };
  invoicesMarker.producerId = { __column: "invoices.producer_id" };

  const contractsMarker: Record<string, unknown> = { __table: "contracts" };
  contractsMarker.projectId = { __column: "contracts.project_id" };
  contractsMarker.producerId = { __column: "contracts.producer_id" };

  type Row = Record<string, unknown>;
  const producerSelectQueue: Row[][] = [];
  const projectSelectQueue: Row[][] = [];
  const invoicesMock = vi.fn<() => Promise<Row[]>>();
  const contractsMock = vi.fn<() => Promise<Row[]>>();
  const projectsWhereSpy = vi.fn<(arg: unknown) => void>();
  const invoicesWhereSpy = vi.fn<(arg: unknown) => void>();
  const contractsWhereSpy = vi.fn<(arg: unknown) => void>();

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
      get then() {
        const p = get();
        return p.then.bind(p);
      },
    };
    return link;
  };

  function shift<T>(q: T[][]): T[] {
    return q.shift() ?? [];
  }

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve(shift(producerSelectQueue)),
            }),
          };
        }
        if (table === projectsMarker) {
          return {
            where: (arg: unknown) => {
              projectsWhereSpy(arg);
              return {
                limit: () => Promise.resolve(shift(projectSelectQueue)),
              };
            },
          };
        }
        if (table === invoicesMarker) {
          return chain(() => invoicesMock(), invoicesWhereSpy);
        }
        if (table === contractsMarker) {
          return chain(() => contractsMock(), contractsWhereSpy);
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
  };

  return {
    projectsMarker,
    producersMarker,
    invoicesMarker,
    contractsMarker,
    producerSelectQueue,
    projectSelectQueue,
    invoicesMock,
    contractsMock,
    projectsWhereSpy,
    invoicesWhereSpy,
    contractsWhereSpy,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  invoices: invoicesMarker,
  contracts: contractsMarker,
  // Other tables imported transitively — opaque markers.
  bookings: { __table: "bookings" },
  projectTracks: { __table: "project_tracks" },
  trackVersions: { __table: "track_versions" },
  trackComments: { __table: "track_comments" },
  notifications: { __table: "notifications" },
  clientContacts: { __table: "client_contacts" },
  stripeCustomers: { __table: "stripe_customers" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  not: (cond: unknown) => ({ not: cond }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  isNull: (col: unknown) => ({ isNull: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  sql: () => ({ sql: true }),
}));

import { contracts, invoices, projects } from "@skitza/db";

vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitCommentCreated: vi.fn() }));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));
vi.mock("~/server/stripe/client", () => ({
  // The money procedure may opportunistically fetch the saved card's
  // last-4 from Stripe; mock the client so the test environment doesn't
  // hit the real API.
  getStripe: () => ({
    paymentMethods: {
      retrieve: vi.fn(() => Promise.resolve({ card: { last4: "4242" } })),
    },
  }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  invoicesMock.mockReset().mockResolvedValue([]);
  contractsMock.mockReset().mockResolvedValue([]);
  projectsWhereSpy.mockReset();
  invoicesWhereSpy.mockReset();
  contractsWhereSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

function findPredicate(
  where: unknown,
  columnMarker: unknown,
  operator: "eq" | "inArray" = "eq",
  expectedValue?: unknown,
): boolean {
  if (!where || typeof where !== "object") return false;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const p of (where as { and: unknown[] }).and) {
      if (findPredicate(p, columnMarker, operator, expectedValue)) return true;
    }
    return false;
  }
  if (operator in where) {
    const args = (where as Record<string, unknown[]>)[operator];
    if (Array.isArray(args) && args[0] === columnMarker) {
      if (expectedValue === undefined) return true;
      return args[1] === expectedValue;
    }
  }
  return false;
}

const seedProject = (overrides: Record<string, unknown> = {}) => {
  producerSelectQueue.push([{ id: PRODUCER_ID }]);
  projectSelectQueue.push([
    {
      id: PROJECT_ID,
      producerId: PRODUCER_ID,
      currency: "USD",
      nextChargeAt: null,
      paymentPlanKind: "full",
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      ...overrides,
    },
  ]);
};

describe("projectRoom.money", () => {
  it("returns zeros + empty arrays when project has no money activity", async () => {
    seedProject();
    const caller = await buildCaller();
    const result = await caller.projectRoom.money({ projectId: PROJECT_ID });

    expect(result).toMatchObject({
      paidCents: 0,
      outstandingCents: 0,
      currency: "USD",
      nextChargeAt: null,
      invoices: [],
      contractSummary: null,
      stripePaymentMethods: [],
    });
  });

  it("scopes the projects ownership SELECT by producerId (auth boundary)", async () => {
    seedProject();
    const caller = await buildCaller();
    await caller.projectRoom.money({ projectId: PROJECT_ID });

    const whereArg = projectsWhereSpy.mock.calls[0]?.[0];
    expect(findPredicate(whereArg, projects.id, "eq", PROJECT_ID)).toBe(true);
    expect(
      findPredicate(whereArg, projects.producerId, "eq", PRODUCER_ID),
    ).toBe(true);
  });

  it("scopes invoices SELECT by producerId AND projectId", async () => {
    seedProject();
    const caller = await buildCaller();
    await caller.projectRoom.money({ projectId: PROJECT_ID });

    const whereArg = invoicesWhereSpy.mock.calls[0]?.[0];
    expect(
      findPredicate(whereArg, invoices.producerId, "eq", PRODUCER_ID),
    ).toBe(true);
    expect(findPredicate(whereArg, invoices.projectId, "eq", PROJECT_ID)).toBe(
      true,
    );
  });

  it("scopes contracts SELECT by producerId AND projectId", async () => {
    seedProject();
    const caller = await buildCaller();
    await caller.projectRoom.money({ projectId: PROJECT_ID });

    const whereArg = contractsWhereSpy.mock.calls[0]?.[0];
    expect(
      findPredicate(whereArg, contracts.producerId, "eq", PRODUCER_ID),
    ).toBe(true);
    expect(
      findPredicate(whereArg, contracts.projectId, "eq", PROJECT_ID),
    ).toBe(true);
  });

  it("throws NOT_FOUND when project doesn't exist or belongs to another producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.money({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("aggregates paid/outstanding totals from invoices, ignoring mixed currencies", async () => {
    seedProject();
    invoicesMock.mockResolvedValueOnce([
      // Same-currency rows count.
      {
        id: "i-paid",
        amountCents: 50000,
        currency: "USD",
        status: "paid",
        kind: "deposit",
        description: "Deposit",
        customerName: "Maya",
        createdAt: new Date("2026-04-01T00:00:00Z"),
        paidAt: new Date("2026-04-02T00:00:00Z"),
      },
      {
        id: "i-sent",
        amountCents: 50000,
        currency: "USD",
        status: "sent",
        kind: "final",
        description: "Final",
        customerName: "Maya",
        createdAt: new Date("2026-04-10T00:00:00Z"),
        paidAt: null,
      },
      // Mixed currency — excluded from sums to avoid USD+EUR addition.
      {
        id: "i-eur",
        amountCents: 100000,
        currency: "EUR",
        status: "paid",
        kind: "deposit",
        description: "X",
        customerName: "X",
        createdAt: new Date("2026-04-05T00:00:00Z"),
        paidAt: new Date("2026-04-05T00:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.money({ projectId: PROJECT_ID });

    expect(result.paidCents).toBe(50000);
    expect(result.outstandingCents).toBe(50000);
    expect(result.currency).toBe("USD");
    // The full invoice list is returned regardless of currency (UI shows
    // all rows in the ledger; only the totals filter to a single currency).
    expect(result.invoices).toHaveLength(3);
  });

  it("returns contractSummary when at least one contract exists", async () => {
    seedProject();
    contractsMock.mockResolvedValueOnce([
      {
        id: "ct-1",
        title: "Master agreement",
        status: "signed",
        sentAt: new Date("2026-04-01T00:00:00Z"),
        signedAt: new Date("2026-04-02T00:00:00Z"),
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
    ]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.money({ projectId: PROJECT_ID });

    expect(result.contractSummary).toMatchObject({
      id: "ct-1",
      title: "Master agreement",
      status: "signed",
    });
  });
});
