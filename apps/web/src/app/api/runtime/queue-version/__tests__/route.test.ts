import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createDb: vi.fn(() => ({ kind: "db" })),
  loadQueueVersion: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("~/server/runtime/queue-version", () => ({
  loadQueueVersion: mocks.loadQueueVersion,
}));

import { GET } from "../route";

const proofId = "10000000-0000-4000-8000-000000000001";

describe("private queue version route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://unit-test-only";
    mocks.auth.mockResolvedValue({ userId: "user_123" });
    mocks.loadQueueVersion.mockResolvedValue("v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("requires an authenticated viewer and always disables caching", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await GET(
      new Request("https://skitza.test/api/runtime/queue-version?kind=dashboard"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
    expect(mocks.createDb).not.toHaveBeenCalled();
    expect(mocks.loadQueueVersion).not.toHaveBeenCalled();
  });

  it("rejects malformed or extra scope instead of broadening the read", async () => {
    const response = await GET(
      new Request(
        `https://skitza.test/api/runtime/queue-version?kind=payment-proof&proofId=${proofId}&extra=1`,
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.loadQueueVersion).not.toHaveBeenCalled();
  });

  it("returns only the opaque tenant-scoped revision", async () => {
    const response = await GET(
      new Request(
        `https://skitza.test/api/runtime/queue-version?kind=payment-proof&proofId=${proofId}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: "v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    expect(mocks.loadQueueVersion).toHaveBeenCalledWith({ kind: "db" }, "user_123", {
      kind: "payment-proof",
      proofId,
    });
  });

  it("keeps database failures generic and private", async () => {
    mocks.loadQueueVersion.mockRejectedValue(new Error("contains-sensitive-details"));

    const response = await GET(
      new Request("https://skitza.test/api/runtime/queue-version?kind=purchase-requests"),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });
});
