import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { UserAccountMemberships, UserRole } from "~/server/auth/role";

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
// invariants they protected (auth guard, DB-URL guard, producer-membership
// guard, and complete-producer re-entry) MUST carry over to completeStudio. This
// file rewrites the suite around the new shape while preserving every
// invariant the old suite enforced.

// Chain mock for db.update().set().where().returning().
const returningMock = vi
  .fn<() => Promise<Array<{ id: string }>>>()
  .mockResolvedValue([{ id: "producer-incomplete-1" }]);
const whereMock = vi.fn((condition: unknown) => {
  void condition;
  return { returning: returningMock };
});
const setMock = vi.fn((values: Record<string, unknown>) => {
  void values;
  return { where: whereMock };
});
const updateMock = vi.fn((table: unknown) => {
  void table;
  return { set: setMock };
});
const dbMock = { update: updateMock };

let mockUserId: string | null = "user_test_1";
// Stateful role mock — Task 16 added a role check to the action.
// Default: "producer-incomplete" so the happy-path tests pass. Specific
// tests override to simulate cross-role and no-membership attacks.
let mockRole: UserRole = {
  kind: "producer-incomplete",
  producer: {
    id: "producer-incomplete-1",
    displayName: null,
    slug: "ada-abcd",
    email: "ada@example.com",
  },
};
let mockHistoricalArtistAccess = false;
let mockClosureStarted = false;

function membershipsForMockRole(): UserAccountMemberships {
  const producer =
    mockRole.kind === "producer-complete"
      ? ({ status: "complete", profile: mockRole.producer } as const)
      : mockRole.kind === "producer-incomplete"
        ? ({ status: "incomplete", profile: mockRole.producer } as const)
        : ({ status: "none", profile: null } as const);
  const activeArtist = mockRole.kind === "artist";
  return {
    isAuthenticated: mockRole.kind !== "unauthenticated",
    accountStatus: mockClosureStarted ? "closure_started" : "open",
    producer,
    artist: {
      hasAccess: activeArtist || mockHistoricalArtistAccess,
      hasActiveConnections: activeArtist,
    },
  };
}

// Stateful country header. Default null = local dev → USD fallback.
// Individual tests override via `mockCountryHeader = "GB"` to assert
// currency derivation.
let mockCountryHeader: string | null = null;
let mockOnboardingIntentHeader: string | null = null;

// Stateful crypto hash queue. Each call to randomBytes(2).toString("hex")
// pops the front of this queue. Tests override to:
//   - assert deterministic slug shape ("aaaa" → slug ends "-aaaa")
//   - simulate retry-on-conflict (queue ["aaaa", "bbbb"] → 1st update
//     uses "-aaaa", 2nd uses "-bbbb", asserting they differ)
let mockHashQueue: string[] = ["abcd"];

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: mockUserId }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: { id: "producer_id", clerkUserId: "clerk_user_id", closedAt: "closed_at" },
  eq: (a: unknown, b: unknown) => ({ a, b }),
  isNull: (column: unknown) => ({ column, operator: "is-null" }),
  and: (...conditions: unknown[]) => ({ conditions }),
}));
vi.mock("~/server/auth/role", () => ({
  fetchUserAccountMemberships: () => Promise.resolve(membershipsForMockRole()),
}));
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) => {
        if (name === "x-vercel-ip-country") return mockCountryHeader;
        if (name === "x-onboarding-intent") return mockOnboardingIntentHeader;
        return null;
      },
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
  updateMock.mockClear();
  setMock.mockClear();
  whereMock.mockClear();
  returningMock.mockReset().mockResolvedValue([{ id: "producer-incomplete-1" }]);
  mockUserId = "user_test_1";
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
  mockOnboardingIntentHeader = null;
  mockHistoricalArtistAccess = false;
  mockClosureStarted = false;
  mockHashQueue = ["abcd"];
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("completeStudio — happy path + invariant carryover", () => {
  it("updates the invitation-provisioned Producer with the server-derived slug", async () => {
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(updateMock).toHaveBeenCalledOnce();
    const setArg = setMock.mock.calls[0]?.[0];
    expect(setArg).toMatchObject({
      displayName: "Ada Studios",
      timezone: "Europe/Berlin",
    });
    // Slug derived server-side via slugFromDisplayName + injected hash
    // "abcd". Helper produces "<body>-<hash>", so "Ada Studios" + "abcd"
    // → "ada-studios-abcd". Pin the shape so a future refactor that
    // accidentally drops the hash suffix or stops calling the helper
    // is caught.
    expect(setArg?.slug).toBe("ada-studios-abcd");
  });

  it("matches both the resolved Producer id and authenticated Clerk user", async () => {
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(whereMock).toHaveBeenCalledWith({
      conditions: [
        { a: "producer_id", b: "producer-incomplete-1" },
        { a: "clerk_user_id", b: "user_test_1" },
        { column: "closed_at", operator: "is-null" },
      ],
    });
    expect(returningMock).toHaveBeenCalledOnce();
    expect(setMock.mock.calls[0]?.[0]?.updatedAt).toBeInstanceOf(Date);
  });
});

describe("completeStudio — currency derivation from x-vercel-ip-country", () => {
  it("uses the producer's confirmed currency when provided", async () => {
    mockCountryHeader = "GB";
    const { completeStudio } = await import("../actions");
    await completeStudio({ ...validInput, currency: "ILS" });
    expect(setMock.mock.calls[0]?.[0]?.defaultCurrency).toBe("ILS");
  });

  it("uses GBP when header is GB", async () => {
    mockCountryHeader = "GB";
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(setMock.mock.calls[0]?.[0]?.defaultCurrency).toBe("GBP");
  });

  it("uses EUR for any EU member (DE)", async () => {
    mockCountryHeader = "DE";
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(setMock.mock.calls[0]?.[0]?.defaultCurrency).toBe("EUR");
  });

  it("uses ILS when header is IL", async () => {
    mockCountryHeader = "IL";
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(setMock.mock.calls[0]?.[0]?.defaultCurrency).toBe("ILS");
  });

  it("falls back to USD when x-vercel-ip-country is absent (local dev)", async () => {
    mockCountryHeader = null;
    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);
    expect(setMock.mock.calls[0]?.[0]?.defaultCurrency).toBe("USD");
  });
});

describe("completeStudio — safe re-entry", () => {
  it("preserves an established public slug when the producer edits identity", async () => {
    mockRole = {
      kind: "producer-complete",
      producer: {
        id: "producer-complete-1",
        displayName: "Ada",
        slug: "ada-produces",
        email: "ada@example.com",
      },
    };

    const { completeStudio } = await import("../actions");
    await completeStudio({ ...validInput, displayName: "Ada Studio" });

    expect(setMock.mock.calls[0]?.[0]?.slug).toBe("ada-produces");
    expect(whereMock).toHaveBeenCalledWith({
      conditions: [
        { a: "producer_id", b: "producer-complete-1" },
        { a: "clerk_user_id", b: "user_test_1" },
        { column: "closed_at", operator: "is-null" },
      ],
    });
  });
});

describe("completeStudio — slug retry loop on uniqueness conflict", () => {
  it("retries with a fresh hash on slug conflict and succeeds on the second attempt", async () => {
    // Queue two hashes — the first triggers the conflict, the second
    // wins. Without the retry loop this test fails: a single attempt
    // would surface the duplicate-key error to the caller.
    mockHashQueue = ["1111", "2222"];
    returningMock
      .mockRejectedValueOnce(
        new Error(
          'duplicate key value violates unique constraint "producers_slug_unique" on column "slug"',
        ),
      )
      .mockResolvedValueOnce([{ id: "producer-incomplete-1" }]);

    const { completeStudio } = await import("../actions");
    await completeStudio(validInput);

    // Two update attempts fired, with two distinct slugs.
    expect(updateMock).toHaveBeenCalledTimes(2);
    const firstSlug = (setMock.mock.calls[0]?.[0] as { slug?: string } | undefined)?.slug;
    const secondSlug = (setMock.mock.calls[1]?.[0] as { slug?: string } | undefined)?.slug;
    expect(firstSlug).toBe("ada-studios-1111");
    expect(secondSlug).toBe("ada-studios-2222");
    expect(firstSlug).not.toBe(secondSlug);
  });

  it("throws a friendly error after 3 consecutive slug conflicts", async () => {
    mockHashQueue = ["1111", "2222", "3333"];
    const conflict = new Error(
      'duplicate key value violates unique constraint "producers_slug_unique" on column "slug"',
    );
    returningMock
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict);

    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow(/could not allocate slug/);
    // Action attempted exactly 3 times before giving up.
    expect(updateMock).toHaveBeenCalledTimes(3);
  });

  it("rethrows non-slug DB errors without retrying", async () => {
    returningMock.mockRejectedValueOnce(new Error("connection lost"));
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow("connection lost");
    // Must NOT retry on unrelated errors — only slug-uniqueness.
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});

describe("completeStudio — auth + role invariants (carried over from completeOnboarding)", () => {
  it("throws unauthorized when no userId", async () => {
    mockUserId = null;
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow("unauthorized");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws missing DATABASE_URL when env var absent", async () => {
    delete process.env.DATABASE_URL;
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow("missing DATABASE_URL");
    expect(updateMock).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────
  // Task 16 carryover — the layout gate already redirects artists at
  // the render path, but a signed-in artist crafting a raw HTTP POST
  // (devtools / curl / a script) bypasses the layout. Without this
  // guard they'd silently create a producers row and "become" a
  // producer. The new completeStudio MUST preserve this invariant.
  // ─────────────────────────────────────────────────────────────────
  it("rejects when caller role is 'artist' (closes raw-POST hole)", async () => {
    mockRole = { kind: "artist" };
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow(
      "forbidden: producer access is invitation-only",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a closing Producer before any studio profile write", async () => {
    mockClosureStarted = true;
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow("forbidden: account closure started");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects an Artist raw POST that claims the retired create-studio input intent", async () => {
    mockRole = { kind: "artist" };
    const { completeStudio } = await import("../actions");
    await expect(
      completeStudio({
        ...validInput,
        intent: "create-studio",
      } as Parameters<typeof completeStudio>[0]),
    ).rejects.toThrow("forbidden: producer access is invitation-only");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects an Artist raw POST that carries the retired create-studio header", async () => {
    mockRole = { kind: "artist" };
    mockOnboardingIntentHeader = "create-studio";
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow(
      "forbidden: producer access is invitation-only",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a disconnected historical Artist without explicit create-studio intent", async () => {
    mockRole = { kind: "orphan" };
    mockHistoricalArtistAccess = true;
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow(
      "forbidden: producer access is invitation-only",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a disconnected historical Artist even with retired create-studio signals", async () => {
    mockRole = { kind: "orphan" };
    mockHistoricalArtistAccess = true;
    mockOnboardingIntentHeader = "create-studio";
    const { completeStudio } = await import("../actions");
    await expect(
      completeStudio({
        ...validInput,
        intent: "create-studio",
      } as Parameters<typeof completeStudio>[0]),
    ).rejects.toThrow("forbidden: producer access is invitation-only");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects an authenticated account without a provisioned Producer membership", async () => {
    mockRole = { kind: "orphan" };
    const { completeStudio } = await import("../actions");
    await expect(completeStudio(validInput)).rejects.toThrow(
      "forbidden: producer access is invitation-only",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("fails closed if the Producer disappears after the membership lookup", async () => {
    returningMock.mockResolvedValueOnce([]);
    const { completeStudio } = await import("../actions");

    await expect(completeStudio(validInput)).rejects.toThrow(
      "forbidden: producer access is invitation-only",
    );

    expect(updateMock).toHaveBeenCalledOnce();
    expect(returningMock).toHaveBeenCalledOnce();
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
    expect(updateMock).toHaveBeenCalledOnce();
  });
});

describe("completeStudio — input validation", () => {
  it("throws ZodError on empty displayName (zod.trim().min(1))", async () => {
    const { completeStudio } = await import("../actions");
    await expect(
      completeStudio({ displayName: "   ", timezone: "Europe/Berlin" }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws ZodError when displayName exceeds 80 chars", async () => {
    const { completeStudio } = await import("../actions");
    await expect(
      completeStudio({ displayName: "x".repeat(81), timezone: "UTC" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when timezone is empty", async () => {
    const { completeStudio } = await import("../actions");
    await expect(completeStudio({ displayName: "Ada", timezone: "" })).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});
