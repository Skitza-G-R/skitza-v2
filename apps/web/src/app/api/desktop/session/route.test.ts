import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  auth: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("~/server/auth/clerk-identity", () => ({ auth: mocks.auth }));
vi.mock("@skitza/db", () => ({
  and: mocks.and,
  createDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.limit }),
      }),
    }),
  }),
  eq: mocks.eq,
  isNull: mocks.isNull,
  producers: { clerkUserId: "clerk_user_id", closedAt: "closed_at", id: "id" },
}));

describe("desktop live session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    mocks.limit.mockResolvedValue([{ id: "producer-a" }]);
  });

  it("looks up the canonical account but returns the current provider account", async () => {
    mocks.auth.mockResolvedValue({ providerUserId: "provider-user-a", userId: "canonical-user-a" });
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.eq).toHaveBeenCalledWith("clerk_user_id", "canonical-user-a");
    expect(mocks.isNull).toHaveBeenCalledWith("closed_at");
    expect(await response.json()).toEqual({ active: true, accountId: "provider-user-a" });
  });

  it("fails with 401 when the Clerk session is no longer active", async () => {
    mocks.auth.mockResolvedValue({ providerUserId: null, userId: null });
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ active: false });
  });

  it("fails with 403 and no account identifier after the producer is deleted", async () => {
    mocks.auth.mockResolvedValue({ providerUserId: "provider-deleted-user", userId: "deleted-user" });
    mocks.limit.mockResolvedValue([]);
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ active: false });
  });

  it("fails with 403 and no account identifier after the producer is closed", async () => {
    mocks.auth.mockResolvedValue({ providerUserId: "provider-closed-user", userId: "closed-user" });
    mocks.limit.mockResolvedValue([]);
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.isNull).toHaveBeenCalledWith("closed_at");
    expect(await response.json()).toEqual({ active: false });
  });

  it("fails closed without exposing an account when identity resolution fails", async () => {
    mocks.auth.mockRejectedValue(new Error("IDENTITY_BINDING_REVOKED"));
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ active: false });
  });
});
