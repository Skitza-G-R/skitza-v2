import { describe, expect, it, vi } from "vitest";

import {
  createRegisteredAccountSyncRepository,
  parseRegisteredAccountLifecycleEvent,
  shouldReplaceRegisteredAccountSnapshot,
  synchronizeRegisteredAccount,
  type RegisteredAccountSyncRepository,
} from "./registered-account-sync";
import type { Db } from "@skitza/db";

function repository(): RegisteredAccountSyncRepository {
  return {
    claimEvent: vi.fn().mockResolvedValue({ replayed: false }),
    tombstone: vi.fn().mockResolvedValue({ applied: true }),
    upsertSnapshot: vi.fn().mockResolvedValue({ applied: true, terminalDeleted: false }),
  };
}

const INSTANCE_ID = "ins_skitza_test";
const DIGEST = `sha256:${"a".repeat(64)}`;
const resolveSelf = vi.fn((identity: { providerClerkUserId: string }) =>
  Promise.resolve(identity.providerClerkUserId),
);

describe("registered account lifecycle synchronization", () => {
  it("uses Clerk's selected primary email and verified state", () => {
    expect(
      parseRegisteredAccountLifecycleEvent(
        {
          data: {
            banned: false,
            created_at: 1_700_000_000_000,
            email_addresses: [
              {
                email_address: "old@example.com",
                id: "idn_old",
                verification: { status: "verified" },
              },
              {
                email_address: "Maya@Example.com",
                id: "idn_primary",
                verification: { status: "verified" },
              },
            ],
            first_name: " Maya ",
            id: "user_maya",
            last_name: " Levi ",
            last_sign_in_at: 1_700_000_100_000,
            locked: false,
            private_metadata: { skitzaAccountKind: "external" },
            primary_email_address_id: "idn_primary",
            updated_at: 1_700_000_200_000,
          },
          instance_id: INSTANCE_ID,
          timestamp: 1_700_000_200_000,
          type: "user.created",
        },
        "evt_created",
        INSTANCE_ID,
      ),
    ).toEqual({
      eventType: "user.created",
      instanceId: INSTANCE_ID,
      kind: "snapshot",
      snapshot: {
        audienceType: "external",
        clerkUserId: "user_maya",
        displayName: "Maya Levi",
        emailVerified: true,
        eventId: "evt_created",
        lastSignInAt: new Date(1_700_000_100_000),
        primaryEmail: "maya@example.com",
        providerCreatedAt: new Date(1_700_000_000_000),
        providerState: "active",
        providerUpdatedAt: new Date(1_700_000_200_000),
      },
    });
  });

  it("maps restricted provider states without inventing app suspension", () => {
    const event = parseRegisteredAccountLifecycleEvent(
      {
        data: {
          banned: true,
          created_at: 1_700_000_000_000,
          email_addresses: [],
          first_name: null,
          id: "user_restricted",
          last_name: null,
          locked: false,
          primary_email_address_id: null,
          updated_at: 1_700_000_300_000,
          username: null,
        },
        instance_id: INSTANCE_ID,
        timestamp: 1_700_000_300_000,
        type: "user.updated",
      },
      "evt_restricted",
      INSTANCE_ID,
    );

    expect(event?.kind).toBe("snapshot");
    if (event?.kind === "snapshot") {
      expect(event.snapshot.providerState).toBe("banned");
      expect(event.snapshot.primaryEmail).toBeNull();
      expect(event.snapshot.displayName).toBeNull();
    }
  });

  it("creates a minimal deletion tombstone with no copied PII", () => {
    expect(
      parseRegisteredAccountLifecycleEvent(
        {
          data: { deleted: true, id: "user_deleted", object: "user" },
          instance_id: INSTANCE_ID,
          timestamp: 1_700_000_400_000,
          type: "user.deleted",
        },
        "evt_deleted",
        INSTANCE_ID,
      ),
    ).toEqual({
      eventType: "user.deleted",
      instanceId: INSTANCE_ID,
      kind: "tombstone",
      tombstone: {
        clerkUserId: "user_deleted",
        eventId: "evt_deleted",
        providerUpdatedAt: new Date(1_700_000_400_000),
      },
    });
  });

  it("ignores unrelated events and rejects malformed supported events", () => {
    expect(
      parseRegisteredAccountLifecycleEvent(
        { data: { id: "session_1" }, timestamp: 1, type: "session.created" },
        "evt_other",
        INSTANCE_ID,
      ),
    ).toBeNull();
    expect(() =>
      parseRegisteredAccountLifecycleEvent(
        {
          data: { id: "", updated_at: 1 },
          instance_id: INSTANCE_ID,
          timestamp: 1,
          type: "user.updated",
        },
        "evt_bad",
        INSTANCE_ID,
      ),
    ).toThrow("INVALID_CLERK_USER_EVENT");
  });

  it("routes snapshots and tombstones through the idempotent repository", async () => {
    const repo = repository();

    await synchronizeRegisteredAccount(
      repo,
      {
        data: {
          banned: false,
          created_at: 1_700_000_000_000,
          email_addresses: [],
          id: "user_1",
          locked: false,
          updated_at: 1_700_000_100_000,
        },
        instance_id: INSTANCE_ID,
        timestamp: 1_700_000_100_000,
        type: "user.updated",
      },
      "evt_update",
      DIGEST,
      INSTANCE_ID,
      resolveSelf,
    );
    await synchronizeRegisteredAccount(
      repo,
      {
        data: { deleted: true, id: "user_1" },
        instance_id: INSTANCE_ID,
        timestamp: 1_700_000_200_000,
        type: "user.deleted",
      },
      "evt_delete",
      DIGEST,
      INSTANCE_ID,
      resolveSelf,
    );

    expect(repo.claimEvent).toHaveBeenCalledTimes(2);
    expect(repo.upsertSnapshot).toHaveBeenCalledTimes(1);
    expect(repo.tombstone).toHaveBeenCalledTimes(1);
  });

  it("records raw webhook identity but writes the canonical application id", async () => {
    const repo = repository();
    const resolveCanonical = vi.fn().mockResolvedValue("user_historical");

    await synchronizeRegisteredAccount(
      repo,
      {
        data: {
          banned: false,
          created_at: 1_700_000_000_000,
          email_addresses: [],
          id: "user_production",
          locked: false,
          updated_at: 1_700_000_100_000,
        },
        instance_id: INSTANCE_ID,
        timestamp: 1_700_000_100_000,
        type: "user.updated",
      },
      "evt_relinked",
      DIGEST,
      INSTANCE_ID,
      resolveCanonical,
    );

    expect(repo.claimEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalClerkUserId: "user_historical",
        clerkInstanceId: INSTANCE_ID,
        clerkUserId: "user_production",
      }),
    );
    expect(repo.upsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkInstanceId: INSTANCE_ID,
        clerkUserId: "user_historical",
        providerClerkUserId: "user_production",
      }),
    );
  });

  it("does not fall back to a non-primary email and defaults audience to unknown", () => {
    const parsed = parseRegisteredAccountLifecycleEvent(
      {
        data: {
          banned: false,
          created_at: 1_700_000_000_000,
          email_addresses: [
            {
              email_address: "first@example.com",
              id: "idn_first",
              verification: { status: "verified" },
            },
          ],
          id: "user_without_primary",
          locked: false,
          primary_email_address_id: "idn_missing",
          updated_at: 1_700_000_100_000,
        },
        instance_id: INSTANCE_ID,
        timestamp: 1_700_000_100_000,
        type: "user.updated",
      },
      "evt_no_primary",
      INSTANCE_ID,
    );

    expect(parsed?.kind).toBe("snapshot");
    if (parsed?.kind === "snapshot") {
      expect(parsed.snapshot.primaryEmail).toBeNull();
      expect(parsed.snapshot.emailVerified).toBeNull();
      expect(parsed.snapshot.audienceType).toBe("unknown");
    }
  });

  it("fails closed for a mismatched instance or incomplete lifecycle payload", () => {
    const base = {
      data: {
        banned: false,
        created_at: 1_700_000_000_000,
        email_addresses: [],
        id: "user_1",
        locked: false,
        updated_at: 1_700_000_100_000,
      },
      instance_id: INSTANCE_ID,
      timestamp: 1_700_000_100_000,
      type: "user.updated",
    };

    expect(() =>
      parseRegisteredAccountLifecycleEvent(base, "evt_wrong_instance", "ins_live"),
    ).toThrow("CLERK_INSTANCE_MISMATCH");
    expect(() =>
      parseRegisteredAccountLifecycleEvent(
        { ...base, data: { ...base.data, locked: undefined } },
        "evt_missing_boolean",
        INSTANCE_ID,
      ),
    ).toThrow("INVALID_CLERK_USER_EVENT");
    expect(() =>
      parseRegisteredAccountLifecycleEvent(
        {
          data: { deleted: false, id: "user_1" },
          instance_id: INSTANCE_ID,
          timestamp: 1_700_000_100_000,
          type: "user.deleted",
        },
        "evt_bad_delete",
        INSTANCE_ID,
      ),
    ).toThrow("INVALID_CLERK_USER_EVENT");
  });

  it("deterministically constrains a valid combined provider name to the database limit", () => {
    const parsed = parseRegisteredAccountLifecycleEvent(
      {
        data: {
          banned: false,
          created_at: 1_700_000_000_000,
          email_addresses: [],
          first_name: "a".repeat(80),
          id: "user_long_name",
          last_name: "b".repeat(80),
          locked: false,
          updated_at: 1_700_000_100_000,
        },
        instance_id: INSTANCE_ID,
        timestamp: 1_700_000_100_000,
        type: "user.updated",
      },
      "evt_long_name",
      INSTANCE_ID,
    );
    expect(parsed?.kind).toBe("snapshot");
    if (parsed?.kind === "snapshot") {
      expect(parsed.snapshot.displayName).toHaveLength(160);
      expect(parsed.snapshot.clerkUserId).toBe("user_long_name");
    }
  });

  it("stops all lifecycle side effects for an exact receipt replay", async () => {
    const repo = repository();
    vi.mocked(repo.claimEvent).mockResolvedValue({ replayed: true });

    const result = await synchronizeRegisteredAccount(
      repo,
      {
        data: {
          banned: false,
          created_at: 1_700_000_000_000,
          email_addresses: [],
          id: "user_replayed",
          locked: false,
          updated_at: 1_700_000_100_000,
        },
        instance_id: INSTANCE_ID,
        timestamp: 1_700_000_100_000,
        type: "user.updated",
      },
      "evt_replayed",
      DIGEST,
      INSTANCE_ID,
      resolveSelf,
    );

    expect(result.replayed).toBe(true);
    expect(result.terminalDeleted).toBe(false);
    expect(repo.upsertSnapshot).not.toHaveBeenCalled();
    expect(repo.tombstone).not.toHaveBeenCalled();
  });

  it("preserves a terminal-deleted disposition for a delayed create", async () => {
    const repo = repository();
    vi.mocked(repo.upsertSnapshot).mockResolvedValue({
      applied: false,
      terminalDeleted: true,
    });

    const result = await synchronizeRegisteredAccount(
      repo,
      {
        data: {
          banned: false,
          created_at: 1_700_000_000_000,
          email_addresses: [
            {
              email_address: "late@example.com",
              id: "idn_late",
              verification: { status: "verified" },
            },
          ],
          id: "user_deleted_first",
          locked: false,
          primary_email_address_id: "idn_late",
          updated_at: 1_700_000_100_000,
        },
        instance_id: INSTANCE_ID,
        timestamp: 1_700_000_100_000,
        type: "user.created",
      },
      "evt_late_created",
      DIGEST,
      INSTANCE_ID,
      resolveSelf,
    );

    expect(result).toMatchObject({
      replayed: false,
      terminalDeleted: true,
    });
  });

  it("makes a deletion dominate an account update at the same millisecond", async () => {
    let conflictConfig: { setWhere: { queryChunks?: readonly unknown[] } } | undefined;
    const onConflictDoUpdate = vi.fn(
      (config: { setWhere: { queryChunks?: readonly unknown[] } }) => {
        conflictConfig = config;
        return {
          returning: vi.fn().mockResolvedValue([{ clerkUserId: "user_equal" }]),
        };
      },
    );
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ onConflictDoUpdate })),
      })),
    } as unknown as Db;
    const repository = createRegisteredAccountSyncRepository(
      db,
      () => new Date("2026-07-30T00:00:00.000Z"),
    );

    await repository.tombstone({
      clerkUserId: "user_equal",
      providerClerkUserId: "user_equal",
      clerkInstanceId: INSTANCE_ID,
      eventId: "evt_delete_equal",
      providerUpdatedAt: new Date("2026-07-30T00:00:00.000Z"),
    });

    const setWhere = conflictConfig?.setWhere;
    const render = (value: unknown): string => {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map(render).join("");
      if (typeof value !== "object" || value === null) return "";
      const item = value as {
        queryChunks?: readonly unknown[];
        value?: readonly string[];
      };
      if (item.value) return item.value.join("");
      return item.queryChunks ? item.queryChunks.map(render).join("") : "";
    };
    expect(render(setWhere)).toContain("<=");
  });

  it("uses the same deterministic event-ID winner for equal-time snapshots", () => {
    const at = new Date("2026-07-30T00:00:00.000Z");
    const apply = (
      events: readonly string[],
    ): Readonly<{ eventId: string; providerUpdatedAt: Date }> =>
      events.reduce(
        (current, eventId) =>
          shouldReplaceRegisteredAccountSnapshot(
            {
              eventId: current.eventId,
              providerState: "active",
              providerUpdatedAt: current.providerUpdatedAt,
            },
            { eventId, providerUpdatedAt: at },
          )
            ? { eventId, providerUpdatedAt: at }
            : current,
        { eventId: "", providerUpdatedAt: null as Date | null },
      ) as Readonly<{ eventId: string; providerUpdatedAt: Date }>;

    expect(apply(["evt_a", "evt_b"]).eventId).toBe("evt_b");
    expect(apply(["evt_b", "evt_a"]).eventId).toBe("evt_b");
    expect(
      shouldReplaceRegisteredAccountSnapshot(
        {
          eventId: "evt_delete",
          providerState: "deleted",
          providerUpdatedAt: at,
        },
        { eventId: "evt_z", providerUpdatedAt: at },
      ),
    ).toBe(false);
  });
});
