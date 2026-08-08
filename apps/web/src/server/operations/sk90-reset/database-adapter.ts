import {
  assertApprovedResetArtifact,
  assertArtifactLockedSnapshot,
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  compareUtf8Bytes,
  fingerprintSanitizedResetRows,
  fingerprintStorageReferences,
  protectValue,
  sameDigest,
  sha256Digest,
  targetObservationDigest,
  type ApprovedResetArtifact,
  type ProtectedToken,
  type ResetFingerprintSnapshot,
  type SanitizedManifestRow,
  type Sha256Digest,
  type StorageReference,
} from "./index";
import { Sk90ResetSafetyError, stop } from "./errors";
import { SK90_APPROVED_RESET_INVENTORY } from "./manifest";
import { assertFreshTargetAuthorization, type FreshTargetAuthorization } from "./policy";

export const SK90_DATABASE_ADVISORY_LOCK_KEY = "7468258445703257128";
export const SK90_MIGRATION_ADVISORY_LOCK_KEY = "7468258445703257129";

export const SK90_RESET_SOURCE_TABLES = [
  "agreement_acceptances",
  "bookings",
  "invoices",
  "notifications",
  "payment_proofs",
  "project_tracks",
  "projects",
  "purchase_requests",
  "store_purchase_intents",
  "stripe_customers",
  "track_comments",
  "track_versions",
] as const;

export const SK90_PRESERVED_TABLES = [
  "availability_blackouts",
  "availability_blocks",
  "client_contacts",
  "portfolio_tracks",
  "producer_external_links",
  "producer_notes",
  "producers",
  "products",
] as const;

export const SK90_REQUIRED_LOCK_TABLES = [
  "agreement_acceptances",
  "availability_blackouts",
  "availability_blocks",
  "bookings",
  "client_contacts",
  "invoices",
  "notifications",
  "payment_proofs",
  "portfolio_tracks",
  "producer_external_links",
  "producer_notes",
  "producers",
  "products",
  "project_tracks",
  "projects",
  "purchase_requests",
  "store_purchase_intents",
  "stripe_customers",
  "track_comments",
  "track_versions",
] as const;

export const SK90_POST_RESET_EMPTY_TABLES = [
  "bookings",
  "notifications",
  "payment_proofs",
  "private_offers",
  "project_payment_pause_events",
  "project_tracks",
  "projects",
  "purchase_acceptances",
  "purchase_cancellations",
  "purchase_download_override_events",
  "purchase_installments",
  "purchase_payment_corrections",
  "purchase_payments",
  "purchase_requests",
  "purchase_reminder_deliveries",
  "purchase_reminder_logs",
  "purchase_session_allowances",
  "purchase_waivers",
  "purchases",
  "song_public_links",
  "track_comments",
  "track_versions",
  "version_approval_events",
] as const;

export const SK90_POST_RESET_LOCK_TABLES = [
  "availability_blackouts",
  "availability_blocks",
  "bookings",
  "client_contacts",
  "notifications",
  "payment_proofs",
  "portfolio_tracks",
  "private_offers",
  "project_payment_pause_events",
  "producer_external_links",
  "producer_notes",
  "producers",
  "products",
  "project_tracks",
  "projects",
  "purchase_acceptances",
  "purchase_cancellations",
  "purchase_download_override_events",
  "purchase_installments",
  "purchase_payment_corrections",
  "purchase_payments",
  "purchase_requests",
  "purchase_reminder_deliveries",
  "purchase_reminder_logs",
  "purchase_session_allowances",
  "purchase_waivers",
  "purchases",
  "song_public_links",
  "track_comments",
  "track_versions",
  "version_approval_events",
] as const;

const DELETE_ORDER = [
  "notifications",
  "agreement_acceptances",
  "invoices",
  "payment_proofs",
  "track_comments",
  "track_versions",
  "project_tracks",
  "bookings",
  "purchase_requests",
  "projects",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PENDING_AUDIO_COLUMNS = [
  "pending_audio_cancel_requested_at",
  "pending_audio_cleanup_etag",
  "pending_audio_complete_attempted_at",
  "pending_audio_complete_write_once_protected_at",
  "pending_audio_completion_token",
  "pending_audio_create_attempted_at",
  "pending_audio_initiation_digest",
  "pending_audio_part_urls_expire_at",
  "pending_audio_r2_key",
  "pending_audio_size_bytes",
  "pending_audio_started_at",
  "pending_audio_upload_id",
] as const;

export const SK90_BASELINE_ONLY_RELATIONS = [
  "agreement_acceptances",
  "invoices",
  "store_purchase_intents",
  "stripe_customers",
] as const;

export const SK90_POST_RESET_ONLY_RELATIONS = [
  "private_offers",
  "purchases",
  "purchase_installments",
  "purchase_payments",
] as const;

export type DatabaseSchemaState = "baseline" | "post_reset" | "mixed";

export type PgQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> =
  Readonly<{
    rows: readonly Row[];
    rowCount?: number | null;
  }>;

export interface NeonPoolClientLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<PgQueryResult<Row>>;
  release(): void;
}

/** The concrete adapter accepts Neon Pool's node-postgres-compatible surface. */
export interface NeonPoolLike {
  connect(): Promise<NeonPoolClientLike>;
}

export type ResetRowIdentity = Readonly<{
  table: (typeof SK90_RESET_SOURCE_TABLES)[number];
  id: string;
}>;

export type ProviderResetEvidence = Readonly<{
  sourceKind: "producer_stripe_account" | "booking_tranzila_confirmation";
  ownerId: string;
  providerValue: string;
  provider: "stripe" | "tranzila";
  mode: "test";
  attested: true;
  chargeEnabled: false;
  externalCharge: false;
  liveSchedule: false;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  challengeToken: ProtectedToken;
}>;

export type PreservedDatabaseEvidence = Readonly<{
  rowCountsFingerprint: Sha256Digest;
  businessFingerprint: Sha256Digest;
}>;

export type DatabasePostResetEvidence = Readonly<{
  schemaFingerprint: Sha256Digest;
  resetRowCount: number;
  preserved: PreservedDatabaseEvidence;
  foreignKeyViolationCount: number;
  orphanRowCount: number;
  ownershipViolationCount: number;
  prohibitedLegacyRowCount: number;
  syntheticPurchaseCount: number;
}>;

export type DatabaseResetReceipt = Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  deletedRowCount: number;
  schemaFingerprint: Sha256Digest;
  databaseStateFingerprint: Sha256Digest;
  committed: true;
}>;

export type DatabaseVerificationReceipt = Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  purpose: "restored_baseline" | "second_run_noop";
  schemaFingerprint: Sha256Digest;
  databaseStateFingerprint: Sha256Digest;
  databaseMutationCount: 0;
  committed: true;
}>;

export type VerifiedBaselineSnapshotReceipt = DatabaseVerificationReceipt &
  Readonly<{ purpose: "restored_baseline" }>;

export type DatabaseRestorePreparedRecord = Readonly<{
  markerJson: string;
  markerFingerprint: Sha256Digest;
}>;

export type PrepareRestoreTargetInput = Readonly<{
  marker: DatabaseRestorePreparedRecord;
  expectedExistingMarkerFingerprint: Sha256Digest | null;
  expectedSourceState: "baseline" | "post_reset";
  assertFresh(): void;
}>;

export type Sk90CutoverApprovalBinding = Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  executionApprovalDigest: Sha256Digest;
  freshAuthorizationDigest: Sha256Digest;
  actionChallengeToken: ProtectedToken;
}>;

type DatabaseMutationFreshnessCheck = () => void | Promise<void>;

export function assertFreshDatabaseMutationAuthorization(
  input: Readonly<{
    freshAuthorization: FreshTargetAuthorization;
    action: "reset_database" | "noop";
    artifactDigest: Sha256Digest;
    actionChallengeToken: ProtectedToken;
    targetObservationDigest: Sha256Digest;
  }>,
  observedNow: Date,
): true {
  if (!Number.isFinite(observedNow.getTime())) stop("FRESHNESS_PROOF_INVALID");
  assertFreshTargetAuthorization(input.freshAuthorization, {
    action: input.action,
    artifactDigest: input.artifactDigest,
    challengeToken: input.actionChallengeToken,
    targetObservationDigest: input.targetObservationDigest,
    currentTime: observedNow.toISOString(),
  });
  return true;
}

function freshnessCheckedClient(
  client: NeonPoolClientLike,
  assertAuthorizationFresh: DatabaseMutationFreshnessCheck,
): NeonPoolClientLike {
  return {
    query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      parameters?: readonly unknown[],
    ): Promise<PgQueryResult<Row>> => {
      await assertAuthorizationFresh();
      return client.query<Row>(statement, parameters);
    },
    release: () => {
      client.release();
    },
  };
}

type CountRow = Readonly<{ count: number | string }>;
type IdentityPayloadRow = Readonly<{ identity: string; payload: string }>;
type RestorePreparedRow = Readonly<{
  marker_json: unknown;
  marker_fingerprint: unknown;
}>;
type RestorePreparedCatalogRow = Readonly<{
  public_exists: unknown;
  migrations_exists: unknown;
  public_object_count: unknown;
  private_relation_count: unknown;
}>;
type RestorePreparedAttributeRow = Readonly<{
  attribute_name: unknown;
  data_type: unknown;
  not_null: unknown;
}>;

function assertRestorePreparedRecord(
  value: DatabaseRestorePreparedRecord,
): DatabaseRestorePreparedRecord {
  if (
    typeof value.markerJson !== "string" ||
    value.markerJson.length === 0 ||
    value.markerJson.includes("\0") ||
    typeof value.markerFingerprint !== "string"
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }
  assertSha256Digest(value.markerFingerprint);
  if (!sameDigest(sha256Digest(value.markerJson), value.markerFingerprint)) {
    stop("RESTORE_PROOF_MISMATCH");
  }
  return value;
}

async function assertExactRestorePreparedCatalog(client: NeonPoolClientLike): Promise<void> {
  const catalog = await client.query<RestorePreparedCatalogRow>(`
    SELECT
      to_regnamespace('public') IS NOT NULL AS "public_exists",
      to_regnamespace('skitza_migrations') IS NOT NULL AS "migrations_exists",
      (SELECT count(*)::text
       FROM pg_depend AS dependency
       WHERE dependency.refclassid = 'pg_namespace'::regclass
         AND dependency.refobjid = to_regnamespace('public')
         AND dependency.deptype = 'n') AS "public_object_count",
      (SELECT count(*)::text
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'skitza_rehearsal'
         AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS "private_relation_count"`);
  const row = catalog.rows[0];
  if (
    catalog.rows.length !== 1 ||
    row?.public_exists !== true ||
    row.migrations_exists !== false ||
    safeCount(row.public_object_count) !== 0 ||
    safeCount(row.private_relation_count) !== 1
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }

  const attributes = await client.query<RestorePreparedAttributeRow>(`
    SELECT attribute.attname AS "attribute_name",
      format_type(attribute.atttypid, attribute.atttypmod) AS "data_type",
      attribute.attnotnull AS "not_null"
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'skitza_rehearsal'
      AND relation.relname = 'target_identity'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY attribute.attnum`);
  const expected = [
    ["private_marker", "text", true],
    ["restore_prepared_marker_json", "text", false],
    ["restore_prepared_marker_fingerprint", "text", false],
  ] as const;
  if (
    attributes.rows.length !== expected.length ||
    attributes.rows.some(
      (attribute, index) =>
        attribute.attribute_name !== expected[index]?.[0] ||
        attribute.data_type !== expected[index]?.[1] ||
        attribute.not_null !== expected[index]?.[2],
    )
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }
}

function safeCount(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) stop("POST_RESET_INTEGRITY_MISMATCH");
  return parsed;
}

function assertPrivateIdentifier(value: string): void {
  if (!UUID_PATTERN.test(value)) stop("ARTIFACT_BINDING_MISMATCH");
}

function exactSortedStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedLeft = [...left].sort(compareUtf8Bytes);
  const normalizedRight = [...right].sort(compareUtf8Bytes);
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

/**
 * Classify the cutover phase without touching a relation that may have been
 * dropped. The exact catalog and data verifiers still run after this gate; the
 * marker inventory only selects the safe phase-specific lock set.
 */
export async function classifyDatabaseSchemaState(
  client: NeonPoolClientLike,
): Promise<DatabaseSchemaState> {
  const relationNames = [...SK90_BASELINE_ONLY_RELATIONS, ...SK90_POST_RESET_ONLY_RELATIONS];
  const result = await client.query<Readonly<{ relation_name: unknown; relation: unknown }>>(
    `SELECT candidate."relation_name",
      to_regclass(format('public.%I', candidate."relation_name"))::text AS "relation"
     FROM unnest($1::text[]) AS candidate("relation_name")
     ORDER BY candidate."relation_name" COLLATE "C"`,
    [relationNames],
  );
  if (result.rows.length !== relationNames.length) stop("DATABASE_VERIFICATION_MISMATCH");

  const expected = new Set<string>(relationNames);
  const presence = new Map<string, boolean>();
  for (const row of result.rows) {
    if (
      typeof row.relation_name !== "string" ||
      !expected.has(row.relation_name) ||
      presence.has(row.relation_name) ||
      (row.relation !== null && typeof row.relation !== "string")
    ) {
      stop("DATABASE_VERIFICATION_MISMATCH");
    }
    presence.set(row.relation_name, row.relation !== null);
  }
  if (presence.size !== relationNames.length) stop("DATABASE_VERIFICATION_MISMATCH");

  const allBaseline = SK90_BASELINE_ONLY_RELATIONS.every((name) => presence.get(name) === true);
  const noBaseline = SK90_BASELINE_ONLY_RELATIONS.every((name) => presence.get(name) === false);
  const allPostReset = SK90_POST_RESET_ONLY_RELATIONS.every((name) => presence.get(name) === true);
  const noPostReset = SK90_POST_RESET_ONLY_RELATIONS.every((name) => presence.get(name) === false);
  if (allBaseline && noPostReset) return "baseline";
  if (noBaseline && allPostReset) return "post_reset";
  return "mixed";
}

async function assertDatabaseSchemaState(
  client: NeonPoolClientLike,
  expected: Exclude<DatabaseSchemaState, "mixed">,
): Promise<void> {
  if ((await classifyDatabaseSchemaState(client)) !== expected) {
    stop("DATABASE_VERIFICATION_MISMATCH");
  }
}

/**
 * Pre-0027 targets have none of the pending-upload columns. A completed or
 * partially applied target must have the exact twelve-column journal shape, and
 * any unresolved journal entry is an unapproved storage recovery reference.
 * It cannot be folded into the reset manifest or silently deleted.
 */
export async function assertNoUnresolvedPendingAudioUploads(
  client: NeonPoolClientLike,
): Promise<void> {
  const columns = await client.query<Readonly<{ column_name: string }>>(
    `SELECT "column_name"
     FROM "information_schema"."columns"
     WHERE "table_schema" = 'public'
       AND "table_name" = 'track_versions'
       AND "column_name" LIKE 'pending_audio_%'
     ORDER BY "column_name" COLLATE "C"`,
  );
  const observedColumns = columns.rows.map((row) => row.column_name);
  if (observedColumns.length === 0) return;
  if (!exactSortedStrings(observedColumns, PENDING_AUDIO_COLUMNS)) {
    stop("STORAGE_ENUMERATION_MISMATCH");
  }

  const pending = await client.query<CountRow>(`
    SELECT count(*)::text AS "count"
    FROM "public"."track_versions"
    WHERE "pending_audio_cancel_requested_at" IS NOT NULL
       OR "pending_audio_cleanup_etag" IS NOT NULL
       OR "pending_audio_complete_attempted_at" IS NOT NULL
       OR "pending_audio_complete_write_once_protected_at" IS NOT NULL
       OR "pending_audio_r2_key" IS NOT NULL
       OR "pending_audio_initiation_digest" IS NOT NULL
       OR "pending_audio_completion_token" IS NOT NULL
       OR "pending_audio_size_bytes" IS NOT NULL
       OR "pending_audio_started_at" IS NOT NULL
       OR "pending_audio_create_attempted_at" IS NOT NULL
       OR "pending_audio_part_urls_expire_at" IS NOT NULL
       OR "pending_audio_upload_id" IS NOT NULL`);
  if (safeCount(pending.rows[0]?.count) !== 0) {
    stop("STORAGE_ENUMERATION_MISMATCH");
  }
}

/**
 * Discover every database-owned storage reference on the same transaction
 * client that holds the reset locks. The approved manifest contributes only
 * protected identities and independently observed object evidence; callers
 * cannot substitute a precomputed fingerprint for this database observation.
 */
export async function collectDatabaseStorageReferencesFingerprint(
  client: NeonPoolClientLike,
  hmacKey: string,
  approvedReferences: readonly StorageReference[],
): Promise<Sha256Digest> {
  if (hmacKey.length < 32) stop("MANIFEST_INPUT_INVALID");
  const result = await client.query<
    Readonly<{ bucket_role: unknown; object_key: unknown; referenced_by: unknown }>
  >(`
    SELECT * FROM (
      SELECT 'audio'::text AS "bucket_role", "audio_r2_key" AS "object_key", 'reset'::text AS "referenced_by"
      FROM "public"."track_versions" WHERE "audio_r2_key" IS NOT NULL
      UNION ALL
      SELECT 'audio', "peaks_r2_key", 'reset'
      FROM "public"."track_versions" WHERE "peaks_r2_key" IS NOT NULL
      UNION ALL
      SELECT 'docs', "storage_key", 'reset'
      FROM "public"."payment_proofs" WHERE "storage_key" IS NOT NULL
      UNION ALL
      SELECT 'audio', "audio_r2_key", 'preserved'
      FROM "public"."portfolio_tracks" WHERE "audio_r2_key" IS NOT NULL
      UNION ALL
      SELECT 'audio', "peaks_r2_key", 'preserved'
      FROM "public"."portfolio_tracks" WHERE "peaks_r2_key" IS NOT NULL
    ) AS "storage_reference"
    ORDER BY "bucket_role" COLLATE "C", "object_key" COLLATE "C", "referenced_by" COLLATE "C"`);

  const remaining = new Map<string, StorageReference>();
  for (const reference of approvedReferences) {
    const identity = `${reference.bucketRole}\0${reference.protectedKey}\0${reference.referencedBy}`;
    if (remaining.has(identity)) stop("STORAGE_ENUMERATION_MISMATCH");
    remaining.set(identity, reference);
  }
  const observed = result.rows.map((row) => {
    if (
      (row.bucket_role !== "audio" && row.bucket_role !== "docs") ||
      typeof row.object_key !== "string" ||
      row.object_key.length === 0 ||
      (row.referenced_by !== "reset" && row.referenced_by !== "preserved")
    ) {
      stop("STORAGE_ENUMERATION_MISMATCH");
    }
    const protectedKey = protectValue(
      hmacKey,
      `storage-key\0${row.bucket_role}\0${row.object_key}`,
    );
    const identity = `${row.bucket_role}\0${protectedKey}\0${row.referenced_by}`;
    const approved = remaining.get(identity);
    if (!approved || !remaining.delete(identity)) stop("STORAGE_ENUMERATION_MISMATCH");
    return approved;
  });
  if (remaining.size !== 0) stop("STORAGE_ENUMERATION_MISMATCH");
  return fingerprintStorageReferences(observed);
}

function expectedRowsByTable(rows: readonly ResetRowIdentity[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const inventory of SK90_APPROVED_RESET_INVENTORY) result.set(inventory.table, []);
  for (const row of rows) {
    assertPrivateIdentifier(row.id);
    const tableRows = result.get(row.table);
    if (!tableRows || tableRows.includes(row.id)) stop("ARTIFACT_BINDING_MISMATCH");
    tableRows.push(row.id);
  }
  for (const inventory of SK90_APPROVED_RESET_INVENTORY) {
    if (result.get(inventory.table)?.length !== inventory.count) {
      stop("ARTIFACT_BINDING_MISMATCH");
    }
  }
  return result;
}

export async function collectResetRowCandidates(
  client: NeonPoolClientLike,
): Promise<readonly Readonly<{ category: string; table: string; id: string; payload: string }>[]> {
  // Discovery is the earliest manifest boundary. Stop before collecting any
  // reset candidate if a pending object still needs upload recovery.
  await assertNoUnresolvedPendingAudioUploads(client);
  const candidates: Array<
    Readonly<{ category: string; table: string; id: string; payload: string }>
  > = [];
  for (const inventory of SK90_APPROVED_RESET_INVENTORY) {
    if (inventory.table === "stripe_customers") {
      const result = await client.query<IdentityPayloadRow>(
        `SELECT * FROM (SELECT concat("producer_id"::text, '/', "client_contact_id"::text) AS "identity", to_jsonb(source)::text AS "payload" FROM "public"."stripe_customers" AS source) AS "reset_row" ORDER BY "identity" COLLATE "C"`,
      );
      for (const row of result.rows) {
        candidates.push({
          category: inventory.category,
          table: inventory.table,
          id: row.identity,
          payload: row.payload,
        });
      }
      continue;
    }
    const result = await client.query<IdentityPayloadRow>(
      `SELECT "id"::text AS "identity", to_jsonb(source)::text AS "payload" FROM "public"."${inventory.table}" AS source ORDER BY "id"::text COLLATE "C"`,
    );
    for (const row of result.rows) {
      candidates.push({
        category: inventory.category,
        table: inventory.table,
        id: row.identity,
        payload: row.payload,
      });
    }
  }
  return candidates;
}

export async function collectResetRowsFingerprint(
  client: NeonPoolClientLike,
  hmacKey: string,
): Promise<Sha256Digest> {
  if (hmacKey.length < 32) stop("MANIFEST_INPUT_INVALID");
  const candidates = await collectResetRowCandidates(client);
  const rows: SanitizedManifestRow[] = candidates.map((candidate) => ({
    category: candidate.category,
    table: candidate.table,
    protectedId: protectValue(hmacKey, `row-id\0${candidate.table}\0${candidate.id}`),
    protectedContent: protectValue(
      hmacKey,
      `row-content\0${candidate.table}\0${canonicalJson(candidate.payload)}`,
    ),
  }));
  return fingerprintSanitizedResetRows(rows);
}

const PRESERVED_PAYLOAD_EXPRESSION: Readonly<
  Record<(typeof SK90_PRESERVED_TABLES)[number], string>
> = {
  availability_blackouts: "to_jsonb(source)",
  availability_blocks: "to_jsonb(source)",
  client_contacts: "to_jsonb(source) - ARRAY['producer_archived_at']::text[]",
  portfolio_tracks: "to_jsonb(source)",
  producer_external_links: "to_jsonb(source)",
  producer_notes: "to_jsonb(source)",
  producers:
    "to_jsonb(source) - ARRAY['stripe_account_id', 'stripe_charges_enabled', 'tranzila_terminal_name']::text[]",
  products: "to_jsonb(source) - ARRAY['deposit_pct', 'deposit_model', 'milestones']::text[]",
};

export async function collectPreservedDatabaseEvidence(
  client: NeonPoolClientLike,
  hmacKey: string,
): Promise<PreservedDatabaseEvidence> {
  if (hmacKey.length < 32) stop("MANIFEST_INPUT_INVALID");
  const counts: Array<{ table: string; count: number }> = [];
  const protectedRows: Array<{
    table: string;
    protectedId: ProtectedToken;
    protectedContent: ProtectedToken;
  }> = [];

  for (const table of SK90_PRESERVED_TABLES) {
    const countResult = await client.query<CountRow>(
      `SELECT count(*)::text AS "count" FROM "public"."${table}"`,
    );
    counts.push({ table, count: safeCount(countResult.rows[0]?.count) });
    const rows = await client.query<IdentityPayloadRow>(
      `SELECT "id"::text AS "identity", (${PRESERVED_PAYLOAD_EXPRESSION[table]})::text AS "payload" FROM "public"."${table}" AS source ORDER BY "id"::text COLLATE "C"`,
    );
    for (const row of rows.rows) {
      protectedRows.push({
        table,
        protectedId: protectValue(hmacKey, `preserved-row-id\0${table}\0${row.identity}`),
        protectedContent: protectValue(hmacKey, `preserved-row-content\0${table}\0${row.payload}`),
      });
    }
  }

  counts.sort((left, right) => compareUtf8Bytes(left.table, right.table));
  protectedRows.sort((left, right) =>
    compareUtf8Bytes(`${left.table}:${left.protectedId}`, `${right.table}:${right.protectedId}`),
  );
  return {
    rowCountsFingerprint: sha256Digest(canonicalJson(counts)),
    businessFingerprint: sha256Digest(canonicalJson(protectedRows)),
  };
}

const CATALOG_FINGERPRINT_SQL = `
WITH catalog_entry AS (
  SELECT 'column'::text AS kind,
    format('%I.%I.%I', namespace.nspname, relation.relname, attribute.attname) AS "identity",
    concat_ws('|', format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull::text,
      COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '<none>')) AS definition
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
  UNION ALL
  SELECT 'constraint', format('%I.%I', relation.relname, constraint_entry.conname),
    concat_ws('|', constraint_entry.contype::text, constraint_entry.convalidated::text,
      constraint_entry.condeferrable::text, constraint_entry.condeferred::text,
      pg_get_constraintdef(constraint_entry.oid, false))
  FROM pg_constraint AS constraint_entry
  JOIN pg_class AS relation ON relation.oid = constraint_entry.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'index', format('%I.%I', table_relation.relname, index_relation.relname),
    pg_get_indexdef(index_relation.oid)
  FROM pg_index
  JOIN pg_class AS table_relation ON table_relation.oid = pg_index.indrelid
  JOIN pg_class AS index_relation ON index_relation.oid = pg_index.indexrelid
  JOIN pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'trigger', format('%I.%I', relation.relname, trigger_entry.tgname),
    pg_get_triggerdef(trigger_entry.oid, false)
  FROM pg_trigger AS trigger_entry
  JOIN pg_class AS relation ON relation.oid = trigger_entry.tgrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND NOT trigger_entry.tgisinternal
  UNION ALL
  SELECT 'function', format('%I.%I(%s)', namespace.nspname, procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)),
    concat_ws('|', procedure.prokind::text, procedure.provolatile::text, procedure.prosecdef::text,
      procedure.proleakproof::text, procedure.proparallel::text, procedure.prosrc)
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'enum', format('%I.%I', namespace.nspname, type_entry.typname),
    string_agg(enum_entry.enumlabel, ',' ORDER BY enum_entry.enumsortorder)
  FROM pg_type AS type_entry
  JOIN pg_namespace AS namespace ON namespace.oid = type_entry.typnamespace
  JOIN pg_enum AS enum_entry ON enum_entry.enumtypid = type_entry.oid
  WHERE namespace.nspname = 'public'
  GROUP BY namespace.nspname, type_entry.typname
)
SELECT kind, "identity", definition FROM catalog_entry
ORDER BY kind COLLATE "C", "identity" COLLATE "C", definition COLLATE "C"`;

export async function collectCatalogFingerprint(client: NeonPoolClientLike): Promise<Sha256Digest> {
  const result =
    await client.query<Readonly<{ kind: string; identity: string; definition: string }>>(
      CATALOG_FINGERPRINT_SQL,
    );
  return sha256Digest(canonicalJson(result.rows.map((row) => ({ ...row }))));
}

export async function stageProviderResetEvidence(
  client: NeonPoolClientLike,
  artifact: ApprovedResetArtifact,
  evidence: readonly ProviderResetEvidence[],
  hmacKey: string,
  actionChallengeToken: ProtectedToken,
  assertAuthorizationFresh: DatabaseMutationFreshnessCheck,
): Promise<void> {
  assertApprovedResetArtifact(artifact);
  assertProtectedToken(actionChallengeToken);
  if (hmacKey.length < 32) stop("MANIFEST_INPUT_INVALID");
  if (evidence.length !== 7) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  const sourceCounts = new Map<string, number>();
  const identities = new Set<string>();
  for (const row of evidence) {
    const untrustedRow = row as unknown as Record<keyof ProviderResetEvidence, unknown>;
    assertPrivateIdentifier(row.ownerId);
    if (
      !row.providerValue ||
      row.artifactDigest !== artifact.digest ||
      row.manifestDigest !== artifact.manifestDigest ||
      row.policyDigest !== artifact.target.policyDigest ||
      row.challengeToken !== actionChallengeToken ||
      untrustedRow.mode !== "test" ||
      untrustedRow.attested !== true ||
      untrustedRow.chargeEnabled !== false ||
      untrustedRow.externalCharge !== false ||
      untrustedRow.liveSchedule !== false ||
      (untrustedRow.sourceKind !== "producer_stripe_account" &&
        untrustedRow.sourceKind !== "booking_tranzila_confirmation") ||
      (row.sourceKind === "producer_stripe_account"
        ? row.provider !== "stripe"
        : row.provider !== "tranzila")
    ) {
      stop("PROVIDER_REFERENCE_NOT_APPROVED_TEST");
    }
    const identity = `${row.sourceKind}\0${row.ownerId}\0${row.providerValue}`;
    if (identities.has(identity)) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
    identities.add(identity);
    sourceCounts.set(row.sourceKind, (sourceCounts.get(row.sourceKind) ?? 0) + 1);
  }
  if (
    sourceCounts.get("producer_stripe_account") !== 3 ||
    sourceCounts.get("booking_tranzila_confirmation") !== 4
  ) {
    stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  }

  const providerReferenceTokens = evidence
    .map((row) =>
      protectValue(
        hmacKey,
        `provider-reference\0${row.sourceKind}\0${row.ownerId}\0${row.providerValue}`,
      ),
    )
    .sort(compareUtf8Bytes);
  const providerReferenceTokensFingerprint = sha256Digest(canonicalJson(providerReferenceTokens));
  if (
    !sameDigest(
      providerReferenceTokensFingerprint,
      artifact.mockEvidenceCoverage.providerReferenceTokensFingerprint,
    )
  ) {
    stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  }

  const observed = await client.query<
    Readonly<{ source_kind: string; owner_id: string; provider_value: string }>
  >(`
    SELECT * FROM (
      SELECT 'producer_stripe_account'::text AS "source_kind",
        "id"::text AS "owner_id", "stripe_account_id" AS "provider_value"
      FROM "public"."producers"
      WHERE "stripe_account_id" IS NOT NULL
      UNION ALL
      SELECT 'booking_tranzila_confirmation'::text AS "source_kind",
        "id"::text AS "owner_id", "tranzila_confirmation_code" AS "provider_value"
      FROM "public"."bookings"
      WHERE "tranzila_confirmation_code" IS NOT NULL
    ) AS "provider_reference"
    ORDER BY "source_kind" COLLATE "C", "owner_id" COLLATE "C", "provider_value" COLLATE "C"`);
  const expectedReferences = evidence.map(
    (row) => `${row.sourceKind}\0${row.ownerId}\0${row.providerValue}`,
  );
  const observedReferences = observed.rows.map(
    (row) => `${row.source_kind}\0${row.owner_id}\0${row.provider_value}`,
  );
  if (!exactSortedStrings(observedReferences, expectedReferences)) {
    stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  }

  await assertAuthorizationFresh();
  await client.query(
    `SELECT set_config('skitza.sk90_artifact_digest', $1, true), set_config('skitza.sk90_manifest_digest', $2, true), set_config('skitza.sk90_policy_digest', $3, true), set_config('skitza.sk90_provider_challenge', $4, true)`,
    [artifact.digest, artifact.manifestDigest, artifact.target.policyDigest, actionChallengeToken],
  );
  await assertAuthorizationFresh();
  await client.query(`CREATE TEMP TABLE "skitza_0027_approved_provider_values" (
    "source_kind" text NOT NULL,
    "owner_id" uuid NOT NULL,
    "provider_value" text NOT NULL,
    "provider" text NOT NULL,
    "mode" text NOT NULL,
    "attested" boolean NOT NULL,
    "charge_enabled" boolean NOT NULL,
    "external_charge" boolean NOT NULL,
    "live_schedule" boolean NOT NULL,
    "artifact_digest" text NOT NULL,
    "manifest_digest" text NOT NULL,
    "policy_digest" text NOT NULL,
    "challenge_token" text NOT NULL,
    PRIMARY KEY ("source_kind", "owner_id", "provider_value")
  ) ON COMMIT DROP`);
  for (const row of evidence) {
    await assertAuthorizationFresh();
    await client.query(
      `INSERT INTO pg_temp."skitza_0027_approved_provider_values" (
      "source_kind", "owner_id", "provider_value", "provider", "mode", "attested",
      "charge_enabled", "external_charge", "live_schedule", "artifact_digest",
      "manifest_digest", "policy_digest", "challenge_token"
    ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.sourceKind,
        row.ownerId,
        row.providerValue,
        row.provider,
        row.mode,
        row.attested,
        row.chargeEnabled,
        row.externalCharge,
        row.liveSchedule,
        row.artifactDigest,
        row.manifestDigest,
        row.policyDigest,
        row.challengeToken,
      ],
    );
  }
}

type ForeignKeyCatalogRow = Readonly<{
  child_table: string;
  parent_table: string;
  child_columns: readonly string[];
  parent_columns: readonly string[];
  match_type: string;
  validated: boolean;
}>;

function quoteCatalogIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) stop("POST_RESET_INTEGRITY_MISMATCH");
  return `"${identifier}"`;
}

async function collectForeignKeyIntegrity(
  client: NeonPoolClientLike,
): Promise<Readonly<{ foreignKeyViolationCount: number; orphanRowCount: number }>> {
  const catalog = await client.query<ForeignKeyCatalogRow>(`
    SELECT child.relname AS child_table, parent.relname AS parent_table,
      to_json(ARRAY(SELECT child_attribute.attname FROM unnest(constraint_entry.conkey) WITH ORDINALITY AS key(attnum, ordinality) JOIN pg_attribute AS child_attribute ON child_attribute.attrelid = child.oid AND child_attribute.attnum = key.attnum ORDER BY key.ordinality)) AS child_columns,
      to_json(ARRAY(SELECT parent_attribute.attname FROM unnest(constraint_entry.confkey) WITH ORDINALITY AS key(attnum, ordinality) JOIN pg_attribute AS parent_attribute ON parent_attribute.attrelid = parent.oid AND parent_attribute.attnum = key.attnum ORDER BY key.ordinality)) AS parent_columns,
      constraint_entry.confmatchtype::text AS match_type, constraint_entry.convalidated AS validated
    FROM pg_constraint AS constraint_entry
    JOIN pg_class AS child ON child.oid = constraint_entry.conrelid
    JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
    JOIN pg_class AS parent ON parent.oid = constraint_entry.confrelid
    WHERE constraint_entry.contype = 'f' AND child_namespace.nspname = 'public'
    ORDER BY child.relname COLLATE "C", constraint_entry.conname COLLATE "C"`);
  let foreignKeyViolationCount = 0;
  let orphanRowCount = 0;
  for (const foreignKey of catalog.rows) {
    if (!foreignKey.validated) foreignKeyViolationCount += 1;
    if (
      foreignKey.child_columns.length === 0 ||
      foreignKey.child_columns.length !== foreignKey.parent_columns.length
    ) {
      stop("POST_RESET_INTEGRITY_MISMATCH");
    }
    const childTable = quoteCatalogIdentifier(foreignKey.child_table);
    const parentTable = quoteCatalogIdentifier(foreignKey.parent_table);
    const pairs = foreignKey.child_columns.map((childColumn, index) => {
      const parentColumn = foreignKey.parent_columns[index];
      if (!parentColumn) stop("POST_RESET_INTEGRITY_MISMATCH");
      return `parent.${quoteCatalogIdentifier(parentColumn)} = child.${quoteCatalogIdentifier(childColumn)}`;
    });
    const allPresent = foreignKey.child_columns
      .map((column) => `child.${quoteCatalogIdentifier(column)} IS NOT NULL`)
      .join(" AND ");
    const orphanResult = await client.query<CountRow>(
      `SELECT count(*)::text AS "count" FROM "public".${childTable} AS child WHERE ${allPresent} AND NOT EXISTS (SELECT 1 FROM "public".${parentTable} AS parent WHERE ${pairs.join(" AND ")})`,
    );
    orphanRowCount += safeCount(orphanResult.rows[0]?.count);
  }
  return { foreignKeyViolationCount, orphanRowCount };
}

const OWNERSHIP_CHECK_SQL = `
WITH violation AS (
  SELECT 1 FROM "public"."projects" child JOIN "public"."client_contacts" parent ON parent."id" = child."client_contact_id" WHERE child."producer_id" <> parent."producer_id"
  UNION ALL SELECT 1 FROM "public"."purchase_requests" child JOIN "public"."client_contacts" parent ON parent."id" = child."client_contact_id" WHERE child."producer_id" <> parent."producer_id"
  UNION ALL SELECT 1 FROM "public"."private_offers" child JOIN "public"."client_contacts" parent ON parent."id" = child."client_contact_id" WHERE child."producer_id" <> parent."producer_id"
  UNION ALL SELECT 1 FROM "public"."purchases" child JOIN "public"."projects" parent ON parent."id" = child."project_id" WHERE child."producer_id" <> parent."producer_id" OR child."client_contact_id" <> parent."client_contact_id"
  UNION ALL SELECT 1 FROM "public"."project_tracks" child JOIN "public"."purchases" parent ON parent."id" = child."purchase_id" WHERE child."project_id" <> parent."project_id"
  UNION ALL SELECT 1 FROM "public"."track_versions" child JOIN "public"."project_tracks" parent ON parent."id" = child."track_id" WHERE child."purchase_id" <> parent."purchase_id"
  UNION ALL SELECT 1 FROM "public"."bookings" child JOIN "public"."purchases" parent ON parent."id" = child."purchase_id" WHERE child."producer_id" <> parent."producer_id" OR child."project_id" <> parent."project_id"
  UNION ALL SELECT 1 FROM "public"."payment_proofs" child JOIN "public"."purchases" parent ON parent."id" = child."purchase_id" WHERE child."producer_id" <> parent."producer_id" OR child."project_id" <> parent."project_id" OR child."client_contact_id" <> parent."client_contact_id"
  UNION ALL SELECT 1 FROM "public"."notifications" child JOIN "public"."purchases" parent ON parent."id" = child."purchase_id" WHERE child."purchase_id" IS NOT NULL AND child."producer_id" <> parent."producer_id"
)
SELECT count(*)::text AS "count" FROM violation`;

export async function collectPostResetDatabaseEvidence(
  client: NeonPoolClientLike,
  hmacKey: string,
): Promise<DatabasePostResetEvidence> {
  const schemaFingerprint = await collectCatalogFingerprint(client);
  const preserved = await collectPreservedDatabaseEvidence(client, hmacKey);
  let resetRowCount = 0;
  for (const table of SK90_POST_RESET_EMPTY_TABLES) {
    const result = await client.query<CountRow>(
      `SELECT count(*)::text AS "count" FROM "public"."${table}"`,
    );
    resetRowCount += safeCount(result.rows[0]?.count);
  }
  const foreignKeys = await collectForeignKeyIntegrity(client);
  const ownership = await client.query<CountRow>(OWNERSHIP_CHECK_SQL);
  let prohibitedLegacyRowCount = 0;
  for (const table of [
    "agreement_acceptances",
    "invoices",
    "store_purchase_intents",
    "stripe_customers",
  ] as const) {
    const relation = await client.query<Readonly<{ relation: string | null }>>(
      `SELECT to_regclass('public.${table}')::text AS "relation"`,
    );
    if (relation.rows[0]?.relation) {
      const count = await client.query<CountRow>(
        `SELECT count(*)::text AS "count" FROM "public"."${table}"`,
      );
      prohibitedLegacyRowCount += safeCount(count.rows[0]?.count);
    }
  }
  const purchases = await client.query<CountRow>(
    `SELECT count(*)::text AS "count" FROM "public"."purchases"`,
  );
  return {
    schemaFingerprint,
    resetRowCount,
    preserved,
    foreignKeyViolationCount: foreignKeys.foreignKeyViolationCount,
    orphanRowCount: foreignKeys.orphanRowCount,
    ownershipViolationCount: safeCount(ownership.rows[0]?.count),
    prohibitedLegacyRowCount,
    syntheticPurchaseCount: safeCount(purchases.rows[0]?.count),
  };
}

async function expectConcurrentWriteBlocked(pool: NeonPoolLike, statement: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '250ms'");
    try {
      await client.query(statement);
      stop("LOCK_CONTRACT_INVALID");
    } catch (error) {
      if (error instanceof Sk90ResetSafetyError) throw error;
      if ((error as { code?: unknown }).code !== "55P03") stop("LOCK_CONTRACT_INVALID");
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
}

export async function assertConcurrentWriteStop(pool: NeonPoolLike): Promise<void> {
  await expectConcurrentWriteBlocked(
    pool,
    `INSERT INTO "public"."notifications" ("producer_id", "kind", "title", "body") SELECT "id", 'comment_created', 'sk90-probe', '' FROM "public"."producers" ORDER BY "id" LIMIT 1`,
  );
  await expectConcurrentWriteBlocked(
    pool,
    `UPDATE "public"."products" SET "position" = "position" WHERE "id" = (SELECT "id" FROM "public"."products" ORDER BY "id" LIMIT 1)`,
  );
}

async function breakResetCycles(
  client: NeonPoolClientLike,
  expected: ReadonlyMap<string, readonly string[]>,
  assertAuthorizationFresh: DatabaseMutationFreshnessCheck,
): Promise<void> {
  for (const [table, statement] of [
    [
      "projects",
      `UPDATE "public"."projects" SET "booking_id" = NULL WHERE "id" = ANY($1::uuid[]) AND "booking_id" IS NOT NULL`,
    ],
    [
      "bookings",
      `UPDATE "public"."bookings" SET "project_id" = NULL, "song_id" = NULL WHERE "id" = ANY($1::uuid[]) AND ("project_id" IS NOT NULL OR "song_id" IS NOT NULL)`,
    ],
    [
      "invoices",
      `UPDATE "public"."invoices" SET "project_id" = NULL, "booking_id" = NULL, "payment_plan_project_id" = NULL, "purchase_request_id" = NULL, "payment_proof_id" = NULL WHERE "id" = ANY($1::uuid[]) AND ("project_id" IS NOT NULL OR "booking_id" IS NOT NULL OR "payment_plan_project_id" IS NOT NULL OR "purchase_request_id" IS NOT NULL OR "payment_proof_id" IS NOT NULL)`,
    ],
    [
      "purchase_requests",
      `UPDATE "public"."purchase_requests" SET "project_id" = NULL, "booking_id" = NULL WHERE "id" = ANY($1::uuid[]) AND ("project_id" IS NOT NULL OR "booking_id" IS NOT NULL)`,
    ],
    [
      "payment_proofs",
      `UPDATE "public"."payment_proofs" SET "project_id" = NULL WHERE "id" = ANY($1::uuid[]) AND "project_id" IS NOT NULL`,
    ],
  ] as const) {
    await assertAuthorizationFresh();
    await client.query(statement, [expected.get(table) ?? []]);
  }
}

async function deleteExactResetRows(
  client: NeonPoolClientLike,
  expected: Map<string, string[]>,
  assertAuthorizationFresh: DatabaseMutationFreshnessCheck,
): Promise<number> {
  let deleted = 0;
  for (const table of DELETE_ORDER) {
    const ids = expected.get(table) ?? [];
    await assertAuthorizationFresh();
    const result = await client.query<Readonly<{ identity: string }>>(
      `DELETE FROM "public"."${table}" WHERE "id" = ANY($1::uuid[]) RETURNING "id"::text AS "identity"`,
      [ids],
    );
    const returned = result.rows.map((row) => row.identity);
    if (!exactSortedStrings(returned, ids)) stop("FINAL_DRIFT_DETECTED");
    deleted += returned.length;
  }
  for (const table of SK90_RESET_SOURCE_TABLES) {
    const remaining = await client.query<CountRow>(
      `SELECT count(*)::text AS "count" FROM "public"."${table}"`,
    );
    if (safeCount(remaining.rows[0]?.count) !== 0) stop("FINAL_DRIFT_DETECTED");
  }
  return deleted;
}

async function attemptEmptyPostResetDeletionPath(
  client: NeonPoolClientLike,
  assertAuthorizationFresh: DatabaseMutationFreshnessCheck,
): Promise<0> {
  for (const table of SK90_POST_RESET_EMPTY_TABLES) {
    const observed = await client.query<CountRow>(
      `SELECT count(*)::text AS "count" FROM "public"."${table}"`,
    );
    if (safeCount(observed.rows[0]?.count) !== 0) stop("IDEMPOTENCY_PROOF_MISMATCH");

    // This is the executable second reset attempt. The exact expected set is
    // empty, so RETURNING must prove that the DELETE statement changed zero
    // rows. An unexpected row is rejected by the count gate above, never
    // opportunistically deleted.
    await assertAuthorizationFresh();
    const result = await client.query<Readonly<{ identity: string }>>(
      `DELETE FROM "public"."${table}" WHERE "id" = ANY($1::uuid[]) RETURNING "id"::text AS "identity"`,
      [[]],
    );
    if (result.rows.length !== 0 || (result.rowCount != null && result.rowCount !== 0)) {
      stop("IDEMPOTENCY_PROOF_MISMATCH");
    }
  }
  return 0;
}

async function assertAppliedCutoverDigest(
  client: NeonPoolClientLike,
  migrationDigest: string,
): Promise<void> {
  const ledger = await client.query<Readonly<{ digest: string }>>(
    'SELECT "digest" FROM "skitza_migrations"."applied" WHERE "filename" = $1',
    ["0027_purchase_foundation.sql"],
  );
  if (ledger.rows.length !== 1 || ledger.rows[0]?.digest !== migrationDigest) {
    stop("MIGRATION_DIGEST_MISMATCH");
  }
}

function assertPostDatabaseEvidence(
  artifact: ApprovedResetArtifact,
  evidence: DatabasePostResetEvidence,
): void {
  const expected = artifact.postResetExpectations;
  if (
    !sameDigest(evidence.schemaFingerprint, expected.targetSchemaFingerprint) ||
    evidence.resetRowCount !== 0 ||
    !sameDigest(evidence.preserved.rowCountsFingerprint, expected.preservedRowCountsFingerprint) ||
    !sameDigest(evidence.preserved.businessFingerprint, expected.preservedBusinessFingerprint) ||
    evidence.foreignKeyViolationCount !== 0 ||
    evidence.orphanRowCount !== 0 ||
    evidence.ownershipViolationCount !== 0 ||
    evidence.prohibitedLegacyRowCount !== 0 ||
    evidence.syntheticPurchaseCount !== 0
  ) {
    stop("POST_RESET_INTEGRITY_MISMATCH");
  }
}

async function connectSafely(pool: NeonPoolLike): Promise<NeonPoolClientLike> {
  try {
    return await pool.connect();
  } catch {
    stop("UNEXPECTED_FAILURE");
  }
}

async function collectBaselineSnapshot(
  client: NeonPoolClientLike,
  artifact: ApprovedResetArtifact,
  hmacKey: string,
  approvedStorageReferences: readonly StorageReference[],
): Promise<ResetFingerprintSnapshot> {
  const [schemaFingerprint, resetRowsFingerprint, preserved, storageReferencesFingerprint] =
    await Promise.all([
      collectCatalogFingerprint(client),
      collectResetRowsFingerprint(client, hmacKey),
      collectPreservedDatabaseEvidence(client, hmacKey),
      collectDatabaseStorageReferencesFingerprint(client, hmacKey, approvedStorageReferences),
    ]);
  return {
    manifestDigest: artifact.manifestDigest,
    schemaFingerprint,
    resetRowsFingerprint,
    preservedRowCountsFingerprint: preserved.rowCountsFingerprint,
    preservedBusinessFingerprint: preserved.businessFingerprint,
    storageReferencesFingerprint,
  };
}

function assertLockedBaseline(
  artifact: ApprovedResetArtifact,
  snapshot: ResetFingerprintSnapshot,
): void {
  assertArtifactLockedSnapshot(artifact, {
    isolationLevel: "serializable",
    advisoryLockAcquired: true,
    mutationStarted: false,
    storageDeletionStarted: false,
    locks: SK90_REQUIRED_LOCK_TABLES.map((table) => ({
      table,
      mode: "share_row_exclusive",
    })),
    reviewed: artifact.reviewedBaseline,
    underLock: snapshot,
  });
}

export class Sk90DatabaseRehearsalAdapter {
  constructor(
    private readonly transactionPool: NeonPoolLike,
    private readonly concurrentProbePool: NeonPoolLike,
    private readonly now: () => Date,
  ) {}

  async execute(
    input: Readonly<{
      artifact: ApprovedResetArtifact;
      hmacKey: string;
      expectedRows: readonly ResetRowIdentity[];
      providerEvidence: readonly ProviderResetEvidence[];
      freshAuthorization: FreshTargetAuthorization;
      actionChallengeToken: ProtectedToken;
      currentTime: string;
      executionApprovalDigest: Sha256Digest;
      approvedStorageReferences: readonly StorageReference[];
      applyCutoverInTransaction: (
        client: NeonPoolClientLike,
        binding: Sk90CutoverApprovalBinding,
      ) => Promise<void>;
    }>,
  ): Promise<DatabaseResetReceipt> {
    assertApprovedResetArtifact(input.artifact);
    assertFreshTargetAuthorization(input.freshAuthorization, {
      action: "reset_database",
      artifactDigest: input.artifact.digest,
      challengeToken: input.actionChallengeToken,
      targetObservationDigest: targetObservationDigest(input.artifact.target),
      currentTime: input.currentTime,
    });
    assertSha256Digest(input.executionApprovalDigest);
    const cutoverBinding: Sk90CutoverApprovalBinding = {
      artifactDigest: input.artifact.digest,
      manifestDigest: input.artifact.manifestDigest,
      policyDigest: input.artifact.target.policyDigest,
      targetDatabaseFingerprint: input.artifact.target.databaseFingerprint,
      targetObservationDigest: targetObservationDigest(input.artifact.target),
      executionApprovalDigest: input.executionApprovalDigest,
      freshAuthorizationDigest: input.freshAuthorization.authorizationDigest,
      actionChallengeToken: input.actionChallengeToken,
    };
    const assertMutationAuthorizationFresh = (): void => {
      assertFreshDatabaseMutationAuthorization(
        {
          freshAuthorization: input.freshAuthorization,
          action: "reset_database",
          artifactDigest: input.artifact.digest,
          actionChallengeToken: input.actionChallengeToken,
          targetObservationDigest: targetObservationDigest(input.artifact.target),
        },
        this.now(),
      );
    };
    const expected = expectedRowsByTable(input.expectedRows);
    const client = await connectSafely(this.transactionPool);
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      // Keep the same lock order as later migrations: migration lock first,
      // then the reset-specific lock, then all affected tables.
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_MIGRATION_ADVISORY_LOCK_KEY,
      ]);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_DATABASE_ADVISORY_LOCK_KEY,
      ]);
      await assertDatabaseSchemaState(client, "baseline");
      await client.query(
        `LOCK TABLE ${SK90_REQUIRED_LOCK_TABLES.map((table) => `"public"."${table}"`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
      );

      const lockedSnapshot = await collectBaselineSnapshot(
        client,
        input.artifact,
        input.hmacKey,
        input.approvedStorageReferences,
      );
      assertLockedBaseline(input.artifact, lockedSnapshot);

      await assertConcurrentWriteStop(this.concurrentProbePool);
      await stageProviderResetEvidence(
        client,
        input.artifact,
        input.providerEvidence,
        input.hmacKey,
        input.actionChallengeToken,
        assertMutationAuthorizationFresh,
      );
      await breakResetCycles(client, expected, assertMutationAuthorizationFresh);
      const deletedRowCount = await deleteExactResetRows(
        client,
        expected,
        assertMutationAuthorizationFresh,
      );
      assertMutationAuthorizationFresh();
      await input.applyCutoverInTransaction(
        freshnessCheckedClient(client, assertMutationAuthorizationFresh),
        cutoverBinding,
      );
      const postEvidence = await collectPostResetDatabaseEvidence(client, input.hmacKey);
      assertPostDatabaseEvidence(input.artifact, postEvidence);
      assertMutationAuthorizationFresh();
      await client.query("COMMIT");
      transactionOpen = false;
      return {
        artifactDigest: input.artifact.digest,
        manifestDigest: input.artifact.manifestDigest,
        deletedRowCount,
        schemaFingerprint: postEvidence.schemaFingerprint,
        databaseStateFingerprint: sha256Digest(canonicalJson(postEvidence)),
        committed: true,
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original sanitized safety failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError) throw error;
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      client.release();
    }
  }

  async readRestorePreparedRecordForArchive(): Promise<DatabaseRestorePreparedRecord | null> {
    const client = await connectSafely(this.transactionPool);
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_MIGRATION_ADVISORY_LOCK_KEY,
      ]);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_DATABASE_ADVISORY_LOCK_KEY,
      ]);
      const columns = await client.query<CountRow>(`
        SELECT count(*)::text AS "count"
        FROM pg_attribute AS attribute
        JOIN pg_class AS relation ON relation.oid = attribute.attrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'skitza_rehearsal'
          AND relation.relname = 'target_identity'
          AND attribute.attname IN (
            'restore_prepared_marker_json',
            'restore_prepared_marker_fingerprint'
          )
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped`);
      const columnCount = safeCount(columns.rows[0]?.count);
      if (columnCount === 0) {
        await client.query("COMMIT");
        transactionOpen = false;
        return null;
      }
      if (columnCount !== 2) stop("RESTORE_PROOF_MISMATCH");
      await assertExactRestorePreparedCatalog(client);
      const stored = await client.query<RestorePreparedRow>(
        `SELECT "restore_prepared_marker_json" AS "marker_json",
                "restore_prepared_marker_fingerprint" AS "marker_fingerprint"
         FROM "skitza_rehearsal"."target_identity"`,
      );
      const row = stored.rows[0];
      if (
        stored.rows.length !== 1 ||
        typeof row?.marker_json !== "string" ||
        typeof row.marker_fingerprint !== "string"
      ) {
        stop("RESTORE_PROOF_MISMATCH");
      }
      const record = assertRestorePreparedRecord({
        markerJson: row.marker_json,
        markerFingerprint: row.marker_fingerprint as Sha256Digest,
      });
      await client.query("COMMIT");
      transactionOpen = false;
      return record;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original sanitized safety failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError) throw error;
      throw new Sk90ResetSafetyError("RESTORE_REQUIRED");
    } finally {
      client.release();
    }
  }

  /**
   * Atomically record the exact authenticated restore generation while removing
   * the mutable catalogs. A failed single-transaction pg_restore leaves this
   * marker intact so only that prepared generation can be resumed.
   */
  async prepareRestoreTargetForArchive(
    input: PrepareRestoreTargetInput &
      Readonly<{
        artifact: ApprovedResetArtifact;
        hmacKey: string;
        approvedStorageReferences: readonly StorageReference[];
        migrationDigest: string;
      }>,
  ): Promise<void> {
    assertApprovedResetArtifact(input.artifact);
    if (!/^[0-9a-f]{64}$/.test(input.migrationDigest)) stop("MIGRATION_DIGEST_MISMATCH");
    const marker = assertRestorePreparedRecord(input.marker);
    if (input.expectedExistingMarkerFingerprint !== null) {
      assertSha256Digest(input.expectedExistingMarkerFingerprint);
    }
    input.assertFresh();
    const client = await connectSafely(this.transactionPool);
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_MIGRATION_ADVISORY_LOCK_KEY,
      ]);
      input.assertFresh();
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_DATABASE_ADVISORY_LOCK_KEY,
      ]);
      input.assertFresh();
      const targetMarker = await client.query<CountRow>(
        'SELECT count(*)::text AS "count" FROM "skitza_rehearsal"."target_identity"',
      );
      if (safeCount(targetMarker.rows[0]?.count) !== 1) stop("RESTORE_PROOF_MISMATCH");

      const existingColumns = await client.query<CountRow>(`
        SELECT count(*)::text AS "count"
        FROM pg_attribute AS attribute
        JOIN pg_class AS relation ON relation.oid = attribute.attrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'skitza_rehearsal'
          AND relation.relname = 'target_identity'
          AND attribute.attname IN (
            'restore_prepared_marker_json',
            'restore_prepared_marker_fingerprint'
          )
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped`);
      const existingColumnCount = safeCount(existingColumns.rows[0]?.count);
      if (input.expectedExistingMarkerFingerprint === null) {
        if (existingColumnCount !== 0) stop("RESTORE_PROOF_MISMATCH");
        const sourceState = await classifyDatabaseSchemaState(client);
        if (sourceState !== input.expectedSourceState) {
          stop("DATABASE_VERIFICATION_MISMATCH");
        }
        if (sourceState === "baseline") {
          await client.query('LOCK TABLE "skitza_migrations"."applied" IN ACCESS EXCLUSIVE MODE');
          await client.query(
            `LOCK TABLE ${SK90_REQUIRED_LOCK_TABLES.map((table) => `"public"."${table}"`).join(", ")} IN ACCESS EXCLUSIVE MODE`,
          );
          const before = await collectBaselineSnapshot(
            client,
            input.artifact,
            input.hmacKey,
            input.approvedStorageReferences,
          );
          assertLockedBaseline(input.artifact, before);
          await assertConcurrentWriteStop(this.concurrentProbePool);
          const after = await collectBaselineSnapshot(
            client,
            input.artifact,
            input.hmacKey,
            input.approvedStorageReferences,
          );
          assertLockedBaseline(input.artifact, after);
          if (canonicalJson(before) !== canonicalJson(after)) {
            stop("RESTORE_PROOF_MISMATCH");
          }
        } else {
          await client.query('LOCK TABLE "skitza_migrations"."applied" IN ACCESS EXCLUSIVE MODE');
          await client.query(
            `LOCK TABLE ${SK90_POST_RESET_LOCK_TABLES.map((table) => `"public"."${table}"`).join(", ")} IN ACCESS EXCLUSIVE MODE`,
          );
          await assertAppliedCutoverDigest(client, input.migrationDigest);
          const before = await collectPostResetDatabaseEvidence(client, input.hmacKey);
          assertPostDatabaseEvidence(input.artifact, before);
          await assertConcurrentWriteStop(this.concurrentProbePool);
          const after = await collectPostResetDatabaseEvidence(client, input.hmacKey);
          assertPostDatabaseEvidence(input.artifact, after);
          if (canonicalJson(before) !== canonicalJson(after)) {
            stop("RESTORE_PROOF_MISMATCH");
          }
        }
      } else {
        if (existingColumnCount !== 2) stop("RESTORE_PROOF_MISMATCH");
        await assertExactRestorePreparedCatalog(client);
        const existing = await client.query<RestorePreparedRow>(
          `SELECT "restore_prepared_marker_json" AS "marker_json",
                  "restore_prepared_marker_fingerprint" AS "marker_fingerprint"
           FROM "skitza_rehearsal"."target_identity"`,
        );
        const row = existing.rows[0];
        if (
          existing.rows.length !== 1 ||
          typeof row?.marker_json !== "string" ||
          typeof row.marker_fingerprint !== "string"
        ) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        const existingMarker = assertRestorePreparedRecord({
          markerJson: row.marker_json,
          markerFingerprint: row.marker_fingerprint as Sha256Digest,
        });
        if (
          !sameDigest(existingMarker.markerFingerprint, input.expectedExistingMarkerFingerprint)
        ) {
          stop("RESTORE_PROOF_MISMATCH");
        }
      }

      if (existingColumnCount === 0) {
        input.assertFresh();
        await client.query(
          'ALTER TABLE "skitza_rehearsal"."target_identity" ADD COLUMN "restore_prepared_marker_json" text',
        );
        input.assertFresh();
        await client.query(
          'ALTER TABLE "skitza_rehearsal"."target_identity" ADD COLUMN "restore_prepared_marker_fingerprint" text',
        );
      }
      input.assertFresh();
      await client.query(
        `UPDATE "skitza_rehearsal"."target_identity"
         SET "restore_prepared_marker_json" = $1,
             "restore_prepared_marker_fingerprint" = $2`,
        [marker.markerJson, marker.markerFingerprint],
      );
      input.assertFresh();
      await client.query('DROP SCHEMA IF EXISTS "skitza_migrations" CASCADE');
      input.assertFresh();
      await client.query('DROP SCHEMA IF EXISTS "public" CASCADE');
      input.assertFresh();
      await client.query('CREATE SCHEMA "public" AUTHORIZATION CURRENT_USER');
      input.assertFresh();
      await client.query('GRANT USAGE ON SCHEMA "public" TO PUBLIC');
      input.assertFresh();
      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original sanitized safety failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError) throw error;
      throw new Sk90ResetSafetyError("RESTORE_REQUIRED");
    } finally {
      client.release();
    }
  }

  /**
   * Hold the reset lock set while a caller consumes one exported PostgreSQL
   * snapshot. The archive is therefore taken from the exact reviewed baseline,
   * not merely from a database that happened to match before or after pg_dump.
   */
  async withVerifiedBaselineSnapshot(
    input: Readonly<{
      artifact: ApprovedResetArtifact;
      hmacKey: string;
      approvedStorageReferences: readonly StorageReference[];
      useSnapshot(snapshotId: string): Promise<void>;
    }>,
  ): Promise<VerifiedBaselineSnapshotReceipt> {
    assertApprovedResetArtifact(input.artifact);
    const client = await connectSafely(this.transactionPool);
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_MIGRATION_ADVISORY_LOCK_KEY,
      ]);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_DATABASE_ADVISORY_LOCK_KEY,
      ]);
      await assertDatabaseSchemaState(client, "baseline");
      await client.query(
        `LOCK TABLE ${SK90_REQUIRED_LOCK_TABLES.map((table) => `"public"."${table}"`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
      );

      const before = await collectBaselineSnapshot(
        client,
        input.artifact,
        input.hmacKey,
        input.approvedStorageReferences,
      );
      assertLockedBaseline(input.artifact, before);
      await assertConcurrentWriteStop(this.concurrentProbePool);

      const exported = await client.query<{ snapshotId: unknown }>(
        'SELECT pg_export_snapshot() AS "snapshotId"',
      );
      const snapshotId = exported.rows[0]?.snapshotId;
      if (
        exported.rows.length !== 1 ||
        (exported.rowCount !== undefined &&
          exported.rowCount !== null &&
          exported.rowCount !== 1) ||
        typeof snapshotId !== "string" ||
        snapshotId.length === 0 ||
        snapshotId.length > 256 ||
        /[\0\r\n]/.test(snapshotId)
      ) {
        stop("RESTORE_POINT_NOT_READY");
      }

      await input.useSnapshot(snapshotId);

      const after = await collectBaselineSnapshot(
        client,
        input.artifact,
        input.hmacKey,
        input.approvedStorageReferences,
      );
      assertLockedBaseline(input.artifact, after);
      if (canonicalJson(before) !== canonicalJson(after)) stop("RESTORE_POINT_NOT_READY");

      await client.query("COMMIT");
      transactionOpen = false;
      return {
        artifactDigest: input.artifact.digest,
        manifestDigest: input.artifact.manifestDigest,
        purpose: "restored_baseline",
        schemaFingerprint: after.schemaFingerprint,
        databaseStateFingerprint: sha256Digest(canonicalJson(after)),
        databaseMutationCount: 0,
        committed: true,
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original sanitized safety failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError) throw error;
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      client.release();
    }
  }

  /** Verify a restored database is byte-for-byte equivalent to the reviewed baseline. */
  async verifyRestoredBaseline(
    input: Readonly<{
      artifact: ApprovedResetArtifact;
      hmacKey: string;
      approvedStorageReferences: readonly StorageReference[];
    }>,
  ): Promise<DatabaseVerificationReceipt> {
    assertApprovedResetArtifact(input.artifact);
    const client = await connectSafely(this.transactionPool);
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_MIGRATION_ADVISORY_LOCK_KEY,
      ]);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_DATABASE_ADVISORY_LOCK_KEY,
      ]);
      await assertDatabaseSchemaState(client, "baseline");
      await client.query(
        `LOCK TABLE ${SK90_REQUIRED_LOCK_TABLES.map((table) => `"public"."${table}"`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
      );

      const before = await collectBaselineSnapshot(
        client,
        input.artifact,
        input.hmacKey,
        input.approvedStorageReferences,
      );
      assertLockedBaseline(input.artifact, before);
      await assertConcurrentWriteStop(this.concurrentProbePool);
      const after = await collectBaselineSnapshot(
        client,
        input.artifact,
        input.hmacKey,
        input.approvedStorageReferences,
      );
      assertLockedBaseline(input.artifact, after);
      if (canonicalJson(before) !== canonicalJson(after)) stop("RESTORE_PROOF_MISMATCH");

      await client.query("COMMIT");
      transactionOpen = false;
      return {
        artifactDigest: input.artifact.digest,
        manifestDigest: input.artifact.manifestDigest,
        purpose: "restored_baseline",
        schemaFingerprint: after.schemaFingerprint,
        databaseStateFingerprint: sha256Digest(canonicalJson(after)),
        databaseMutationCount: 0,
        committed: true,
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original sanitized safety failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError) throw error;
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      client.release();
    }
  }

  /**
   * Execute the reset and 0027 verifier a second time against the committed
   * post-reset state. This is deliberately separate from the read-only post
   * verifier below: it runs zero-row DELETE ... RETURNING statements for the
   * exact empty expected set and invokes the same cutover callback.
   */
  async executeSecondRunNoOp(
    input: Readonly<{
      artifact: ApprovedResetArtifact;
      hmacKey: string;
      expectedRows: readonly ResetRowIdentity[];
      migrationDigest: string;
      freshAuthorization: FreshTargetAuthorization;
      actionChallengeToken: ProtectedToken;
      currentTime: string;
      executionApprovalDigest: Sha256Digest;
      applyCutoverInTransaction: (
        client: NeonPoolClientLike,
        binding: Sk90CutoverApprovalBinding,
      ) => Promise<void>;
    }>,
  ): Promise<DatabaseResetReceipt> {
    assertApprovedResetArtifact(input.artifact);
    if (!/^[0-9a-f]{64}$/.test(input.migrationDigest)) stop("MIGRATION_DIGEST_MISMATCH");
    assertFreshTargetAuthorization(input.freshAuthorization, {
      action: "noop",
      artifactDigest: input.artifact.digest,
      challengeToken: input.actionChallengeToken,
      targetObservationDigest: targetObservationDigest(input.artifact.target),
      currentTime: input.currentTime,
    });
    assertSha256Digest(input.executionApprovalDigest);
    const cutoverBinding: Sk90CutoverApprovalBinding = {
      artifactDigest: input.artifact.digest,
      manifestDigest: input.artifact.manifestDigest,
      policyDigest: input.artifact.target.policyDigest,
      targetDatabaseFingerprint: input.artifact.target.databaseFingerprint,
      targetObservationDigest: targetObservationDigest(input.artifact.target),
      executionApprovalDigest: input.executionApprovalDigest,
      freshAuthorizationDigest: input.freshAuthorization.authorizationDigest,
      actionChallengeToken: input.actionChallengeToken,
    };
    const assertMutationAuthorizationFresh = (): void => {
      assertFreshDatabaseMutationAuthorization(
        {
          freshAuthorization: input.freshAuthorization,
          action: "noop",
          artifactDigest: input.artifact.digest,
          actionChallengeToken: input.actionChallengeToken,
          targetObservationDigest: targetObservationDigest(input.artifact.target),
        },
        this.now(),
      );
    };
    // Rebind the invocation to the originally approved private reset set. The
    // observed post-reset expected set below is intentionally empty.
    expectedRowsByTable(input.expectedRows);

    const client = await connectSafely(this.transactionPool);
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_MIGRATION_ADVISORY_LOCK_KEY,
      ]);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_DATABASE_ADVISORY_LOCK_KEY,
      ]);
      await assertDatabaseSchemaState(client, "post_reset");
      await client.query('LOCK TABLE "skitza_migrations"."applied" IN SHARE ROW EXCLUSIVE MODE');
      await client.query(
        `LOCK TABLE ${SK90_POST_RESET_LOCK_TABLES.map((table) => `"public"."${table}"`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
      );

      await assertAppliedCutoverDigest(client, input.migrationDigest);
      const before = await collectPostResetDatabaseEvidence(client, input.hmacKey);
      assertPostDatabaseEvidence(input.artifact, before);
      await assertConcurrentWriteStop(this.concurrentProbePool);

      const deletedRowCount = await attemptEmptyPostResetDeletionPath(
        client,
        assertMutationAuthorizationFresh,
      );
      assertMutationAuthorizationFresh();
      await input.applyCutoverInTransaction(
        freshnessCheckedClient(client, assertMutationAuthorizationFresh),
        cutoverBinding,
      );
      await assertAppliedCutoverDigest(client, input.migrationDigest);

      const after = await collectPostResetDatabaseEvidence(client, input.hmacKey);
      assertPostDatabaseEvidence(input.artifact, after);
      if (canonicalJson(before) !== canonicalJson(after)) {
        stop("IDEMPOTENCY_PROOF_MISMATCH");
      }

      assertMutationAuthorizationFresh();
      await client.query("COMMIT");
      transactionOpen = false;
      return {
        artifactDigest: input.artifact.digest,
        manifestDigest: input.artifact.manifestDigest,
        deletedRowCount,
        schemaFingerprint: after.schemaFingerprint,
        databaseStateFingerprint: sha256Digest(canonicalJson(after)),
        committed: true,
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original sanitized safety failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError) throw error;
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      client.release();
    }
  }

  /** Read-only post-reset verifier; the executable idempotency run is above. */
  async verifySecondRunNoOp(
    input: Readonly<{
      artifact: ApprovedResetArtifact;
      hmacKey: string;
      migrationDigest: string;
    }>,
  ): Promise<DatabaseVerificationReceipt> {
    assertApprovedResetArtifact(input.artifact);
    if (!/^[0-9a-f]{64}$/.test(input.migrationDigest)) stop("MIGRATION_DIGEST_MISMATCH");
    const client = await connectSafely(this.transactionPool);
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_MIGRATION_ADVISORY_LOCK_KEY,
      ]);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_DATABASE_ADVISORY_LOCK_KEY,
      ]);
      await assertDatabaseSchemaState(client, "post_reset");
      await client.query('LOCK TABLE "skitza_migrations"."applied" IN SHARE ROW EXCLUSIVE MODE');
      await client.query(
        `LOCK TABLE ${SK90_POST_RESET_LOCK_TABLES.map((table) => `"public"."${table}"`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
      );
      const ledger = await client.query<Readonly<{ digest: string }>>(
        'SELECT "digest" FROM "skitza_migrations"."applied" WHERE "filename" = $1',
        ["0027_purchase_foundation.sql"],
      );
      if (ledger.rows.length !== 1 || ledger.rows[0]?.digest !== input.migrationDigest) {
        stop("MIGRATION_DIGEST_MISMATCH");
      }

      const before = await collectPostResetDatabaseEvidence(client, input.hmacKey);
      assertPostDatabaseEvidence(input.artifact, before);
      await assertConcurrentWriteStop(this.concurrentProbePool);
      const after = await collectPostResetDatabaseEvidence(client, input.hmacKey);
      assertPostDatabaseEvidence(input.artifact, after);
      if (canonicalJson(before) !== canonicalJson(after)) stop("IDEMPOTENCY_PROOF_MISMATCH");

      await client.query("COMMIT");
      transactionOpen = false;
      return {
        artifactDigest: input.artifact.digest,
        manifestDigest: input.artifact.manifestDigest,
        purpose: "second_run_noop",
        schemaFingerprint: after.schemaFingerprint,
        databaseStateFingerprint: sha256Digest(canonicalJson(after)),
        databaseMutationCount: 0,
        committed: true,
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original sanitized safety failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError) throw error;
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      client.release();
    }
  }
}
