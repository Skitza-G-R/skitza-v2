import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_CLOSURE_RUNNING_TASK_LEASE_MS,
  ACCOUNT_CLOSURE_TASKS,
  AccountClosureError,
  AccountClosureTaskError,
  accountClosureRequesterEmailHash,
  applyAccountClosureLegalHold,
  finishManualAccountClosureTask,
  isAccountClosureRunningTaskLeaseActive,
  recoverStaleAccountClosureTask,
  releaseAccountClosureLegalHold,
  resumeAutomatedAccountClosure,
  startManualAccountClosureTask,
  type AccountClosureRequestRecord,
  type AccountClosureStore,
  type AccountClosureTaskKind,
} from "./account-closure";

const request: AccountClosureRequestRecord = {
  id: "00000000-0000-4000-8000-000000000050",
  clerkUserId: "user_closing",
  status: "processing",
  closureStartedAt: new Date("2026-08-13T12:00:00.000Z"),
  accessRevokedAt: null,
  dueAt: new Date("2026-09-12T12:00:00.000Z"),
  legalHoldAt: null,
  legalHoldReleasedAt: null,
};

function store(overrides: Partial<AccountClosureStore> = {}): AccountClosureStore {
  const attemptByKind = new Map<AccountClosureTaskKind, number>();
  return {
    openRequest: vi.fn(() => Promise.resolve(request)),
    verifyAndBeginClosure: vi.fn(() => Promise.resolve(request)),
    getRequest: vi.fn(() => Promise.resolve(request)),
    getTasks: vi.fn(() => Promise.resolve([])),
    claimTask: vi.fn((input: Parameters<AccountClosureStore["claimTask"]>[0]) => {
      const { kind } = input;
      const attempt = (attemptByKind.get(kind) ?? 0) + 1;
      attemptByKind.set(kind, attempt);
      return Promise.resolve({ attempt, kind, request });
    }),
    succeedTask: vi.fn(() => Promise.resolve()),
    markTaskNotApplicable: vi.fn(() => Promise.resolve()),
    blockTask: vi.fn(() => Promise.resolve()),
    recoverStaleTask: vi.fn(() => Promise.resolve()),
    resolveProducerId: vi.fn(() => Promise.resolve("00000000-0000-4000-8000-000000000001")),
    hasGoogleCalendarConnection: vi.fn(() => Promise.resolve(true)),
    deleteDeviceAndArtistPreferences: vi.fn(() => Promise.resolve()),
    revokePublicAndCapabilityLinks: vi.fn(() => Promise.resolve(true)),
    applyLegalHold: vi.fn(() => Promise.resolve()),
    releaseLegalHold: vi.fn(() => Promise.resolve()),
    completeIfReady: vi.fn(() => Promise.resolve(false)),
    ...overrides,
  };
}

describe("operator-managed account closure", () => {
  it("keeps the service task manifest exact and complete", () => {
    expect(ACCOUNT_CLOSURE_TASKS).toEqual([
      "google_calendar_disconnect",
      "device_and_artist_preferences_cleanup",
      "clerk_account_delete",
      "public_and_capability_link_revoke",
      "account_profile_deidentification",
      "storage_review_and_cleanup",
      "retained_record_review",
      "diagnostic_provider_cleanup",
      "backup_expiry_tracking",
    ]);
  });

  it("keeps one task claim exclusive until the documented stale-claim window", () => {
    const startedAt = new Date("2026-08-13T12:00:00.000Z");
    expect(
      isAccountClosureRunningTaskLeaseActive(
        startedAt,
        new Date(startedAt.getTime() + ACCOUNT_CLOSURE_RUNNING_TASK_LEASE_MS - 1),
      ),
    ).toBe(true);
    expect(
      isAccountClosureRunningTaskLeaseActive(
        startedAt,
        new Date(startedAt.getTime() + ACCOUNT_CLOSURE_RUNNING_TASK_LEASE_MS),
      ),
    ).toBe(false);
  });

  it("requires a separate evidence-bearing action to recover a stale claim", async () => {
    const closureStore = store();
    await recoverStaleAccountClosureTask(closureStore, {
      requestId: request.id,
      kind: "google_calendar_disconnect",
      actorClerkUserId: "user_operator",
      operationKey: "recover-google-1",
      evidenceRef: "case:closure-50/google-state-reviewed",
    });

    expect(closureStore.recoverStaleTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "google_calendar_disconnect",
        evidenceRef: "case:closure-50/google-state-reviewed",
      }),
    );
    expect(closureStore.claimTask).not.toHaveBeenCalled();
  });

  it("normalizes requester email before storing only a one-way hash", () => {
    expect(accountClosureRequesterEmailHash("  Gili@Example.com ")).toBe(
      accountClosureRequesterEmailHash("gili@example.com"),
    );
    expect(accountClosureRequesterEmailHash("gili@example.com")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("runs Calendar disconnect, local preference cleanup, and public-link revocation", async () => {
    const closureStore = store();
    const disconnectGoogleCalendar = vi.fn(() => Promise.resolve());

    await expect(
      resumeAutomatedAccountClosure(
        closureStore,
        { disconnectGoogleCalendar },
        {
          requestId: request.id,
          actorClerkUserId: "user_operator",
          operationKey: "closure-run-1",
        },
      ),
    ).resolves.toEqual([
      { kind: "google_calendar_disconnect", status: "succeeded" },
      { kind: "device_and_artist_preferences_cleanup", status: "succeeded" },
      { kind: "public_and_capability_link_revoke", status: "succeeded" },
    ]);

    expect(disconnectGoogleCalendar).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
    expect(closureStore.deleteDeviceAndArtistPreferences).toHaveBeenCalledWith("user_closing");
    expect(closureStore.revokePublicAndCapabilityLinks).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(closureStore.claimTask).toHaveBeenCalledTimes(3);
    expect(closureStore.claimTask).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "clerk_account_delete" }),
    );
  });

  it("keeps capability revocation blocked until issued upload URLs have expired", async () => {
    const closureStore = store({
      revokePublicAndCapabilityLinks: vi.fn(() => Promise.resolve(false)),
    });

    const outcomes = await resumeAutomatedAccountClosure(
      closureStore,
      { disconnectGoogleCalendar: vi.fn(() => Promise.resolve()) },
      {
        requestId: request.id,
        actorClerkUserId: "user_operator",
        operationKey: "closure-run-capability-wait",
      },
    );

    expect(outcomes[2]).toEqual({
      kind: "public_and_capability_link_revoke",
      status: "blocked",
      errorCode: "capability_expiry_pending",
    });
    const succeededKinds = vi
      .mocked(closureStore.succeedTask)
      .mock.calls.map(([input]) => input.claim.kind);
    expect(succeededKinds).not.toContain("public_and_capability_link_revoke");
  });

  it("records Calendar as not applicable for an Artist-only account", async () => {
    const closureStore = store({ resolveProducerId: vi.fn(() => Promise.resolve(null)) });
    const disconnectGoogleCalendar = vi.fn(() => Promise.resolve());

    const outcomes = await resumeAutomatedAccountClosure(
      closureStore,
      { disconnectGoogleCalendar },
      {
        requestId: request.id,
        actorClerkUserId: "user_operator",
        operationKey: "closure-run-artist",
      },
    );

    expect(outcomes[0]).toEqual({
      kind: "google_calendar_disconnect",
      status: "not_applicable",
    });
    expect(disconnectGoogleCalendar).not.toHaveBeenCalled();
    expect(closureStore.markTaskNotApplicable).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceRef: "not-applicable:artist-only-account",
      }),
    );
  });

  it("does not require Google configuration when the Producer never connected Google", async () => {
    const closureStore = store({
      hasGoogleCalendarConnection: vi.fn(() => Promise.resolve(false)),
    });
    const disconnectGoogleCalendar = vi.fn(() => Promise.resolve());

    const outcomes = await resumeAutomatedAccountClosure(
      closureStore,
      { disconnectGoogleCalendar },
      {
        requestId: request.id,
        actorClerkUserId: "user_operator",
        operationKey: "closure-run-no-google",
      },
    );

    expect(outcomes[0]).toEqual({
      kind: "google_calendar_disconnect",
      status: "not_applicable",
    });
    expect(disconnectGoogleCalendar).not.toHaveBeenCalled();
    expect(closureStore.markTaskNotApplicable).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceRef: "not-applicable:no-google-connection" }),
    );
  });

  it("persists a safe blocked state and never stores a raw provider error", async () => {
    const closureStore = store();
    const outcomes = await resumeAutomatedAccountClosure(
      closureStore,
      {
        disconnectGoogleCalendar: vi.fn(() =>
          Promise.reject(new Error("token=must-never-be-persisted")),
        ),
      },
      {
        requestId: request.id,
        actorClerkUserId: "user_operator",
        operationKey: "closure-run-failed",
      },
    );

    expect(outcomes[0]).toEqual({
      kind: "google_calendar_disconnect",
      status: "blocked",
      errorCode: "unexpected_failure",
    });
    expect(closureStore.blockTask).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "unexpected_failure" }),
    );
    expect(JSON.stringify(vi.mocked(closureStore.blockTask).mock.calls)).not.toContain("token=");
  });

  it("preserves a specific allowlisted operational error code", async () => {
    const closureStore = store();
    await resumeAutomatedAccountClosure(
      closureStore,
      {
        disconnectGoogleCalendar: vi.fn(() =>
          Promise.reject(new AccountClosureTaskError("google_calendar_not_configured")),
        ),
      },
      {
        requestId: request.id,
        actorClerkUserId: "user_operator",
        operationKey: "closure-run-config",
      },
    );
    expect(closureStore.blockTask).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "google_calendar_not_configured" }),
    );
  });

  it("stops a task cleanly if a legal hold is applied while automation is running", async () => {
    const closureStore = store({
      succeedTask: vi.fn((input: Parameters<AccountClosureStore["succeedTask"]>[0]) => {
        const { claim } = input;
        if (claim.kind === "google_calendar_disconnect") {
          return Promise.reject(new AccountClosureError("account_closure_legal_hold"));
        }
        return Promise.resolve();
      }),
    });

    const outcomes = await resumeAutomatedAccountClosure(
      closureStore,
      { disconnectGoogleCalendar: vi.fn(() => Promise.resolve()) },
      {
        requestId: request.id,
        actorClerkUserId: "user_operator",
        operationKey: "closure-run-hold-race",
      },
    );

    expect(outcomes[0]).toEqual({
      kind: "google_calendar_disconnect",
      status: "blocked",
      errorCode: "account_closure_legal_hold",
    });
    expect(closureStore.blockTask).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "account_closure_legal_hold" }),
    );
  });

  it("claims a manual phase before accepting its exact-attempt evidence", async () => {
    const closureStore = store();
    const claim = await startManualAccountClosureTask(closureStore, {
      requestId: request.id,
      kind: "clerk_account_delete",
      actorClerkUserId: "user_operator",
      operationKey: "clerk-delete-1:start",
    });
    expect(claim.attempt).toBe(1);
    expect(closureStore.succeedTask).not.toHaveBeenCalled();

    await finishManualAccountClosureTask(closureStore, {
      requestId: request.id,
      kind: "clerk_account_delete",
      attempt: claim.attempt,
      actorClerkUserId: "user_operator",
      operationKey: "clerk-delete-1:finish",
      evidenceRef: "clerk:request_123",
      outcome: "succeeded",
    });
    const finishInput = vi.mocked(closureStore.succeedTask).mock.calls[0]?.[0];
    expect(finishInput?.claim).toMatchObject({ attempt: 1, kind: "clerk_account_delete" });
    expect(finishInput?.evidenceRef).toBe("clerk:request_123");
  });

  it("allows only one operator to start the same manual phase", async () => {
    let claimed = false;
    const claimTask = vi.fn((input: Parameters<AccountClosureStore["claimTask"]>[0]) => {
      if (claimed) return Promise.resolve(null);
      claimed = true;
      return Promise.resolve({ attempt: 1, kind: input.kind, request });
    });
    const closureStore = store({ claimTask });
    const input = {
      requestId: request.id,
      kind: "storage_review_and_cleanup" as const,
      actorClerkUserId: "user_operator",
    };

    await expect(
      startManualAccountClosureTask(closureStore, {
        ...input,
        operationKey: "storage-start-1",
      }),
    ).resolves.toMatchObject({ attempt: 1 });
    await expect(
      startManualAccountClosureTask(closureStore, {
        ...input,
        operationKey: "storage-start-2",
      }),
    ).rejects.toMatchObject({ code: "account_closure_task_state" });
    expect(claimTask).toHaveBeenCalledTimes(2);
  });

  it("fails instead of pretending that an already-running or terminal manual task was claimed", async () => {
    const closureStore = store({ claimTask: vi.fn(() => Promise.resolve(null)) });
    await expect(
      startManualAccountClosureTask(closureStore, {
        requestId: request.id,
        kind: "storage_review_and_cleanup",
        actorClerkUserId: "user_operator",
        operationKey: "storage-review-1:start",
      }),
    ).rejects.toMatchObject({ code: "account_closure_task_state" });

    expect(closureStore.succeedTask).not.toHaveBeenCalled();
    expect(closureStore.completeIfReady).not.toHaveBeenCalled();
  });

  it("requires an explicit valid outcome and exact positive attempt", async () => {
    const closureStore = store();
    await expect(
      finishManualAccountClosureTask(closureStore, {
        requestId: request.id,
        kind: "clerk_account_delete",
        attempt: 0,
        actorClerkUserId: "user_operator",
        operationKey: "clerk-delete-invalid",
        evidenceRef: "clerk:request_123",
        outcome: "succeeded",
      }),
    ).rejects.toMatchObject({ code: "account_closure_invalid_input" });

    await expect(
      finishManualAccountClosureTask(closureStore, {
        requestId: request.id,
        kind: "clerk_account_delete",
        attempt: 1,
        actorClerkUserId: "user_operator",
        operationKey: "clerk-delete-not-applicable",
        evidenceRef: "clerk:request_123",
        outcome: "not_applicable",
      }),
    ).rejects.toMatchObject({ code: "account_closure_invalid_input" });
  });

  it("accepts only a short reason code for a legal hold", async () => {
    const closureStore = store();
    await applyAccountClosureLegalHold(closureStore, {
      requestId: request.id,
      actorClerkUserId: "user_operator",
      operationKey: "hold-1",
      reasonCode: "active_legal_claim",
    });
    expect(closureStore.applyLegalHold).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "active_legal_claim" }),
    );

    await expect(
      applyAccountClosureLegalHold(closureStore, {
        requestId: request.id,
        actorClerkUserId: "user_operator",
        operationKey: "hold-unsafe",
        reasonCode: "Free text with personal details",
      }),
    ).rejects.toMatchObject({ code: "account_closure_invalid_input" });
  });

  it("rechecks request completion immediately after a legal hold is released", async () => {
    const closureStore = store();
    await releaseAccountClosureLegalHold(closureStore, {
      requestId: request.id,
      actorClerkUserId: "user_operator",
      operationKey: "hold-release-1",
    });

    expect(closureStore.releaseLegalHold).toHaveBeenCalledOnce();
    expect(closureStore.completeIfReady).toHaveBeenCalledWith(
      expect.objectContaining({ operationKey: "hold-release-1:complete" }),
    );
  });
});
