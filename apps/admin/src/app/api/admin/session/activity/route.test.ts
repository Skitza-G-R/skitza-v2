import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminAccessError,
  refreshAdminActivity,
  requireActiveAdminAccess,
  type FounderIdentity,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
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

vi.mock("~/server/auth/request-security", () => ({
  isSameOriginMutation: vi.fn(),
}));

const mockedRefreshAdminActivity = vi.mocked(refreshAdminActivity);
const mockedRequireActiveAdminAccess = vi.mocked(
  requireActiveAdminAccess,
);
const mockedIsSameOriginMutation = vi.mocked(isSameOriginMutation);

const FOUNDER_IDENTITY: FounderIdentity = {
  accessEmail: "founder@example.test",
  accessIssuedAt: 1_800_000_000,
  accessSubject: "access-founder",
  accessTokenFingerprint: "access-token-fingerprint",
  sessionId: "sess_founder",
  userId: "user_founder",
};

function activityRequest(): Request {
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

  it("authenticates before returning the same-origin exception", async () => {
    mockedRequireActiveAdminAccess.mockResolvedValue(FOUNDER_IDENTITY);
    mockedIsSameOriginMutation.mockReturnValue(false);

    const request = activityRequest();
    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
    expect(mockedRequireActiveAdminAccess).toHaveBeenCalledOnce();
    expect(mockedIsSameOriginMutation).toHaveBeenCalledWith(request);
    expect(
      mockedRequireActiveAdminAccess.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      mockedIsSameOriginMutation.mock.invocationCallOrder[0] ??
        Number.NEGATIVE_INFINITY,
    );
    expect(mockedRefreshAdminActivity).not.toHaveBeenCalled();
  });

  it("denies failed authorization without writing activity", async () => {
    mockedRequireActiveAdminAccess.mockRejectedValue(
      new AdminAccessError("founder-role-required"),
    );

    const response = await POST(activityRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mockedIsSameOriginMutation).not.toHaveBeenCalled();
    expect(mockedRefreshAdminActivity).not.toHaveBeenCalled();
  });

  it("passes the full authorized founder identity to activity refresh", async () => {
    mockedRequireActiveAdminAccess.mockResolvedValue(FOUNDER_IDENTITY);
    mockedIsSameOriginMutation.mockReturnValue(true);

    const response = await POST(activityRequest());

    expect(response.status).toBe(204);
    expect(mockedRefreshAdminActivity).toHaveBeenCalledWith(
      FOUNDER_IDENTITY,
    );
  });
});
