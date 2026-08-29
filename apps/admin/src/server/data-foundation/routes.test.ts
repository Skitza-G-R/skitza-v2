import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminAccessError,
  requireActiveAdminAccess,
  type FounderIdentity,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { createAdminDataFoundationRuntime } from "./runtime";
import { AdminDataFoundationError } from "./service";
import { POST as createSupportNote } from "~/app/api/admin/support-notes/route";
import { POST as recordReveal } from "~/app/api/admin/sensitive-content-reveals/route";
import { POST as transitionProblem } from "~/app/api/admin/system-problems/state/route";
import { POST as purgeHistory } from "~/app/api/admin/maintenance/history-retention/route";

vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/auth/access")>();
  return {
    ...actual,
    requireActiveAdminAccess: vi.fn(),
  };
});

vi.mock("~/server/auth/request-security", () => ({
  isSameOriginMutation: vi.fn(),
}));

vi.mock("./runtime", () => ({
  createAdminDataFoundationRuntime: vi.fn(),
}));

const FOUNDER: FounderIdentity = {
  accessEmail: "founder@example.test",
  accessIssuedAt: 1_800_000_000,
  accessSubject: "access-founder",
  accessTokenFingerprint: "access-token-fingerprint",
  sessionId: "session-founder",
  userId: "user-founder",
};
const ORIGINAL_LIVE_URL = process.env.ADMIN_LIVE_DATABASE_URL;
const PROBLEM_ID = "9de0f153-9400-49a5-9249-f810d0fbfd27";
const addSupportNote = vi.fn();
const purgeExpiredAdminHistory = vi.fn();
const recordSensitiveReveal = vi.fn();
const transitionSystemProblem = vi.fn();

const protectedEntries = [
  {
    body: {
      body: "Private support note",
      targetId: "user-42",
      targetType: "registered_account",
    },
    handler: createSupportNote,
    name: "support-note write",
    path: "/api/admin/support-notes",
  },
  {
    body: {
      contentKind: "payment_proof",
      reason: "support_investigation",
      targetId: "user-42",
      targetType: "registered_account",
    },
    handler: recordReveal,
    name: "sensitive reveal",
    path: "/api/admin/sensitive-content-reveals",
  },
  {
    body: {
      privateNote: "Founder-only provider context",
      problemId: PROBLEM_ID,
      state: "seen",
    },
    handler: transitionProblem,
    name: "problem transition",
    path: "/api/admin/system-problems/state",
  },
  {
    body: {},
    handler: purgeHistory,
    name: "history cleanup",
    path: "/api/admin/maintenance/history-retention",
  },
] as const;

function request(
  path: string,
  body: Readonly<Record<string, unknown>>,
  environment: string | null = "test",
): Request {
  const environmentQuery = environment === null ? "" : `?environment=${environment}`;
  return new Request(`https://admin.skitza.app${path}${environmentQuery}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "idempotency-key": "request-1",
      origin: "https://admin.skitza.app",
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  });
}

describe("SK-132 admin data entry-point authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_LIVE_DATABASE_URL = "postgresql://live.example.test/skitza";
    vi.mocked(requireActiveAdminAccess).mockResolvedValue(FOUNDER);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(createAdminDataFoundationRuntime).mockReturnValue({
      addSupportNote,
      purgeExpiredAdminHistory,
      recordSensitiveReveal,
      transitionSystemProblem,
    });
    addSupportNote.mockResolvedValue({ id: "note-1", replayed: false });
    purgeExpiredAdminHistory.mockResolvedValue(2);
    recordSensitiveReveal.mockResolvedValue({
      id: "history-1",
      replayed: false,
    });
    transitionSystemProblem.mockResolvedValue({
      id: PROBLEM_ID,
      replayed: false,
      state: "seen",
    });
  });

  afterEach(() => {
    if (ORIGINAL_LIVE_URL === undefined) {
      delete process.env.ADMIN_LIVE_DATABASE_URL;
    } else {
      process.env.ADMIN_LIVE_DATABASE_URL = ORIGINAL_LIVE_URL;
    }
  });

  it.each(protectedEntries)(
    "fails closed before origin, environment, body, or data access for $name",
    async ({ body, handler, path }) => {
      vi.mocked(requireActiveAdminAccess).mockRejectedValueOnce(
        new AdminAccessError("founder-role-required"),
      );

      const response = await handler(request(path, body));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
      expect(isSameOriginMutation).not.toHaveBeenCalled();
      expect(createAdminDataFoundationRuntime).not.toHaveBeenCalled();
    },
  );

  it.each(protectedEntries)(
    "authenticates before rejecting cross-origin $name",
    async ({ body, handler, path }) => {
      vi.mocked(isSameOriginMutation).mockReturnValueOnce(false);
      const incoming = request(path, body);

      const response = await handler(incoming);

      expect(response.status).toBe(403);
      expect(requireActiveAdminAccess).toHaveBeenCalledOnce();
      expect(isSameOriginMutation).toHaveBeenCalledWith(incoming);
      expect(createAdminDataFoundationRuntime).not.toHaveBeenCalled();
      expect(
        vi.mocked(requireActiveAdminAccess).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      ).toBeLessThan(
        vi.mocked(isSameOriginMutation).mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
      );
    },
  );

  it("takes the environment only from the explicit server-resolved selector", async () => {
    // SK-288 removed the client-facing selector. A caller that still sends
    // one must be ignored rather than obeyed — the server decides.
    const smuggled = await createSupportNote(
      request(
        "/api/admin/support-notes",
        {
          body: "Private support note",
          targetId: "user-42",
          targetType: "registered_account",
        },
        "test",
      ),
    );
    expect(smuggled.status).toBe(201);
    expect(createAdminDataFoundationRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "live" }),
    );
    vi.mocked(createAdminDataFoundationRuntime).mockClear();
    vi.mocked(addSupportNote).mockClear();

    const rejected = await createSupportNote(
      request("/api/admin/support-notes", {
        body: "Private support note",
        environment: "live",
        targetId: "user-42",
        targetType: "registered_account",
      }),
    );
    expect(rejected.status).toBe(400);
    expect(addSupportNote).not.toHaveBeenCalled();

    const response = await createSupportNote(
      request("/api/admin/support-notes", {
        body: "Private support note",
        targetId: "user-42",
        targetType: "registered_account",
      }),
    );
    expect(response.status).toBe(201);
    expect(createAdminDataFoundationRuntime).toHaveBeenLastCalledWith({
      databaseUrl: "postgresql://live.example.test/skitza",
      environment: "live",
    });
    expect(addSupportNote).toHaveBeenCalledWith({
      actorClerkUserId: "user-founder",
      body: "Private support note",
      environment: "live",
      operationKey: "request-1",
      targetId: "user-42",
      targetType: "registered_account",
    });
  });

  it("records reveal reason and metadata without accepting revealed content", async () => {
    const response = await recordReveal(
      request("/api/admin/sensitive-content-reveals", {
        content: "must never be accepted",
        contentKind: "payment_proof",
        reason: "safety_issue",
        targetId: "user-42",
        targetType: "registered_account",
      }),
    );

    expect(response.status).toBe(400);
    expect(recordSensitiveReveal).not.toHaveBeenCalled();

    const accepted = await recordReveal(
      request("/api/admin/sensitive-content-reveals", {
        contentKind: "payment_proof",
        reason: "safety_issue",
        targetId: "user-42",
        targetType: "registered_account",
      }),
    );

    expect(accepted.status).toBe(201);
    expect(recordSensitiveReveal).toHaveBeenCalledWith({
      actorClerkUserId: "user-founder",
      contentKind: "payment_proof",
      environment: "live",
      operationKey: "request-1",
      reason: "safety_issue",
      targetId: "user-42",
      targetType: "registered_account",
    });
  });

  it("preserves a system private note when omitted and forwards explicit null to clear it", async () => {
    const preserved = await transitionProblem(
      request("/api/admin/system-problems/state", {
        problemId: PROBLEM_ID,
        state: "new",
      }),
    );

    expect(preserved.status).toBe(201);
    expect(transitionSystemProblem).toHaveBeenLastCalledWith({
      actorClerkUserId: "user-founder",
      environment: "live",
      operationKey: "request-1",
      problemId: PROBLEM_ID,
      state: "new",
    });

    await transitionProblem(
      request("/api/admin/system-problems/state", {
        privateNote: null,
        problemId: PROBLEM_ID,
        state: "resolved",
      }),
    );
    expect(transitionSystemProblem).toHaveBeenLastCalledWith({
      actorClerkUserId: "user-founder",
      environment: "live",
      operationKey: "request-1",
      privateNote: null,
      problemId: PROBLEM_ID,
      state: "resolved",
    });
  });

  it.each([
    {
      code: "INVALID_INPUT",
      expectedBody: { error: "invalid_request" },
      name: "malformed UUID",
      status: 400,
    },
    {
      code: "IDEMPOTENCY_EXPIRED",
      expectedBody: { error: "idempotency_expired" },
      name: "expired idempotency receipt",
      status: 409,
    },
    {
      code: "STATE_CONFLICT",
      expectedBody: { error: "state_conflict" },
      name: "invalid problem lifecycle",
      status: 409,
    },
  ] as const)("maps a $name service failure to its private API contract", async (testCase) => {
    transitionSystemProblem.mockRejectedValueOnce(new AdminDataFoundationError(testCase.code));

    const response = await transitionProblem(
      request("/api/admin/system-problems/state", {
        problemId: testCase.code === "INVALID_INPUT" ? "problem-1" : PROBLEM_ID,
        state: "seen",
      }),
    );

    expect(response.status).toBe(testCase.status);
    await expect(response.json()).resolves.toEqual(testCase.expectedBody);
  });

  it("invokes retention only through the selected protected environment", async () => {
    const response = await purgeHistory(request("/api/admin/maintenance/history-retention", {}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 2 });
    expect(purgeExpiredAdminHistory).toHaveBeenCalledWith("live");
  });
});
