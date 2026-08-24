import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  currentUser: vi.fn(),
  getToken: vi.fn(),
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
  const actual = await importOriginal<typeof import("./cloudflare-access")>();
  return {
    ...actual,
    verifyCloudflareAccessHeaders: mocks.verifyCloudflareAccessHeaders,
  };
});

import {
  AdminAccessError,
  requireFounderRole,
  unlockAdminSession,
  VERCEL_PROTECTION_LOGOUT_PATH,
} from "./access";
import {
  SKITZA_ADMIN_ROLE_METADATA_KEY,
  SKITZA_FOUNDER_ROLE,
} from "./founder-authorization";

const FOUNDER_USER_ID = "user_2founderAAAA";
const SESSION_TOKEN = "session-jwt-token-value";

function founderUser(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    emailAddresses: [
      {
        emailAddress: "Gili@Skitza.app",
        id: "email_primary",
        verification: { status: "verified" },
      },
    ],
    id: FOUNDER_USER_ID,
    primaryEmailAddressId: "email_primary",
    privateMetadata: { [SKITZA_ADMIN_ROLE_METADATA_KEY]: SKITZA_FOUNDER_ROLE },
    ...overrides,
  };
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "allowed";
  } catch (error) {
    if (error instanceof AdminAccessError) return error.reason;
    throw error;
  }
}

describe("vercel-protection access mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_ACCESS_MODE = "vercel-protection";
    process.env.ADMIN_FOUNDER_CLERK_USER_ID = FOUNDER_USER_ID;
    process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret-0123456789abcdef";
    mocks.auth.mockResolvedValue({
      actor: undefined,
      getToken: mocks.getToken,
      sessionClaims: { iat: 1_756_000_000 },
      sessionId: "sess_1",
      userId: FOUNDER_USER_ID,
    });
    mocks.getToken.mockResolvedValue(SESSION_TOKEN);
    mocks.currentUser.mockResolvedValue(founderUser());
    mocks.cookies.mockResolvedValue({
      delete: mocks.cookieDelete,
      get: mocks.cookieGet,
      set: mocks.cookieSet,
    });
    mocks.cookieGet.mockReturnValue(undefined);
  });

  afterEach(() => {
    delete process.env.ADMIN_ACCESS_MODE;
    delete process.env.ADMIN_FOUNDER_CLERK_USER_ID;
    delete process.env.ADMIN_SESSION_SECRET;
  });

  it("admits the pinned founder using the Clerk session as proof", async () => {
    const identity = await requireFounderRole();

    expect(identity.userId).toBe(FOUNDER_USER_ID);
    expect(identity.accessEmail).toBe("gili@skitza.app");
    expect(identity.accessSubject).toBe(`clerk:${FOUNDER_USER_ID}`);
    expect(identity.accessIssuedAt).toBe(1_756_000_000);
    expect(identity.accessTokenFingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.verifyCloudflareAccessHeaders).not.toHaveBeenCalled();
  });

  it("denies any Clerk user that is not the pinned founder", async () => {
    mocks.auth.mockResolvedValue({
      actor: undefined,
      getToken: mocks.getToken,
      sessionClaims: { iat: 1_756_000_000 },
      sessionId: "sess_2",
      userId: "user_2intruderBBBB",
    });
    mocks.currentUser.mockResolvedValue(founderUser({ id: "user_2intruderBBBB" }));

    await expect(reason(requireFounderRole())).resolves.toBe("access-identity-mismatch");
  });

  it("treats a missing founder pin as a configuration error, never an open door", async () => {
    delete process.env.ADMIN_FOUNDER_CLERK_USER_ID;

    await expect(reason(requireFounderRole())).resolves.toBe("configuration-invalid");
  });

  it("requires a verified email on the founder account", async () => {
    mocks.currentUser.mockResolvedValue(
      founderUser({
        emailAddresses: [
          {
            emailAddress: "gili@skitza.app",
            id: "email_primary",
            verification: { status: "unverified" },
          },
        ],
      }),
    );

    await expect(reason(requireFounderRole())).resolves.toBe("access-identity-mismatch");
  });

  it("requires a live session token and issued-at claim", async () => {
    mocks.getToken.mockResolvedValue(null);

    await expect(reason(requireFounderRole())).resolves.toBe("access-proof-required");
  });

  it("still requires the founder role metadata", async () => {
    mocks.currentUser.mockResolvedValue(founderUser({ privateMetadata: {} }));

    await expect(reason(requireFounderRole())).resolves.toBe("founder-role-required");
  });

  it("fails closed on an unknown mode value", async () => {
    process.env.ADMIN_ACCESS_MODE = "wide-open";

    await expect(reason(requireFounderRole())).resolves.toBe("configuration-invalid");
  });

  it("points the unlock ceremony at Clerk sign-in instead of Cloudflare logout", async () => {
    const identity = await requireFounderRole();
    const decision = await unlockAdminSession(identity, Date.now());

    expect(decision.unlocked).toBe(false);
    if (!decision.unlocked) {
      expect(decision.logoutPath).toBe(VERCEL_PROTECTION_LOGOUT_PATH);
    }
  });
});
