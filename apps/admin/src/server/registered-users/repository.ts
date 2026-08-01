import {
  type Db,
  sql,
} from "@skitza/db";

import type { AdminEnvironmentId } from "~/server/environment";
import {
  decodeRegisteredUserCursor,
  deriveRegisteredUserRoles,
  encodeRegisteredUserCursor,
  registeredUserFilterDigest,
  type RegisteredUserCursor,
  type RegisteredUserDirectoryQuery,
} from "./model";
import type {
  RegisteredUserDirectoryPage,
  RegisteredUserProfileHeader,
  RegisteredUserProfileTab,
  RegisteredUserProfileTabData,
  RegisteredUserRepository,
  RegisteredUserSummary,
} from "./service";
import { RegisteredUserProfileAccessError } from "./service";

type RawDirectoryRow = Readonly<{
  activation: string;
  audience_type: string;
  clerk_user_id: string;
  display_name: string;
  email: string | null;
  email_verified: boolean | null;
  has_artist: boolean;
  has_producer: boolean;
  identity_source: string;
  last_meaningful_activity_at: Date | string | null;
  last_sign_in_at: Date | string | null;
  onboarding: string;
  provider_created_at: Date | string | null;
  provider_state: string;
  provider_updated_at: Date | string | null;
  sort_null: number | string;
  sort_value: Date | string | null;
  status: string;
}>;

function date(value: Date | string | null): Date | null {
  if (value === null) return null;
  const result = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("INVALID_ADMIN_USER_DATA");
  return result;
}

function count(value: number | string | null): number {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("INVALID_ADMIN_USER_DATA");
  }
  return result;
}

function exact<T extends string>(value: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new Error("INVALID_ADMIN_USER_DATA");
  return value as T;
}

function validateClerkUserId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)) {
    throw new Error("INVALID_ADMIN_USER_ID");
  }
  return value;
}

type ActivityCursor = Readonly<{
  environment: AdminEnvironmentId;
  eventKey: string;
  occurredAt: string;
  userId: string;
  version: 1;
}>;

function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeActivityCursor(
  value: string,
  environment: AdminEnvironmentId,
  userId: string,
): ActivityCursor {
  if (value.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("INVALID_ADMIN_ACTIVITY_CURSOR");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_ADMIN_ACTIVITY_CURSOR");
  }
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new Error("INVALID_ADMIN_ACTIVITY_CURSOR");
  }
  const cursor = candidate as Record<string, unknown>;
  const occurredAt =
    typeof cursor.occurredAt === "string" ? new Date(cursor.occurredAt) : null;
  if (
    cursor.version !== 1 ||
    cursor.environment !== environment ||
    cursor.userId !== userId ||
    typeof cursor.eventKey !== "string" ||
    !/^[a-z][a-z_]{0,39}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      cursor.eventKey,
    ) ||
    !occurredAt ||
    !Number.isFinite(occurredAt.getTime()) ||
    occurredAt.toISOString() !== cursor.occurredAt
  ) {
    throw new Error("INVALID_ADMIN_ACTIVITY_CURSOR");
  }
  return cursor as unknown as ActivityCursor;
}

function mapSummary(row: RawDirectoryRow): RegisteredUserSummary {
  const status = exact(row.status, [
    "Active",
    "Deleted",
    "Needs attention",
    "Needs sync",
    "Restricted",
  ] as const);
  if (status === "Deleted") {
    return {
      activation: "Not applicable",
      clerkUserId: row.clerk_user_id,
      displayName: "Deleted account",
      email: null,
      identitySource: "Unavailable",
      lastMeaningfulActivityAt: null,
      onboarding: "Not applicable",
      providerCreatedAt: date(row.provider_created_at),
      roles: [],
      status,
    };
  }
  return {
    activation: exact(row.activation, [
      "Activated",
      "Not activated",
      "Not applicable",
      "Not recorded",
      "Window open",
    ] as const),
    clerkUserId: row.clerk_user_id,
    displayName: row.display_name,
    email: row.email,
    identitySource: exact(row.identity_source, [
      "Clerk",
      "Mixed",
      "Skitza",
      "Unavailable",
    ] as const),
    lastMeaningfulActivityAt: date(row.last_meaningful_activity_at),
    onboarding: exact(row.onboarding, [
      "Complete",
      "Not applicable",
      "Not complete",
    ] as const),
    providerCreatedAt: date(row.provider_created_at),
    roles: deriveRegisteredUserRoles({
      hasArtistRelationships: row.has_artist,
      hasProducer: row.has_producer,
    }),
    status,
  };
}

function accountFactsSql(
  environment: AdminEnvironmentId,
  now: Date,
  accountSource = sql`"registered_accounts"`,
) {
  return sql`
    "account_facts" AS (
      SELECT
        "account".*,
        "producer"."id" AS "producer_id",
        "producer"."email" AS "producer_email",
        "producer"."display_name" AS "producer_display_name",
        "producer"."slug" AS "producer_slug",
        "producer"."created_at" AS "producer_created_at",
        "contact_hint"."email" AS "contact_email",
        "contact_hint"."name" AS "contact_name",
        EXISTS (
          SELECT 1
          FROM "producers" AS "role_producer"
          WHERE "account"."provider_state" <> 'deleted'
            AND "role_producer"."clerk_user_id" = "account"."clerk_user_id"
        ) AS "has_producer",
        EXISTS (
          SELECT 1
          FROM "client_contacts" AS "role_contact"
          WHERE "account"."provider_state" <> 'deleted'
            AND "role_contact"."clerk_user_id" = "account"."clerk_user_id"
            AND "role_contact"."archived_at" IS NULL
        ) AS "has_artist",
        (
          SELECT "event"."occurred_at"
          FROM "domain_events" AS "event"
          WHERE "account"."provider_state" <> 'deleted'
            AND "event"."environment" = ${environment}
            AND "event"."actor_clerk_user_id" = "account"."clerk_user_id"
          ORDER BY "event"."occurred_at" DESC, "event"."id" DESC
          LIMIT 1
        ) AS "last_meaningful_activity_at",
        "activation"."first_external_event_at",
        coalesce("activation"."has_unclassified_event", false) AS "has_unclassified_event",
        (
          "producer"."id" IS NOT NULL
          AND NULLIF(btrim("producer"."display_name"), '') IS NOT NULL
          AND "producer"."slug" <> (
            coalesce(
              nullif(
                trim(
                  both '-' from replace(
                    regexp_replace(
                      split_part(split_part(lower("producer"."email"), '@', 1), '+', 1),
                      '[^a-z0-9.]',
                      '',
                      'g'
                    ),
                    '.',
                    '-'
                  )
                ),
                ''
              ),
              'user'
            )
            || '-'
            || substr(
              encode(sha256(convert_to("producer"."email", 'UTF8')), 'hex'),
              1,
              4
            )
          )
        ) AS "producer_onboarding_complete"
      FROM ${accountSource} AS "account"
      LEFT JOIN LATERAL (
        SELECT "id", "email", "display_name", "slug", "created_at"
        FROM "producers"
        WHERE "account"."provider_state" <> 'deleted'
          AND "producers"."clerk_user_id" = "account"."clerk_user_id"
        LIMIT 1
      ) AS "producer" ON true
      LEFT JOIN LATERAL (
        SELECT "email", "name"
        FROM "client_contacts"
        WHERE "account"."provider_state" <> 'deleted'
          AND "client_contacts"."clerk_user_id" = "account"."clerk_user_id"
        ORDER BY
          ("client_contacts"."archived_at" IS NULL) DESC,
          "client_contacts"."last_seen_at" DESC,
          "client_contacts"."id"
        LIMIT 1
      ) AS "contact_hint" ON true
      LEFT JOIN LATERAL (
        WITH "bounded_events" AS (
          SELECT
            "request"."client_contact_id",
            "request"."created_at" AS "occurred_at"
          FROM "purchase_requests" AS "request"
          WHERE "request"."producer_id" = "producer"."id"
            AND "request"."created_at" >= "producer"."created_at"
            AND "request"."created_at" <= "producer"."created_at" + interval '14 days'
          UNION ALL
          SELECT
            "purchase"."client_contact_id",
            "purchase"."created_at" AS "occurred_at"
          FROM "purchases" AS "purchase"
          WHERE "purchase"."producer_id" = "producer"."id"
            AND "purchase"."created_at" >= "producer"."created_at"
            AND "purchase"."created_at" <= "producer"."created_at" + interval '14 days'
          UNION ALL
          SELECT
            "purchase"."client_contact_id",
            "booking"."created_at" AS "occurred_at"
          FROM "bookings" AS "booking"
          INNER JOIN "purchases" AS "purchase"
            ON "purchase"."id" = "booking"."purchase_id"
          WHERE "booking"."producer_id" = "producer"."id"
            AND "booking"."created_at" >= "producer"."created_at"
            AND "booking"."created_at" <= "producer"."created_at" + interval '14 days'
        )
        SELECT
          min("event"."occurred_at") FILTER (
            WHERE "actor_account"."audience_type" = 'external'
          ) AS "first_external_event_at",
          bool_or(
            "contact"."clerk_user_id" IS NULL
            OR "actor_account"."clerk_user_id" IS NULL
            OR "actor_account"."audience_type" = 'unknown'
          ) AS "has_unclassified_event"
        FROM "bounded_events" AS "event"
        INNER JOIN "client_contacts" AS "contact"
          ON "contact"."id" = "event"."client_contact_id"
          AND "contact"."producer_id" = "producer"."id"
        LEFT JOIN "registered_accounts" AS "actor_account"
          ON "actor_account"."clerk_user_id" = "contact"."clerk_user_id"
      ) AS "activation" ON "producer"."id" IS NOT NULL
    ),
    "projected_accounts" AS (
      SELECT
        "facts".*,
        CASE
          WHEN "facts"."provider_state" = 'deleted' THEN 'Deleted'
          WHEN "facts"."provider_state" = 'needs_sync' THEN 'Needs sync'
          WHEN "facts"."provider_state" IN ('banned', 'locked') THEN 'Restricted'
          WHEN NOT "facts"."has_producer" AND NOT "facts"."has_artist" THEN 'Needs attention'
          ELSE 'Active'
        END AS "directory_status",
        CASE
          WHEN NOT "facts"."has_producer" THEN 'Not applicable'
          WHEN "facts"."producer_onboarding_complete" THEN 'Complete'
          ELSE 'Not complete'
        END AS "onboarding_status",
        CASE
          WHEN NOT "facts"."has_producer" THEN 'Not applicable'
          WHEN ${environment} <> 'live' THEN 'Not recorded'
          WHEN "facts"."audience_type" <> 'external' THEN 'Not recorded'
          WHEN (
            "facts"."first_external_event_at" IS NOT NULL
            AND "facts"."first_external_event_at"
              <= "facts"."producer_created_at" + interval '14 days'
          ) THEN 'Activated'
          WHEN "facts"."has_unclassified_event" THEN 'Not recorded'
          WHEN ${now} <= "facts"."producer_created_at" + interval '14 days' THEN 'Window open'
          ELSE 'Not activated'
        END AS "activation_status",
        CASE
          WHEN "facts"."provider_state" = 'deleted' THEN 'Deleted account'
          ELSE coalesce(
            left(NULLIF(btrim("facts"."display_name"), ''), 160),
            left(NULLIF(btrim("facts"."producer_display_name"), ''), 160),
            left(NULLIF(btrim("facts"."contact_name"), ''), 160),
            left(split_part(
              coalesce(
                "facts"."primary_email",
                "facts"."producer_email",
                "facts"."contact_email"
              ),
              '@',
              1
            ), 160),
            'Unknown user'
          )
        END AS "resolved_display_name",
        CASE
          WHEN "facts"."provider_state" = 'deleted' THEN NULL
          ELSE left(coalesce(
            "facts"."primary_email",
            "facts"."producer_email",
            "facts"."contact_email"
          ), 320)
        END AS "resolved_email",
        CASE
          WHEN "facts"."provider_state" = 'deleted' THEN 'Unavailable'
          WHEN (
            NULLIF(btrim("facts"."display_name"), '') IS NOT NULL
            AND "facts"."primary_email" IS NULL
            AND coalesce("facts"."producer_email", "facts"."contact_email") IS NOT NULL
          ) OR (
            "facts"."primary_email" IS NOT NULL
            AND NULLIF(btrim("facts"."display_name"), '') IS NULL
            AND coalesce(
              NULLIF(btrim("facts"."producer_display_name"), ''),
              NULLIF(btrim("facts"."contact_name"), '')
            ) IS NOT NULL
          ) THEN 'Mixed'
          WHEN "facts"."display_name" IS NOT NULL OR "facts"."primary_email" IS NOT NULL THEN 'Clerk'
          WHEN "facts"."producer_id" IS NOT NULL
            OR "facts"."contact_email" IS NOT NULL THEN 'Skitza'
          ELSE 'Unavailable'
        END AS "identity_source"
      FROM "account_facts" AS "facts"
    )
  `;
}

function directoryFilterSql(query: RegisteredUserDirectoryQuery, now: Date) {
  const filters = [
    query.status === "deleted"
      ? sql`"directory_status" = 'Deleted'`
      : sql`"directory_status" <> 'Deleted'`,
  ];
  if (query.query) {
    const prefix = escapeRegisteredUserLikePrefix(query.query);
    filters.push(
      query.status === "deleted"
        ? sql`lower("clerk_user_id") LIKE ${prefix} ESCAPE '\'`
        : sql`(
          lower("resolved_display_name") LIKE ${prefix} ESCAPE '\'
          OR lower(coalesce("resolved_email", '')) LIKE ${prefix} ESCAPE '\'
          OR lower("clerk_user_id") LIKE ${prefix} ESCAPE '\'
          OR EXISTS (
            SELECT 1
            FROM "producers" AS "search_producer"
            WHERE "search_producer"."clerk_user_id" = "projected_accounts"."clerk_user_id"
              AND (
                lower("search_producer"."display_name") LIKE ${prefix} ESCAPE '\'
                OR lower("search_producer"."email") LIKE ${prefix} ESCAPE '\'
              )
          )
          OR EXISTS (
            SELECT 1
            FROM "client_contacts" AS "search_contact"
            WHERE "search_contact"."clerk_user_id" = "projected_accounts"."clerk_user_id"
              AND (
                lower("search_contact"."name") LIKE ${prefix} ESCAPE '\'
                OR lower("search_contact"."email") LIKE ${prefix} ESCAPE '\'
              )
          )
        )`,
    );
  }
  if (query.role === "producer") filters.push(sql`"has_producer"`);
  if (query.role === "artist") filters.push(sql`"has_artist"`);
  if (query.role === "both") {
    filters.push(sql`"has_producer" AND "has_artist"`);
  }
  const statusMap = {
    active: "Active",
    "needs-attention": "Needs attention",
    "needs-sync": "Needs sync",
    restricted: "Restricted",
  } as const;
  if (query.status !== "all" && query.status !== "deleted") {
    filters.push(sql`"directory_status" = ${statusMap[query.status]}`);
  }
  if (query.onboarding === "complete") {
    filters.push(sql`"onboarding_status" = 'Complete'`);
  } else if (query.onboarding === "not-complete") {
    filters.push(sql`"onboarding_status" = 'Not complete'`);
  }
  const activationMap = {
    activated: "Activated",
    "not-activated": "Not activated",
    "not-recorded": "Not recorded",
    "window-open": "Window open",
  } as const;
  if (query.activation !== "all") {
    filters.push(sql`"activation_status" = ${activationMap[query.activation]}`);
  }
  if (query.signup === "today") {
    filters.push(
      sql`"provider_created_at" >= date_trunc('day', ${now}::timestamptz)`,
    );
  } else if (query.signup === "7d") {
    filters.push(sql`"provider_created_at" >= ${now}::timestamptz - interval '7 days'`);
  } else if (query.signup === "month") {
    filters.push(
      sql`"provider_created_at" >= date_trunc('month', ${now}::timestamptz)`,
    );
  }
  if (query.status !== "deleted" && query.activity === "none") {
    filters.push(sql`"last_meaningful_activity_at" IS NULL`);
  } else if (query.status !== "deleted" && query.activity === "7d") {
    filters.push(
      sql`"last_meaningful_activity_at" >= ${now}::timestamptz - interval '7 days'`,
    );
  } else if (query.status !== "deleted" && query.activity === "30d") {
    filters.push(
      sql`"last_meaningful_activity_at" >= ${now}::timestamptz - interval '30 days'`,
    );
  }
  return sql.join(filters, sql` AND `);
}

function directoryCandidateFilterSql(
  query: RegisteredUserDirectoryQuery,
  now: Date,
  environment: AdminEnvironmentId,
) {
  const hasProducer = sql`EXISTS (
    SELECT 1
    FROM "producers" AS "candidate_producer"
    WHERE "candidate_account"."provider_state" <> 'deleted'
      AND "candidate_producer"."clerk_user_id" = "candidate_account"."clerk_user_id"
  )`;
  const hasArtist = sql`EXISTS (
    SELECT 1
    FROM "client_contacts" AS "candidate_contact"
    WHERE "candidate_account"."provider_state" <> 'deleted'
      AND "candidate_contact"."clerk_user_id" = "candidate_account"."clerk_user_id"
      AND "candidate_contact"."archived_at" IS NULL
  )`;
  const filters = [
    query.status === "deleted"
      ? sql`"candidate_account"."provider_state" = 'deleted'`
      : sql`"candidate_account"."provider_state" <> 'deleted'`,
  ];

  if (query.query) {
    const prefix = escapeRegisteredUserLikePrefix(query.query);
    filters.push(
      query.status === "deleted"
        ? sql`lower("candidate_account"."clerk_user_id") LIKE ${prefix} ESCAPE '\'`
        : sql`"candidate_account"."clerk_user_id" IN (
          SELECT "search_account"."clerk_user_id"
          FROM "registered_accounts" AS "search_account"
          WHERE lower("search_account"."display_name") LIKE ${prefix} ESCAPE '\'
          UNION
          SELECT "search_account"."clerk_user_id"
          FROM "registered_accounts" AS "search_account"
          WHERE lower("search_account"."primary_email") LIKE ${prefix} ESCAPE '\'
          UNION
          SELECT "search_account"."clerk_user_id"
          FROM "registered_accounts" AS "search_account"
          WHERE lower("search_account"."clerk_user_id") LIKE ${prefix} ESCAPE '\'
          UNION
          SELECT "search_producer"."clerk_user_id"
          FROM "producers" AS "search_producer"
          WHERE lower("search_producer"."display_name") LIKE ${prefix} ESCAPE '\'
          UNION
          SELECT "search_producer"."clerk_user_id"
          FROM "producers" AS "search_producer"
          WHERE lower("search_producer"."email") LIKE ${prefix} ESCAPE '\'
          UNION
          SELECT "search_contact"."clerk_user_id"
          FROM "client_contacts" AS "search_contact"
          WHERE "search_contact"."clerk_user_id" IS NOT NULL
            AND lower("search_contact"."name") LIKE ${prefix} ESCAPE '\'
          UNION
          SELECT "search_contact"."clerk_user_id"
          FROM "client_contacts" AS "search_contact"
          WHERE "search_contact"."clerk_user_id" IS NOT NULL
            AND lower("search_contact"."email") LIKE ${prefix} ESCAPE '\'
        )`,
    );
  }
  if (query.role === "producer") filters.push(hasProducer);
  if (query.role === "artist") filters.push(hasArtist);
  if (query.role === "both") {
    filters.push(sql`${hasProducer} AND ${hasArtist}`);
  }
  if (query.status === "needs-sync") {
    filters.push(sql`"candidate_account"."provider_state" = 'needs_sync'`);
  } else if (query.status === "restricted") {
    filters.push(
      sql`"candidate_account"."provider_state" IN ('banned', 'locked')`,
    );
  } else if (query.status === "active") {
    filters.push(sql`
      "candidate_account"."provider_state" = 'active'
      AND (${hasProducer} OR ${hasArtist})
    `);
  } else if (query.status === "needs-attention") {
    filters.push(sql`
      "candidate_account"."provider_state" = 'active'
      AND NOT ${hasProducer}
      AND NOT ${hasArtist}
    `);
  }
  if (query.signup === "today") {
    filters.push(sql`
      "candidate_account"."provider_created_at"
        >= date_trunc('day', ${now}::timestamptz)
    `);
  } else if (query.signup === "7d") {
    filters.push(sql`
      "candidate_account"."provider_created_at"
        >= ${now}::timestamptz - interval '7 days'
    `);
  } else if (query.signup === "month") {
    filters.push(sql`
      "candidate_account"."provider_created_at"
        >= date_trunc('month', ${now}::timestamptz)
    `);
  }
  if (query.onboarding !== "all" || query.activation !== "all") {
    filters.push(hasProducer);
  }
  if (query.onboarding !== "all") {
    const isComplete = sql`EXISTS (
      SELECT 1
      FROM "producers" AS "onboarding_producer"
      WHERE "onboarding_producer"."clerk_user_id"
        = "candidate_account"."clerk_user_id"
        AND NULLIF(btrim("onboarding_producer"."display_name"), '') IS NOT NULL
        AND "onboarding_producer"."slug" <> (
          coalesce(
            nullif(
              trim(
                both '-' from replace(
                  regexp_replace(
                    split_part(
                      split_part(lower("onboarding_producer"."email"), '@', 1),
                      '+',
                      1
                    ),
                    '[^a-z0-9.]',
                    '',
                    'g'
                  ),
                  '.',
                  '-'
                )
              ),
              ''
            ),
            'user'
          )
          || '-'
          || substr(
            encode(
              sha256(convert_to("onboarding_producer"."email", 'UTF8')),
              'hex'
            ),
            1,
            4
          )
        )
    )`;
    filters.push(
      query.onboarding === "complete"
        ? isComplete
        : sql`NOT ${isComplete}`,
    );
  }
  if (query.status !== "deleted" && query.activity === "none") {
    filters.push(sql`NOT EXISTS (
      SELECT 1
      FROM "domain_events" AS "candidate_event"
      WHERE "candidate_event"."environment" = ${environment}
        AND "candidate_event"."actor_clerk_user_id"
          = "candidate_account"."clerk_user_id"
    )`);
  } else if (
    query.status !== "deleted" &&
    (query.activity === "7d" || query.activity === "30d")
  ) {
    const interval =
      query.activity === "7d" ? sql`interval '7 days'` : sql`interval '30 days'`;
    filters.push(sql`EXISTS (
      SELECT 1
      FROM "domain_events" AS "candidate_event"
      WHERE "candidate_event"."environment" = ${environment}
        AND "candidate_event"."actor_clerk_user_id"
          = "candidate_account"."clerk_user_id"
        AND "candidate_event"."occurred_at" >= ${now}::timestamptz - ${interval}
    )`);
  }

  return sql.join(filters, sql` AND `);
}

export function escapeRegisteredUserLikePrefix(value: string): string {
  return `${value.toLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function sortKeySql(query: RegisteredUserDirectoryQuery) {
  if (query.sort === "name") {
    return sql`left(lower("resolved_display_name"), 500)`;
  }
  if (query.sort === "signup") return sql`"provider_created_at"`;
  if (query.sort === "status") return sql`"directory_status"`;
  return sql`"last_meaningful_activity_at"`;
}

function directoryKeysSql(
  query: RegisteredUserDirectoryQuery,
  environment: AdminEnvironmentId,
) {
  const keyValues =
    query.sort === "name"
      ? sql`
        SELECT
          "candidate_account"."clerk_user_id",
          left(lower(
            CASE
              WHEN "candidate_account"."provider_state" = 'deleted'
                THEN 'Deleted account'
              ELSE coalesce(
                left(
                  NULLIF(btrim("candidate_account"."display_name"), ''),
                  160
                ),
                left(NULLIF(btrim("key_producer"."display_name"), ''), 160),
                left(NULLIF(btrim("key_contact"."name"), ''), 160),
                left(
                  split_part(
                    coalesce(
                      "candidate_account"."primary_email",
                      "key_producer"."email",
                      "key_contact"."email"
                    ),
                    '@',
                    1
                  ),
                  160
                ),
                'Unknown user'
              )
            END
          ), 500) AS "sort_value"
        FROM "candidate_accounts" AS "candidate_account"
        LEFT JOIN LATERAL (
          SELECT "display_name", "email"
          FROM "producers"
          WHERE "producers"."clerk_user_id"
            = "candidate_account"."clerk_user_id"
            AND "candidate_account"."provider_state" <> 'deleted'
          LIMIT 1
        ) AS "key_producer" ON true
        LEFT JOIN LATERAL (
          SELECT "email", "name"
          FROM "client_contacts"
          WHERE "client_contacts"."clerk_user_id"
            = "candidate_account"."clerk_user_id"
            AND "candidate_account"."provider_state" <> 'deleted'
          ORDER BY
            ("client_contacts"."archived_at" IS NULL) DESC,
            "client_contacts"."last_seen_at" DESC,
            "client_contacts"."id"
          LIMIT 1
        ) AS "key_contact" ON true
      `
      : query.sort === "status"
        ? sql`
          SELECT
            "candidate_account"."clerk_user_id",
            CASE
              WHEN "candidate_account"."provider_state" = 'deleted'
                THEN 'Deleted'
              WHEN "candidate_account"."provider_state" = 'needs_sync'
                THEN 'Needs sync'
              WHEN "candidate_account"."provider_state" IN ('banned', 'locked')
                THEN 'Restricted'
              WHEN NOT EXISTS (
                SELECT 1
                FROM "producers" AS "key_producer"
                WHERE "candidate_account"."provider_state" <> 'deleted'
                  AND "key_producer"."clerk_user_id"
                  = "candidate_account"."clerk_user_id"
              ) AND NOT EXISTS (
                SELECT 1
                FROM "client_contacts" AS "key_contact"
                WHERE "candidate_account"."provider_state" <> 'deleted'
                  AND "key_contact"."clerk_user_id"
                  = "candidate_account"."clerk_user_id"
                  AND "key_contact"."archived_at" IS NULL
              ) THEN 'Needs attention'
              ELSE 'Active'
            END AS "sort_value"
          FROM "candidate_accounts" AS "candidate_account"
        `
        : query.sort === "signup"
          ? sql`
            SELECT
              "candidate_account"."clerk_user_id",
              "candidate_account"."provider_created_at" AS "sort_value"
            FROM "candidate_accounts" AS "candidate_account"
          `
          : sql`
            SELECT
              "candidate_account"."clerk_user_id",
              (
                SELECT "key_event"."occurred_at"
                FROM "domain_events" AS "key_event"
                WHERE "candidate_account"."provider_state" <> 'deleted'
                  AND "key_event"."environment" = ${environment}
                  AND "key_event"."actor_clerk_user_id"
                    = "candidate_account"."clerk_user_id"
                ORDER BY "key_event"."occurred_at" DESC, "key_event"."id" DESC
                LIMIT 1
              ) AS "sort_value"
            FROM "candidate_accounts" AS "candidate_account"
          `;
  return sql`
    "directory_key_values" AS MATERIALIZED (
      ${keyValues}
    ),
    "directory_keys" AS MATERIALIZED (
      SELECT
        "directory_key_values".*,
        CASE WHEN "sort_value" IS NULL THEN 1 ELSE 0 END AS "sort_null"
      FROM "directory_key_values"
    )
  `;
}

function cursorSortValue(
  cursor: RegisteredUserCursor,
  query: RegisteredUserDirectoryQuery,
): string | Date {
  if (cursor.sortValue === null) return "";
  return query.sort === "signup" || query.sort === "last-activity"
    ? new Date(cursor.sortValue)
    : cursor.sortValue;
}

function cursorPredicateSql(
  cursor: RegisteredUserCursor | null,
  query: RegisteredUserDirectoryQuery,
) {
  if (!cursor) return sql`true`;
  const after = cursor.direction === "after";
  const valueGreater = (query.direction === "asc") === after;
  const value = cursorSortValue(cursor, query);
  const sameRank =
    cursor.nullRank === 1
      ? valueGreater
        ? sql`"clerk_user_id" > ${cursor.clerkUserId}`
        : sql`"clerk_user_id" < ${cursor.clerkUserId}`
      : valueGreater
        ? sql`(
            "sort_value" > ${value}
            OR (
              "sort_value" = ${value}
              AND "clerk_user_id" > ${cursor.clerkUserId}
            )
          )`
        : sql`(
            "sort_value" < ${value}
            OR (
              "sort_value" = ${value}
              AND "clerk_user_id" < ${cursor.clerkUserId}
            )
          )`;
  return after
    ? sql`(
        "sort_null" > ${cursor.nullRank}
        OR ("sort_null" = ${cursor.nullRank} AND (${sameRank}))
      )`
    : sql`(
        "sort_null" < ${cursor.nullRank}
        OR ("sort_null" = ${cursor.nullRank} AND (${sameRank}))
      )`;
}

function indexedSignupCursorPredicateSql(
  cursor: RegisteredUserCursor | null,
  query: RegisteredUserDirectoryQuery,
) {
  if (!cursor) return sql`true`;
  const nullRank = sql`CASE
    WHEN "registered_accounts"."provider_created_at" IS NULL THEN 1
    ELSE 0
  END`;
  const after = cursor.direction === "after";
  const valueGreater = (query.direction === "asc") === after;
  const sameRank =
    cursor.nullRank === 1
      ? valueGreater
        ? sql`"registered_accounts"."clerk_user_id" > ${cursor.clerkUserId}`
        : sql`"registered_accounts"."clerk_user_id" < ${cursor.clerkUserId}`
      : valueGreater
        ? sql`(
            "registered_accounts"."provider_created_at" > ${new Date(
              cursor.sortValue as string,
            )}
            OR (
              "registered_accounts"."provider_created_at" = ${new Date(
                cursor.sortValue as string,
              )}
              AND "registered_accounts"."clerk_user_id" > ${cursor.clerkUserId}
            )
          )`
        : sql`(
            "registered_accounts"."provider_created_at" < ${new Date(
              cursor.sortValue as string,
            )}
            OR (
              "registered_accounts"."provider_created_at" = ${new Date(
                cursor.sortValue as string,
              )}
              AND "registered_accounts"."clerk_user_id" < ${cursor.clerkUserId}
            )
          )`;
  return after
    ? sql`(
        ${nullRank} > ${cursor.nullRank}
        OR (${nullRank} = ${cursor.nullRank} AND (${sameRank}))
      )`
    : sql`(
        ${nullRank} < ${cursor.nullRank}
        OR (${nullRank} = ${cursor.nullRank} AND (${sameRank}))
      )`;
}

function shouldQueryAscending(
  query: RegisteredUserDirectoryQuery,
  cursor: RegisteredUserCursor | null,
): boolean {
  const normalAscending = query.direction === "asc";
  return cursor?.direction === "before" ? !normalAscending : normalAscending;
}

function cursorFor(
  row: RawDirectoryRow,
  direction: "after" | "before",
  environment: AdminEnvironmentId,
  filterDigest: string,
) {
  return encodeRegisteredUserCursor({
    clerkUserId: row.clerk_user_id,
    direction,
    environment,
    filterDigest,
    nullRank: Number(row.sort_null) === 1 ? 1 : 0,
    sortValue:
      row.sort_value instanceof Date
        ? row.sort_value.toISOString()
        : row.sort_value,
    version: 1,
  });
}

function isIndexedDefaultDirectoryQuery(
  query: RegisteredUserDirectoryQuery,
): boolean {
  return (
    query.activation === "all" &&
    query.activity === "all" &&
    query.onboarding === "all" &&
    query.query === "" &&
    query.role === "all" &&
    query.signup === "all" &&
    query.sort === "signup" &&
    query.status === "all"
  );
}

export function createRegisteredUserRepository(
  db: Db,
  environment: AdminEnvironmentId,
  now: () => Date = () => new Date(),
): RegisteredUserRepository {
  return Object.freeze({
    async findDirectory(
      query: RegisteredUserDirectoryQuery,
    ): Promise<RegisteredUserDirectoryPage> {
      const requestedAt = now();
      const filterDigest = registeredUserFilterDigest(environment, query);
      let cursor: RegisteredUserCursor | null = null;
      let cursorReset = false;
      if (query.cursor) {
        try {
          cursor = decodeRegisteredUserCursor(query.cursor, {
            environment,
            filterDigest,
            sort: query.sort,
          });
        } catch {
          cursorReset = true;
        }
      }
      const sortKey = sortKeySql(query);
      const queryAscending = shouldQueryAscending(query, cursor);
      const order = queryAscending ? sql`ASC` : sql`DESC`;
      const rankOrder =
        cursor?.direction === "before" ? sql`DESC` : sql`ASC`;
      const directoryStatement = isIndexedDefaultDirectoryQuery(query)
        ? sql`
          WITH "total" AS (
            SELECT count(*) AS "total_count"
            FROM "registered_accounts"
            WHERE "provider_state" <> 'deleted'
          ),
          "page_accounts" AS MATERIALIZED (
            SELECT
              "registered_accounts".*,
              CASE
                WHEN "provider_created_at" IS NULL THEN 1
                ELSE 0
              END AS "sort_null",
              "provider_created_at" AS "sort_value"
            FROM "registered_accounts"
            WHERE "provider_state" <> 'deleted'
              AND ${indexedSignupCursorPredicateSql(cursor, query)}
            ORDER BY
              "sort_null" ${rankOrder},
              "sort_value" ${order},
              "clerk_user_id" ${order}
            LIMIT ${query.pageSize + 1}
          ),
          ${accountFactsSql(
            environment,
            requestedAt,
            sql`"page_accounts"`,
          )},
          "page" AS (
            SELECT
              "activation_status" AS "activation",
              "audience_type",
              "clerk_user_id",
              "resolved_display_name" AS "display_name",
              "resolved_email" AS "email",
              "email_verified",
              "has_artist",
              "has_producer",
              "identity_source",
              "last_meaningful_activity_at",
              "last_sign_in_at",
              "onboarding_status" AS "onboarding",
              "provider_created_at",
              "provider_state",
              "provider_updated_at",
              "sort_null",
              "sort_value",
              "directory_status" AS "status"
            FROM "projected_accounts"
          )
          SELECT
            "page".*,
            "total"."total_count"
          FROM "total"
          LEFT JOIN "page" ON true
          ORDER BY
            "page"."sort_null" ${rankOrder},
            "page"."sort_value" ${order},
            "page"."clerk_user_id" ${order}
        `
        : query.activation === "all"
          ? sql`
          WITH "candidate_accounts" AS NOT MATERIALIZED (
            SELECT "candidate_account".*
            FROM "registered_accounts" AS "candidate_account"
            WHERE ${directoryCandidateFilterSql(
              query,
              requestedAt,
              environment,
            )}
          ),
          ${directoryKeysSql(query, environment)},
          "total" AS (
            SELECT count(*) AS "total_count"
            FROM "directory_keys"
          ),
          "page_keys" AS MATERIALIZED (
            SELECT *
            FROM "directory_keys"
            WHERE ${cursorPredicateSql(cursor, query)}
            ORDER BY
              "sort_null" ${rankOrder},
              "sort_value" ${order},
              "clerk_user_id" ${order}
            LIMIT ${query.pageSize + 1}
          ),
          "page_accounts" AS MATERIALIZED (
            SELECT
              "candidate_account".*,
              "page_keys"."sort_null",
              "page_keys"."sort_value"
            FROM "page_keys"
            INNER JOIN "candidate_accounts" AS "candidate_account"
              ON "candidate_account"."clerk_user_id"
                = "page_keys"."clerk_user_id"
          ),
          ${accountFactsSql(
            environment,
            requestedAt,
            sql`"page_accounts"`,
          )},
          "page" AS (
            SELECT
              "activation_status" AS "activation",
              "audience_type",
              "clerk_user_id",
              "resolved_display_name" AS "display_name",
              "resolved_email" AS "email",
              "email_verified",
              "has_artist",
              "has_producer",
              "identity_source",
              "last_meaningful_activity_at",
              "last_sign_in_at",
              "onboarding_status" AS "onboarding",
              "provider_created_at",
              "provider_state",
              "provider_updated_at",
              "sort_null",
              "sort_value",
              "directory_status" AS "status"
            FROM "projected_accounts"
          )
          SELECT
            "page".*,
            "total"."total_count"
          FROM "total"
          LEFT JOIN "page" ON true
          ORDER BY
            "page"."sort_null" ${rankOrder},
            "page"."sort_value" ${order},
            "page"."clerk_user_id" ${order}
        `
          : sql`
          WITH "candidate_accounts" AS MATERIALIZED (
            SELECT "candidate_account".*
            FROM "registered_accounts" AS "candidate_account"
            WHERE ${directoryCandidateFilterSql(
              query,
              requestedAt,
              environment,
            )}
          ),
          ${accountFactsSql(
            environment,
            requestedAt,
            sql`"candidate_accounts"`,
          )},
          "filtered_accounts" AS MATERIALIZED (
            SELECT
              "projected_accounts".*,
              "directory_status" AS "status",
              "onboarding_status" AS "onboarding",
              "activation_status" AS "activation",
              CASE WHEN ${sortKey} IS NULL THEN 1 ELSE 0 END AS "sort_null",
              ${sortKey} AS "sort_value"
            FROM "projected_accounts"
            WHERE ${directoryFilterSql(query, requestedAt)}
          ),
          "total" AS (
            SELECT count(*) AS "total_count"
            FROM "filtered_accounts"
          ),
          "page" AS MATERIALIZED (
            SELECT *
            FROM "filtered_accounts"
            WHERE ${cursorPredicateSql(cursor, query)}
            ORDER BY
              "sort_null" ${rankOrder},
              "sort_value" ${order},
              "clerk_user_id" ${order}
            LIMIT ${query.pageSize + 1}
          )
          SELECT
            "page".*,
            "total"."total_count"
          FROM "total"
          LEFT JOIN "page" ON true
          ORDER BY
            "page"."sort_null" ${rankOrder},
            "page"."sort_value" ${order},
            "page"."clerk_user_id" ${order}
        `;
      const result = await db.execute<
        Omit<RawDirectoryRow, "clerk_user_id"> & {
          clerk_user_id: string | null;
          total_count: number | string;
        }
      >(directoryStatement);
      const totalCount = Number(result.rows[0]?.total_count ?? 0);
      if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
        throw new Error("INVALID_ADMIN_USER_DATA");
      }
      const fetched = result.rows.filter(
        (
          row,
        ): row is RawDirectoryRow & { total_count: number | string } =>
          row.clerk_user_id !== null,
      );
      if (cursor && totalCount > 0 && fetched.length === 0) {
        const resetPage = await createRegisteredUserRepository(
          db,
          environment,
          () => requestedAt,
        ).findDirectory({ ...query, cursor: null });
        return { ...resetPage, cursorReset: true };
      }
      const hasMore = fetched.length > query.pageSize;
      const kept = fetched.slice(0, query.pageSize);
      if (cursor?.direction === "before") kept.reverse();
      const first = kept[0];
      const last = kept.at(-1);
      return {
        cursorReset,
        items: kept.map(mapSummary),
        nextCursor:
          last && (hasMore || cursor?.direction === "before")
            ? cursorFor(last, "after", environment, filterDigest)
            : null,
        previousCursor:
          first &&
          (cursor?.direction === "after" ||
            (cursor?.direction === "before" && hasMore))
            ? cursorFor(first, "before", environment, filterDigest)
            : null,
        totalCount,
      };
    },

    async findProfileHeader(
      clerkUserId: string,
    ): Promise<RegisteredUserProfileHeader | null> {
      const id = validateClerkUserId(clerkUserId);
      const requestedAt = now();
      const result = await db.execute<RawDirectoryRow>(sql`
        WITH ${accountFactsSql(environment, requestedAt)}
        SELECT
          "activation_status" AS "activation",
          "audience_type",
          "clerk_user_id",
          "resolved_display_name" AS "display_name",
          "resolved_email" AS "email",
          "email_verified",
          "has_artist",
          "has_producer",
          "identity_source",
          "last_meaningful_activity_at",
          "last_sign_in_at",
          "onboarding_status" AS "onboarding",
          "provider_created_at",
          "provider_state",
          "provider_updated_at",
          0 AS "sort_null",
          NULL AS "sort_value",
          "directory_status" AS "status"
        FROM "projected_accounts"
        WHERE "clerk_user_id" = ${id}
        LIMIT 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      const summary = mapSummary(row);
      const deleted = summary.status === "Deleted";
      return {
        ...summary,
        audienceType: deleted
          ? "unknown"
          : exact(row.audience_type, [
              "external",
              "internal",
              "unknown",
            ] as const),
        emailVerified: deleted ? null : row.email_verified,
        lastSignInAt: deleted ? null : date(row.last_sign_in_at),
        providerState: row.provider_state,
        providerUpdatedAt: date(row.provider_updated_at),
      };
    },

    async findProfileTab(
      clerkUserId: string,
      tab: RegisteredUserProfileTab,
      options: Readonly<{
        activityCursor?: string | null;
        allowDeletedSummary?: boolean;
      }> = {},
    ): Promise<RegisteredUserProfileTabData> {
      const id = validateClerkUserId(clerkUserId);
      if (tab === "summary") {
        const access = await db.execute<{ provider_state: string }>(sql`
          SELECT "provider_state"
          FROM "registered_accounts"
          WHERE "clerk_user_id" = ${id}
            AND ${
              options.allowDeletedSummary
                ? sql`"provider_state" = 'deleted'`
                : sql`"provider_state" <> 'deleted'`
            }
          LIMIT 1
        `);
        if (!access.rows[0]) {
          throw new RegisteredUserProfileAccessError();
        }
        return { tab };
      }
      if (tab === "activity") {
        let cursor: ActivityCursor | null = null;
        let cursorReset = false;
        if (options.activityCursor) {
          try {
            cursor = decodeActivityCursor(
              options.activityCursor,
              environment,
              id,
            );
          } catch {
            cursorReset = true;
          }
        }
        const result = await db.execute<{
          account_id: string;
          event_key: string | null;
          event_name: string | null;
          has_any: boolean;
          id: string | null;
          occurred_at: Date | string | null;
          safe_metadata: Readonly<Record<string, unknown>> | null;
          target_id: string | null;
          target_type: string | null;
        }>(sql`
          WITH "active_account" AS MATERIALIZED (
            SELECT "clerk_user_id"
            FROM "registered_accounts"
            WHERE "clerk_user_id" = ${id}
              AND "provider_state" <> 'deleted'
          ),
          "actor_context" AS MATERIALIZED (
            SELECT
              "active_account"."clerk_user_id",
              (
                SELECT "producer"."id"
                FROM "producers" AS "producer"
                WHERE "producer"."clerk_user_id" = "active_account"."clerk_user_id"
                LIMIT 1
              ) AS "producer_id"
            FROM "active_account"
          ),
          "actor_contacts" AS MATERIALIZED (
            SELECT "contact"."id"
            FROM "client_contacts" AS "contact"
            INNER JOIN "active_account"
              ON "active_account"."clerk_user_id" = "contact"."clerk_user_id"
          ),
          "domain_items" AS MATERIALIZED (
            SELECT
              'domain_event:' || "event"."id"::text AS "event_key",
              "event"."event_name",
              "event"."id"::text AS "id",
              "event"."occurred_at",
              "event"."safe_metadata",
              "event"."target_id",
              "event"."target_type"
            FROM "domain_events" AS "event"
            INNER JOIN "active_account"
              ON "active_account"."clerk_user_id" = "event"."actor_clerk_user_id"
            WHERE "event"."environment" = ${environment}
              AND ${
                cursor
                  ? sql`(
                      "event"."occurred_at" < ${new Date(cursor.occurredAt)}
                      OR (
                        "event"."occurred_at" = ${new Date(cursor.occurredAt)}
                        AND 'domain_event:' || "event"."id"::text < ${cursor.eventKey}
                      )
                    )`
                  : sql`true`
              }
            ORDER BY "event"."occurred_at" DESC, "event"."id" DESC
            LIMIT 51
          ),
          "fallback_items" AS MATERIALIZED (
            (
              SELECT
              'project:' || "project"."id"::text AS "event_key",
              'project.created'::text AS "event_name",
              "project"."id"::text AS "id",
              "project"."created_at" AS "occurred_at",
              jsonb_build_object('status', "project"."lifecycle_status"::text)
                AS "safe_metadata",
              "project"."id"::text AS "target_id",
              'project'::text AS "target_type"
            FROM "projects" AS "project"
            CROSS JOIN "actor_context"
            WHERE (
              "project"."producer_id" = "actor_context"."producer_id"
              OR "project"."client_contact_id" IN (
                SELECT "id" FROM "actor_contacts"
              )
            )
              AND ${
                cursor
                  ? sql`(
                      "project"."created_at" < ${new Date(cursor.occurredAt)}
                      OR (
                        "project"."created_at" = ${new Date(cursor.occurredAt)}
                        AND 'project:' || "project"."id"::text < ${cursor.eventKey}
                      )
                    )`
                  : sql`true`
              }
              ORDER BY "project"."created_at" DESC, "project"."id" DESC
              LIMIT 51
            )
            UNION ALL
            (
              SELECT
              'purchase_request:' || "request"."id"::text,
              'request.created'::text,
              "request"."id"::text,
              "request"."created_at",
              jsonb_build_object('status', "request"."status"::text),
              "request"."id"::text,
              'purchase_request'::text
            FROM "purchase_requests" AS "request"
            CROSS JOIN "actor_context"
            WHERE (
              "request"."producer_id" = "actor_context"."producer_id"
              OR "request"."client_contact_id" IN (
                SELECT "id" FROM "actor_contacts"
              )
            )
              AND ${
                cursor
                  ? sql`(
                      "request"."created_at" < ${new Date(cursor.occurredAt)}
                      OR (
                        "request"."created_at" = ${new Date(cursor.occurredAt)}
                        AND 'purchase_request:' || "request"."id"::text
                          < ${cursor.eventKey}
                      )
                    )`
                  : sql`true`
              }
              ORDER BY "request"."created_at" DESC, "request"."id" DESC
              LIMIT 51
            )
            UNION ALL
            (
              SELECT
              'purchase:' || "purchase"."id"::text,
              'purchase.created'::text,
              "purchase"."id"::text,
              "purchase"."created_at",
              jsonb_build_object('status', "purchase"."lifecycle_status"::text),
              "purchase"."id"::text,
              'purchase'::text
            FROM "purchases" AS "purchase"
            CROSS JOIN "actor_context"
            WHERE (
              "purchase"."producer_id" = "actor_context"."producer_id"
              OR "purchase"."client_contact_id" IN (
                SELECT "id" FROM "actor_contacts"
              )
            )
              AND ${
                cursor
                  ? sql`(
                      "purchase"."created_at" < ${new Date(cursor.occurredAt)}
                      OR (
                        "purchase"."created_at" = ${new Date(cursor.occurredAt)}
                        AND 'purchase:' || "purchase"."id"::text < ${cursor.eventKey}
                      )
                    )`
                  : sql`true`
              }
              ORDER BY "purchase"."created_at" DESC, "purchase"."id" DESC
              LIMIT 51
            )
            UNION ALL
            (
              SELECT
              'booking:' || "booking"."id"::text,
              'booking.created'::text,
              "booking"."id"::text,
              "booking"."created_at",
              jsonb_build_object('status', "booking"."status"::text),
              "booking"."id"::text,
              'booking'::text
            FROM "bookings" AS "booking"
            INNER JOIN "purchases" AS "booking_purchase"
              ON "booking_purchase"."id" = "booking"."purchase_id"
            CROSS JOIN "actor_context"
            WHERE (
              "booking"."producer_id" = "actor_context"."producer_id"
              OR "booking_purchase"."client_contact_id" IN (
                SELECT "id" FROM "actor_contacts"
              )
            )
              AND ${
                cursor
                  ? sql`(
                      "booking"."created_at" < ${new Date(cursor.occurredAt)}
                      OR (
                        "booking"."created_at" = ${new Date(cursor.occurredAt)}
                        AND 'booking:' || "booking"."id"::text < ${cursor.eventKey}
                      )
                    )`
                  : sql`true`
              }
              ORDER BY "booking"."created_at" DESC, "booking"."id" DESC
              LIMIT 51
            )
            UNION ALL
            (
              SELECT
              'payment_proof:' || "proof"."id"::text,
              'payment_proof.created'::text,
              "proof"."id"::text,
              "proof"."created_at",
              jsonb_build_object('status', "proof"."status"::text),
              "proof"."id"::text,
              'payment_proof'::text
            FROM "payment_proofs" AS "proof"
            CROSS JOIN "actor_context"
            WHERE (
              "proof"."producer_id" = "actor_context"."producer_id"
              OR "proof"."client_contact_id" IN (
                SELECT "id" FROM "actor_contacts"
              )
            )
              AND ${
                cursor
                  ? sql`(
                      "proof"."created_at" < ${new Date(cursor.occurredAt)}
                      OR (
                        "proof"."created_at" = ${new Date(cursor.occurredAt)}
                        AND 'payment_proof:' || "proof"."id"::text
                          < ${cursor.eventKey}
                      )
                    )`
                  : sql`true`
              }
              ORDER BY "proof"."created_at" DESC, "proof"."id" DESC
              LIMIT 51
            )
          ),
          "activity_items" AS MATERIALIZED (
            SELECT * FROM "domain_items"
            UNION ALL
            SELECT "fallback".*
            FROM "fallback_items" AS "fallback"
            WHERE NOT EXISTS (
              SELECT 1
              FROM "domain_events" AS "recorded"
              WHERE "recorded"."environment" = ${environment}
                AND "recorded"."actor_clerk_user_id" = (
                  SELECT "clerk_user_id" FROM "active_account"
                )
                AND "recorded"."target_type" = "fallback"."target_type"
                AND "recorded"."target_id" = "fallback"."target_id"
                AND "recorded"."event_name" = "fallback"."event_name"
            )
          ),
          "page" AS MATERIALIZED (
            SELECT *
            FROM "activity_items"
            WHERE ${
              cursor
                ? sql`(
                    "occurred_at" < ${new Date(cursor.occurredAt)}
                    OR (
                      "occurred_at" = ${new Date(cursor.occurredAt)}
                      AND "event_key" < ${cursor.eventKey}
                    )
                  )`
                : sql`true`
            }
            ORDER BY "occurred_at" DESC, "event_key" DESC
            LIMIT 51
          )
          SELECT
            "active_account"."clerk_user_id" AS "account_id",
            "page".*,
            EXISTS (SELECT 1 FROM "activity_items") AS "has_any"
          FROM "active_account"
          LEFT JOIN "page" ON true
          ORDER BY "page"."occurred_at" DESC, "page"."event_key" DESC
        `);
        if (!result.rows[0]) throw new RegisteredUserProfileAccessError();
        const activityRows = result.rows.filter(
          (row): row is typeof row & { event_key: string; id: string } =>
            row.event_key !== null && row.id !== null,
        );
        if (
          cursor &&
          activityRows.length === 0
        ) {
          const reset = await createRegisteredUserRepository(
            db,
            environment,
            now,
          ).findProfileTab(id, "activity");
          return reset.tab === "activity"
            ? { ...reset, cursorReset: true }
            : reset;
        }
        const rows = activityRows.slice(0, 50);
        const last = rows.at(-1);
        return {
          cursorReset,
          items: rows.map((row) => ({
            eventName: row.event_name as string,
            id: row.id,
            occurredAt: date(row.occurred_at) as Date,
            safeMetadata: row.safe_metadata ?? {},
            targetId: row.target_id as string,
            targetType: row.target_type as string,
          })),
          nextCursor:
            activityRows.length > 50 && last
              ? encodeActivityCursor({
                  environment,
                  eventKey: last.event_key,
                  occurredAt: (date(last.occurred_at) as Date).toISOString(),
                  userId: id,
                  version: 1,
                })
              : null,
          tab,
        };
      }
      if (tab === "business") {
        const result = await db.execute<{
          account_id: string;
          artist_bookings: number | string;
          artist_payment_records: number | string;
          artist_projects: number | string;
          artist_purchase_requests: number | string;
          artist_purchases: number | string;
          producer_bookings: number | string;
          producer_created_at: Date | string | null;
          producer_display_name: string | null;
          producer_email: string | null;
          producer_id: string | null;
          producer_onboarding: string | null;
          producer_payment_records: number | string;
          producer_projects: number | string;
          producer_purchase_requests: number | string;
          producer_purchases: number | string;
          producer_slug: string | null;
          studio_archived_at: Date | string | null;
          studio_id: string | null;
          studio_last_seen_at: Date | string | null;
          studio_producer_archived_at: Date | string | null;
          studio_producer_display_name: string | null;
          studio_producer_id: string | null;
          total_studios: number | string;
        }>(sql`
          WITH "active_account" AS MATERIALIZED (
            SELECT "clerk_user_id"
            FROM "registered_accounts"
            WHERE "clerk_user_id" = ${id}
              AND "provider_state" <> 'deleted'
          ),
          "person_producer" AS MATERIALIZED (
            SELECT "producer".*
            FROM "producers" AS "producer"
            INNER JOIN "active_account"
              ON "active_account"."clerk_user_id" = "producer"."clerk_user_id"
            LIMIT 1
          ),
          "person_contacts" AS MATERIALIZED (
            SELECT "contact".*
            FROM "client_contacts" AS "contact"
            INNER JOIN "active_account"
              ON "active_account"."clerk_user_id" = "contact"."clerk_user_id"
          ),
          "counts" AS (
            SELECT
              (SELECT count(*) FROM "projects"
                WHERE "producer_id" IN (SELECT "id" FROM "person_producer"))
                AS "producer_projects",
              (SELECT count(*) FROM "purchase_requests"
                WHERE "producer_id" IN (SELECT "id" FROM "person_producer"))
                AS "producer_purchase_requests",
              (SELECT count(*) FROM "purchases"
                WHERE "producer_id" IN (SELECT "id" FROM "person_producer"))
                AS "producer_purchases",
              (SELECT count(*) FROM "bookings"
                WHERE "producer_id" IN (SELECT "id" FROM "person_producer"))
                AS "producer_bookings",
              (SELECT count(*) FROM "payment_proofs"
                WHERE "producer_id" IN (SELECT "id" FROM "person_producer"))
                AS "producer_payment_records",
              (SELECT count(*) FROM "projects"
                WHERE "client_contact_id" IN (SELECT "id" FROM "person_contacts"))
                AS "artist_projects",
              (SELECT count(*) FROM "purchase_requests"
                WHERE "client_contact_id" IN (SELECT "id" FROM "person_contacts"))
                AS "artist_purchase_requests",
              (SELECT count(*) FROM "purchases"
                WHERE "client_contact_id" IN (SELECT "id" FROM "person_contacts"))
                AS "artist_purchases",
              (SELECT count(*)
                FROM "bookings"
                INNER JOIN "purchases"
                  ON "purchases"."id" = "bookings"."purchase_id"
                WHERE "purchases"."client_contact_id" IN (
                  SELECT "id" FROM "person_contacts"
                )) AS "artist_bookings",
              (SELECT count(*) FROM "payment_proofs"
                WHERE "client_contact_id" IN (SELECT "id" FROM "person_contacts"))
                AS "artist_payment_records",
              (SELECT count(*) FROM "person_contacts") AS "total_studios"
          ),
          "studios" AS MATERIALIZED (
            SELECT
              "contact"."archived_at",
              "contact"."id",
              "contact"."last_seen_at",
              "contact"."producer_archived_at",
              left("producer"."display_name", 160) AS "producer_display_name",
              "contact"."producer_id"
            FROM "person_contacts" AS "contact"
            INNER JOIN "producers" AS "producer"
              ON "producer"."id" = "contact"."producer_id"
            ORDER BY
              ("contact"."archived_at" IS NULL) DESC,
              "contact"."last_seen_at" DESC,
              "contact"."id"
            LIMIT 101
          )
          SELECT
            "active_account"."clerk_user_id" AS "account_id",
            "counts".*,
            "person_producer"."created_at" AS "producer_created_at",
            left("person_producer"."display_name", 160) AS "producer_display_name",
            left("person_producer"."email", 320) AS "producer_email",
            "person_producer"."id" AS "producer_id",
            CASE
              WHEN NULLIF(btrim("person_producer"."display_name"), '') IS NOT NULL
                AND "person_producer"."slug" <> (
                  coalesce(
                    nullif(
                      trim(
                        both '-' from replace(
                          regexp_replace(
                            split_part(split_part(lower("person_producer"."email"), '@', 1), '+', 1),
                            '[^a-z0-9.]',
                            '',
                            'g'
                          ),
                          '.',
                          '-'
                        )
                      ),
                      ''
                    ),
                    'user'
                  )
                  || '-'
                  || substr(
                    encode(
                      sha256(convert_to("person_producer"."email", 'UTF8')),
                      'hex'
                    ),
                    1,
                    4
                  )
                )
              THEN 'Complete'
              ELSE 'Not complete'
            END AS "producer_onboarding",
            "person_producer"."slug" AS "producer_slug",
            "studios"."archived_at" AS "studio_archived_at",
            "studios"."id" AS "studio_id",
            "studios"."last_seen_at" AS "studio_last_seen_at",
            "studios"."producer_archived_at" AS "studio_producer_archived_at",
            "studios"."producer_display_name" AS "studio_producer_display_name",
            "studios"."producer_id" AS "studio_producer_id"
          FROM "active_account"
          CROSS JOIN "counts"
          LEFT JOIN "person_producer" ON true
          LEFT JOIN "studios" ON true
          ORDER BY
            ("studios"."archived_at" IS NULL) DESC,
            "studios"."last_seen_at" DESC,
            "studios"."id"
        `);
        const first = result.rows[0];
        if (!first) throw new RegisteredUserProfileAccessError();
        const totalStudios = count(first.total_studios);
        const producer =
          first.producer_id &&
          first.producer_created_at &&
          first.producer_email &&
          first.producer_slug &&
          first.producer_onboarding
            ? {
                createdAt: date(first.producer_created_at) as Date,
                displayName: first.producer_display_name,
                email: first.producer_email,
                id: first.producer_id,
                onboarding: exact(first.producer_onboarding, [
                  "Complete",
                  "Not complete",
                ] as const),
                slug: first.producer_slug,
              }
            : null;
        return {
          data: {
            counts: {
              asArtist: {
                bookings: count(first.artist_bookings),
                paymentRecords: count(first.artist_payment_records),
                projects: count(first.artist_projects),
                purchaseRequests: count(first.artist_purchase_requests),
                purchases: count(first.artist_purchases),
              },
              asProducer: {
                bookings: count(first.producer_bookings),
                paymentRecords: count(first.producer_payment_records),
                projects: count(first.producer_projects),
                purchaseRequests: count(first.producer_purchase_requests),
                purchases: count(first.producer_purchases),
              },
            },
            producer,
            studios: result.rows
              .filter(
                (row): row is typeof row & {
                  studio_id: string;
                  studio_last_seen_at: Date | string;
                  studio_producer_id: string;
                } =>
                  row.studio_id !== null &&
                  row.studio_last_seen_at !== null &&
                  row.studio_producer_id !== null,
              )
              .slice(0, 100)
              .map((studio) => ({
                archivedAt: date(studio.studio_archived_at),
                id: studio.studio_id,
                lastSeenAt: date(studio.studio_last_seen_at) as Date,
                producerArchivedAt: date(
                  studio.studio_producer_archived_at,
                ),
                producerDisplayName: studio.studio_producer_display_name,
                producerId: studio.studio_producer_id,
              })),
            studiosTruncated: totalStudios > 100,
            totalStudios,
          },
          tab,
        };
      }

      const result = await db.execute<{
        account_id: string;
        action: string | null;
        actor_clerk_user_id: string | null;
        id: string | null;
        kind: string | null;
        last_event_reference: string | null;
        occurred_at: Date | string | null;
        outcome: string | null;
        provider_state: string;
        provider_updated_at: Date | string | null;
        synced_at: Date | string | null;
        total_count: number | string | null;
      }>(sql`
        WITH "active_account" AS MATERIALIZED (
          SELECT
            "clerk_user_id",
            "last_webhook_event_id",
            "provider_state",
            "provider_updated_at",
            "synced_at"
          FROM "registered_accounts"
          WHERE "clerk_user_id" = ${id}
            AND "provider_state" <> 'deleted'
        ),
        "timeline" AS MATERIALIZED (
          SELECT
            NULL::text AS "action",
            "created_by_clerk_user_id" AS "actor_clerk_user_id",
            "id"::text,
            'note'::text AS "kind",
            "created_at" AS "occurred_at",
            NULL::text AS "outcome"
          FROM "admin_support_notes"
          WHERE "environment" = ${environment}
            AND "target_type" = 'registered_account'
            AND "target_id" = ${id}
          UNION ALL
          SELECT
            "action",
            "actor_clerk_user_id",
            "id"::text,
            'audit'::text,
            "occurred_at",
            "outcome"::text
          FROM "admin_action_history"
          WHERE "environment" = ${environment}
            AND (
              ("target_type" = 'registered_account' AND "target_id" = ${id})
              OR "target_account_clerk_user_id" = ${id}
            )
        ),
        "page" AS MATERIALIZED (
          SELECT
            "timeline".*,
            count(*) OVER () AS "total_count"
          FROM "timeline"
          ORDER BY "occurred_at" DESC, "id" DESC
          LIMIT 101
        )
        SELECT
          "active_account"."clerk_user_id" AS "account_id",
          "active_account"."last_webhook_event_id" AS "last_event_reference",
          "active_account"."provider_state",
          "active_account"."provider_updated_at",
          "active_account"."synced_at",
          "page".*
        FROM "active_account"
        LEFT JOIN "page" ON true
        ORDER BY "page"."occurred_at" DESC, "page"."id" DESC
      `);
      const first = result.rows[0];
      if (!first) throw new RegisteredUserProfileAccessError();
      const totalItems = count(first.total_count);
      return {
        data: {
          items: result.rows
            .filter(
              (item): item is typeof item & {
                actor_clerk_user_id: string;
                id: string;
                kind: "audit" | "note";
                occurred_at: Date | string;
              } =>
                item.actor_clerk_user_id !== null &&
                item.id !== null &&
                (item.kind === "audit" || item.kind === "note") &&
                item.occurred_at !== null,
            )
            .slice(0, 100)
            .map((item) => ({
              action: item.action,
              actorClerkUserId: item.actor_clerk_user_id,
              id: item.id,
              kind: item.kind,
              occurredAt: date(item.occurred_at) as Date,
              outcome: item.outcome,
            })),
          provider: {
            lastEventReference: first.last_event_reference,
            state: first.provider_state,
            syncedAt: date(first.synced_at),
            updatedAt: date(first.provider_updated_at),
          },
          totalItems,
          truncated: totalItems > 100,
        },
        tab,
      };
    },
  });
}
