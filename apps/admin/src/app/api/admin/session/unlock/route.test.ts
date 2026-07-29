import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminAccessError,
  requireFounderRole,
  unlockAdminSession,
  type FounderIdentity,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { POST } from "./route";

vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/auth/access")>();
  return {
    ...actual,
    requireFounderRole: vi.fn(),
    unlockAdminSession: vi.fn(),
  };
});

vi.mock("~/server/auth/request-security", () => ({
  isSameOriginMutation: vi.fn(),
}));

const mockedRequireFounderRole = vi.mocked(requireFounderRole);
const mockedUnlockAdminSession = vi.mocked(unlockAdminSession);
const mockedIsSameOriginMutation = vi.mocked(isSameOriginMutation);

const FOUNDER_IDENTITY: FounderIdentity = {
  accessEmail: "founder@example.test",
  accessIssuedAt: 1_800_000_000,
  accessSubject: "access-founder",
  accessTokenFingerprint: "access-token-fingerprint",
  sessionId: "sess_founder",
  userId: "user_founder",
};

function unlockRequest(): Request {
  return new Request(
    "https://admin.skitza.app/api/admin/session/unlock",
    {
      method: "POST",
      headers: {
        origin: "https://admin.skitza.app",
        "sec-fetch-site": "same-origin",
      },
    },
  );
}

describe("admin unlock API authorization", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("authenticates before returning the same-origin exception", async () => {
    mockedRequireFounderRole.mockResolvedValue(FOUNDER_IDENTITY);
    mockedIsSameOriginMutation.mockReturnValue(false);

    const request = unlockRequest();
    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
    expect(mockedRequireFounderRole).toHaveBeenCalledOnce();
    expect(mockedIsSameOriginMutation).toHaveBeenCalledWith(request);
    expect(
      mockedRequireFounderRole.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      mockedIsSameOriginMutation.mock.invocationCallOrder[0] ??
        Number.NEGATIVE_INFINITY,
    );
    expect(mockedUnlockAdminSession).not.toHaveBeenCalled();
  });

  it("denies failed authorization without attempting unlock", async () => {
    mockedRequireFounderRole.mockRejectedValue(
      new AdminAccessError("founder-role-required"),
    );

    const response = await POST(unlockRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mockedIsSameOriginMutation).not.toHaveBeenCalled();
    expect(mockedUnlockAdminSession).not.toHaveBeenCalled();
  });

  it("returns the exact Cloudflare reauthentication response", async () => {
    mockedRequireFounderRole.mockResolvedValue(FOUNDER_IDENTITY);
    mockedIsSameOriginMutation.mockReturnValue(true);
    mockedUnlockAdminSession.mockResolvedValue({
      logoutPath: "/cdn-cgi/access/logout",
      reauthenticationRequired: true,
      unlocked: false,
    });

    const response = await POST(unlockRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "cloudflare_reauthentication_required",
      logoutPath: "/cdn-cgi/access/logout",
    });
    expect(mockedUnlockAdminSession).toHaveBeenCalledWith(
      FOUNDER_IDENTITY,
    );
  });

  it("returns 200 after secure reauthentication succeeds", async () => {
    mockedRequireFounderRole.mockResolvedValue(FOUNDER_IDENTITY);
    mockedIsSameOriginMutation.mockReturnValue(true);
    mockedUnlockAdminSession.mockResolvedValue({ unlocked: true });

    const response = await POST(unlockRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unlocked: true });
    expect(mockedUnlockAdminSession).toHaveBeenCalledWith(
      FOUNDER_IDENTITY,
    );
  });
});
