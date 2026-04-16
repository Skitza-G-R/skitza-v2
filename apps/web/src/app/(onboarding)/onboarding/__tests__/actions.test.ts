import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

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
});
