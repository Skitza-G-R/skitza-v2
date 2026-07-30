import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import {
  decodeRegisteredUserCursor,
  encodeRegisteredUserCursor,
  parseRegisteredUserDirectoryQuery,
  registeredUserFilterDigest,
} from "./model";
import {
  createRegisteredUserRepository,
  escapeRegisteredUserLikePrefix,
} from "./repository";

const source = readFileSync(
  join(process.cwd(), "src/server/registered-users/repository.ts"),
  "utf8",
);

type MockRow = Readonly<Record<string, unknown>>;

function databaseWithPages(...pages: readonly MockRow[][]): Readonly<{
  database: Db;
  execute: ReturnType<
    typeof vi.fn<(query: unknown) => Promise<{ rows: readonly MockRow[] }>>
  >;
}> {
  let page = 0;
  const execute =
    vi.fn<(query: unknown) => Promise<{ rows: readonly MockRow[] }>>();
  execute.mockImplementation(() => {
    const rows = pages[page] ?? [];
    page += 1;
    return Promise.resolve({ rows });
  });
  return {
    database: { execute } as unknown as Db,
    execute,
  };
}

function directoryRow(index: number, overrides: MockRow = {}): MockRow {
  const sequence = String(index).padStart(2, "0");
  return {
    activation: "Not applicable",
    audience_type: "external",
    clerk_user_id: `user_${sequence}`,
    display_name: "Same name",
    email: `user${String(index)}@example.com`,
    email_verified: true,
    has_artist: true,
    has_producer: false,
    identity_source: "Clerk",
    last_meaningful_activity_at: null,
    last_sign_in_at: null,
    onboarding: "Not applicable",
    provider_created_at: new Date("2026-07-01T00:00:00.000Z"),
    provider_state: "active",
    provider_updated_at: new Date("2026-07-01T00:00:00.000Z"),
    sort_null: 0,
    sort_value: "same name",
    status: "Active",
    total_count: 26,
    ...overrides,
  };
}

function activityRow(index: number): MockRow {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    account_id: "user_activity",
    event_key: `domain_event:${id}`,
    event_name: "request.created",
    has_any: true,
    id,
    occurred_at: new Date(1_700_000_000_000 - index),
    safe_metadata: {},
    target_id: `request_${String(index)}`,
    target_type: "purchase_request",
  };
}

const emptyActivityRow: MockRow = {
  account_id: "user_activity",
  event_key: null,
  event_name: null,
  has_any: false,
  id: null,
  occurred_at: null,
  safe_metadata: null,
  target_id: null,
  target_type: null,
};

const emptyBusinessRow: MockRow = {
  account_id: "user_selected",
  artist_bookings: 0,
  artist_payment_records: 0,
  artist_projects: 0,
  artist_purchase_requests: 0,
  artist_purchases: 0,
  producer_bookings: 0,
  producer_created_at: null,
  producer_display_name: null,
  producer_email: null,
  producer_id: null,
  producer_onboarding: null,
  producer_payment_records: 0,
  producer_projects: 0,
  producer_purchase_requests: 0,
  producer_purchases: 0,
  producer_slug: null,
  studio_archived_at: null,
  studio_id: null,
  studio_last_seen_at: null,
  studio_producer_archived_at: null,
  studio_producer_display_name: null,
  studio_producer_id: null,
  total_studios: 0,
};

const emptySupportRow: MockRow = {
  account_id: "user_selected",
  action: null,
  actor_clerk_user_id: null,
  id: null,
  kind: null,
  last_event_reference: null,
  occurred_at: null,
  outcome: null,
  provider_state: "active",
  provider_updated_at: null,
  synced_at: null,
  total_count: null,
};

describe("registered-user repository contract", () => {
  it("uses only active artist relationships for the current Artist role", () => {
    expect(source).toContain('"role_contact"."archived_at" IS NULL');
    expect(source).not.toMatch(
      /"role_contact"\."producer_archived_at"\s+IS\s+NULL/,
    );
    expect(source).toContain('"contact"."archived_at"');
    expect(source).toContain('"contact"."producer_archived_at"');
  });

  it("pins the truthful 14-day inclusive activation boundary", () => {
    expect(source).toContain("interval '14 days'");
    expect(source).toMatch(
      /"first_external_event_at"[\s\S]*<= "facts"\."producer_created_at" \+ interval '14 days'/,
    );
    expect(source).toContain(
      'WHEN ${environment} <> \'live\' THEN \'Not recorded\'',
    );
    expect(source).toContain('"actor_account"."audience_type" = \'external\'');
    expect(source).toContain('"has_unclassified_event"');
  });

  it("uses actor events plus bounded safe business fallback activity", () => {
    expect(source).toContain(
      '"event"."actor_clerk_user_id" = "account"."clerk_user_id"',
    );
    expect(source).toContain('"fallback_items" AS MATERIALIZED');
    expect(source).toContain("'project.created'");
    expect(source).toContain("'payment_proof.created'");
    expect(source).toContain(
      '"recorded"."event_name" = "fallback"."event_name"',
    );
    expect(source).not.toMatch(/last_sign_in_at"\) AS "last_meaningful/);
  });

  it("uses one HTTP statement with stable keyset ordering and no offset", () => {
    expect(source).toContain('"filtered_accounts" AS MATERIALIZED');
    expect(source).toContain('"page_accounts" AS MATERIALIZED');
    expect(source).toContain('"directory_keys" AS MATERIALIZED');
    expect(source).toContain('"page_keys" AS MATERIALIZED');
    expect(source).toContain('"sort_null" ${rankOrder}');
    expect(source).toContain('"sort_value" ${order}');
    expect(source).toContain('"clerk_user_id" ${order}');
    expect(source).not.toMatch(/\bOFFSET\b/);
    expect(source).not.toContain("return db.transaction");
  });

  it("keeps the default signup directory on its direct indexed page path", () => {
    const defaultPath = source.slice(
      source.indexOf("isIndexedDefaultDirectoryQuery(query)"),
      source.indexOf(': query.activation === "all"'),
    );
    expect(defaultPath).toContain('FROM "registered_accounts"');
    expect(defaultPath).toContain(
      '"provider_state" <> \'deleted\'',
    );
    expect(defaultPath).toContain("indexedSignupCursorPredicateSql");
    expect(defaultPath).toContain(`LIMIT \${query.pageSize + 1}`);
    expect(defaultPath).not.toContain('"directory_keys"');
  });

  it("searches every relationship identity while returning bounded hints", () => {
    const nonDefaultDirectory = source.slice(
      source.lastIndexOf('WITH "candidate_accounts" AS MATERIALIZED'),
      source.lastIndexOf('"filtered_accounts" AS MATERIALIZED'),
    );
    expect(nonDefaultDirectory).toContain(
      'WITH "candidate_accounts" AS MATERIALIZED',
    );
    expect(nonDefaultDirectory).toContain("accountFactsSql(");
    expect(source).toContain(
      'sql`"candidate_accounts"`',
    );
    expect(source).toContain(
      '"candidate_account"."clerk_user_id" IN (',
    );
    expect(source).toContain(
      'FROM "registered_accounts" AS "search_account"',
    );
    const candidateSearch = source.slice(
      source.indexOf("function directoryCandidateFilterSql"),
      source.indexOf("if (query.role ===", source.indexOf("function directoryCandidateFilterSql")),
    );
    expect(candidateSearch).not.toContain(
      'lower(coalesce("search_account"',
    );
    expect(candidateSearch).not.toContain(
      'lower(coalesce("search_producer"',
    );
    expect(source).toContain('"search_producer"."email"');
    expect(source).toContain('"search_contact"."email"');
    expect(source).toContain('"search_contact"."name"');
    expect(source).toContain(
      "left(NULLIF(btrim(\"facts\".\"display_name\"), ''), 160)",
    );
    expect(source).toContain("left(coalesce(");
    expect(escapeRegisteredUserLikePrefix("100%_Real\\Name")).toBe(
      "100\\%\\_real\\\\name%",
    );
    expect(source).toContain("ESCAPE '\\'");
  });

  it("keeps deleted-account lookup and projection limited to the provider tombstone", async () => {
    expect(source).toContain(
      "query.status === \"deleted\"\n        ? sql`lower(\"candidate_account\".\"clerk_user_id\")",
    );
    expect(source).toContain(
      "query.status === \"deleted\"\n        ? sql`lower(\"clerk_user_id\")",
    );
    expect(source).toContain(
      "\"account\".\"provider_state\" <> 'deleted'\n            AND \"role_producer\"",
    );
    expect(source).toContain(
      "\"account\".\"provider_state\" <> 'deleted'\n            AND \"role_contact\"",
    );
    expect(source).toContain(
      'query.status !== "deleted" && query.activity === "none"',
    );
    expect(source).toContain(
      'query.status !== "deleted" &&\n    (query.activity === "7d" || query.activity === "30d")',
    );

    const leakedRow = directoryRow(1, {
      activation: "Activated",
      audience_type: "external",
      display_name: "Private old name",
      email: "private@example.com",
      email_verified: true,
      has_artist: true,
      has_producer: true,
      identity_source: "Mixed",
      last_meaningful_activity_at: new Date("2026-07-29T00:00:00.000Z"),
      last_sign_in_at: new Date("2026-07-29T00:00:00.000Z"),
      onboarding: "Complete",
      provider_state: "deleted",
      provider_updated_at: new Date("2026-07-30T00:00:00.000Z"),
      status: "Deleted",
    });
    const directoryFixture = databaseWithPages([leakedRow]);
    const directory = createRegisteredUserRepository(
      directoryFixture.database,
      "test",
    );
    const page = await directory.findDirectory(
      parseRegisteredUserDirectoryQuery({ status: "deleted" }),
    );

    expect(page.items[0]).toMatchObject({
      activation: "Not applicable",
      clerkUserId: "user_01",
      displayName: "Deleted account",
      email: null,
      identitySource: "Unavailable",
      lastMeaningfulActivityAt: null,
      onboarding: "Not applicable",
      roles: [],
      status: "Deleted",
    });
    expect(JSON.stringify(page.items[0])).not.toContain("Private old name");
    expect(JSON.stringify(page.items[0])).not.toContain("private@example.com");

    const profileFixture = databaseWithPages([leakedRow]);
    const profile = createRegisteredUserRepository(
      profileFixture.database,
      "test",
    );
    await expect(profile.findProfileHeader("user_01")).resolves.toMatchObject({
      audienceType: "unknown",
      emailVerified: null,
      lastSignInAt: null,
      roles: [],
      status: "Deleted",
    });
  });

  it("preselects cheap role, status, signup, and activity candidates", () => {
    const candidates = source.slice(
      source.indexOf("function directoryCandidateFilterSql"),
      source.indexOf("export function escapeRegisteredUserLikePrefix"),
    );
    expect(candidates).toContain('"candidate_account"."provider_state"');
    expect(candidates).toContain('"candidate_producer"."clerk_user_id"');
    expect(candidates).toContain('"candidate_contact"."archived_at" IS NULL');
    expect(candidates).toContain('"candidate_account"."provider_created_at"');
    expect(candidates).toContain('"candidate_event"."actor_clerk_user_id"');
    expect(candidates).toContain('"candidate_event"."occurred_at"');
  });

  it("returns a filter-bound next cursor when equal sort values span pages", async () => {
    const fixture = databaseWithPages(
      Array.from({ length: 26 }, (_, index) => directoryRow(index + 1)),
    );
    const repository = createRegisteredUserRepository(
      fixture.database,
      "test",
      () => new Date("2026-07-30T00:00:00.000Z"),
    );
    const query = parseRegisteredUserDirectoryQuery({
      dir: "asc",
      sort: "name",
    });

    const result = await repository.findDirectory(query);

    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(result.items).toHaveLength(25);
    expect(result.items[0]?.clerkUserId).toBe("user_01");
    expect(result.items[24]?.clerkUserId).toBe("user_25");
    expect(result.previousCursor).toBeNull();
    expect(
      decodeRegisteredUserCursor(result.nextCursor as string, {
        environment: "test",
        filterDigest: registeredUserFilterDigest("test", query),
        sort: "name",
      }),
    ).toMatchObject({
      clerkUserId: "user_25",
      direction: "after",
      sortValue: "same name",
    });
  });

  it.each(["asc", "desc"] as const)(
    "round-trips null timestamp cursors in %s order",
    async (direction) => {
      const fixture = databaseWithPages(
        Array.from({ length: 26 }, (_, index) =>
          directoryRow(index + 1, {
            sort_null: 1,
            sort_value: null,
          }),
        ),
      );
      const repository = createRegisteredUserRepository(
        fixture.database,
        "live",
      );
      const query = parseRegisteredUserDirectoryQuery({
        dir: direction,
        sort: "last-activity",
      });

      const result = await repository.findDirectory(query);
      const cursor = decodeRegisteredUserCursor(result.nextCursor as string, {
        environment: "live",
        filterDigest: registeredUserFilterDigest("live", query),
        sort: "last-activity",
      });

      expect(cursor).toMatchObject({ nullRank: 1, sortValue: null });
    },
  );

  it("does not parse an ISO-looking name cursor as a timestamp", async () => {
    const isoName = "2026-07-30T00:00:00.000Z";
    const fixture = databaseWithPages(
      Array.from({ length: 26 }, (_, index) =>
        directoryRow(index + 1, {
          display_name: isoName,
          sort_value: isoName,
        }),
      ),
    );
    const repository = createRegisteredUserRepository(
      fixture.database,
      "test",
    );
    const query = parseRegisteredUserDirectoryQuery({ sort: "name" });

    const result = await repository.findDirectory(query);

    expect(
      decodeRegisteredUserCursor(result.nextCursor as string, {
        environment: "test",
        filterDigest: registeredUserFilterDigest("test", query),
        sort: "name",
      }).sortValue,
    ).toBe(isoName);
  });

  it("does not offer Previous after returning to the true first page", async () => {
    const fixture = databaseWithPages(
      Array.from({ length: 25 }, (_, index) => directoryRow(25 - index)),
    );
    const repository = createRegisteredUserRepository(
      fixture.database,
      "test",
    );
    const base = parseRegisteredUserDirectoryQuery({
      dir: "asc",
      sort: "name",
    });
    const query = {
      ...base,
      cursor: encodeRegisteredUserCursor({
        clerkUserId: "user_26",
        direction: "before" as const,
        environment: "test" as const,
        filterDigest: registeredUserFilterDigest("test", base),
        nullRank: 0 as const,
        sortValue: "same name",
        version: 1 as const,
      }),
    };

    const result = await repository.findDirectory(query);

    expect(result.items[0]?.clerkUserId).toBe("user_01");
    expect(result.items[24]?.clerkUserId).toBe("user_25");
    expect(result.previousCursor).toBeNull();
    expect(result.nextCursor).not.toBeNull();
  });

  it("resets malformed and out-of-range directory cursors", async () => {
    const base = parseRegisteredUserDirectoryQuery({
      dir: "desc",
      sort: "signup",
    });
    const digest = registeredUserFilterDigest("test", base);
    const stale = encodeRegisteredUserCursor({
      clerkUserId: "user_stale",
      direction: "after",
      environment: "test",
      filterDigest: digest,
      nullRank: 0,
      sortValue: "2020-01-01T00:00:00.000Z",
      version: 1,
    });
    const fixture = databaseWithPages(
      [{ clerk_user_id: null, total_count: 2 }],
      [
        directoryRow(1, { total_count: 2 }),
        directoryRow(2, { total_count: 2 }),
      ],
    );
    const repository = createRegisteredUserRepository(
      fixture.database,
      "test",
    );

    const result = await repository.findDirectory({
      ...base,
      cursor: stale,
    });

    expect(fixture.execute).toHaveBeenCalledTimes(2);
    expect(result.cursorReset).toBe(true);
    expect(result.items).toHaveLength(2);
  });

  it("never selects private note bodies in the initial Support query", () => {
    const supportSection = source.slice(
      source.indexOf('"timeline" AS MATERIALIZED'),
      source.indexOf('"page" AS MATERIALIZED', source.indexOf('"timeline" AS MATERIALIZED')),
    );
    expect(supportSection).not.toMatch(/\bbody\b/);
    expect(supportSection).toContain('"created_by_clerk_user_id"');
    expect(supportSection).toContain('"target_account_clerk_user_id"');
  });

  it("loads exactly one HTTP statement for the selected profile tab", async () => {
    const cases = [
      ["summary", [{ provider_state: "active" }]],
      ["activity", [emptyActivityRow]],
      ["business", [emptyBusinessRow]],
      ["support", [emptySupportRow]],
    ] as const;

    for (const [tab, rows] of cases) {
      const fixture = databaseWithPages([...rows]);
      const repository = createRegisteredUserRepository(
        fixture.database,
        "test",
      );

      const result = await repository.findProfileTab("user_selected", tab);

      expect(result.tab).toBe(tab);
      expect(fixture.execute).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain("private note body");
    }
  });

  it("fails closed when an active Summary becomes a deletion tombstone between reads", async () => {
    const activeHeaderThenDeleted = databaseWithPages([]);
    const activeRepository = createRegisteredUserRepository(
      activeHeaderThenDeleted.database,
      "test",
    );

    await expect(
      activeRepository.findProfileTab("user_selected", "summary"),
    ).rejects.toThrow("REGISTERED_USER_PROFILE_NOT_FOUND");

    const deletedHeaderStillDeleted = databaseWithPages([
      { provider_state: "deleted" },
    ]);
    const deletedRepository = createRegisteredUserRepository(
      deletedHeaderStillDeleted.database,
      "test",
    );
    await expect(
      deletedRepository.findProfileTab("user_selected", "summary", {
        allowDeletedSummary: true,
      }),
    ).resolves.toEqual({ tab: "summary" });
  });

  it("cursor-paginates Activity without serializing an unbounded feed", async () => {
    const fixture = databaseWithPages(
      Array.from({ length: 51 }, (_, index) => activityRow(index)),
    );
    const repository = createRegisteredUserRepository(
      fixture.database,
      "live",
    );

    const result = await repository.findProfileTab(
      "user_activity",
      "activity",
    );

    expect(result.tab).toBe("activity");
    if (result.tab === "activity") {
      expect(result.items).toHaveLength(50);
      expect(result.nextCursor).not.toBeNull();
      expect(result.cursorReset).toBe(false);
    }
  });

  it("resets malformed and valid out-of-range Activity cursors", async () => {
    const malformedFixture = databaseWithPages([emptyActivityRow]);
    const malformedRepository = createRegisteredUserRepository(
      malformedFixture.database,
      "live",
    );
    const malformed = await malformedRepository.findProfileTab(
      "user_activity",
      "activity",
      { activityCursor: "not-a-cursor" },
    );
    expect(malformed).toMatchObject({
      cursorReset: true,
      items: [],
      nextCursor: null,
      tab: "activity",
    });

    const validCursor = Buffer.from(
      JSON.stringify({
        environment: "live",
        eventKey:
          "domain_event:00000000-0000-4000-8000-000000000999",
        occurredAt: "2020-01-01T00:00:00.000Z",
        userId: "user_activity",
        version: 1,
      }),
    ).toString("base64url");
    const staleFixture = databaseWithPages(
      [{ ...emptyActivityRow, has_any: false }],
      [activityRow(1)],
    );
    const staleRepository = createRegisteredUserRepository(
      staleFixture.database,
      "live",
    );
    const stale = await staleRepository.findProfileTab(
      "user_activity",
      "activity",
      { activityCursor: validCursor },
    );
    expect(stale).toMatchObject({
      cursorReset: true,
      tab: "activity",
    });
    expect(staleFixture.execute).toHaveBeenCalledTimes(2);
  });

  it("denies non-summary tabs for missing or deleted accounts", async () => {
    for (const tab of ["activity", "business", "support"] as const) {
      const fixture = databaseWithPages([]);
      const repository = createRegisteredUserRepository(
        fixture.database,
        "test",
      );

      await expect(
        repository.findProfileTab("user_hidden", tab),
      ).rejects.toThrow("REGISTERED_USER_PROFILE_NOT_FOUND");
      expect(fixture.execute).toHaveBeenCalledOnce();
    }
  });

  it("returns role-aware counts and tells the truth about bounded lists", async () => {
    const fixture = databaseWithPages([
      {
        ...emptyBusinessRow,
        artist_bookings: 4,
        artist_payment_records: 5,
        artist_projects: 1,
        artist_purchase_requests: 2,
        artist_purchases: 3,
        total_studios: 101,
      },
    ]);
    const repository = createRegisteredUserRepository(
      fixture.database,
      "live",
    );

    const result = await repository.findProfileTab(
      "user_selected",
      "business",
    );

    expect(result).toMatchObject({
      data: {
        counts: {
          asArtist: {
            bookings: 4,
            paymentRecords: 5,
            projects: 1,
            purchaseRequests: 2,
            purchases: 3,
          },
        },
        studiosTruncated: true,
        totalStudios: 101,
      },
      tab: "business",
    });
  });
});
