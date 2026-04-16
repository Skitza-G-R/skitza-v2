import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const returningMock = vi.fn().mockResolvedValue([{ id: "producer-uuid" }]);
const dbMock = {
  update: () => ({ set: () => ({ where: () => ({ returning: returningMock }) }) }),
};

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({ auth: () => Promise.resolve({ userId: mockUserId }) }));
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
  returningMock.mockClear();
  mockUserId = "user_test_1";
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("completeOnboarding", () => {
  it("calls update once on valid input", async () => {
    const { completeOnboarding } = await import("../actions");
    await completeOnboarding(validInput);
    expect(returningMock).toHaveBeenCalledOnce();
  });

  it("throws ZodError on uppercase slug", async () => {
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding({ ...validInput, slug: "BadSlug" })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(returningMock).not.toHaveBeenCalled();
  });

  it("throws unauthorized when no userId", async () => {
    mockUserId = null;
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow("unauthorized");
    expect(returningMock).not.toHaveBeenCalled();
  });

  it("throws missing DATABASE_URL when env var absent", async () => {
    delete process.env.DATABASE_URL;
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow("missing DATABASE_URL");
    expect(returningMock).not.toHaveBeenCalled();
  });

  it("throws when the producer row hasn't been provisioned yet (webhook race)", async () => {
    returningMock.mockResolvedValueOnce([]); // 0-row update — webhook hasn't landed
    const { completeOnboarding } = await import("../actions");
    await expect(completeOnboarding(validInput)).rejects.toThrow(/not provisioned/);
    expect(returningMock).toHaveBeenCalledOnce();
  });
});
