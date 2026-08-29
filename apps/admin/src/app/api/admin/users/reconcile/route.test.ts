import { EventFoundationError } from "@skitza/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminAccessError,
  requireActiveAdminAccess,
  type FounderIdentity,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { resolveAdminClerkEnvironment } from "~/server/registered-users/clerk-environment";
import {
  createClerkReconciliationProvider,
  createRegisteredAccountReconciliationRepository,
  reconcileRegisteredAccounts,
  RegisteredAccountReconciliationError,
} from "~/server/registered-users/reconciliation";
import { POST } from "./route";

vi.mock("@skitza/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skitza/db")>();
  return { ...actual, createDb: vi.fn(() => ({ execute: vi.fn() })) };
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
}));

vi.mock("~/server/registered-users/reconciliation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/registered-users/reconciliation")>();
  return {
    ...actual,
    createClerkReconciliationProvider: vi.fn(),
    createRegisteredAccountReconciliationRepository: vi.fn(),
    reconcileRegisteredAccounts: vi.fn(),
  };
});

const founder: FounderIdentity = {
  accessEmail: "founder@example.test",
  accessIssuedAt: 1_800_000_000,
  accessSubject: "access-founder",
  accessTokenFingerprint: "fingerprint",
  sessionId: "session-founder",
  userId: "user_founder",
};
const originalLive = process.env.ADMIN_LIVE_DATABASE_URL;
const provider = {
  getInstanceId: vi.fn(),
  getPage: vi.fn(),
};
const repository = {
  applySnapshots: vi.fn(),
};

function request(
  input: Readonly<{
    cursor?: string;
    idempotencyKey?: string;
  }> = {},
): Request {
  const cursor = input.cursor ? `?cursor=${encodeURIComponent(input.cursor)}` : "";
  const headers = new Headers({
    origin: "https://admin.skitza.app",
    "sec-fetch-site": "same-origin",
  });
  if (input.idempotencyKey !== undefined) {
    headers.set("idempotency-key", input.idempotencyKey);
  }
  return new Request(
    `https://admin.skitza.app/api/admin/users/reconcile${cursor}`,
    { headers, method: "POST" },
  );
}

describe("registered-user reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_LIVE_DATABASE_URL = "postgresql://live.example.test/skitza";
    vi.mocked(requireActiveAdminAccess).mockResolvedValue(founder);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(resolveAdminClerkEnvironment).mockReturnValue({
      instanceId: "ins_live",
      secretKey: "sk_live_hidden",
    });
    vi.mocked(createClerkReconciliationProvider).mockReturnValue(provider);
    vi.mocked(createRegisteredAccountReconciliationRepository).mockReturnValue(repository);
    vi.mocked(reconcileRegisteredAccounts).mockResolvedValue({
      applied: 2,
      complete: true,
      durationMs: 12,
      nextCursor: null,
      replayed: false,
      seen: 2,
      skipped: 0,
    });
  });

  afterEach(() => {
    if (originalLive === undefined) {
      delete process.env.ADMIN_LIVE_DATABASE_URL;
    } else {
      process.env.ADMIN_LIVE_DATABASE_URL = originalLive;
    }
  });

  it("authorizes before origin, environment, provider, or data access", async () => {
    vi.mocked(requireActiveAdminAccess).mockRejectedValueOnce(
      new AdminAccessError("founder-role-required"),
    );

    const response = await POST(request({ idempotencyKey: "sync-1" }));

    expect(response.status).toBe(404);
    expect(isSameOriginMutation).not.toHaveBeenCalled();
    expect(resolveAdminClerkEnvironment).not.toHaveBeenCalled();
    expect(reconcileRegisteredAccounts).not.toHaveBeenCalled();
  });

  it("rejects cross-origin before reconciliation", async () => {
    vi.mocked(isSameOriginMutation).mockReturnValueOnce(false);

    const response = await POST(request({ idempotencyKey: "sync-1" }));

    expect(response.status).toBe(403);
    expect(reconcileRegisteredAccounts).not.toHaveBeenCalled();
  });

  it("requires an idempotency key and maps malformed reconciliation to 400", async () => {
    const missing = await POST(request());
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: "invalid_request",
    });
    expect(reconcileRegisteredAccounts).not.toHaveBeenCalled();

    vi.mocked(reconcileRegisteredAccounts).mockRejectedValueOnce(
      new RegisteredAccountReconciliationError("INVALID_REQUEST"),
    );
    const invalid = await POST(request({ idempotencyKey: "sync-invalid" }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "invalid_request",
    });
  });

  it("keeps provider and configuration failures private and retryable", async () => {
    vi.mocked(reconcileRegisteredAccounts).mockRejectedValueOnce(
      new RegisteredAccountReconciliationError("UNAVAILABLE"),
    );

    const response = await POST(request({ idempotencyKey: "sync-provider" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "reconciliation_unavailable",
    });
  });

  it("passes founder, environment, cursor, and operation key without secrets", async () => {
    const incoming = request({
      cursor: "opaque_cursor",
      idempotencyKey: "sync-page-2",
    });

    const response = await POST(incoming);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ applied: 2, complete: true });
    expect(reconcileRegisteredAccounts).toHaveBeenCalledOnce();
    const reconciliationInput = vi.mocked(reconcileRegisteredAccounts).mock.calls[0]?.[0];
    expect(reconciliationInput).toMatchObject({
      actorClerkUserId: "user_founder",
      clerkInstanceId: "ins_live",
      cursor: "opaque_cursor",
      environment: "live",
      operationKey: "sync-page-2",
      provider,
      repository,
    });
    expect(typeof reconciliationInput?.identityResolver.resolveCanonicalUserId).toBe("function");
    expect(JSON.stringify(body)).not.toContain("sk_live_hidden");
  });

  it("maps a different-intent retry to a private 409", async () => {
    vi.mocked(reconcileRegisteredAccounts).mockRejectedValueOnce(
      new EventFoundationError("IDEMPOTENCY_CONFLICT"),
    );

    const response = await POST(request({ idempotencyKey: "sync-reused" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "idempotency_conflict",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
