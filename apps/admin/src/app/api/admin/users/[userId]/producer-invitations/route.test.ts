import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withNeonSessionAdvisoryLock, type Db } from "@skitza/db";
import {
  AdminAccessError,
  requireActiveAdminAccess,
  type FounderIdentity,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  resolveAdminClerkEnvironment,
  resolveAdminWebAppUrl,
} from "~/server/registered-users/clerk-environment";
import {
  createClerkProducerInvitationProvider,
  ProducerInvitationError,
  sendProducerInvitation,
} from "~/server/registered-users/producer-invitations";
import { createRegisteredUserRepository } from "~/server/registered-users/repository";
import { POST } from "./route";

vi.mock("@skitza/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skitza/db")>();
  return {
    ...actual,
    withNeonSessionAdvisoryLock: vi.fn(),
  };
});

vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/auth/access")>();
  return { ...actual, requireActiveAdminAccess: vi.fn() };
});

vi.mock("~/server/auth/request-security", () => ({
  isSameOriginMutation: vi.fn(),
}));

vi.mock("~/server/registered-users/clerk-environment", () => ({
  resolveAdminClerkEnvironment: vi.fn(),
  resolveAdminWebAppUrl: vi.fn(),
}));

vi.mock("~/server/registered-users/producer-invitations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/registered-users/producer-invitations")>();
  return {
    ...actual,
    createClerkProducerInvitationProvider: vi.fn(),
    sendProducerInvitation: vi.fn(),
  };
});

vi.mock("~/server/registered-users/repository", () => ({
  createRegisteredUserRepository: vi.fn(),
}));

const founder: FounderIdentity = {
  accessEmail: "founder@example.test",
  accessIssuedAt: 1_800_000_000,
  accessSubject: "access-founder",
  accessTokenFingerprint: "fingerprint",
  sessionId: "session-founder",
  userId: "user_founder",
};
const originalLive = process.env.ADMIN_LIVE_DATABASE_URL;
const originalTest = process.env.ADMIN_TEST_DATABASE_URL;
const findProfileHeader = vi.fn();
const db = {} as Db;
const provider = {
  createInvitation: vi.fn(),
  getInstanceId: vi.fn(),
  getUser: vi.fn(),
  listInvitations: vi.fn(),
};

function request(
  input: Readonly<{
    environment?: string | null;
    idempotencyKey?: string;
  }> = {},
): Request {
  const environment =
    input.environment === null ? "" : `?environment=${input.environment ?? "test"}`;
  const headers = new Headers({
    "content-type": "application/json",
    origin: "https://admin.skitza.app",
    "sec-fetch-site": "same-origin",
  });
  if (input.idempotencyKey !== undefined) {
    headers.set("idempotency-key", input.idempotencyKey);
  }
  return new Request(
    `https://admin.skitza.app/api/admin/users/user_artist/producer-invitations${environment}`,
    {
      body: JSON.stringify({ emailAddress: "attacker@example.test" }),
      headers,
      method: "POST",
    },
  );
}

const context = {
  params: Promise.resolve({ userId: "user_artist" }),
};

describe("Producer invitation admin route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_LIVE_DATABASE_URL = "postgresql://live.example.test/skitza";
    process.env.ADMIN_TEST_DATABASE_URL = "postgresql://test.example.test/skitza";
    vi.mocked(requireActiveAdminAccess).mockResolvedValue(founder);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(resolveAdminClerkEnvironment).mockReturnValue({
      instanceId: "ins_test",
      secretKey: "sk_test_hidden",
    });
    vi.mocked(resolveAdminWebAppUrl).mockReturnValue("https://skitza-test.example");
    vi.mocked(withNeonSessionAdvisoryLock).mockImplementation(
      async (_databaseUrl, _lockKey, callback) => callback(db),
    );
    vi.mocked(createRegisteredUserRepository).mockReturnValue({
      findDirectory: vi.fn(),
      findProfileHeader,
      findProfileTab: vi.fn(),
    });
    findProfileHeader.mockResolvedValue({
      roles: ["Artist"],
      status: "Active",
    });
    vi.mocked(createClerkProducerInvitationProvider).mockReturnValue(provider);
    vi.mocked(sendProducerInvitation).mockResolvedValue({
      invitationId: "inv_new",
      reused: false,
      status: "pending",
    });
  });

  afterEach(() => {
    if (originalLive === undefined) {
      delete process.env.ADMIN_LIVE_DATABASE_URL;
    } else {
      process.env.ADMIN_LIVE_DATABASE_URL = originalLive;
    }
    if (originalTest === undefined) {
      delete process.env.ADMIN_TEST_DATABASE_URL;
    } else {
      process.env.ADMIN_TEST_DATABASE_URL = originalTest;
    }
  });

  it("authorizes before origin, route input, environment, database, or Clerk", async () => {
    vi.mocked(requireActiveAdminAccess).mockRejectedValueOnce(
      new AdminAccessError("founder-role-required"),
    );

    const response = await POST(request({ idempotencyKey: "producer-invite:request-1" }), context);

    expect(response.status).toBe(404);
    expect(isSameOriginMutation).not.toHaveBeenCalled();
    expect(withNeonSessionAdvisoryLock).not.toHaveBeenCalled();
    expect(createClerkProducerInvitationProvider).not.toHaveBeenCalled();
  });

  it("rejects cross-origin before any environment or provider work", async () => {
    vi.mocked(isSameOriginMutation).mockReturnValueOnce(false);

    const response = await POST(request({ idempotencyKey: "producer-invite:request-1" }), context);

    expect(response.status).toBe(403);
    expect(withNeonSessionAdvisoryLock).not.toHaveBeenCalled();
    expect(createClerkProducerInvitationProvider).not.toHaveBeenCalled();
  });

  it("binds the target and provider to the selected environment without accepting a client email", async () => {
    const response = await POST(request({ idempotencyKey: "producer-invite:request-1" }), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      invitationId: "inv_new",
      reused: false,
      status: "pending",
    });
    expect(withNeonSessionAdvisoryLock).toHaveBeenCalledWith(
      "postgresql://test.example.test/skitza",
      "admin:producer-invitation:test:user_artist",
      expect.any(Function),
    );
    expect(createRegisteredUserRepository).toHaveBeenCalledWith(db, "test");
    expect(findProfileHeader).toHaveBeenCalledWith("user_artist");
    expect(createClerkProducerInvitationProvider).toHaveBeenCalledWith("sk_test_hidden");
    expect(sendProducerInvitation).toHaveBeenCalledWith({
      clerkInstanceId: "ins_test",
      operationKey: "producer-invite:request-1",
      provider,
      redirectUrl: "https://skitza-test.example/sign-up",
      targetClerkUserId: "user_artist",
    });
    expect(JSON.stringify(vi.mocked(sendProducerInvitation).mock.calls)).not.toContain(
      "attacker@example.test",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    { roles: ["Producer", "Artist"], name: "an existing Producer" },
    { roles: [], name: "an account without an Artist relationship" },
  ])("does not send to $name", async ({ roles }) => {
    findProfileHeader.mockResolvedValueOnce({ roles, status: "Active" });

    const response = await POST(request({ idempotencyKey: "producer-invite:request-1" }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "target_not_eligible",
    });
    expect(createClerkProducerInvitationProvider).not.toHaveBeenCalled();
    expect(sendProducerInvitation).not.toHaveBeenCalled();
  });

  it("requires a valid idempotency key and maps provider failure privately", async () => {
    const missing = await POST(request(), context);
    expect(missing.status).toBe(400);
    expect(sendProducerInvitation).not.toHaveBeenCalled();

    vi.mocked(sendProducerInvitation).mockRejectedValueOnce(
      new ProducerInvitationError("UNAVAILABLE"),
    );
    const unavailable = await POST(
      request({ idempotencyKey: "producer-invite:request-2" }),
      context,
    );
    expect(unavailable.status).toBe(503);
    const payload: unknown = await unavailable.json();
    expect(payload).toEqual({
      error: "producer_invitation_unavailable",
    });
    expect(JSON.stringify(payload)).not.toContain("sk_test_hidden");
  });
});
