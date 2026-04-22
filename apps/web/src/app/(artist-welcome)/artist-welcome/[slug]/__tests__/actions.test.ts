import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// Tests for the `joinArtistWorkspace` server action — the fix for the
// webhook-race bug Gili caught in manual QA of Phase 2+3. The action
// ensures that clicking "Open my artist workspace →" on
// /artist-welcome/<slug> synchronously stamps the client_contacts
// relationship BEFORE redirecting to /artist, so the race between
// Clerk's async webhook and the user's click-through can't land them
// on the orphan welcome page.

// Mocks for the DB + Clerk + next/navigation
let redirectTarget: string | null = null;
// Throw on redirect() so control flow matches Next.js behaviour: the
// real redirect() helper throws a special error that halts execution.
// Tests assert on redirectTarget (captured before throw) + catch the
// throw.
class RedirectError extends Error {
  constructor(public target: string) {
    super(`REDIRECT:${target}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    redirectTarget = target;
    throw new RedirectError(target);
  },
}));

let mockUserId: string | null = "user_test_artist";
let mockEmail: string | undefined = "ada@example.com";
let mockFirstName: string | null = "Ada";
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: mockUserId }),
  currentUser: () =>
    Promise.resolve(
      mockEmail
        ? {
            firstName: mockFirstName,
            emailAddresses: [{ emailAddress: mockEmail }],
          }
        : null,
    ),
}));

// DB chain mocks. The action now makes TWO distinct SELECT calls:
//   1) producer lookup by slug (the target producer)
//   2) own producer lookup by clerkUserId (self-join detection — if
//      the target is the user's own producer row, bounce to /dashboard)
// Use a FIFO queue so each test can stage the results both calls
// should return. Queue is drained in order — first select consumes
// the first element, second select consumes the next.
let selectQueue: Array<Array<{ id: string }>> = [];
const producerSelectMock = vi.fn(() => {
  const next = selectQueue.shift() ?? [];
  return Promise.resolve(next);
});

const insertValuesMock = vi.fn();
const insertOnConflictMock = vi.fn(() => Promise.resolve());
const insertMock = vi.fn(() => ({
  values: (v: unknown) => {
    insertValuesMock(v);
    return { onConflictDoNothing: insertOnConflictMock };
  },
}));

const updateSetMock = vi.fn();
const updateWhereMock = vi.fn(() => Promise.resolve());
const updateMock = vi.fn(() => ({
  set: (v: unknown) => {
    updateSetMock(v);
    return { where: updateWhereMock };
  },
}));

const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => producerSelectMock(),
      }),
    }),
  }),
  insert: insertMock,
  update: updateMock,
};

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  clientContacts: {
    emailHash: { _name: "email_hash" },
    clerkUserId: { _name: "clerk_user_id" },
  },
  producers: { slug: { _name: "slug" } },
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[]) => ({ and: args }),
  isNull: (col: unknown) => ({ isNull: col }),
}));

beforeEach(() => {
  redirectTarget = null;
  mockUserId = "user_test_artist";
  mockEmail = "ada@example.com";
  mockFirstName = "Ada";
  // Default queue: slug lookup finds the target producer; own-producer
  // lookup finds nothing (user isn't a producer — normal artist path).
  selectQueue = [[{ id: "producer-target-1" }], []];
  producerSelectMock.mockClear();
  insertMock.mockClear();
  insertValuesMock.mockClear();
  insertOnConflictMock.mockClear();
  updateMock.mockClear();
  updateSetMock.mockClear();
  updateWhereMock.mockClear();
  process.env.DATABASE_URL = "postgresql://test/test";
});

async function runAction(slug: string): Promise<string | null> {
  const { joinArtistWorkspace } = await import("../actions");
  try {
    await joinArtistWorkspace(slug);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("REDIRECT:")) {
      // Expected — redirect() throws. Swallow so we can assert on
      // redirectTarget.
      return redirectTarget;
    }
    throw err;
  }
  return redirectTarget;
}

describe("joinArtistWorkspace (webhook-race fix)", () => {
  it("inserts client_contacts synchronously and redirects to /artist (happy path)", async () => {
    const target = await runAction("gili-asraf");

    // INVARIANT 1: client_contacts insert fired with the right fields.
    expect(insertMock).toHaveBeenCalledOnce();
    const values = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.producerId).toBe("producer-target-1");
    expect(values.clerkUserId).toBe("user_test_artist");
    expect(values.email).toBe("ada@example.com");
    expect(values.name).toBe("Ada");
    const expectedHash = createHash("sha256").update("ada@example.com").digest("hex");
    expect(values.emailHash).toBe(expectedHash);

    // INVARIANT 2: onConflictDoNothing was called (idempotency — safe
    // when the webhook already inserted).
    expect(insertOnConflictMock).toHaveBeenCalledOnce();

    // INVARIANT 3: the multi-producer stamping UPDATE fired too.
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateSetMock).toHaveBeenCalledWith({ clerkUserId: "user_test_artist" });

    // INVARIANT 4: redirect target is /artist (NOT /artist-welcome —
    // that was the bug's symptom).
    expect(target).toBe("/artist");
  });

  it("redirects to /sign-in when not authenticated (preserving the welcome URL)", async () => {
    mockUserId = null;
    const target = await runAction("gili-asraf");
    expect(target).toBe(
      "/sign-in?redirect_url=/artist-welcome/gili-asraf",
    );
    // No DB writes when not authed.
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("redirects to /artist (safe fallback) when slug doesn't resolve to a producer", async () => {
    // Slug lookup returns empty → action short-circuits before the
    // own-producer lookup fires.
    selectQueue = [[]];
    const target = await runAction("does-not-exist");
    // Safe fallback — artist lands on /artist and sees the generic
    // orphan welcome if they have no other studios. Better than 500.
    expect(target).toBe("/artist");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when the user's OWN producer has this slug (self-join edge)", async () => {
    // Scenario: a producer signs into their own /join/<slug> link
    // (usually while testing). The action should detect that the
    // target producer IS the current user's producer row and bounce
    // to /dashboard instead of creating a weird self-client row.
    selectQueue = [
      [{ id: "producer-self" }], // slug lookup: target producer
      [{ id: "producer-self" }], // own producer lookup: SAME id
    ];
    const target = await runAction("my-own-slug");
    expect(target).toBe("/dashboard");
    // Critical: no client_contacts insert for the self-join case.
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("still inserts client_contacts when the user is a producer of a DIFFERENT studio (dual-role legit)", async () => {
    // Scenario: producer X signs into producer Y's /join link. They
    // legitimately want to become Y's artist. Insert should fire.
    selectQueue = [
      [{ id: "producer-Y-target" }], // slug lookup
      [{ id: "producer-X-self" }], // own producer lookup: different id
    ];
    const target = await runAction("producer-Y");
    expect(target).toBe("/artist");
    expect(insertMock).toHaveBeenCalledOnce();
    const values = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.producerId).toBe("producer-Y-target");
  });

  it("trims + lowercases the email before hashing (matches the webhook's idiom)", async () => {
    mockEmail = "  Ada@Example.com  ";
    await runAction("gili-asraf");
    const values = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    // The `email` stored in the row is normalised to the trimmed+
    // lowercased form so the CRM displays a clean value.
    expect(values.email).toBe("ada@example.com");
    // The hash MUST match the hash the webhook would produce for
    // "ada@example.com" — otherwise multi-producer identity unification
    // silently breaks (different hashes → no match in the UPDATE).
    const expectedHash = createHash("sha256").update("ada@example.com").digest("hex");
    expect(values.emailHash).toBe(expectedHash);
  });

  it("falls back to email local-part when user has no firstName set", async () => {
    mockFirstName = null;
    await runAction("gili-asraf");
    const values = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.name).toBe("ada");
  });
});
