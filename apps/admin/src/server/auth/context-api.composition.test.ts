import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookieGet: vi.fn(),
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

import { GET } from "~/app/api/admin/context/route";
import { ADMIN_ACTIVITY_COOKIE_NAME } from "./access";
import {
  CloudflareAccessVerificationError,
  type CloudflareAccessIdentity,
} from "./cloudflare-access";
import {
  SKITZA_ADMIN_ROLE_METADATA_KEY,
  SKITZA_FOUNDER_ROLE,
} from "./founder-authorization";
import { createInactivityToken } from "./inactivity-token";

const ADMIN_SECRET = "test-only-composition-session-secret-32-bytes";
const ACCESS_EMAIL = "founder@example.test";
const ACCESS_ISSUED_AT = 1_800_000_000;
const ACCESS_SUBJECT = "access-founder";
const SESSION_ID = "sess_founder";
const USER_ID = "user_founder";
const REQUEST_HEADERS = new Headers({ host: "admin.skitza.app" });

const ACCESS_IDENTITY: CloudflareAccessIdentity = {
  audience: "admin-access-audience",
  email: ACCESS_EMAIL,
  expiresAt: ACCESS_ISSUED_AT + 3_600,
  issuedAt: ACCESS_ISSUED_AT,
  issuer: "https://skitza.cloudflareaccess.com",
  notBefore: ACCESS_ISSUED_AT,
  subject: ACCESS_SUBJECT,
  tokenFingerprint: "a".repeat(43),
};

const ORIGINAL_ENVIRONMENT = {
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET,
  liveDatabaseUrl: process.env.ADMIN_LIVE_DATABASE_URL,
  testDatabaseUrl: process.env.ADMIN_TEST_DATABASE_URL,
};

function restoreEnvironment(
  name:
    | "ADMIN_LIVE_DATABASE_URL"
    | "ADMIN_SESSION_SECRET"
    | "ADMIN_TEST_DATABASE_URL",
  value: string | undefined,
): void {
  switch (name) {
    case "ADMIN_LIVE_DATABASE_URL":
      if (value === undefined) {
        delete process.env.ADMIN_LIVE_DATABASE_URL;
      } else {
        process.env.ADMIN_LIVE_DATABASE_URL = value;
      }
      return;
    case "ADMIN_SESSION_SECRET":
      if (value === undefined) {
        delete process.env.ADMIN_SESSION_SECRET;
      } else {
        process.env.ADMIN_SESSION_SECRET = value;
      }
      return;
    case "ADMIN_TEST_DATABASE_URL":
      if (value === undefined) {
        delete process.env.ADMIN_TEST_DATABASE_URL;
      } else {
        process.env.ADMIN_TEST_DATABASE_URL = value;
      }
  }
}

function setSignedInSession(options?: Readonly<{ actor?: object | null }>): void {
  mocks.auth.mockResolvedValue({
    actor: options?.actor ?? null,
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
}

function setClerkUser(
  privateMetadata: Readonly<Record<string, unknown>>,
): void {
  mocks.currentUser.mockResolvedValue({
    emailAddresses: [
      {
        emailAddress: ACCESS_EMAIL,
        verification: { status: "verified" },
      },
    ],
    id: USER_ID,
    privateMetadata,
  });
}

function requestContext(): Promise<Response> {
  return GET(
    new Request(
      "https://admin.skitza.app/api/admin/context?environment=test",
    ),
  );
}

describe("admin context HTTP authorization composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SESSION_SECRET = ADMIN_SECRET;
    process.env.ADMIN_LIVE_DATABASE_URL =
      "postgresql://fake:fake@live.example.test/skitza";
    process.env.ADMIN_TEST_DATABASE_URL =
      "postgresql://fake:fake@test.example.test/skitza";

    mocks.headers.mockResolvedValue(REQUEST_HEADERS);
    mocks.verifyCloudflareAccessHeaders.mockResolvedValue(
      ACCESS_IDENTITY,
    );
    mocks.cookies.mockResolvedValue({ get: mocks.cookieGet });
    mocks.cookieGet.mockReturnValue(undefined);
    setSignedInSession();
    setClerkUser({
      [SKITZA_ADMIN_ROLE_METADATA_KEY]: SKITZA_FOUNDER_ROLE,
    });
  });

  afterEach(() => {
    restoreEnvironment(
      "ADMIN_SESSION_SECRET",
      ORIGINAL_ENVIRONMENT.adminSessionSecret,
    );
    restoreEnvironment(
      "ADMIN_LIVE_DATABASE_URL",
      ORIGINAL_ENVIRONMENT.liveDatabaseUrl,
    );
    restoreEnvironment(
      "ADMIN_TEST_DATABASE_URL",
      ORIGINAL_ENVIRONMENT.testDatabaseUrl,
    );
  });

  it("lets invalid Access proof win before Clerk or cookies", async () => {
    mocks.verifyCloudflareAccessHeaders.mockRejectedValue(
      new CloudflareAccessVerificationError("token-invalid"),
    );

    const response = await requestContext();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mocks.headers).toHaveBeenCalledOnce();
    expect(mocks.verifyCloudflareAccessHeaders).toHaveBeenCalledWith(
      REQUEST_HEADERS,
    );
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.cookieGet).not.toHaveBeenCalled();
  });

  it("returns 401 when Access is valid but Clerk is signed out", async () => {
    mocks.auth.mockResolvedValue({
      actor: null,
      sessionId: null,
      userId: null,
    });

    const response = await requestContext();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "unauthorized",
    });
    expect(mocks.verifyCloudflareAccessHeaders).toHaveBeenCalledOnce();
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("returns 404 for a signed-in non-founder before activity cookies", async () => {
    setClerkUser({});

    const response = await requestContext();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mocks.verifyCloudflareAccessHeaders).toHaveBeenCalledOnce();
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("returns 404 for impersonation before loading the Clerk user", async () => {
    setSignedInSession({ actor: { sub: "fake-support-user" } });

    const response = await requestContext();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mocks.verifyCloudflareAccessHeaders).toHaveBeenCalledOnce();
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("returns only sanitized context for a matching founder with signed active state", async () => {
    const activityToken = createInactivityToken({
      accessSubject: ACCESS_SUBJECT,
      lastActivityAtMs: Date.now(),
      minimumAccessIssuedAtSec: ACCESS_ISSUED_AT,
      secret: ADMIN_SECRET,
      sessionId: SESSION_ID,
    });
    mocks.cookieGet.mockImplementation((name: string) =>
      name === ADMIN_ACTIVITY_COOKIE_NAME
        ? { value: activityToken }
        : undefined,
    );

    const response = await requestContext();
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authorized: true,
      environment: { id: "test", label: "Test", tone: "info" },
    });
    expect(JSON.stringify(body)).not.toContain("postgresql://");
    expect(JSON.stringify(body)).not.toContain(USER_ID);
    expect(JSON.stringify(body)).not.toContain(SESSION_ID);
    expect(JSON.stringify(body)).not.toContain(ACCESS_SUBJECT);
    expect(mocks.verifyCloudflareAccessHeaders).toHaveBeenCalledOnce();
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.cookieGet).toHaveBeenCalledWith(
      ADMIN_ACTIVITY_COOKIE_NAME,
    );
  });
});
