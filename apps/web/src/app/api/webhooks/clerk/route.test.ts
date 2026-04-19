import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const insertMock = vi.fn().mockResolvedValue([{ id: "uuid-1" }]);
// Capture-mock for the client_contacts UPDATE chain. The route does:
//   db.update(clientContacts).set({...}).where(and(...))
// We capture the .set() and .where() args so each test can assert on them.
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn().mockResolvedValue(undefined);
const updateMock = vi.fn(() => ({
  set: (values: unknown) => {
    updateSetMock(values);
    return { where: updateWhereMock };
  },
}));
const dbMock = {
  insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: insertMock }) }) }),
  update: updateMock,
};

// Toggle to simulate svix signature failure in a single test.
let verifyShouldThrow = false;

// Capture the predicate args passed to `and(...)` so tests can introspect
// whether `eq(emailHash, ...)` and `isNull(clerkUserId)` were composed.
const andCalls: unknown[][] = [];
const eqCalls: { col: unknown; value: unknown }[] = [];
const isNullCalls: unknown[] = [];

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: {},
  clientContacts: {
    emailHash: { _name: "email_hash" },
    clerkUserId: { _name: "clerk_user_id" },
  },
  eq: (col: unknown, value: unknown) => {
    eqCalls.push({ col, value });
    return { _kind: "eq", col, value };
  },
  and: (...args: unknown[]) => {
    andCalls.push(args);
    return { _kind: "and", args };
  },
  isNull: (col: unknown) => {
    isNullCalls.push(col);
    return { _kind: "isNull", col };
  },
}));
vi.mock("svix", () => ({
  Webhook: class {
    verify(payload: string): unknown {
      if (verifyShouldThrow) throw new Error("bad sig");
      return JSON.parse(payload) as unknown;
    }
  },
}));

const buildReq = (body: string) =>
  new Request("http://x/api/webhooks/clerk", {
    method: "POST",
    headers: { "svix-id": "1", "svix-timestamp": "1", "svix-signature": "x" },
    body,
  });

beforeEach(() => {
  insertMock.mockClear();
  updateMock.mockClear();
  updateSetMock.mockClear();
  updateWhereMock.mockClear();
  andCalls.length = 0;
  eqCalls.length = 0;
  isNullCalls.length = 0;
  verifyShouldThrow = false;
  process.env.CLERK_WEBHOOK_SECRET = "test";
  process.env.DATABASE_URL = "x";
});

describe("clerk webhook", () => {
  it("creates a Producer on user.created", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: { id: "user_1", email_addresses: [{ email_address: "ada@x.com" }], first_name: "Ada" },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("returns 500 when CLERK_WEBHOOK_SECRET is missing", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const { POST } = await import("./route");
    const res = await POST(buildReq("{}"));
    expect(res.status).toBe(500);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid svix signature", async () => {
    verifyShouldThrow = true;
    const { POST } = await import("./route");
    const res = await POST(buildReq("{}"));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 400 when user.created has no email_addresses", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ type: "user.created", data: { id: "user_2", email_addresses: [] } });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 200 and skips insert for non user.created events", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ type: "user.updated", data: { id: "user_3" } });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("user.created — artist stamping", () => {
  it("stamps clerk_user_id on every client_contacts row matching the email_hash", async () => {
    // The mocked DB doesn't simulate per-row returning, but we can verify
    // the route fired the right SQL: UPDATE client_contacts SET clerkUserId
    // WHERE emailHash = sha256(lower(email)) AND clerkUserId IS NULL.
    // In real Postgres this single statement updates BOTH producer-A and
    // producer-B rows for "dan@example.com" because the index isn't
    // partitioned by producer.
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: { id: "user_dan", email_addresses: [{ email_address: "dan@example.com" }], first_name: "Dan" },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);

    // Stamping branch fired exactly once
    expect(updateMock).toHaveBeenCalledOnce();

    // .set({ clerkUserId: "user_dan" })
    expect(updateSetMock).toHaveBeenCalledWith({ clerkUserId: "user_dan" });

    // .where(and(eq(emailHash, sha256(lower("dan@example.com"))), isNull(clerkUserId)))
    expect(updateWhereMock).toHaveBeenCalledOnce();
    const expectedHash = createHash("sha256").update("dan@example.com").digest("hex");
    const eqCall = eqCalls.find((c) => c.value === expectedHash);
    expect(eqCall, "expected eq(emailHash, sha256(lower(email))) to be composed").toBeDefined();
    // isNull(clerkUserId) must be part of the predicate (idempotency).
    expect(isNullCalls.length, "expected isNull(clerkUserId) in WHERE clause").toBeGreaterThan(0);
  });

  it("leaves rows that already have a clerk_user_id alone (idempotent on re-fire)", async () => {
    // The IS NULL predicate is what makes this idempotent. We can't
    // simulate "row already stamped" through the mock, but we CAN
    // assert that the WHERE clause includes isNull(clerkUserId), so
    // already-stamped rows are excluded by the SQL itself.
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: { id: "user_new", email_addresses: [{ email_address: "shared@example.com" }] },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);

    // Critical idempotency invariant: WHERE includes isNull(clerkUserId)
    expect(isNullCalls.length, "isNull(clerkUserId) MUST appear in WHERE so already-stamped rows are skipped").toBeGreaterThan(0);
    // The composed `and(...)` must wrap both predicates so the SQL is
    // emailHash = X AND clerkUserId IS NULL (not just one of them).
    expect(andCalls.length).toBeGreaterThan(0);
    expect(andCalls[0]?.length).toBe(2);
  });

  it("creates the producers row AND stamps any client_contacts rows in one webhook (producer-also-client edge case)", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_gili",
        email_addresses: [{ email_address: "gili@studios.test" }],
        first_name: "Gili",
      },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);

    // BOTH branches fired in the same handler invocation
    expect(insertMock).toHaveBeenCalledOnce();   // producers insert
    expect(updateMock).toHaveBeenCalledOnce();   // client_contacts stamp

    // Stamp uses the same Clerk user id
    expect(updateSetMock).toHaveBeenCalledWith({ clerkUserId: "user_gili" });
  });

  it("does nothing extra when no client_contacts rows match the email_hash", async () => {
    // Even when zero rows match the SQL still runs (idempotently — it's
    // a no-op UPDATE in Postgres terms). The route must still return 200
    // and not throw. We resolve the where-mock with an empty result and
    // assert the chain was invoked but produced no error.
    updateWhereMock.mockResolvedValueOnce(undefined);
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: { id: "user_unknown", email_addresses: [{ email_address: "noone@example.com" }] },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);
    // SQL ran; row count is 0 in reality, but the handler doesn't care.
    expect(updateMock).toHaveBeenCalledOnce();
  });
});
