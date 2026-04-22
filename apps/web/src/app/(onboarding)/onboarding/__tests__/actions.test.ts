import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { UserRole } from "~/server/auth/role";

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
// Default: "producer-incomplete" so the 8 pre-existing tests pass
// unchanged. Individual tests override this to simulate the artist-
// POSTing-the-form attack (must reject) and orphan webhook-race
// (must proceed).
let mockRole: UserRole = {
  kind: "producer-incomplete",
  producer: {
    id: "producer-incomplete-1",
    displayName: null,
    slug: "ada-abcd",
    email: "ada@example.com",
  },
};
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

const validInput = {
  displayName: "Ada Studios",
  slug: "ada-studios",
  defaultCurrency: "USD" as const,
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
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("completeOnboarding", () => {
  it("upserts insert values that include parsed input + session email", async () => {
    const { completeOnboarding } = await import("../actions");
    await completeOnboarding(validInput);
    expect(insertMock).toHaveBeenCalledOnce();
    const valuesArg = valuesMock.mock.calls[0]?.[0];
    expect(valuesArg).toMatchObject({
      clerkUserId: "user_test_1",
      email: "ada@example.com",
      displayName: "Ada Studios",
      slug: "ada-studios",
      defaultCurrency: "USD",
      timezone: "Europe/Berlin",
    });
  });

  it("passes update set + bumped updatedAt on conflict (webhook already seeded row)", async () => {
    const { completeOnboarding } = await import("../actions");
    await completeOnboarding(validInput);
    const arg = onConflictDoUpdateMock.mock.calls[0]?.[0];
    expect(arg?.set).toMatchObject({
      displayName: "Ada Studios",
      slug: "ada-studios",
      defaultCurrency: "USD",
      timezone: "Europe/Berlin",
    });
    expect(arg?.set.updatedAt).toBeInstanceOf(Date);
  });

  it("throws ZodError on uppercase slug", async () => {
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding({ ...validInput, slug: "BadSlug" })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws unauthorized when no userId", async () => {
    mockUserId = null;
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow("unauthorized");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws missing DATABASE_URL when env var absent", async () => {
    delete process.env.DATABASE_URL;
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow("missing DATABASE_URL");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws when Clerk session lacks an email address", async () => {
    mockEmail = undefined;
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow(/unable to resolve email/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces a friendly error when slug is already taken", async () => {
    onConflictDoUpdateMock.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "producers_slug_unique" on column "slug"',
      ),
    );
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow(/slug is already taken/);
  });

  it("rethrows unknown db errors unchanged", async () => {
    onConflictDoUpdateMock.mockRejectedValueOnce(new Error("connection lost"));
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow("connection lost");
  });

  // ─────────────────────────────────────────────────────────────────
  // audit Task 16 — role-based hardening. The layout now blocks
  // artists from reaching /onboarding in the first place, but these
  // tests close the "raw HTTP POST" hole: a signed-in artist crafting
  // a direct POST to this server action (via devtools / curl / a
  // script) would bypass the layout. Without this check they'd
  // silently upsert a producers row and "become" a producer.
  // ─────────────────────────────────────────────────────────────────
  it("🔴 TASK 16: rejects when caller role is 'artist' (closes raw-POST hole)", async () => {
    mockRole = { kind: "artist" };
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow(
      /artist|forbidden/i,
    );
    // Invariant: the DB insert MUST NOT fire. Otherwise the artist
    // gets a producers row and becomes a producer via HTTP.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("proceeds when caller role is 'orphan' (Clerk webhook race — action's upsert handles it)", async () => {
    mockRole = { kind: "orphan" };
    const { completeOnboarding } = await import("../actions");
    await completeOnboarding(validInput);
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("proceeds when caller role is 'producer-complete' (idempotent re-save — no harm)", async () => {
    // Per Q1 the layout redirects complete producers away from
    // /onboarding. But if one reaches the action anyway (e.g. stale
    // client-side form submit after the layout would have redirected
    // on navigation), the upsert is idempotent by (clerkUserId) — no
    // double row created, just a harmless update.
    mockRole = {
      kind: "producer-complete",
      producer: {
        id: "producer-complete-1",
        displayName: "Ada Studios",
        slug: "ada-studios",
        email: "ada@example.com",
      },
    };
    const { completeOnboarding } = await import("../actions");
    await completeOnboarding(validInput);
    expect(insertMock).toHaveBeenCalledOnce();
  });
});
