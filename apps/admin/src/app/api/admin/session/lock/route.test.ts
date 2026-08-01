import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminAccessError,
  beginAdminReauthentication,
  lockAdminActivityIfInactive,
  requireFounderRole,
  type FounderIdentity,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { POST } from "./route";

vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/auth/access")>();
  return {
    ...actual,
    beginAdminReauthentication: vi.fn(),
    lockAdminActivityIfInactive: vi.fn(),
    requireFounderRole: vi.fn(),
  };
});

vi.mock("~/server/auth/request-security", () => ({
  isSameOriginMutation: vi.fn(),
}));

const mockedBeginAdminReauthentication = vi.mocked(
  beginAdminReauthentication,
);
const mockedLockAdminActivityIfInactive = vi.mocked(
  lockAdminActivityIfInactive,
);
const mockedRequireFounderRole = vi.mocked(requireFounderRole);
const mockedIsSameOriginMutation = vi.mocked(isSameOriginMutation);

const FOUNDER_IDENTITY: FounderIdentity = {
  accessEmail: "founder@example.test",
  accessIssuedAt: 1_800_000_000,
  accessSubject: "access-founder",
  accessTokenFingerprint: "access-token-fingerprint",
  sessionId: "sess_founder",
  userId: "user_founder",
};

function lockRequest(): Request {
  return new Request(
    "https://admin.skitza.app/api/admin/session/lock",
    {
      method: "POST",
      headers: {
        origin: "https://admin.skitza.app",
        "sec-fetch-site": "same-origin",
      },
    },
  );
}

describe("admin lock API authorization", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("authenticates before returning the same-origin exception", async () => {
    mockedRequireFounderRole.mockResolvedValue(FOUNDER_IDENTITY);
    mockedIsSameOriginMutation.mockReturnValue(false);

    const request = lockRequest();
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
    expect(mockedLockAdminActivityIfInactive).not.toHaveBeenCalled();
    expect(mockedBeginAdminReauthentication).not.toHaveBeenCalled();
  });

  it("denies failed authorization without locking or writing a marker", async () => {
    mockedRequireFounderRole.mockRejectedValue(
      new AdminAccessError("access-proof-required"),
    );

    const response = await POST(lockRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mockedIsSameOriginMutation).not.toHaveBeenCalled();
    expect(mockedLockAdminActivityIfInactive).not.toHaveBeenCalled();
    expect(mockedBeginAdminReauthentication).not.toHaveBeenCalled();
  });

  it("returns 409 without a marker when the session is still active", async () => {
    mockedRequireFounderRole.mockResolvedValue(FOUNDER_IDENTITY);
    mockedIsSameOriginMutation.mockReturnValue(true);
    mockedLockAdminActivityIfInactive.mockResolvedValue({
      locked: false,
      retryAfterMs: 12_345,
    });

    const response = await POST(lockRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      locked: false,
      retryAfterMs: 12_345,
    });
    expect(mockedLockAdminActivityIfInactive).toHaveBeenCalledWith(
      FOUNDER_IDENTITY,
    );
    expect(mockedBeginAdminReauthentication).not.toHaveBeenCalled();
  });

  it("returns 204 and writes a marker after confirming the lock", async () => {
    mockedRequireFounderRole.mockResolvedValue(FOUNDER_IDENTITY);
    mockedIsSameOriginMutation.mockReturnValue(true);
    mockedLockAdminActivityIfInactive.mockResolvedValue({ locked: true });

    const response = await POST(lockRequest());

    expect(response.status).toBe(204);
    expect(mockedLockAdminActivityIfInactive).toHaveBeenCalledWith(
      FOUNDER_IDENTITY,
    );
    expect(mockedBeginAdminReauthentication).toHaveBeenCalledWith(
      FOUNDER_IDENTITY,
    );
    expect(
      mockedLockAdminActivityIfInactive.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      mockedBeginAdminReauthentication.mock.invocationCallOrder[0] ??
        Number.NEGATIVE_INFINITY,
    );
  });
});
