import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@skitza/db", () => ({
  createDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.limit }),
      }),
    }),
  }),
  eq: vi.fn(),
  producers: { clerkUserId: "clerk_user_id", id: "id" },
}));

describe("desktop live session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    mocks.limit.mockResolvedValue([{ id: "producer-a" }]);
  });

  it("returns only the current Clerk account with no-store headers", async () => {
    mocks.auth.mockResolvedValue({ userId: "user-a" });
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ active: true, accountId: "user-a" });
  });

  it("fails with 401 when the Clerk session is no longer active", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ active: false });
  });

  it("fails with 403 and no account identifier after the producer is deleted", async () => {
    mocks.auth.mockResolvedValue({ userId: "deleted-user" });
    mocks.limit.mockResolvedValue([]);
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ active: false });
  });
});
