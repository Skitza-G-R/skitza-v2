import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// Back-compat: totals-counter that fires on every insert regardless of
// target table. The 2026-04-22 /join-origin branch made inserts
// table-specific, so new tests additionally use `insertsByTable` below
// to introspect which table was targeted + with what values.
const insertMock = vi.fn().mockResolvedValue([{ id: "uuid-1" }]);

// New (2026-04-22): capture every insert with its target marker +
// the values object passed. Tests can filter by marker to assert
// "producers row was inserted" vs "client_contacts row was inserted"
// independently. Reset in beforeEach.
const insertsByTable: { table: unknown; values: unknown }[] = [];

// New (2026-04-22): mock for the producer-by-slug lookup in the
// join-origin branch. Tests set its return value to simulate
// "producer exists" (array with row) vs "slug unknown" (empty array).
const producerLookupMock = vi.fn<() => Promise<Array<{ id: string }>>>();

// Table markers — the updated dbMock routes inserts by identity-
// comparing the table arg to these markers. Field refs are kept
// on the marker so `eq(producers.slug, ...)` still captures a
// recognizable column reference in eqCalls.
const producersMarker = {
  __table: "producers",
  id: { _name: "id" },
  slug: { _name: "slug" },
  clerkUserId: { _name: "clerk_user_id" },
};
const clientContactsMarker = {
  __table: "client_contacts",
  id: { _name: "id" },
  emailHash: { _name: "email_hash" },
  clerkUserId: { _name: "clerk_user_id" },
  producerId: { _name: "producer_id" },
};

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
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      insertsByTable.push({ table, values });
      // Support BOTH call shapes the webhook uses:
      //   1) insert(...).values(...).onConflictDoNothing().returning()
      //      — default producer branch, awaits the returned rows.
      //   2) await insert(...).values(...).onConflictDoNothing()
      //      — join-origin client_contacts branch, no .returning().
      // We implement the second via a thenable so `await` resolves.
      const seq = String(insertsByTable.length);
      const conflict = {
        returning: () => {
          insertMock();
          return Promise.resolve([{ id: `uuid-${seq}` }]);
        },
        then: (resolve: (val: unknown) => void) => {
          insertMock();
          resolve([]);
        },
      };
      return { onConflictDoNothing: () => conflict };
    },
  }),
  update: updateMock,
  // SELECT chain for the producer-by-slug lookup used in the
  // join-origin branch: db.select({id}).from(producers).where(...).limit(1).
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => producerLookupMock(),
      }),
    }),
  }),
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
  producers: producersMarker,
  clientContacts: clientContactsMarker,
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
  insertsByTable.length = 0;
  producerLookupMock.mockReset();
  // Default: slug lookup returns empty (join-origin tests override
  // when they want a resolvable slug). Keeps default-branch tests
  // from crashing if the webhook ever calls select() on them.
  producerLookupMock.mockResolvedValue([]);
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

  it("trims whitespace from email before hashing (matches recordContact)", async () => {
    // The producing side (recordContact) hashes email.trim().toLowerCase().
    // If Clerk ever delivers an email with surrounding whitespace, the
    // webhook MUST trim too — otherwise the hash mismatches and the artist
    // silently sees zero studios. Capture the eq() call to assert the hash
    // computed by the route equals sha256("dan@example.com") even when the
    // payload contains "  Dan@Example.com  ".
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_dan",
        email_addresses: [{ email_address: "  Dan@Example.com  " }],
        first_name: "Dan",
      },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);

    // Expected hash is the trimmed/lowercased one — this MUST match what
    // recordContact produces for "dan@example.com".
    const expectedHash = createHash("sha256").update("dan@example.com").digest("hex");
    const eqCall = eqCalls.find((c) => c.value === expectedHash);
    expect(
      eqCall,
      "expected eq(emailHash, sha256(trim+lower)) — webhook hash must match recordContact's hash",
    ).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// /join-origin signup (2026-04-22 critical bug fix — see
// docs/audit-report.md Task 15). Before this fix, every sign-up — even
// from /join/<slug> — created a producers row and forced the user into
// producer-onboarding. The fix reads Clerk's `unsafe_metadata` on the
// user.created event: if `signupOrigin === "join"` AND the attached
// `producerSlug` resolves to a real producer, we DO NOT create a
// producer row; instead we insert a client_contacts row scoped to that
// producer. The update-all-matching-email-hash step still runs afterward
// (same as default branch) so multi-producer artist identity unifies.
// ─────────────────────────────────────────────────────────────────────
describe("user.created — /join origin (artist self-serve)", () => {
  it("TDD-A: join-origin with resolvable slug inserts client_contacts and does NOT insert producers", async () => {
    // Seed: target producer exists with slug "gili-asraf" → returned
    // from the first select().from(producers).where(slug).limit(1).
    producerLookupMock.mockResolvedValueOnce([{ id: "producer-uuid-target" }]);

    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_artist_1",
        email_addresses: [{ email_address: "newfan@example.com" }],
        first_name: "Fan",
        unsafe_metadata: { signupOrigin: "join", producerSlug: "gili-asraf" },
      },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);

    // INVARIANT 1: No producers row created. This is the whole point —
    // a visitor arriving via /join is an artist, never a producer.
    const producerInserts = insertsByTable.filter((c) => c.table === producersMarker);
    expect(
      producerInserts,
      "join-origin signup MUST NOT create a producers row",
    ).toHaveLength(0);

    // INVARIANT 2: Exactly one client_contacts row was inserted, scoped
    // to the target producer, carrying the Clerk user id + email hash.
    const contactInserts = insertsByTable.filter(
      (c) => c.table === clientContactsMarker,
    );
    expect(contactInserts).toHaveLength(1);
    const values = contactInserts[0]?.values as Record<string, unknown>;
    expect(values.producerId).toBe("producer-uuid-target");
    expect(values.clerkUserId).toBe("user_artist_1");
    expect(values.email).toBe("newfan@example.com");
    const expectedHash = createHash("sha256").update("newfan@example.com").digest("hex");
    expect(values.emailHash).toBe(expectedHash);
    // `name` is NOT NULL on client_contacts — must be populated.
    expect(values.name).toBeTruthy();

    // INVARIANT 3: the slug lookup actually happened. Guards against a
    // future refactor that reads metadata but skips the DB resolution
    // (which would trust tampered client-set metadata unconditionally).
    expect(producerLookupMock).toHaveBeenCalledOnce();
  });

  it("TDD-B: default signup (no unsafe_metadata) still creates producer row only — regression guard", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_producer_1",
        email_addresses: [{ email_address: "producer@example.com" }],
        first_name: "Pat",
        // no unsafe_metadata → default producer branch
      },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);

    // Default branch invariant: producers row created.
    const producerInserts = insertsByTable.filter((c) => c.table === producersMarker);
    expect(producerInserts).toHaveLength(1);

    // No client_contacts INSERT from the origin branch (the UPDATE-
    // stamp branch can still run — that's the pre-existing artist-
    // stamping logic and is covered by the earlier test block).
    const contactInserts = insertsByTable.filter(
      (c) => c.table === clientContactsMarker,
    );
    expect(contactInserts).toHaveLength(0);
  });

  it("TDD-C: join-origin with unknown slug falls back to default producer insert (does not crash)", async () => {
    // Simulate lookup: no producer exists with that slug.
    producerLookupMock.mockResolvedValueOnce([]);

    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_weird",
        email_addresses: [{ email_address: "weird@example.com" }],
        unsafe_metadata: {
          signupOrigin: "join",
          producerSlug: "does-not-exist",
        },
      },
    });
    const res = await POST(buildReq(body));
    // Safety invariant: handler returns 200, not 500. Malformed or
    // tampered metadata must never crash the webhook — Clerk retries
    // 5xx forever and would flood our logs.
    expect(res.status).toBe(200);

    // Fallback branch invariant: a producer row IS created (same as
    // default branch). Better to create an orphan producer row the
    // user can ignore than to leave them with no record at all.
    const producerInserts = insertsByTable.filter((c) => c.table === producersMarker);
    expect(producerInserts).toHaveLength(1);

    // Fallback branch: no client_contacts row (slug didn't resolve
    // so we don't know which producer to attach to).
    const contactInserts = insertsByTable.filter(
      (c) => c.table === clientContactsMarker,
    );
    expect(contactInserts).toHaveLength(0);

    // Behavior proof: the lookup WAS attempted. This is what forces
    // the webhook to actually read metadata + query the DB. Without
    // this assertion, pre-fix code also "passes" the fallback shape
    // by doing no branching at all — vacuous.
    expect(producerLookupMock).toHaveBeenCalledOnce();
  });

  it("TDD-D: default signup (no unsafe_metadata) does NOT attempt slug lookup — no wasted query", async () => {
    // Regression guard on perf: the slug lookup should only fire when
    // unsafe_metadata contains signupOrigin==="join". Every normal
    // producer signup otherwise would burn an extra DB round-trip.
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_plain",
        email_addresses: [{ email_address: "plain@example.com" }],
      },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);
    expect(producerLookupMock).not.toHaveBeenCalled();
  });
});
