import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { withNeonSessionAdvisoryLock } from "@skitza/db";
import { requireActiveAdminAccess } from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  resolveAdminClerkEnvironment,
  resolveAdminWebAppUrl,
} from "~/server/registered-users/clerk-environment";
import {
  createClerkProducerInvitationProvider,
  sendProducerInvitationToEmail,
} from "~/server/registered-users/producer-invitations";
import { POST } from "./route";

vi.mock("@skitza/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skitza/db")>();
  return { ...actual, withNeonSessionAdvisoryLock: vi.fn() };
});
vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/auth/access")>();
  return { ...actual, requireActiveAdminAccess: vi.fn() };
});
vi.mock("~/server/auth/request-security", () => ({ isSameOriginMutation: vi.fn() }));
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
    sendProducerInvitationToEmail: vi.fn(),
  };
});

const provider = {
  createInvitation: vi.fn(),
  getInstanceId: vi.fn(),
  getUser: vi.fn(),
  listInvitations: vi.fn(),
};

function request(emailAddress: unknown = "new.producer@example.com") {
  return new Request("https://admin.skitza.app/api/admin/producer-invitations?environment=test", {
    body: JSON.stringify({ emailAddress }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": "producer-invite-email:request-1",
      origin: "https://admin.skitza.app",
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  });
}

describe("new Producer email invitation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_LIVE_DATABASE_URL = "postgresql://live.example.test/skitza";
    process.env.ADMIN_TEST_DATABASE_URL = "postgresql://test.example.test/skitza";
    vi.mocked(requireActiveAdminAccess).mockResolvedValue({} as never);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(resolveAdminClerkEnvironment).mockReturnValue({
      instanceId: "ins_test",
      secretKey: "sk_test_hidden",
    });
    vi.mocked(resolveAdminWebAppUrl).mockReturnValue("https://skitza-test.example");
    vi.mocked(createClerkProducerInvitationProvider).mockReturnValue(provider);
    vi.mocked(withNeonSessionAdvisoryLock).mockImplementation(
      async (_databaseUrl, _lockKey, callback) => callback({} as never),
    );
    vi.mocked(sendProducerInvitationToEmail).mockResolvedValue({
      invitationId: "inv_new",
      reused: false,
      status: "pending",
    });
  });

  it("sends the entered email through the marked server invitation path", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(withNeonSessionAdvisoryLock).toHaveBeenCalledWith(
      "postgresql://test.example.test/skitza",
      `admin:producer-invitation-email:test:${createHash("sha256")
        .update("new.producer@example.com")
        .digest("hex")}`,
      expect.any(Function),
    );
    expect(sendProducerInvitationToEmail).toHaveBeenCalledWith({
      clerkInstanceId: "ins_test",
      emailAddress: "new.producer@example.com",
      operationKey: "producer-invite-email:request-1",
      provider,
      redirectUrl: "https://skitza-test.example/sign-up",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects malformed input before Clerk", async () => {
    const response = await POST(request(42));

    expect(response.status).toBe(400);
    expect(createClerkProducerInvitationProvider).not.toHaveBeenCalled();
    expect(sendProducerInvitationToEmail).not.toHaveBeenCalled();
  });
});
