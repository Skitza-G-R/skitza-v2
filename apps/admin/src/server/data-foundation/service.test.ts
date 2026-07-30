import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_HISTORY_RETENTION_MS,
  buildRegisteredAccountsReconciliationCommand,
  createAdminDataFoundation,
  isAdminHistoryExpired,
  isAdminSystemProblemTransitionAllowed,
  type AdminDataFoundationRepository,
} from "./service";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const PROBLEM_ID = "9de0f153-9400-49a5-9249-f810d0fbfd27";
const BATCH_DIGEST = `sha256:${"a".repeat(64)}`;

function repository(): AdminDataFoundationRepository {
  return {
    addSupportNote: vi.fn().mockResolvedValue({
      id: "note-1",
      replayed: false,
    }),
    purgeExpiredAdminHistory: vi.fn().mockResolvedValue(0),
    recordSensitiveReveal: vi.fn().mockResolvedValue({
      id: "history-1",
      replayed: false,
    }),
    transitionSystemProblem: vi.fn().mockResolvedValue({
      id: PROBLEM_ID,
      replayed: false,
      state: "seen",
    }),
  };
}

describe("SK-132 admin data foundation service", () => {
  let store: AdminDataFoundationRepository;

  beforeEach(() => {
    store = repository();
  });

  it("purges expired history before atomically writing a private support note and safe audit", async () => {
    const foundation = createAdminDataFoundation(store, () => NOW);

    await expect(
      foundation.addSupportNote({
        actorClerkUserId: "user_founder",
        body: "Founder-private investigation detail",
        environment: "live",
        operationKey: "support-note:user-42:request-1",
        targetId: "user-42",
        targetType: "registered_account",
      }),
    ).resolves.toEqual({ id: "note-1", replayed: false });

    expect(store.purgeExpiredAdminHistory).toHaveBeenCalledWith({
      environment: "live",
    });
    expect(store.addSupportNote).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "support_note.create",
        actorClerkUserId: "user_founder",
        body: "Founder-private investigation detail",
        environment: "live",
        occurredAt: NOW,
        safeAfterState: { noteCreated: true },
        safeBeforeState: null,
        targetId: "user-42",
        targetType: "registered_account",
      }),
    );
    const command = vi.mocked(store.addSupportNote).mock.calls[0]?.[0];
    expect(command?.operationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(command?.safeAfterState)).not.toContain("investigation detail");
  });

  it("scopes identical operation keys to both environment and action intent", async () => {
    const foundation = createAdminDataFoundation(store, () => NOW);
    const common = {
      actorClerkUserId: "user_founder",
      body: "Private note",
      operationKey: "request-1",
      targetId: "user-42",
      targetType: "registered_account",
    } as const;

    await foundation.addSupportNote({ ...common, environment: "live" });
    await foundation.addSupportNote({ ...common, environment: "test" });
    await foundation.recordSensitiveReveal({
      actorClerkUserId: common.actorClerkUserId,
      contentKind: "payment_proof",
      environment: "live",
      operationKey: common.operationKey,
      reason: "support_investigation",
      targetId: common.targetId,
      targetType: common.targetType,
    });

    const live = vi.mocked(store.addSupportNote).mock.calls[0]?.[0];
    const test = vi.mocked(store.addSupportNote).mock.calls[1]?.[0];
    const reveal = vi.mocked(store.recordSensitiveReveal).mock.calls[0]?.[0];
    expect(live?.environment).toBe("live");
    expect(test?.environment).toBe("test");
    expect(live?.operationDigest).not.toBe(test?.operationDigest);
    expect(reveal?.operationKey).toBe(live?.operationKey);
    expect(reveal?.action).not.toBe(live?.action);
    expect(reveal?.operationDigest).not.toBe(live?.operationDigest);
  });

  it("requires an approved reason before creating a reveal permit", async () => {
    const foundation = createAdminDataFoundation(store, () => NOW);

    await expect(
      foundation.recordSensitiveReveal({
        actorClerkUserId: "user_founder",
        contentKind: "payment_proof",
        environment: "test",
        operationKey: "reveal:user-42:request-1",
        reason: "" as "support_investigation",
        targetId: "user-42",
        targetType: "registered_account",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(store.recordSensitiveReveal).not.toHaveBeenCalled();

    await foundation.recordSensitiveReveal({
      actorClerkUserId: "user_founder",
      contentKind: "payment_proof",
      environment: "test",
      operationKey: "reveal:user-42:request-2",
      reason: "support_investigation",
      targetId: "user-42",
      targetType: "registered_account",
    });

    expect(store.recordSensitiveReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sensitive_content.reveal",
        environment: "test",
        reason: "support_investigation",
        safeAfterState: null,
        safeBeforeState: null,
      }),
    );
    const command = vi.mocked(store.recordSensitiveReveal).mock.calls[0]?.[0];
    expect(command).not.toHaveProperty("content");
    expect(JSON.stringify(command)).not.toContain("private message");
  });

  it.each(["", "PaymentProof", "payment proof", "../secret", `a${"x".repeat(100)}`])(
    "rejects unsafe reveal content kind %j before cleanup or persistence",
    async (contentKind) => {
      const foundation = createAdminDataFoundation(store, () => NOW);

      await expect(
        foundation.recordSensitiveReveal({
          actorClerkUserId: "user_founder",
          contentKind,
          environment: "test",
          operationKey: "reveal:user-42:invalid-content-kind",
          reason: "support_investigation",
          targetId: "user-42",
          targetType: "registered_account",
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(store.purgeExpiredAdminHistory).not.toHaveBeenCalled();
      expect(store.recordSensitiveReveal).not.toHaveBeenCalled();
    },
  );

  it("keeps a system private note out of history snapshots", async () => {
    const foundation = createAdminDataFoundation(store, () => NOW);

    await foundation.transitionSystemProblem({
      actorClerkUserId: "user_founder",
      environment: "live",
      operationKey: "problem:problem-1:seen:request-1",
      privateNote: "Provider ticket contains founder-only detail",
      problemId: PROBLEM_ID,
      state: "seen",
    });

    expect(store.transitionSystemProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "system_problem.update",
        privateNote: "Provider ticket contains founder-only detail",
        safeAfterState: {
          hasPrivateNote: true,
          state: "seen",
        },
      }),
    );
    const command = vi.mocked(store.transitionSystemProblem).mock.calls[0]?.[0];
    expect(JSON.stringify(command?.safeAfterState)).not.toContain("founder-only detail");
  });

  it("preserves a private note when omitted and clears it only with explicit null", async () => {
    const foundation = createAdminDataFoundation(store, () => NOW);

    await foundation.transitionSystemProblem({
      actorClerkUserId: "user_founder",
      environment: "live",
      operationKey: "problem:problem-1:new:request-1",
      problemId: PROBLEM_ID,
      state: "new",
    });
    const preserved = vi.mocked(store.transitionSystemProblem).mock.calls[0]?.[0];
    expect(preserved).not.toHaveProperty("privateNote");
    expect(preserved?.safeAfterState).toEqual({ state: "new" });

    await foundation.transitionSystemProblem({
      actorClerkUserId: "user_founder",
      environment: "live",
      operationKey: "problem:problem-1:resolved:request-2",
      privateNote: null,
      problemId: PROBLEM_ID,
      state: "resolved",
    });
    const cleared = vi.mocked(store.transitionSystemProblem).mock.calls[1]?.[0];
    expect(cleared).toHaveProperty("privateNote", null);
    expect(cleared?.safeAfterState).toEqual({
      hasPrivateNote: false,
      state: "resolved",
    });
    expect(preserved?.operationDigest).not.toBe(cleared?.operationDigest);
  });

  it("rejects a malformed system-problem UUID before retention or repository access", async () => {
    const foundation = createAdminDataFoundation(store, () => NOW);

    await expect(
      foundation.transitionSystemProblem({
        actorClerkUserId: "user_founder",
        environment: "live",
        operationKey: "problem:invalid:seen:request-1",
        problemId: "problem-1",
        state: "seen",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(store.transitionSystemProblem).not.toHaveBeenCalled();
    expect(store.purgeExpiredAdminHistory).not.toHaveBeenCalled();
  });
});

describe("SK-133 registered-account reconciliation audit", () => {
  it("records only bounded batch intent and never copies account identity", () => {
    const command = buildRegisteredAccountsReconciliationCommand(
      {
        actorClerkUserId: "user_founder",
        batchDigest: BATCH_DIGEST,
        environment: "test",
        offset: 100,
        operationKey: "registered-users-reconcile-page-2",
      },
      NOW,
    );

    expect(command).toMatchObject({
      action: "registered_accounts.reconcile",
      actorClerkUserId: "user_founder",
      environment: "test",
      occurredAt: NOW,
      safeAfterState: null,
      safeBeforeState: null,
      targetAccountClerkUserId: null,
      targetId: "test",
      targetType: "registered_accounts",
    });
    expect(command.operationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(command)).not.toMatch(/@|primaryEmail|displayName/);
  });

  it.each([
    {
      actorClerkUserId: "",
      batchDigest: BATCH_DIGEST,
      environment: "test",
      offset: 0,
      operationKey: "reconcile-1",
    },
    {
      actorClerkUserId: "user_founder",
      batchDigest: "sha256:not-a-digest",
      environment: "test",
      offset: 0,
      operationKey: "reconcile-1",
    },
    {
      actorClerkUserId: "user_founder",
      batchDigest: BATCH_DIGEST,
      environment: "test",
      offset: 100_001,
      operationKey: "reconcile-1",
    },
    {
      actorClerkUserId: "user_founder",
      batchDigest: BATCH_DIGEST,
      environment: "test",
      offset: 0.5,
      operationKey: "reconcile-1",
    },
    {
      actorClerkUserId: "user_founder",
      batchDigest: BATCH_DIGEST,
      environment: "unknown",
      offset: 0,
      operationKey: "reconcile-1",
    },
    {
      actorClerkUserId: "user_founder",
      batchDigest: BATCH_DIGEST,
      environment: "test",
      offset: 0,
      operationKey: "x".repeat(201),
    },
  ])("rejects malformed audit intent before persistence", (input) => {
    expect(() =>
      buildRegisteredAccountsReconciliationCommand(
        input as Parameters<
          typeof buildRegisteredAccountsReconciliationCommand
        >[0],
        NOW,
      ),
    ).toThrow("INVALID_INPUT");
  });

  it("rejects an invalid audit timestamp", () => {
    expect(() =>
      buildRegisteredAccountsReconciliationCommand(
        {
          actorClerkUserId: "user_founder",
          batchDigest: BATCH_DIGEST,
          environment: "test",
          offset: 0,
          operationKey: "reconcile-1",
        },
        new Date(Number.NaN),
      ),
    ).toThrow("INVALID_INPUT");
  });
});

describe("SK-132 admin-history retention boundary", () => {
  it("retains the exact 90-day boundary and removes only older history", () => {
    const exactBoundary = new Date(NOW.getTime() - ADMIN_HISTORY_RETENTION_MS);
    const oneMillisecondOlder = new Date(exactBoundary.getTime() - 1);
    const oneMillisecondNewer = new Date(exactBoundary.getTime() + 1);

    expect(isAdminHistoryExpired(oneMillisecondOlder, NOW)).toBe(true);
    expect(isAdminHistoryExpired(exactBoundary, NOW)).toBe(false);
    expect(isAdminHistoryExpired(oneMillisecondNewer, NOW)).toBe(false);
  });
});

describe("SK-132 system-problem transition policy", () => {
  it.each([
    ["new", "new"],
    ["new", "seen"],
    ["new", "resolved"],
    ["seen", "seen"],
    ["seen", "resolved"],
    ["resolved", "resolved"],
  ] as const)("supports the approved %s to %s transition", (current, requested) => {
    expect(isAdminSystemProblemTransitionAllowed(current, requested)).toBe(true);
  });

  it.each([
    ["seen", "new"],
    ["resolved", "new"],
    ["resolved", "seen"],
  ] as const)("rejects the invalid admin %s to %s transition", (current, requested) => {
    expect(isAdminSystemProblemTransitionAllowed(current, requested)).toBe(false);
  });
});
