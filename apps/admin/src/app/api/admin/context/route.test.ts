import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminAccessError,
  requireActiveAdminAccess,
} from "~/server/auth/access";
import { GET } from "./route";

vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/auth/access")>();
  return {
    ...actual,
    requireActiveAdminAccess: vi.fn(),
  };
});

const ORIGINAL_LIVE_URL = process.env.ADMIN_LIVE_DATABASE_URL;
const ORIGINAL_TEST_URL = process.env.ADMIN_TEST_DATABASE_URL;
const mockedRequireActiveAdminAccess = vi.mocked(requireActiveAdminAccess);

describe("protected admin context API", () => {
  beforeEach(() => {
    process.env.ADMIN_LIVE_DATABASE_URL =
      "postgresql://live.example.test/skitza";
    process.env.ADMIN_TEST_DATABASE_URL =
      "postgresql://test.example.test/skitza";
  });

  afterEach(() => {
    vi.resetAllMocks();
    if (ORIGINAL_LIVE_URL === undefined) {
      delete process.env.ADMIN_LIVE_DATABASE_URL;
    } else {
      process.env.ADMIN_LIVE_DATABASE_URL = ORIGINAL_LIVE_URL;
    }
    if (ORIGINAL_TEST_URL === undefined) {
      delete process.env.ADMIN_TEST_DATABASE_URL;
    } else {
      process.env.ADMIN_TEST_DATABASE_URL = ORIGINAL_TEST_URL;
    }
  });

  it("rejects a signed-in non-founder before returning environment context", async () => {
    mockedRequireActiveAdminAccess.mockRejectedValue(
      new AdminAccessError("founder-role-required"),
    );

    const response = await GET(
      new Request(
        "https://admin.skitza.app/api/admin/context?environment=live",
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns only the sanitized server-selected environment to an authorized founder", async () => {
    mockedRequireActiveAdminAccess.mockResolvedValue({
      hasRecentMultiFactorVerification: true,
      sessionId: "sess_founder",
      userId: "user_founder",
    });

    const response = await GET(
      new Request(
        "https://admin.skitza.app/api/admin/context?environment=test",
      ),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authorized: true,
      environment: { id: "test", label: "Test", tone: "info" },
    });
    expect(JSON.stringify(body)).not.toContain("postgresql://");
  });
});
