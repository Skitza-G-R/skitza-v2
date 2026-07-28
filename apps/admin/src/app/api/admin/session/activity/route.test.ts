import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminAccessError,
  refreshAdminActivity,
  requireActiveAdminAccess,
} from "~/server/auth/access";
import { POST } from "./route";

vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/auth/access")>();
  return {
    ...actual,
    refreshAdminActivity: vi.fn(),
    requireActiveAdminAccess: vi.fn(),
  };
});

const mockedRefreshAdminActivity = vi.mocked(refreshAdminActivity);
const mockedRequireActiveAdminAccess = vi.mocked(
  requireActiveAdminAccess,
);

function sameOriginRequest(): Request {
  return new Request(
    "https://admin.skitza.app/api/admin/session/activity",
    {
      method: "POST",
      headers: {
        origin: "https://admin.skitza.app",
        "sec-fetch-site": "same-origin",
      },
    },
  );
}

describe("admin activity API authorization", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("denies a non-founder without writing an activity cookie", async () => {
    mockedRequireActiveAdminAccess.mockRejectedValue(
      new AdminAccessError("founder-role-required"),
    );

    const response = await POST(sameOriginRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mockedRefreshAdminActivity).not.toHaveBeenCalled();
  });

  it("refreshes only the authorized founder session", async () => {
    mockedRequireActiveAdminAccess.mockResolvedValue({
      hasRecentMultiFactorVerification: false,
      sessionId: "sess_founder",
      userId: "user_founder",
    });

    const response = await POST(sameOriginRequest());

    expect(response.status).toBe(204);
    expect(mockedRefreshAdminActivity).toHaveBeenCalledWith(
      "sess_founder",
    );
  });
});
