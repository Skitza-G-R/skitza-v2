import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_INACTIVITY_TIMEOUT_MS,
  createInactivityToken,
} from "./inactivity-token";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  currentUser: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  currentUser: mocks.currentUser,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

import {
  ADMIN_ACTIVITY_COOKIE_NAME,
  AdminAccessError,
  lockAdminActivityIfInactive,
  requireActiveAdminAccess,
  requireFounderRole,
} from "./access";
import {
  SKITZA_ADMIN_ROLE_METADATA_KEY,
  SKITZA_FOUNDER_ROLE,
} from "./founder-authorization";

const ADMIN_SECRET = "test-only-admin-session-secret-32-bytes";
const SESSION_ID = "sess_founder";
const USER_ID = "user_founder";
const START_MS = 5_000_000;

function setFounderSession(options?: {
  actor?: object | null;
  privateMetadata?: Record<string, unknown>;
}) {
  mocks.auth.mockResolvedValue({
    actor: options?.actor ?? null,
    factorVerificationAge: [0, 0],
    has: () => true,
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
  mocks.currentUser.mockResolvedValue({
    id: USER_ID,
    privateMetadata: options?.privateMetadata ?? {
      [SKITZA_ADMIN_ROLE_METADATA_KEY]: SKITZA_FOUNDER_ROLE,
    },
    twoFactorEnabled: true,
  });
}

function setCookieValue(value: string | undefined) {
  mocks.cookieGet.mockReturnValue(
    value === undefined ? undefined : { value },
  );
}

function activityToken(lastActivityAtMs: number): string {
  return createInactivityToken({
    lastActivityAtMs,
    secret: ADMIN_SECRET,
    sessionId: SESSION_ID,
  });
}

describe("server admin access boundary", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = ADMIN_SECRET;
    mocks.cookies.mockResolvedValue({
      delete: mocks.cookieDelete,
      get: mocks.cookieGet,
      set: mocks.cookieSet,
    });
    setFounderSession();
    setCookieValue(activityToken(START_MS));
    vi.spyOn(Date, "now").mockReturnValue(START_MS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    delete process.env.ADMIN_SESSION_SECRET;
  });

  it("rejects a signed-in non-founder before reading or writing activity", async () => {
    setFounderSession({ privateMetadata: {} });

    await expect(requireActiveAdminAccess()).rejects.toEqual(
      expect.objectContaining<Partial<AdminAccessError>>({
        reason: "founder-role-required",
      }),
    );
    expect(mocks.cookieGet).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it("rejects Clerk impersonation before loading the target user", async () => {
    setFounderSession({ actor: { sub: "user_support" } });

    await expect(requireFounderRole()).rejects.toEqual(
      expect.objectContaining<Partial<AdminAccessError>>({
        reason: "impersonated-session",
      }),
    );
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("requires an activity cookie and rejects a tampered cookie", async () => {
    setCookieValue(undefined);
    await expect(requireActiveAdminAccess()).rejects.toEqual(
      expect.objectContaining<Partial<AdminAccessError>>({
        reason: "activity-lock-required",
      }),
    );

    setCookieValue(`${activityToken(START_MS)}tampered`);
    await expect(requireActiveAdminAccess()).rejects.toEqual(
      expect.objectContaining<Partial<AdminAccessError>>({
        reason: "activity-lock-required",
      }),
    );
  });

  it("locks at exactly 30 inactive minutes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      START_MS + ADMIN_INACTIVITY_TIMEOUT_MS,
    );

    await expect(requireActiveAdminAccess()).rejects.toEqual(
      expect.objectContaining<Partial<AdminAccessError>>({
        reason: "activity-lock-required",
      }),
    );
  });

  it("does not let a stale tab clear activity refreshed by another tab", async () => {
    setCookieValue(activityToken(START_MS));

    await expect(
      lockAdminActivityIfInactive(
        SESSION_ID,
        START_MS + ADMIN_INACTIVITY_TIMEOUT_MS - 1,
      ),
    ).resolves.toEqual({ locked: false, retryAfterMs: 1 });
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it("clears the shared activity record once it is actually expired", async () => {
    setCookieValue(activityToken(START_MS));

    await expect(
      lockAdminActivityIfInactive(
        SESSION_ID,
        START_MS + ADMIN_INACTIVITY_TIMEOUT_MS,
      ),
    ).resolves.toEqual({ locked: true });
    expect(mocks.cookieDelete).toHaveBeenCalledWith(
      ADMIN_ACTIVITY_COOKIE_NAME,
    );
  });
});
