import { beforeEach, describe, expect, it, vi } from "vitest";

import { withNeonSessionAdvisoryLock } from "@skitza/db";
import { requireActiveAdminAccess } from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { createBetaRuntime } from "~/server/beta/runtime";
import {
  resolveAdminClerkEnvironment,
  resolveAdminWebAppUrl,
} from "~/server/registered-users/clerk-environment";
import {
  createClerkProducerInvitationProvider,
  ProducerInvitationError,
  sendProducerInvitationToEmail,
} from "~/server/registered-users/producer-invitations";
import { POST } from "./route";

vi.mock("~/server/registered-users/invitation-email", () => ({
  createResendInvitationEmailSender: vi.fn(() => ({ send: vi.fn() })),
  resolveAdminInvitationEmailConfig: vi.fn(() => ({
    apiKey: "re_test_abcdefgh",
    from: "Gili from Skitza (test) <gili@test.skitza.app>",
    replyTo: "gili@test.skitza.app",
    signature: "Gili",
  })),
}));

vi.mock("@skitza/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skitza/db")>();
  return { ...actual, withNeonSessionAdvisoryLock: vi.fn() };
});
vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/auth/access")>();
  return { ...actual, requireActiveAdminAccess: vi.fn() };
});
vi.mock("~/server/auth/request-security", () => ({ isSameOriginMutation: vi.fn() }));
vi.mock("~/server/beta/runtime", () => ({ createBetaRuntime: vi.fn() }));
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

const repository = {
  findByEmail: vi.fn(),
  importRows: vi.fn(),
  listAll: vi.fn(),
  listPendingEmailsInWave: vi.fn(),
  markInvited: vi.fn(),
  removePending: vi.fn(),
  setWave: vi.fn(),
};

const provider = {
  createInvitation: vi.fn(),
  getInstanceId: vi.fn(),
  getUser: vi.fn(),
  listInvitations: vi.fn(),
};

function request(body: Readonly<Record<string, unknown>>) {
  return new Request("https://admin.skitza.app/api/admin/beta/release?environment=test", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "idempotency-key": "beta-release-request-1",
      origin: "https://admin.skitza.app",
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  });
}

describe("beta release route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveAdminAccess).mockResolvedValue({} as never);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(createBetaRuntime).mockReturnValue({
      databaseUrl: "postgresql://test.example.test/skitza",
      db: {} as never,
      environment: "test",
      repository,
    } as never);
    vi.mocked(resolveAdminClerkEnvironment).mockReturnValue({
      instanceId: "ins_test",
      secretKey: "sk_test_hidden",
    } as never);
    vi.mocked(resolveAdminWebAppUrl).mockReturnValue("https://skitza-test.example");
    vi.mocked(createClerkProducerInvitationProvider).mockReturnValue(provider);
    vi.mocked(withNeonSessionAdvisoryLock).mockImplementation(
      async (_databaseUrl, _lockKey, callback) => callback({} as never),
    );
    vi.mocked(sendProducerInvitationToEmail).mockResolvedValue({
      emailed: true,
      invitationId: "inv_new",
      reused: false,
      status: "pending",
    });
  });

  it("invites every pending email in the wave and stamps the rows", async () => {
    repository.listPendingEmailsInWave.mockResolvedValue(["a@example.com", "b@example.com"]);

    const response = await POST(request({ wave: 1 }));
    const payload = (await response.json()) as { attempted: number; invited: number };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ attempted: 2, failures: [], invited: 2 });
    expect(sendProducerInvitationToEmail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendProducerInvitationToEmail).mock.calls[0]?.[0]).toMatchObject({
      emailAddress: "a@example.com",
      operationKey: "beta-release-request-1:0",
    });
    expect(repository.markInvited).toHaveBeenCalledTimes(2);
  });

  it("keeps going when one invitation fails and reports it per email", async () => {
    repository.listPendingEmailsInWave.mockResolvedValue(["a@example.com", "b@example.com"]);
    vi.mocked(sendProducerInvitationToEmail)
      .mockRejectedValueOnce(new ProducerInvitationError("TARGET_NOT_ELIGIBLE"))
      .mockResolvedValueOnce({
        emailed: true,
        invitationId: "inv_b",
        reused: false,
        status: "pending",
      });

    const response = await POST(request({ wave: 1 }));
    const payload = (await response.json()) as {
      failures: readonly { code: string; email: string }[];
      invited: number;
    };

    expect(response.status).toBe(200);
    expect(payload.invited).toBe(1);
    expect(payload.failures).toEqual([
      { code: "TARGET_NOT_ELIGIBLE", email: "a@example.com" },
    ]);
    expect(repository.markInvited).toHaveBeenCalledTimes(1);
    expect(repository.markInvited).toHaveBeenCalledWith("b@example.com", expect.any(Date));
  });

  it("refuses a single re-send for a row that already signed up", async () => {
    repository.findByEmail.mockResolvedValue({ email: "a@example.com", status: "signed_up" });

    const response = await POST(request({ emailAddress: "a@example.com" }));

    expect(response.status).toBe(409);
    expect(sendProducerInvitationToEmail).not.toHaveBeenCalled();
    expect(repository.markInvited).not.toHaveBeenCalled();
  });

  it("rejects a request naming both a wave and an email", async () => {
    const response = await POST(request({ emailAddress: "a@example.com", wave: 1 }));

    expect(response.status).toBe(400);
    expect(sendProducerInvitationToEmail).not.toHaveBeenCalled();
  });
});
