import { describe, expect, it, vi } from "vitest";

import type {
  AccountClosureAutomation,
  AccountClosureRequestRecord,
  AccountClosureStore,
} from "~/server/identity/account-closure";
import {
  ACCOUNT_CLOSURE_TASKS,
  AUTOMATED_ACCOUNT_CLOSURE_TASKS,
} from "~/server/identity/account-closure";

import {
  ACCOUNT_CLOSURE_MAX_STDIN_BYTES,
  executeAccountClosureOperatorCommand,
  MANUAL_ACCOUNT_CLOSURE_TASKS,
  parseAccountClosureOperatorCommand,
} from "./command";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const OCCURRED_AT = "2026-08-13T10:00:00.000Z";
const REQUEST: AccountClosureRequestRecord = {
  id: REQUEST_ID,
  clerkUserId: "user_customer_private",
  status: "processing",
  closureStartedAt: new Date(OCCURRED_AT),
  accessRevokedAt: null,
  dueAt: new Date("2026-09-12T10:00:00.000Z"),
  legalHoldAt: null,
  legalHoldReleasedAt: null,
};

function fakeStore(overrides: Partial<AccountClosureStore> = {}): AccountClosureStore {
  return {
    openRequest: vi.fn(() => Promise.resolve(REQUEST)),
    verifyAndBeginClosure: vi.fn(() => Promise.resolve(REQUEST)),
    getRequest: vi.fn(() => Promise.resolve(REQUEST)),
    getTasks: vi.fn(() =>
      Promise.resolve([
        { kind: "storage_review_and_cleanup" as const, status: "pending" as const },
      ]),
    ),
    claimTask: vi.fn(() => Promise.resolve(null)),
    succeedTask: vi.fn(() => Promise.resolve()),
    markTaskNotApplicable: vi.fn(() => Promise.resolve()),
    blockTask: vi.fn(() => Promise.resolve()),
    recoverStaleTask: vi.fn(() => Promise.resolve()),
    resolveProducerId: vi.fn(() => Promise.resolve(null)),
    hasGoogleCalendarConnection: vi.fn(() => Promise.resolve(false)),
    deleteDeviceAndArtistPreferences: vi.fn(() => Promise.resolve()),
    revokePublicAndCapabilityLinks: vi.fn(() => Promise.resolve(true)),
    applyLegalHold: vi.fn(() => Promise.resolve()),
    releaseLegalHold: vi.fn(() => Promise.resolve()),
    completeIfReady: vi.fn(() => Promise.resolve(false)),
    ...overrides,
  };
}

function dependencies(store = fakeStore()) {
  return {
    store,
    currentClerkInstanceId: "ins_production",
    resolveProviderClerkUserId: vi.fn(({ canonicalClerkUserId }) =>
      Promise.resolve(canonicalClerkUserId),
    ),
    automation: {
      disconnectGoogleCalendar: vi.fn(() => Promise.resolve()),
    } satisfies AccountClosureAutomation,
  };
}

describe("account-closure operator command", () => {
  it("keeps the manual command allowlist equal to the non-automated domain tasks", () => {
    const automated = new Set<string>(AUTOMATED_ACCOUNT_CLOSURE_TASKS);
    expect(MANUAL_ACCOUNT_CLOSURE_TASKS).toEqual(
      ACCOUNT_CLOSURE_TASKS.filter((kind) => !automated.has(kind)),
    );
  });

  it("parses every supported command from strict JSON", () => {
    const commands = [
      { command: "inspect", requestId: REQUEST_ID },
      {
        command: "open",
        clerkUserId: "user_customer_private",
        requesterEmail: "private@example.com",
        operationKey: "request-1",
      },
      {
        command: "verify",
        requestId: REQUEST_ID,
        operationKey: "verify-1",
      },
      {
        command: "resume-automated",
        requestId: REQUEST_ID,
        operationKey: "resume-1",
      },
      {
        command: "start-manual",
        requestId: REQUEST_ID,
        kind: "clerk_account_delete",
        operationKey: "manual-1:start",
        clerkInstanceId: "ins_production",
        providerClerkUserId: "user_customer_private",
      },
      {
        command: "finish-manual",
        requestId: REQUEST_ID,
        kind: "clerk_account_delete",
        attempt: 1,
        operationKey: "manual-1:finish",
        evidenceRef: "clerk:deletion-receipt-1",
        outcome: "succeeded",
        clerkInstanceId: "ins_production",
        providerClerkUserId: "user_customer_private",
      },
      {
        command: "recover-stale-task",
        requestId: REQUEST_ID,
        kind: "google_calendar_disconnect",
        operationKey: "recover-1",
        evidenceRef: "case:closure-1/google-state-reviewed",
      },
      {
        command: "legal-hold",
        action: "set",
        requestId: REQUEST_ID,
        operationKey: "hold-1",
        reasonCode: "litigation_notice",
      },
      {
        command: "legal-hold",
        action: "release",
        requestId: REQUEST_ID,
        operationKey: "release-1",
      },
    ];

    expect(
      commands.map((command) => parseAccountClosureOperatorCommand(JSON.stringify(command))),
    ).toHaveLength(commands.length);
  });

  it("rejects actor injection, old one-step evidence, omitted outcomes, and caller time", () => {
    expect(() =>
      parseAccountClosureOperatorCommand(
        JSON.stringify({
          command: "inspect",
          requestId: REQUEST_ID,
          actorClerkUserId: "user_injected",
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_CLOSURE_COMMAND_INVALID" }));

    expect(() =>
      parseAccountClosureOperatorCommand(
        JSON.stringify({
          command: "record-manual",
          requestId: REQUEST_ID,
          kind: "google_calendar_disconnect",
          operationKey: "manual-invalid",
          evidenceRef: "not-real",
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_CLOSURE_COMMAND_INVALID" }));

    expect(() =>
      parseAccountClosureOperatorCommand(
        JSON.stringify({
          command: "finish-manual",
          requestId: REQUEST_ID,
          kind: "storage_review_and_cleanup",
          attempt: 1,
          operationKey: "manual-missing-outcome",
          evidenceRef: "r2:audit-1",
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_CLOSURE_COMMAND_INVALID" }));

    expect(() =>
      parseAccountClosureOperatorCommand(
        JSON.stringify({
          command: "recover-stale-task",
          requestId: REQUEST_ID,
          kind: "storage_review_and_cleanup",
          operationKey: "recover-with-caller-time",
          evidenceRef: "case:closure-1/storage-state-reviewed",
          occurredAt: "2099-01-01T00:00:00.000Z",
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_CLOSURE_COMMAND_INVALID" }));

    expect(() =>
      parseAccountClosureOperatorCommand("x".repeat(ACCOUNT_CLOSURE_MAX_STDIN_BYTES + 1)),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_CLOSURE_INPUT_TOO_LARGE" }));
  });

  it("takes the actor only from the operator environment and sanitizes open output", async () => {
    const openRequest = vi.fn((input: Parameters<AccountClosureStore["openRequest"]>[0]) => {
      void input;
      return Promise.resolve(REQUEST);
    });
    const store = fakeStore({ openRequest });
    const command = parseAccountClosureOperatorCommand(
      JSON.stringify({
        command: "open",
        clerkUserId: "user_customer_private",
        requesterEmail: "private@example.com",
        operationKey: "request-1",
      }),
    );

    const result = await executeAccountClosureOperatorCommand(
      command,
      "user_founder_operator",
      dependencies(store),
    );

    expect(openRequest).toHaveBeenCalledOnce();
    const recordedInput = openRequest.mock.calls[0]?.[0];
    expect(recordedInput).toEqual({
      clerkUserId: "user_customer_private",
      requesterEmailHash: recordedInput?.requesterEmailHash,
      actorClerkUserId: "user_founder_operator",
      operationKey: "request-1",
    });
    expect(recordedInput?.requesterEmailHash).toMatch(/^sha256:/);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("user_customer_private");
    expect(serialized).not.toContain("user_founder_operator");
  });

  it("dispatches work, explicit stale recovery, and both legal-hold actions", async () => {
    const verifyAndBeginClosure = vi.fn(() => Promise.resolve(REQUEST));
    const claimTask = vi.fn((input: Parameters<AccountClosureStore["claimTask"]>[0]) =>
      Promise.resolve(
        input.kind === "storage_review_and_cleanup"
          ? { attempt: 1, kind: input.kind, request: REQUEST }
          : null,
      ),
    );
    const applyLegalHold = vi.fn(() => Promise.resolve());
    const releaseLegalHold = vi.fn(() => Promise.resolve());
    const recoverStaleTask = vi.fn(() => Promise.resolve());
    const store = fakeStore({
      verifyAndBeginClosure,
      claimTask,
      applyLegalHold,
      releaseLegalHold,
      recoverStaleTask,
    });
    const activeDependencies = dependencies(store);
    const commands = [
      {
        command: "verify",
        requestId: REQUEST_ID,
        operationKey: "verify-1",
      },
      {
        command: "resume-automated",
        requestId: REQUEST_ID,
        operationKey: "resume-1",
      },
      {
        command: "start-manual",
        requestId: REQUEST_ID,
        kind: "storage_review_and_cleanup",
        operationKey: "manual-1:start",
      },
      {
        command: "finish-manual",
        requestId: REQUEST_ID,
        kind: "storage_review_and_cleanup",
        attempt: 1,
        operationKey: "manual-1:finish",
        evidenceRef: "r2:audit-1",
        outcome: "succeeded",
      },
      {
        command: "recover-stale-task",
        requestId: REQUEST_ID,
        kind: "google_calendar_disconnect",
        operationKey: "recover-1",
        evidenceRef: "case:closure-1/google-state-reviewed",
      },
      {
        command: "legal-hold",
        action: "set",
        requestId: REQUEST_ID,
        operationKey: "hold-1",
        reasonCode: "litigation_notice",
      },
      {
        command: "legal-hold",
        action: "release",
        requestId: REQUEST_ID,
        operationKey: "release-1",
      },
    ] as const;

    for (const serialized of commands) {
      await executeAccountClosureOperatorCommand(
        parseAccountClosureOperatorCommand(JSON.stringify(serialized)),
        "user_founder_operator",
        activeDependencies,
      );
    }

    expect(verifyAndBeginClosure).toHaveBeenCalledOnce();
    expect(claimTask).toHaveBeenCalledTimes(4);
    expect(recoverStaleTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "google_calendar_disconnect",
        evidenceRef: "case:closure-1/google-state-reviewed",
      }),
    );
    expect(applyLegalHold).toHaveBeenCalledOnce();
    expect(releaseLegalHold).toHaveBeenCalledOnce();
  });

  it("rejects Clerk deletion proof for any instance except the configured current one", async () => {
    const store = fakeStore();
    const input = dependencies(store);
    const command = parseAccountClosureOperatorCommand(
      JSON.stringify({
        command: "start-manual",
        requestId: REQUEST_ID,
        kind: "clerk_account_delete",
        operationKey: "manual-delete-wrong-instance",
        clerkInstanceId: "ins_development",
        providerClerkUserId: "user_customer_private",
      }),
    );

    await expect(
      executeAccountClosureOperatorCommand(command, "user_founder_operator", input),
    ).rejects.toMatchObject({ code: "account_closure_invalid_input" });
    expect(input.resolveProviderClerkUserId).not.toHaveBeenCalled();
    expect(store.claimTask).not.toHaveBeenCalled();
  });
});
