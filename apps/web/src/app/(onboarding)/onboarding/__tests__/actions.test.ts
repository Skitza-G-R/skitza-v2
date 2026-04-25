import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { UserRole } from "~/server/auth/role";

// Story 03 — completeStudio server action.
//
// Replaces the previous completeOnboarding action: the new shape only
// takes { displayName, timezone } from the client. Everything else
// (slug + currency) is derived server-side, behind the producer's back:
//   - slug = slugFromDisplayName(displayName, randomBytes(2).toString("hex"))
//   - currency = currencyFromCountry(headers().get("x-vercel-ip-country"))
//
// The pre-Story-03 actions.test.ts had 11 tests pinning the old-shape
// contract (caller-supplied slug + currency, ZodError on uppercase
// slug, etc.). Those caller-shape tests no longer apply — but the
// invariants they protected (auth guard, DB-URL guard, artist guard,
// orphan/complete proceed) MUST carry over to completeStudio. This
// file rewrites the suite around the new shape while preserving every
// invariant the old suite enforced.

// Chain mock for db.insert().values().onConflictDoUpdate()
const onConflictDoUpdateMock = vi
  .fn<(arg: { target: unknown; set: Record<string, unknown> }) => Promise<void>>()
  .mockResolvedValue(undefined);
const valuesMock = vi.fn<(values: Record<string, unknown>) => {
  onConflictDoUpdate: typeof onConflictDoUpdateMock;
}>(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));
const insertMock = vi.fn(() => ({ values: valuesMock }));
const dbMock = { insert: insertMock };

let mockUserId: string | null = "user_test_1";
let mockEmail: string | undefined = "ada@example.com";
// Stateful role mock — Task 16 added a role check to the action.
// Default: "producer-incomplete" so the happy-path tests pass. Specific
// tests override to simulate the artist-POSTing-the-form attack and
// the orphan webhook-race.
let mockRole: UserRole = {
  kind: "producer-incomplete",
  producer: {
    id: "producer-incomplete-1",
    displayName: null,
    slug: "ada-abcd",
    email: "ada@example.com",
  },
};

// Stateful country header. Default null = local dev → USD fallback.
// Individual tests override via `mockCountryHeader = "GB"` to assert
// currency derivation.
let mockCountryHeader: string | null = null;

// Stateful crypto hash queue. Each call to randomBytes(2).toString("hex")
// pops the front of this queue. Tests override to:
//   - assert deterministic slug shape ("aaaa" → slug ends "-aaaa")
//   - simulate retry-on-conflict (queue ["aaaa", "bbbb"] → 1st upsert
//     uses "-aaaa", 2nd uses "-bbbb", asserting they differ)
let mockHashQueue: string[] = ["abcd"];

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: mockUserId }),
  currentUser: () =>
    Promise.resolve(mockEmail ? { emailAddresses: [{ emailAddress: mockEmail }] } : null),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: { clerkUserId: "clerk_user_id" },
  eq: (a: unknown, b: unknown) => ({ a, b }),
}));
vi.mock("~/server/auth/role", () => ({
  fetchUserRole: () => Promise.resolve(mockRole),
}));
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "x-vercel-ip-country" ? mockCountryHeader : null,
    }),
}));
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomBytes: (size: number) => {
      // Story 03's contract: action calls randomBytes(2).toString("hex"),
      // producing a 4-char hex string. We bypass the random source and
      // return a Buffer-like that .toString("hex")'s to the next entry
      // in mockHashQueue.
      const hex = mockHashQueue.shift() ?? "ffff";
      return {
        toString: (enc?: string) => (enc === "hex" ? hex : hex),
        length: size,
      };
    },
  };
});

const validInput = {
  displayName: "Ada Studios",
  timezone: "Europe/Berlin",
};

beforeEach(() => {
  insertMock.mockClear();
  valuesMock.mockClear();
  onConflictDoUpdateMock.mockReset().mockResolvedValue(undefined);
  mockUserId = "user_test_1";
  mockEmail = "ada@example.com";
  mockRole = {
    kind: "producer-incomplete",
    producer: {
      id: "producer-incomplete-1",
      displayName: null,
      slug: "ada-abcd",
      email: "ada@example.com",
    },
  };
  mockCountryHeader = null;
  mockHashQueue = ["abcd"];
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("completeStudio — happy path + invariant carryover", () => {
  it("upserts insert values that include parsed displayName + session email + server-derived slug", async () => {
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(insertMock).toHaveBeenCalledOnce();
    const valuesArg = valuesMock.mock.calls[0]?.[0];
    expect(valuesArg).toMatchObject({
      clerkUserId: "user_test_1",
      email: "ada@example.com",
      displayName: "Ada Studios",
      timezone: "Europe/Berlin",
    });
    // Slug derived server-side via slugFromDisplayName + injected hash
    // "abcd". Helper produces "<body>-<hash>", so "Ada Studios" + "abcd"
    // → "ada-studios-abcd". Pin the shape so a future refactor that
    // accidentally drops the hash suffix or stops calling the helper
    // is caught.
    expect(valuesArg?.slug).toBe("ada-studios-abcd");
  });

  it("passes update set + bumped updatedAt on conflict (webhook already seeded row)", async () => {
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    const arg = onConflictDoUpdateMock.mock.calls[0]?.[0];
    expect(arg?.set).toMatchObject({
      displayName: "Ada Studios",
      timezone: "Europe/Berlin",
      slug: "ada-studios-abcd",
    });
    expect(arg?.set.updatedAt).toBeInstanceOf(Date);
  });
});

describe("completeStudio — currency derivation from x-vercel-ip-country", () => {
  it("uses GBP when header is GB", async () => {
    mockCountryHeader = "GB";
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    const valuesArg = valuesMock.mock.calls[0]?.[0];
    expect(valuesArg?.defaultCurrency).toBe("GBP");
  });

  it("uses EUR for any EU member (DE)", async () => {
    mockCountryHeader = "DE";
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    const valuesArg = valuesMock.mock.calls[0]?.[0];
    expect(valuesArg?.defaultCurrency).toBe("EUR");
  });

  it("uses ILS when header is IL", async () => {
    mockCountryHeader = "IL";
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    const valuesArg = valuesMock.mock.calls[0]?.[0];
    expect(valuesArg?.defaultCurrency).toBe("ILS");
  });

  it("falls back to USD when x-vercel-ip-country is absent (local dev)", async () => {
    mockCountryHeader = null;
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    const valuesArg = valuesMock.mock.calls[0]?.[0];
    expect(valuesArg?.defaultCurrency).toBe("USD");
  });
});

describe("completeStudio — slug retry loop on uniqueness conflict", () => {
  it("retries with a fresh hash on slug conflict and succeeds on the second attempt", async () => {
    // Queue two hashes — the first triggers the conflict, the second
    // wins. Without the retry loop this test fails: a single attempt
    // would surface the duplicate-key error to the caller.
    mockHashQueue = ["1111", "2222"];
    onConflictDoUpdateMock
      .mockRejectedValueOnce(
        new Error(
          'duplicate key value violates unique constraint "producers_slug_unique" on column "slug"',
        ),
      )
      .mockResolvedValueOnce(undefined);

    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);

    // Two upsert attempts fired, with two distinct slugs.
    expect(insertMock).toHaveBeenCalledTimes(2);
    const firstSlug = (valuesMock.mock.calls[0]?.[0] as { slug?: string } | undefined)?.slug;
    const secondSlug = (valuesMock.mock.calls[1]?.[0] as { slug?: string } | undefined)?.slug;
    expect(firstSlug).toBe("ada-studios-1111");
    expect(secondSlug).toBe("ada-studios-2222");
    expect(firstSlug).not.toBe(secondSlug);
  });

  it("throws a friendly error after 3 consecutive slug conflicts", async () => {
    mockHashQueue = ["1111", "2222", "3333"];
    const conflict = new Error(
      'duplicate key value violates unique constraint "producers_slug_unique" on column "slug"',
    );
    onConflictDoUpdateMock
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict);

    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow(
      /could not allocate slug/,
    );
    // Action attempted exactly 3 times before giving up.
    expect(insertMock).toHaveBeenCalledTimes(3);
  });

  it("rethrows non-slug DB errors without retrying", async () => {
    onConflictDoUpdateMock.mockRejectedValueOnce(new Error("connection lost"));
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow("connection lost");
    // Must NOT retry on unrelated errors — only slug-uniqueness.
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe("completeStudio — auth + role invariants (carried over from completeOnboarding)", () => {
  it("throws unauthorized when no userId", async () => {
    mockUserId = null;
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow("unauthorized");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws missing DATABASE_URL when env var absent", async () => {
    delete process.env.DATABASE_URL;
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow("missing DATABASE_URL");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws when Clerk session lacks an email address", async () => {
    mockEmail = undefined;
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow(/unable to resolve email/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 16 carryover — the layout gate already redirects artists at
  // the render path, but a signed-in artist crafting a raw HTTP POST
  // (devtools / curl / a script) bypasses the layout. Without this
  // guard they'd silently upsert a producers row and "become" a
  // producer. The new completeStudio MUST preserve this invariant.
  // ─────────────────────────────────────────────────────────────────
  it("rejects when caller role is 'artist' (closes raw-POST hole)", async () => {
    mockRole = { kind: "artist" };
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow(/artist|forbidden/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("proceeds when caller role is 'orphan' (Clerk webhook race — action's upsert handles it)", async () => {
    mockRole = { kind: "orphan" };
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("proceeds when caller role is 'producer-complete' (idempotent re-save — no harm)", async () => {
    mockRole = {
      kind: "producer-complete",
      producer: {
        id: "producer-complete-1",
        displayName: "Ada Studios",
        slug: "ada-studios-aaaa",
        email: "ada@example.com",
      },
    };
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(insertMock).toHaveBeenCalledOnce();
  });
});

describe("completeStudio — input validation", () => {
  it("throws ZodError on empty displayName (zod.trim().min(1))", async () => {
    const { completeStudio } = await import("../actions");
    await expect(
      completeStudio({ displayName: "   ", timezone: "Europe/Berlin" }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws ZodError when displayName exceeds 80 chars", async () => {
    const { completeStudio } = await import("../actions");
    await expect(
      completeStudio({ displayName: "x".repeat(81), timezone: "UTC" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when timezone is empty", async () => {
    const { completeStudio } = await import("../actions");
    await expect(
      completeStudio({ displayName: "Ada", timezone: "" }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
