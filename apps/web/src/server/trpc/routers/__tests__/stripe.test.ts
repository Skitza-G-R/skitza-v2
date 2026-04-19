import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the public-facing stripe procedures introduced in Task 10.
// We mirror the dbMock pattern used in project.test.ts: marker objects
// route select() to per-table mocks, and a FIFO queue per table lets
// each test seed the rows it needs in order.
//
// The Customer Portal mutation only reads from `projects` (one row,
// share-token-keyed) and `producers` (slug for the return URL), then
// calls stripe.billingPortal.sessions.create. There's no Clerk auth —
// this lives on the public-procedure surface — so the test caller is
// constructed with userId: null.

const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";
const PRODUCER_ID = "producer-uuid-1";
const CUSTOMER_ID = "cus_paused_test";
const RAW_TOKEN = "shareToken_paused_banner_happy_path_demo_value";
const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");

const projectsMarker = { __table: "projects" };
const producersMarker = { __table: "producers" };

type Row = Record<string, unknown>;
const projectSelectQueue: Row[][] = [];

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === projectsMarker) {
        return {
          where: () => ({ limit: () => Promise.resolve(shift(projectSelectQueue)) }),
        };
      }
      // Producers / others: nothing to seed for the Portal mutation.
      return {
        where: () => ({ limit: () => Promise.resolve([]) }),
      };
    },
  }),
  insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
};

const billingPortalCreateMock = vi.fn();
vi.mock("~/server/stripe/client", () => ({
  getStripe: () => ({
    billingPortal: { sessions: { create: billingPortalCreateMock } },
    // Other surfaces stripe.ts uses on producer-procedure paths;
    // including them as no-op vi.fn() keeps the module loadable.
    accounts: { create: vi.fn(), retrieve: vi.fn(), createLoginLink: vi.fn() },
    accountLinks: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  }),
  getSiteUrl: () => "https://skitza.test",
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: null }),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: () => null,
    }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  projects: projectsMarker,
  producers: producersMarker,
  // Listed because stripe.ts imports them at the top — the procedures
  // we don't exercise won't actually call them, but the module must load.
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
  products: { __table: "products" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  isNull: (col: unknown) => ({ isNull: col }),
  sql: () => ({ sql: true }),
}));

// Rate-limit mock — controllable per-test. Default to "always allow"
// so tests not focused on the limit don't trip it. Important 1's test
// overrides this to assert the right call shape and force the limit.
// Typed signature so mock.calls is `[string, number, number][]`.
const rateLimitMock = vi.fn<
  (key: string, limit: number, windowMs: number) => {
    ok: boolean;
    remaining: number;
    resetMs: number;
  }
>(() => ({ ok: true, remaining: 10, resetMs: 0 }));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: (key: string, limit: number, windowMs: number) =>
    rateLimitMock(key, limit, windowMs),
}));

beforeEach(() => {
  projectSelectQueue.length = 0;
  billingPortalCreateMock.mockReset();
  rateLimitMock
    .mockReset()
    .mockImplementation(() => ({ ok: true, remaining: 10, resetMs: 0 }));
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: null });
};

describe("stripe.createCustomerPortalSession", () => {
  it("rejects NOT_FOUND when share token doesn't match", async () => {
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        // Stored hash from a different token entirely → mismatch.
        shareTokenHash: createHash("sha256").update("different-token").digest("hex"),
        stripeCustomerId: CUSTOMER_ID,
      },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.stripe.createCustomerPortalSession({
        projectId: PROJECT_ID,
        shareToken: RAW_TOKEN,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(billingPortalCreateMock).not.toHaveBeenCalled();
  });

  it("rejects NOT_FOUND when the project doesn't exist", async () => {
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.stripe.createCustomerPortalSession({
        projectId: PROJECT_ID,
        shareToken: RAW_TOKEN,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(billingPortalCreateMock).not.toHaveBeenCalled();
  });

  it("rejects PRECONDITION_FAILED when project has no stripeCustomerId", async () => {
    // Pre-payment state — the share-token room exists but the client
    // hasn't completed checkout yet, so there's no Stripe Customer to
    // open the Portal against.
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        shareTokenHash: TOKEN_HASH,
        stripeCustomerId: null,
      },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.stripe.createCustomerPortalSession({
        projectId: PROJECT_ID,
        shareToken: RAW_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "No saved payment method on file yet — pay the first invoice first.",
    });
    expect(billingPortalCreateMock).not.toHaveBeenCalled();
  });

  it("happy path: creates portal session with customer + return_url to share page", async () => {
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        shareTokenHash: TOKEN_HASH,
        stripeCustomerId: CUSTOMER_ID,
      },
    ]);
    billingPortalCreateMock.mockResolvedValue({
      id: "bps_123",
      url: "https://billing.stripe.com/session/test_123",
    });

    const caller = await buildCaller();
    const res = await caller.stripe.createCustomerPortalSession({
      projectId: PROJECT_ID,
      shareToken: RAW_TOKEN,
    });

    expect(res).toEqual({ url: "https://billing.stripe.com/session/test_123" });
    expect(billingPortalCreateMock).toHaveBeenCalledTimes(1);
    const [params] = billingPortalCreateMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(params.customer).toBe(CUSTOMER_ID);
    // Return URL points back to the share-token room so the client
    // lands where they started after they finish updating their card.
    expect(params.return_url).toBe(`https://skitza.test/share/${RAW_TOKEN}`);
  });

  it("calls checkRateLimit with portal-session:<ipHash> + (10, 60_000) before any Stripe / DB work (Important 1)", async () => {
    // Rate-limit must run BEFORE the share-token compare and BEFORE the
    // Stripe API call, otherwise an attacker can burn Stripe quota and
    // brute-force tokens cheaply. Mock returns OK so we just verify the
    // call shape — the next test verifies rejection.
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        shareTokenHash: TOKEN_HASH,
        stripeCustomerId: CUSTOMER_ID,
      },
    ]);
    billingPortalCreateMock.mockResolvedValue({
      id: "bps_x",
      url: "https://billing.stripe.com/x",
    });

    const caller = await buildCaller();
    await caller.stripe.createCustomerPortalSession({
      projectId: PROJECT_ID,
      shareToken: RAW_TOKEN,
    });

    expect(rateLimitMock).toHaveBeenCalledTimes(1);
    const [key, limit, windowMs] = rateLimitMock.mock.calls[0]!;
    expect(key).toMatch(/^portal-session:/);
    expect(limit).toBe(10);
    expect(windowMs).toBe(60_000);
  });

  it("throws TOO_MANY_REQUESTS when checkRateLimit returns ok:false (Important 1)", async () => {
    rateLimitMock.mockReturnValue({ ok: false, remaining: 0, resetMs: 12_000 });
    // Even with a valid project + token + customer, the rate-limit short-
    // circuits before the Stripe API call.
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        shareTokenHash: TOKEN_HASH,
        stripeCustomerId: CUSTOMER_ID,
      },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.stripe.createCustomerPortalSession({
        projectId: PROJECT_ID,
        shareToken: RAW_TOKEN,
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // No Stripe call happened — rate-limit fired first.
    expect(billingPortalCreateMock).not.toHaveBeenCalled();
  });

  it("surfaces Stripe portal-not-configured error verbatim", async () => {
    // First-use case: the platform owner hasn't configured a default
    // Portal configuration in the Stripe Dashboard yet. Stripe returns
    // a helpful error and we forward it untouched so the message points
    // the operator at the Dashboard fix.
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        shareTokenHash: TOKEN_HASH,
        stripeCustomerId: CUSTOMER_ID,
      },
    ]);
    billingPortalCreateMock.mockRejectedValueOnce(
      new Error(
        "No configuration provided and your test mode default configuration has not been created.",
      ),
    );
    const caller = await buildCaller();
    await expect(
      caller.stripe.createCustomerPortalSession({
        projectId: PROJECT_ID,
        shareToken: RAW_TOKEN,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("No configuration provided") as string,
    });
  });
});
