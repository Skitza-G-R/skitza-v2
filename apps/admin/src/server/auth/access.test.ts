import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_INACTIVITY_TIMEOUT_MS,
  createInactivityToken,
  verifyInactivityToken,
} from "./inactivity-token";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  currentUser: vi.fn(),
  headers: vi.fn(),
  verifyCloudflareAccessHeaders: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  currentUser: mocks.currentUser,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers,
}));

vi.mock("./cloudflare-access", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./cloudflare-access")>();
  return {
    ...actual,
    verifyCloudflareAccessHeaders:
      mocks.verifyCloudflareAccessHeaders,
  };
});

import {
  ADMIN_ACTIVITY_COOKIE_NAME,
  ADMIN_REAUTHENTICATION_COOKIE_NAME,
  CLOUDFLARE_ACCESS_LOGOUT_PATH,
  AdminAccessError,
  lockAdminActivityIfInactive,
  refreshAdminActivity,
  requireActiveAdminAccess,
  requireFounderRole,
  unlockAdminSession,
  type FounderIdentity,
} from "./access";
import {
  CloudflareAccessVerificationError,
  type CloudflareAccessIdentity,
} from "./cloudflare-access";
import {
  SKITZA_ADMIN_ROLE_METADATA_KEY,
  SKITZA_FOUNDER_ROLE,
} from "./founder-authorization";

const ADMIN_SECRET = "test-only-admin-session-secret-32-bytes";
const ACCESS_AUDIENCE = "admin-access-audience";
const ACCESS_EMAIL = "founder@example.test";
const ACCESS_ISSUED_AT = 1_800_000_000;
const ACCESS_SUBJECT = "access-founder";
const ACCESS_TOKEN_FINGERPRINT = "a".repeat(43);
const REPLACEMENT_TOKEN_FINGERPRINT = "b".repeat(43);
const SESSION_ID = "sess_founder";
const USER_ID = "user_founder";
const START_MS = (ACCESS_ISSUED_AT + 60) * 1_000;
const REQUEST_HEADERS = new Headers({
  host: "admin.skitza.app",
});

const ACCESS_IDENTITY: CloudflareAccessIdentity = {
  audience: ACCESS_AUDIENCE,
  email: ACCESS_EMAIL,
  expiresAt: ACCESS_ISSUED_AT + 3_600,
  issuedAt: ACCESS_ISSUED_AT,
  issuer: "https://skitza.cloudflareaccess.com",
  notBefore: ACCESS_ISSUED_AT,
  subject: ACCESS_SUBJECT,
  tokenFingerprint: ACCESS_TOKEN_FINGERPRINT,
};

const FOUNDER_IDENTITY: FounderIdentity = {
  accessEmail: ACCESS_IDENTITY.email,
  accessIssuedAt: ACCESS_IDENTITY.issuedAt,
  accessSubject: ACCESS_IDENTITY.subject,
  accessTokenFingerprint: ACCESS_IDENTITY.tokenFingerprint,
  sessionId: SESSION_ID,
  userId: USER_ID,
};

const ORIGINAL_ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET;

let cookieValues = new Map<string, string>();

function setClerkSession(options?: {
  actor?: object | null;
  emailAddresses?: ReadonlyArray<{
    emailAddress: string;
    verification?: { status?: string | null } | null;
  }>;
  privateMetadata?: Record<string, unknown>;
  sessionId?: string | null;
  userId?: string | null;
}) {
  const userId =
    options && "userId" in options ? options.userId : USER_ID;
  const sessionId =
    options && "sessionId" in options
      ? options.sessionId
      : SESSION_ID;

  mocks.auth.mockResolvedValue({
    actor: options?.actor ?? null,
    sessionId,
    userId,
  });
  mocks.currentUser.mockResolvedValue({
    emailAddresses: options?.emailAddresses ?? [
      {
        emailAddress: ACCESS_EMAIL,
        verification: { status: "verified" },
      },
    ],
    id: userId,
    privateMetadata: options?.privateMetadata ?? {
      [SKITZA_ADMIN_ROLE_METADATA_KEY]: SKITZA_FOUNDER_ROLE,
    },
  });
}

function setCookie(name: string, value: string | undefined): void {
  if (value === undefined) {
    cookieValues.delete(name);
  } else {
    cookieValues.set(name, value);
  }
}

function activityToken(
  lastActivityAtMs: number,
  overrides: Partial<{
    accessSubject: string;
    minimumAccessIssuedAtSec: number;
    sessionId: string;
  }> = {},
): string {
  return createInactivityToken({
    accessSubject: ACCESS_SUBJECT,
    lastActivityAtMs,
    minimumAccessIssuedAtSec: ACCESS_ISSUED_AT,
    secret: ADMIN_SECRET,
    sessionId: SESSION_ID,
    ...overrides,
  });
}

function accessErrorReason(
  reason: AdminAccessError["reason"],
): Readonly<{ reason: AdminAccessError["reason"] }> {
  return { reason };
}

describe("server admin access boundary", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = ADMIN_SECRET;
    cookieValues = new Map<string, string>();

    mocks.headers.mockResolvedValue(REQUEST_HEADERS);
    mocks.verifyCloudflareAccessHeaders.mockResolvedValue(
      ACCESS_IDENTITY,
    );
    mocks.cookies.mockResolvedValue({
      delete: mocks.cookieDelete,
      get: mocks.cookieGet,
      set: mocks.cookieSet,
    });
    mocks.cookieGet.mockImplementation((name: string) => {
      const value = cookieValues.get(name);
      return value === undefined ? undefined : { value };
    });
    mocks.cookieSet.mockImplementation(
      (cookie: { name: string; value: string }) => {
        cookieValues.set(cookie.name, cookie.value);
      },
    );
    mocks.cookieDelete.mockImplementation((name: string) => {
      cookieValues.delete(name);
    });

    setClerkSession();
    setCookie(
      ADMIN_ACTIVITY_COOKIE_NAME,
      activityToken(START_MS),
    );
    vi.spyOn(Date, "now").mockReturnValue(START_MS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    if (ORIGINAL_ADMIN_SESSION_SECRET === undefined) {
      delete process.env.ADMIN_SESSION_SECRET;
    } else {
      process.env.ADMIN_SESSION_SECRET =
        ORIGINAL_ADMIN_SESSION_SECRET;
    }
  });

  it.each([
    {
      failure: new CloudflareAccessVerificationError(
        "token-required",
      ),
      expectedReason: "access-proof-required",
    },
    {
      failure: new CloudflareAccessVerificationError("token-invalid"),
      expectedReason: "access-proof-required",
    },
    {
      failure: new Error("JWKS network unavailable"),
      expectedReason: "access-proof-required",
    },
    {
      failure: new CloudflareAccessVerificationError(
        "configuration-invalid",
      ),
      expectedReason: "configuration-invalid",
    },
  ] as const)(
    "rejects Access failure as $expectedReason before touching Clerk or cookies",
    async ({ expectedReason, failure }) => {
      mocks.verifyCloudflareAccessHeaders.mockRejectedValue(failure);

      await expect(requireActiveAdminAccess()).rejects.toMatchObject(
        accessErrorReason(expectedReason),
      );

      expect(mocks.headers).toHaveBeenCalledOnce();
      expect(
        mocks.verifyCloudflareAccessHeaders,
      ).toHaveBeenCalledWith(REQUEST_HEADERS);
      expect(mocks.auth).not.toHaveBeenCalled();
      expect(mocks.currentUser).not.toHaveBeenCalled();
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.cookieGet).not.toHaveBeenCalled();
      expect(mocks.cookieSet).not.toHaveBeenCalled();
      expect(mocks.cookieDelete).not.toHaveBeenCalled();
    },
  );

  it("rejects a signed-out Clerk session only after valid Access", async () => {
    setClerkSession({ sessionId: null, userId: null });

    await expect(requireFounderRole()).rejects.toMatchObject(
      accessErrorReason("signed-out"),
    );

    expect(
      mocks.verifyCloudflareAccessHeaders,
    ).toHaveBeenCalledOnce();
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("rejects Clerk impersonation before loading the target user", async () => {
    setClerkSession({ actor: { sub: "user_support" } });

    await expect(requireFounderRole()).rejects.toMatchObject(
      accessErrorReason("impersonated-session"),
    );

    expect(
      mocks.verifyCloudflareAccessHeaders,
    ).toHaveBeenCalledOnce();
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("rejects a signed-in non-founder before reading activity", async () => {
    setClerkSession({ privateMetadata: {} });

    await expect(requireActiveAdminAccess()).rejects.toMatchObject(
      accessErrorReason("founder-role-required"),
    );

    expect(mocks.cookieGet).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it.each([
    {
      emailAddresses: [
        {
          emailAddress: "other@example.test",
          verification: { status: "verified" },
        },
      ],
      label: "a different verified Clerk email",
    },
    {
      emailAddresses: [
        {
          emailAddress: ACCESS_EMAIL,
          verification: { status: "unverified" },
        },
      ],
      label: "an unverified matching Clerk email",
    },
  ])("rejects $label", async ({ emailAddresses }) => {
    setClerkSession({ emailAddresses });

    await expect(requireFounderRole()).rejects.toMatchObject(
      accessErrorReason("access-identity-mismatch"),
    );
  });

  it("accepts only a case-insensitive matching verified Clerk founder email", async () => {
    setClerkSession({
      emailAddresses: [
        {
          emailAddress: "  FOUNDER@EXAMPLE.TEST ",
          verification: { status: "verified" },
        },
      ],
    });

    await expect(requireFounderRole()).resolves.toEqual(
      FOUNDER_IDENTITY,
    );
  });

  it("requires an activity cookie and rejects tampered or wrongly bound activity", async () => {
    setCookie(ADMIN_ACTIVITY_COOKIE_NAME, undefined);
    await expect(requireActiveAdminAccess()).rejects.toMatchObject(
      accessErrorReason("activity-lock-required"),
    );

    for (const token of [
      `${activityToken(START_MS)}tampered`,
      activityToken(START_MS, { sessionId: "sess_other" }),
      activityToken(START_MS, {
        accessSubject: "access-other",
      }),
    ]) {
      setCookie(ADMIN_ACTIVITY_COOKIE_NAME, token);
      await expect(requireActiveAdminAccess()).rejects.toMatchObject(
        accessErrorReason("activity-lock-required"),
      );
    }
  });

  it("rejects an Access assertion older than the signed activity floor", async () => {
    setCookie(
      ADMIN_ACTIVITY_COOKIE_NAME,
      activityToken(START_MS, {
        minimumAccessIssuedAtSec: ACCESS_ISSUED_AT + 1,
      }),
    );

    await expect(requireActiveAdminAccess()).rejects.toMatchObject(
      accessErrorReason("activity-lock-required"),
    );
  });

  it("remains active one millisecond before and locks at the exact 30-minute boundary", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      START_MS + ADMIN_INACTIVITY_TIMEOUT_MS - 1,
    );
    await expect(requireActiveAdminAccess()).resolves.toEqual(
      FOUNDER_IDENTITY,
    );

    vi.spyOn(Date, "now").mockReturnValue(
      START_MS + ADMIN_INACTIVITY_TIMEOUT_MS,
    );
    await expect(requireActiveAdminAccess()).rejects.toMatchObject(
      accessErrorReason("activity-lock-required"),
    );
  });

  it("does not let a stale tab clear activity refreshed by another tab", async () => {
    await expect(
      lockAdminActivityIfInactive(
        FOUNDER_IDENTITY,
        START_MS + ADMIN_INACTIVITY_TIMEOUT_MS - 1,
      ),
    ).resolves.toEqual({ locked: false, retryAfterMs: 1 });
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it("clears the shared activity record at exact expiry", async () => {
    await expect(
      lockAdminActivityIfInactive(
        FOUNDER_IDENTITY,
        START_MS + ADMIN_INACTIVITY_TIMEOUT_MS,
      ),
    ).resolves.toEqual({ locked: true });
    expect(mocks.cookieDelete).toHaveBeenCalledWith(
      ADMIN_ACTIVITY_COOKIE_NAME,
    );
  });

  it("refreshes activity with the full Clerk and Access binding and secure cookie flags", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const refreshedAtMs = START_MS + 1_000;

    await refreshAdminActivity(FOUNDER_IDENTITY, refreshedAtMs);

    const token = cookieValues.get(ADMIN_ACTIVITY_COOKIE_NAME);
    expect(token).toBeDefined();
    if (!token) throw new Error("Expected refreshed activity token");
    expect(mocks.cookieSet).toHaveBeenCalledWith({
      httpOnly: true,
      maxAge: 30 * 60,
      name: ADMIN_ACTIVITY_COOKIE_NAME,
      path: "/",
      sameSite: "strict",
      secure: true,
      value: token,
    });
    expect(
      verifyInactivityToken({
        accessSubject: ACCESS_SUBJECT,
        secret: ADMIN_SECRET,
        sessionId: SESSION_ID,
        token,
      }),
    ).toEqual({
      lastActivityAtMs: refreshedAtMs,
      minimumAccessIssuedAtSec: ACCESS_ISSUED_AT,
      valid: true,
    });
  });

  it("requires a marker, rejects the same Access token, and accepts only a new token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    cookieValues.clear();

    await expect(
      unlockAdminSession(FOUNDER_IDENTITY, START_MS),
    ).resolves.toEqual({
      logoutPath: CLOUDFLARE_ACCESS_LOGOUT_PATH,
      reauthenticationRequired: true,
      unlocked: false,
    });

    expect(mocks.cookieDelete).toHaveBeenCalledWith(
      ADMIN_ACTIVITY_COOKIE_NAME,
    );
    const marker = cookieValues.get(
      ADMIN_REAUTHENTICATION_COOKIE_NAME,
    );
    expect(marker).toBeDefined();
    if (!marker) {
      throw new Error("Expected reauthentication marker");
    }
    expect(mocks.cookieSet).toHaveBeenCalledWith({
      httpOnly: true,
      maxAge: 10 * 60,
      name: ADMIN_REAUTHENTICATION_COOKIE_NAME,
      path: "/",
      sameSite: "strict",
      secure: true,
      value: marker,
    });

    mocks.cookieSet.mockClear();
    mocks.cookieDelete.mockClear();
    await expect(
      unlockAdminSession(FOUNDER_IDENTITY, START_MS + 1_000),
    ).resolves.toEqual({
      logoutPath: CLOUDFLARE_ACCESS_LOGOUT_PATH,
      reauthenticationRequired: true,
      unlocked: false,
    });
    expect(
      cookieValues.get(ADMIN_REAUTHENTICATION_COOKIE_NAME),
    ).toBe(marker);
    expect(
      cookieValues.has(ADMIN_ACTIVITY_COOKIE_NAME),
    ).toBe(false);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();

    const replacementIdentity: FounderIdentity = {
      ...FOUNDER_IDENTITY,
      accessIssuedAt: ACCESS_ISSUED_AT + 61,
      accessTokenFingerprint: REPLACEMENT_TOKEN_FINGERPRINT,
    };
    await expect(
      unlockAdminSession(replacementIdentity, START_MS + 2_000),
    ).resolves.toEqual({ unlocked: true });

    const activity = cookieValues.get(ADMIN_ACTIVITY_COOKIE_NAME);
    expect(activity).toBeDefined();
    if (!activity) {
      throw new Error("Expected post-reauthentication activity token");
    }
    expect(mocks.cookieSet).toHaveBeenCalledWith({
      httpOnly: true,
      maxAge: 30 * 60,
      name: ADMIN_ACTIVITY_COOKIE_NAME,
      path: "/",
      sameSite: "strict",
      secure: true,
      value: activity,
    });
    expect(mocks.cookieDelete).toHaveBeenCalledWith(
      ADMIN_REAUTHENTICATION_COOKIE_NAME,
    );
    expect(
      cookieValues.has(ADMIN_REAUTHENTICATION_COOKIE_NAME),
    ).toBe(false);

    expect(
      verifyInactivityToken({
        accessSubject: ACCESS_SUBJECT,
        secret: ADMIN_SECRET,
        sessionId: SESSION_ID,
        token: activity,
      }),
    ).toEqual({
      lastActivityAtMs: START_MS + 2_000,
      minimumAccessIssuedAtSec: replacementIdentity.accessIssuedAt,
      valid: true,
    });
  });
});
