import { describe, expect, it, vi } from "vitest";

import {
  reconcileRegisteredAccounts,
  type RegisteredAccountReconciliationRepository,
} from "./reconciliation";

function user(id: string, updatedAt: number) {
  return {
    banned: false,
    createdAt: 1_700_000_000_000,
    emailAddresses: [
      {
        emailAddress: `${id}@example.com`,
        id: `email_${id}`,
        verificationStatus: "verified",
      },
    ],
    firstName: id,
    id,
    lastName: null,
    lastSignInAt: null,
    locked: false,
    primaryEmailAddressId: `email_${id}`,
    privateMetadata: { skitzaAccountKind: "external", ignored: "never copied" },
    updatedAt,
    username: null,
  } as const;
}

const auditInput = {
  actorClerkUserId: "user_founder",
  environment: "test" as const,
  operationKey: "reconcile-page-1",
};

function repository(
  applied = 0,
  replayed = false,
): RegisteredAccountReconciliationRepository {
  return {
    applySnapshots: vi.fn().mockResolvedValue({
      applied,
      replayed,
    }),
  };
}

describe("registered-account reconciliation", () => {
  it("processes one bounded provider page and returns a continuation", async () => {
    const getPage = vi.fn().mockResolvedValue({
      data: [user("user_1", 1_700_000_100_000), user("user_2", 1_700_000_200_000)],
      totalCount: 3,
    });
    const store = repository(2);

    const result = await reconcileRegisteredAccounts({
      ...auditInput,
      clerkInstanceId: "ins_test",
      provider: { getInstanceId: vi.fn().mockResolvedValue("ins_test"), getPage },
      repository: store,
    });

    expect(getPage).toHaveBeenCalledWith({ limit: 100, offset: 0 });
    expect(getPage).toHaveBeenCalledOnce();
    expect(store.applySnapshots).toHaveBeenCalledOnce();
    const snapshots = vi.mocked(store.applySnapshots).mock.calls[0]?.[0].snapshots;
    expect(snapshots).toHaveLength(2);
    expect(snapshots?.[0]).toMatchObject({
      audienceType: "external",
      clerkUserId: "user_1",
      primaryEmail: "user_1@example.com",
    });
    expect(snapshots?.[0]).not.toHaveProperty("privateMetadata");
    const audit = vi.mocked(store.applySnapshots).mock.calls[0]?.[0].audit;
    expect(audit).toMatchObject({
      action: "registered_accounts.reconcile",
      actorClerkUserId: "user_founder",
      environment: "test",
      safeAfterState: null,
      safeBeforeState: null,
      targetAccountClerkUserId: null,
      targetType: "registered_accounts",
    });
    expect(JSON.stringify(audit)).not.toMatch(/@|displayName|primaryEmail/);
    expect(result).toMatchObject({
      applied: 2,
      complete: false,
      seen: 2,
      skipped: 0,
    });
    expect(result.nextCursor).toEqual(expect.any(String));

    getPage.mockResolvedValueOnce({
      data: [user("user_3", 1_700_000_300_000)],
      totalCount: 3,
    });
    const second = await reconcileRegisteredAccounts({
      ...auditInput,
      clerkInstanceId: "ins_test",
      cursor: result.nextCursor,
      operationKey: "reconcile-page-2",
      provider: { getInstanceId: vi.fn().mockResolvedValue("ins_test"), getPage },
      repository: store,
    });
    expect(getPage).toHaveBeenLastCalledWith({ limit: 100, offset: 2 });
    expect(second).toMatchObject({
      complete: true,
      nextCursor: null,
      seen: 1,
    });
  });

  it("returns an exact audit replay without claiming a second write", async () => {
    const store = repository(0, true);

    const result = await reconcileRegisteredAccounts({
      ...auditInput,
      clerkInstanceId: "ins_test",
      provider: {
        getInstanceId: vi.fn().mockResolvedValue("ins_test"),
        getPage: vi.fn().mockResolvedValue({
          data: [user("user_1", 1_700_000_100_000)],
          totalCount: 1,
        }),
      },
      repository: store,
    });

    expect(result).toMatchObject({
      applied: 0,
      complete: true,
      replayed: true,
      seen: 1,
      skipped: 1,
    });
    expect(store.applySnapshots).toHaveBeenCalledOnce();
  });

  it("fails closed on an impossible empty partial page and never infers deletion", async () => {
    const store = repository();

    await expect(
      reconcileRegisteredAccounts({
        ...auditInput,
        clerkInstanceId: "ins_test",
        provider: {
          getInstanceId: vi.fn().mockResolvedValue("ins_test"),
          getPage: vi.fn().mockResolvedValue({ data: [], totalCount: 20 }),
        },
        repository: store,
      }),
    ).rejects.toThrow("REGISTERED_ACCOUNT_RECONCILIATION_FAILED");

    expect(store.applySnapshots).not.toHaveBeenCalled();
    expect(store).not.toHaveProperty("deleteMissing");
  });

  it("deduplicates a provider page by Clerk ID and keeps the newest snapshot", async () => {
    const getPage = vi.fn().mockResolvedValue({
      data: [
        user("user_1", 1_700_000_100_000),
        user("user_1", 1_700_000_500_000),
        user("user_2", 1_700_000_200_000),
      ],
      totalCount: 3,
    });
    const store = repository(2);

    await reconcileRegisteredAccounts({
      ...auditInput,
      clerkInstanceId: "ins_test",
      provider: { getInstanceId: vi.fn().mockResolvedValue("ins_test"), getPage },
      repository: store,
    });

    const snapshots = vi.mocked(store.applySnapshots).mock.calls[0]?.[0].snapshots;
    expect(snapshots).toHaveLength(2);
    expect(snapshots?.find((item) => item.clerkUserId === "user_1")?.providerUpdatedAt).toEqual(
      new Date(1_700_000_500_000),
    );
  });

  it("rejects a continuation from another Clerk instance before page access", async () => {
    const first = await reconcileRegisteredAccounts({
      ...auditInput,
      clerkInstanceId: "ins_one",
      provider: {
        getInstanceId: vi.fn().mockResolvedValue("ins_one"),
        getPage: vi.fn().mockResolvedValue({
          data: [user("user_1", 1_700_000_100_000)],
          totalCount: 2,
        }),
      },
      repository: repository(1),
    });
    const getPage = vi.fn();

    await expect(
      reconcileRegisteredAccounts({
        ...auditInput,
        clerkInstanceId: "ins_two",
        cursor: first.nextCursor,
        provider: {
          getInstanceId: vi.fn().mockResolvedValue("ins_two"),
          getPage,
        },
        repository: repository(),
      }),
    ).rejects.toThrow("REGISTERED_ACCOUNT_RECONCILIATION_FAILED");
    expect(getPage).not.toHaveBeenCalled();
  });

  it("proves the key belongs to the configured instance before any write", async () => {
    const store = repository();
    const getPage = vi.fn();

    await expect(
      reconcileRegisteredAccounts({
        ...auditInput,
        clerkInstanceId: "ins_test",
        provider: {
          getInstanceId: vi.fn().mockResolvedValue("ins_other"),
          getPage,
        },
        repository: store,
      }),
    ).rejects.toThrow("REGISTERED_ACCOUNT_RECONCILIATION_FAILED");

    expect(getPage).not.toHaveBeenCalled();
    expect(store.applySnapshots).not.toHaveBeenCalled();
  });

  it("constrains a valid combined provider name without dropping the account", async () => {
    const store = repository(1);
    const tooLong = {
      ...user("user_long_name", 1_700_000_500_000),
      firstName: "a".repeat(80),
      lastName: "b".repeat(80),
    };

    await reconcileRegisteredAccounts({
        ...auditInput,
        clerkInstanceId: "ins_test",
        provider: {
          getInstanceId: vi.fn().mockResolvedValue("ins_test"),
          getPage: vi.fn().mockResolvedValue({ data: [tooLong], totalCount: 1 }),
        },
        repository: store,
      });
    const snapshots = vi.mocked(store.applySnapshots).mock.calls[0]?.[0].snapshots;
    expect(snapshots?.[0]?.displayName).toHaveLength(160);
  });
});
