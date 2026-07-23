import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  compareUtf8Bytes,
  protectValue,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "../sk90-reset/canonical";
import {
  SK90_MIGRATION_ADVISORY_LOCK_KEY,
  SK90_POST_RESET_EMPTY_TABLES,
  assertNoUnresolvedPendingAudioUploads,
  classifyDatabaseSchemaState,
  collectCatalogFingerprint,
  collectPostResetDatabaseEvidence,
  type NeonPoolClientLike,
  type NeonPoolLike,
  type PgQueryResult,
} from "../sk90-reset/database-adapter";
import { Sk90ResetSafetyError, stop } from "../sk90-reset/errors";
import {
  SK104_MOCK_EVIDENCE_COUNTS,
  SK104_PRESERVED_INVENTORY,
  SK104_RESET_INVENTORY,
  SK104_RESET_ROW_COUNT,
  SK104_RESET_STORAGE_REFERENCE_COUNT,
  assertSk104CutoverApproval,
  assertSk104ProductionManifest,
  type Sk104CutoverApproval,
  type Sk104ProductionManifest,
} from "./contract";
import { Sk104CutoverSafetyError } from "./environment";
import {
  assertCanonicalProductionTarget,
  observeProductionDatabaseTarget,
  type ProductionTargetObservation,
} from "./target-observer";

export const SK104_DATABASE_ADVISORY_LOCK_KEY = "7468258445703257130" as const;
export const SK104_RUN_LEASE_ADVISORY_LOCK_KEY = "7468258445703257131" as const;
export const SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY = "7468258445703257132" as const;

const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

function assertRunLeaseProofKey(value: string): string {
  if (!/^[1-9]\d{0,18}$/.test(value)) stop("LOCK_CONTRACT_INVALID");
  const parsed = BigInt(value);
  if (
    parsed > MAX_SIGNED_BIGINT ||
    value === SK104_DATABASE_ADVISORY_LOCK_KEY ||
    value === SK104_RUN_LEASE_ADVISORY_LOCK_KEY ||
    value === SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY ||
    value === SK90_MIGRATION_ADVISORY_LOCK_KEY
  ) {
    stop("LOCK_CONTRACT_INVALID");
  }
  return value;
}

export const SK104_APPROVED_MIGRATION_FILES = [
  "0027_purchase_foundation.sql",
  "0028_stable_client_ownership.sql",
  "0029_private_offer_recipient_identity.sql",
  "0030_song_release_state.sql",
  "0031_purchase_ledger_runtime.sql",
  "0032_purchase_session_allowance.sql",
  "0033_purchase_version_download_overrides.sql",
  "0034_song_public_access.sql",
] as const;

export const SK104_REQUIRED_LOCK_TABLES = [
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

export const SK104_POST_CUTOVER_EMPTY_TABLES = [
  ...SK90_POST_RESET_EMPTY_TABLES,
  "booking_transition_events",
  "song_public_access_events",
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
  "store_purchase_intents",
  "stripe_customers",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ResetTable = (typeof SK104_RESET_INVENTORY)[number]["table"];
type PreservedTable = (typeof SK104_PRESERVED_INVENTORY)[number]["table"];
type MutationFreshnessCheck = () => void;

export type Sk104PrivateResetRow = Readonly<{
  category: string;
  table: ResetTable;
  id: string;
  protectedContentHash: ProtectedToken;
}>;

export type Sk104PrivateDatabaseStorageReference = Readonly<{
  bucketRole: "audio" | "docs";
  sourceTable: "track_versions" | "payment_proofs" | "portfolio_tracks";
  sourceColumn: "audio_r2_key" | "peaks_r2_key" | "storage_key";
  referencedBy: "reset" | "preserved";
  rowId: string;
  key: string;
  protectedKey: ProtectedToken;
}>;

export type Sk104PrivateIdentityEvidence = Readonly<{
  ownerId: string;
  identityValue: string;
  classification: "approved_test";
  attested: true;
}>;

export type Sk104PrivateMonetaryEvidence = Readonly<{
  sourceKind: "invoice_paid" | "payment_proof_confirmed";
  ownerId: string;
  classification: "approved_mock_test";
  attested: true;
}>;

export type Sk104PrivateProviderEvidence = Readonly<{
  sourceKind: "producer_stripe_account" | "booking_tranzila_confirmation";
  ownerId: string;
  providerValue: string;
  provider: "stripe" | "tranzila";
  mode: "test";
  attested: true;
  chargeEnabled: false;
  externalCharge: false;
  liveSchedule: false;
}>;

export type Sk104PrivateMockEvidence = Readonly<{
  identities: readonly Sk104PrivateIdentityEvidence[];
  monetaryRows: readonly Sk104PrivateMonetaryEvidence[];
  providerReferences: readonly Sk104PrivateProviderEvidence[];
}>;

type PrivateDatabaseManifestBody = Readonly<{
  contract: "sk104-private-production-database-manifest-v1";
  sourceSchemaFingerprint: Sha256Digest;
  resetRowsFingerprint: Sha256Digest;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  storageReferencesFingerprint: Sha256Digest;
  mockEvidenceFingerprint: Sha256Digest;
  rows: readonly Sk104PrivateResetRow[];
  storageReferences: readonly Sk104PrivateDatabaseStorageReference[];
  mockEvidence: Sk104PrivateMockEvidence;
}>;

export type Sk104PrivateProductionDatabaseManifest = PrivateDatabaseManifestBody &
  Readonly<{ bindingToken: ProtectedToken }>;

export type Sk104ProductionMigrationBinding = Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  canonicalProductionTargetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  executionApprovalDigest: Sha256Digest;
  freshAuthorizationDigest: Sha256Digest;
  migrationBundleDigest: Sha256Digest;
  actionChallengeToken: ProtectedToken;
}>;

/**
 * The migration module must apply the complete immutable bundle on this exact
 * interactive client. A port that commits 0027 and runs 0028-0034 later is
 * deliberately not accepted because it would expose a partially cut-over
 * production schema.
 */
export interface Sk104ProductionMigrationTransactionPort {
  readonly filenames: typeof SK104_APPROVED_MIGRATION_FILES;
  readonly bundleDigest: Sha256Digest;
  applyApprovedBundleInTransaction(
    client: NeonPoolClientLike,
    binding: Sk104ProductionMigrationBinding,
  ): Promise<void>;
}

export type Sk104ProductionDatabaseReceipt = Readonly<{
  contract: "sk104-production-database-receipt-v1";
  manifestDigest: Sha256Digest;
  approvalDigest: Sha256Digest;
  migrationBundleDigest: Sha256Digest;
  deletedRowCount: typeof SK104_RESET_ROW_COUNT;
  sourceSchemaFingerprint: Sha256Digest;
  targetSchemaFingerprint: Sha256Digest;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  databaseStateFingerprint: Sha256Digest;
  committed: true;
}>;

export type Sk104ProductionDatabaseStateObservation =
  | Readonly<{
      state: "baseline";
      databaseStateFingerprint: Sha256Digest;
    }>
  | Readonly<{
      state: "post";
      migrationBundleDigest: Sha256Digest;
      databaseStateFingerprint: Sha256Digest;
    }>
  | Readonly<{
      state: "mixed";
    }>;

export type Sk104VerifiedSnapshotContext = Readonly<{
  manifest: Sk104ProductionManifest;
  privateManifest: Sk104PrivateProductionDatabaseManifest;
  hmacKey: string;
}>;

export type Sk104RestoredBaselineReceipt = Readonly<{
  contract: "sk104-restored-baseline-receipt-v1";
  manifestDigest: Sha256Digest;
  approvalDigest: Sha256Digest;
  sourceSchemaFingerprint: Sha256Digest;
  resetRowsFingerprint: Sha256Digest;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  storageReferencesFingerprint: Sha256Digest;
  databaseStateFingerprint: Sha256Digest;
  verified: true;
}>;

type CountRow = Readonly<{ count: number | string }>;
type IdentityPayloadRow = Readonly<{ identity: unknown; payload: unknown }>;

function safeCount(value: unknown): number {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0) stop("FINAL_DRIFT_DETECTED");
  return number;
}

function privateUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  return value;
}

function privateText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  return value;
}

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort(compareUtf8Bytes);
  const sortedRight = [...right].sort(compareUtf8Bytes);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function exactMigrationFiles(files: readonly string[]): boolean {
  return canonicalJson(files) === canonicalJson(SK104_APPROVED_MIGRATION_FILES);
}

const PRESERVED_PAYLOAD_EXPRESSION: Readonly<Record<PreservedTable, string>> = {
  availability_blackouts: "to_jsonb(source)",
  availability_blocks: "to_jsonb(source)",
  client_contacts: "to_jsonb(source)",
  portfolio_tracks: "to_jsonb(source)",
  producer_external_links: "to_jsonb(source)",
  producer_notes: "to_jsonb(source)",
  producers:
    "to_jsonb(source) - ARRAY['stripe_account_id', 'stripe_charges_enabled', 'tranzila_terminal_name']::text[]",
  products: "to_jsonb(source) - ARRAY['deposit_pct', 'deposit_model', 'milestones']::text[]",
};

async function collectResetRows(
  client: NeonPoolClientLike,
  hmacKey: string,
): Promise<Readonly<{ rows: readonly Sk104PrivateResetRow[]; fingerprint: Sha256Digest }>> {
  const rows: Sk104PrivateResetRow[] = [];
  for (const inventory of SK104_RESET_INVENTORY) {
    const result =
      inventory.table === "stripe_customers"
        ? await client.query<IdentityPayloadRow>(
            `SELECT concat("producer_id"::text, '/', "client_contact_id"::text) AS "identity", to_jsonb(source)::text AS "payload" FROM "public"."stripe_customers" AS source ORDER BY concat("producer_id"::text, '/', "client_contact_id"::text) COLLATE "C"`,
          )
        : await client.query<IdentityPayloadRow>(
            `SELECT "id"::text AS "identity", to_jsonb(source)::text AS "payload" FROM "public"."${inventory.table}" AS source ORDER BY "id"::text COLLATE "C"`,
          );
    if (result.rows.length !== inventory.count) stop("FINAL_DRIFT_DETECTED");
    for (const row of result.rows) {
      if (inventory.table === "stripe_customers") {
        // The approved production inventory contains no composite-key rows.
        stop("FINAL_DRIFT_DETECTED");
      }
      const id = privateUuid(row.identity);
      const payload = privateText(row.payload);
      rows.push({
        category: inventory.category,
        table: inventory.table,
        id,
        protectedContentHash: protectValue(
          hmacKey,
          `sk104-reset-row-content\0${inventory.table}\0${payload}`,
        ),
      });
    }
  }
  rows.sort((left, right) =>
    compareUtf8Bytes(`${left.table}\0${left.id}`, `${right.table}\0${right.id}`),
  );
  const sanitized = rows.map((row) => ({
    category: row.category,
    table: row.table,
    protectedId: protectValue(hmacKey, `sk104-reset-row-id\0${row.table}\0${row.id}`),
    protectedContentHash: row.protectedContentHash,
  }));
  return { rows, fingerprint: sha256Digest(canonicalJson(sanitized)) };
}

async function collectPreservedEvidence(
  client: NeonPoolClientLike,
  hmacKey: string,
): Promise<
  Readonly<{
    rowCountsFingerprint: Sha256Digest;
    businessFingerprint: Sha256Digest;
  }>
> {
  const counts: Array<{ table: string; count: number }> = [];
  const protectedRows: Array<{
    table: string;
    protectedId: ProtectedToken;
    protectedContent: ProtectedToken;
  }> = [];
  for (const inventory of SK104_PRESERVED_INVENTORY) {
    const countResult = await client.query<CountRow>(
      `SELECT count(*)::text AS "count" FROM "public"."${inventory.table}"`,
    );
    const count = safeCount(countResult.rows[0]?.count);
    if (countResult.rows.length !== 1 || count !== inventory.count) {
      stop("FINAL_DRIFT_DETECTED");
    }
    counts.push({ table: inventory.table, count });
    const result = await client.query<IdentityPayloadRow>(
      `SELECT "id"::text AS "identity", (${PRESERVED_PAYLOAD_EXPRESSION[inventory.table]})::text AS "payload" FROM "public"."${inventory.table}" AS source ORDER BY "id"::text COLLATE "C"`,
    );
    if (result.rows.length !== inventory.count) stop("FINAL_DRIFT_DETECTED");
    for (const row of result.rows) {
      const id = privateUuid(row.identity);
      const payload = privateText(row.payload);
      protectedRows.push({
        table: inventory.table,
        protectedId: protectValue(hmacKey, `preserved-row-id\0${inventory.table}\0${id}`),
        protectedContent: protectValue(
          hmacKey,
          `preserved-row-content\0${inventory.table}\0${payload}`,
        ),
      });
    }
  }
  counts.sort((left, right) => compareUtf8Bytes(left.table, right.table));
  protectedRows.sort((left, right) =>
    compareUtf8Bytes(`${left.table}\0${left.protectedId}`, `${right.table}\0${right.protectedId}`),
  );
  return {
    rowCountsFingerprint: sha256Digest(canonicalJson(counts)),
    businessFingerprint: sha256Digest(canonicalJson(protectedRows)),
  };
}

async function collectStorageReferences(
  client: NeonPoolClientLike,
  hmacKey: string,
): Promise<
  Readonly<{
    references: readonly Sk104PrivateDatabaseStorageReference[];
    fingerprint: Sha256Digest;
  }>
> {
  await assertNoUnresolvedPendingAudioUploads(client);
  const result = await client.query<
    Readonly<{
      bucket_role: unknown;
      source_table: unknown;
      source_column: unknown;
      row_id: unknown;
      object_key: unknown;
      referenced_by: unknown;
    }>
  >(`
    SELECT * FROM (
      SELECT 'audio'::text AS "bucket_role", 'track_versions'::text AS "source_table",
        'audio_r2_key'::text AS "source_column", "id"::text AS "row_id",
        "audio_r2_key" AS "object_key", 'reset'::text AS "referenced_by"
      FROM "public"."track_versions" WHERE "audio_r2_key" IS NOT NULL
      UNION ALL
      SELECT 'audio', 'track_versions', 'peaks_r2_key', "id"::text, "peaks_r2_key", 'reset'
      FROM "public"."track_versions" WHERE "peaks_r2_key" IS NOT NULL
      UNION ALL
      SELECT 'docs', 'payment_proofs', 'storage_key', "id"::text, "storage_key", 'reset'
      FROM "public"."payment_proofs" WHERE "storage_key" IS NOT NULL
      UNION ALL
      SELECT 'audio', 'portfolio_tracks', 'audio_r2_key', "id"::text, "audio_r2_key", 'preserved'
      FROM "public"."portfolio_tracks" WHERE "audio_r2_key" IS NOT NULL
      UNION ALL
      SELECT 'audio', 'portfolio_tracks', 'peaks_r2_key', "id"::text, "peaks_r2_key", 'preserved'
      FROM "public"."portfolio_tracks" WHERE "peaks_r2_key" IS NOT NULL
    ) AS "storage_reference"
    ORDER BY "bucket_role" COLLATE "C", "source_table" COLLATE "C",
      "source_column" COLLATE "C", "row_id" COLLATE "C", "object_key" COLLATE "C",
      "referenced_by" COLLATE "C"`);
  const resetRows = result.rows.filter((row) => row.referenced_by === "reset");
  const preservedRows = result.rows.filter((row) => row.referenced_by === "preserved");
  if (
    resetRows.length !== SK104_RESET_STORAGE_REFERENCE_COUNT ||
    preservedRows.length !== 0 ||
    result.rows.some((row) => row.referenced_by !== "reset" && row.referenced_by !== "preserved")
  ) {
    stop("STORAGE_ENUMERATION_MISMATCH");
  }
  const references = result.rows.map((row): Sk104PrivateDatabaseStorageReference => {
    if (
      (row.bucket_role !== "audio" && row.bucket_role !== "docs") ||
      (row.source_table !== "track_versions" &&
        row.source_table !== "payment_proofs" &&
        row.source_table !== "portfolio_tracks") ||
      (row.source_column !== "audio_r2_key" &&
        row.source_column !== "peaks_r2_key" &&
        row.source_column !== "storage_key") ||
      (row.source_table === "payment_proofs" && row.source_column !== "storage_key") ||
      ((row.source_table === "track_versions" || row.source_table === "portfolio_tracks") &&
        row.source_column === "storage_key") ||
      (row.source_table === "portfolio_tracks" && row.referenced_by !== "preserved") ||
      (row.source_table !== "portfolio_tracks" && row.referenced_by !== "reset")
    ) {
      stop("STORAGE_ENUMERATION_MISMATCH");
    }
    const rowId = privateUuid(row.row_id);
    const key = privateText(row.object_key);
    const referencedBy = row.referenced_by;
    if (referencedBy !== "reset" && referencedBy !== "preserved") {
      stop("STORAGE_ENUMERATION_MISMATCH");
    }
    return {
      bucketRole: row.bucket_role,
      sourceTable: row.source_table,
      sourceColumn: row.source_column,
      referencedBy,
      rowId,
      key,
      protectedKey: protectValue(hmacKey, `storage-key\0${row.bucket_role}\0${key}`),
    };
  });
  const sanitized = references.map((reference) => ({
    bucketRole: reference.bucketRole,
    sourceTable: reference.sourceTable,
    sourceColumn: reference.sourceColumn,
    protectedRowId: protectValue(
      hmacKey,
      `sk104-storage-source-row\0${reference.sourceTable}\0${reference.rowId}`,
    ),
    protectedKey: reference.protectedKey,
    referencedBy: reference.referencedBy,
  }));
  const storageIdentities = new Set(
    references.map((reference) => `${reference.bucketRole}\0${reference.key}`),
  );
  if (storageIdentities.size !== SK104_RESET_STORAGE_REFERENCE_COUNT) {
    stop("STORAGE_ENUMERATION_MISMATCH");
  }
  return { references, fingerprint: sha256Digest(canonicalJson(sanitized)) };
}

function assertPrivateEvidenceShape(evidence: Sk104PrivateMockEvidence): void {
  if (
    evidence.identities.length !== SK104_MOCK_EVIDENCE_COUNTS.identityCount ||
    evidence.monetaryRows.length !== SK104_MOCK_EVIDENCE_COUNTS.monetaryRowCount ||
    evidence.providerReferences.length !== SK104_MOCK_EVIDENCE_COUNTS.providerReferenceCount
  ) {
    stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  }
  const identities = new Set<string>();
  for (const identity of evidence.identities) {
    const untrusted = identity as unknown as Record<keyof Sk104PrivateIdentityEvidence, unknown>;
    const ownerId = privateUuid(untrusted.ownerId);
    const identityValue = privateText(untrusted.identityValue);
    if (untrusted.classification !== "approved_test" || untrusted.attested !== true) {
      stop("IDENTITY_NOT_APPROVED_TEST");
    }
    const key = `${ownerId}\0${identityValue}`;
    if (identities.has(key)) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
    identities.add(key);
  }
  const monetaryRows = new Set<string>();
  for (const monetary of evidence.monetaryRows) {
    const untrusted = monetary as unknown as Record<keyof Sk104PrivateMonetaryEvidence, unknown>;
    const ownerId = privateUuid(untrusted.ownerId);
    if (
      (untrusted.sourceKind !== "invoice_paid" &&
        untrusted.sourceKind !== "payment_proof_confirmed") ||
      untrusted.classification !== "approved_mock_test" ||
      untrusted.attested !== true
    ) {
      stop("MONETARY_ROW_NOT_APPROVED_TEST");
    }
    const key = `${untrusted.sourceKind}\0${ownerId}`;
    if (monetaryRows.has(key)) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
    monetaryRows.add(key);
  }
  const providers = new Set<string>();
  let stripe = 0;
  let tranzila = 0;
  for (const provider of evidence.providerReferences) {
    const untrusted = provider as unknown as Record<keyof Sk104PrivateProviderEvidence, unknown>;
    const ownerId = privateUuid(untrusted.ownerId);
    const providerValue = privateText(untrusted.providerValue);
    if (
      untrusted.mode !== "test" ||
      untrusted.attested !== true ||
      untrusted.chargeEnabled !== false ||
      untrusted.externalCharge !== false ||
      untrusted.liveSchedule !== false ||
      (untrusted.sourceKind === "producer_stripe_account"
        ? untrusted.provider !== "stripe"
        : untrusted.sourceKind === "booking_tranzila_confirmation"
          ? untrusted.provider !== "tranzila"
          : true)
    ) {
      stop("PROVIDER_REFERENCE_NOT_APPROVED_TEST");
    }
    const sourceKind = untrusted.sourceKind as Sk104PrivateProviderEvidence["sourceKind"];
    const key = `${sourceKind}\0${ownerId}\0${providerValue}`;
    if (providers.has(key)) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
    providers.add(key);
    if (sourceKind === "producer_stripe_account") stripe += 1;
    else tranzila += 1;
  }
  if (stripe !== 3 || tranzila !== 4) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
}

/**
 * Read the exact current evidence set after the operator has explicitly
 * attested that every current identity, monetary indicator, and provider
 * reference belongs to approved mock/test activity. The returned values are
 * private and must only be written to the owner-only staged bundle.
 */
export async function discoverSk104AttestedMockEvidence(
  client: NeonPoolClientLike,
  operatorAttestedAllMockTest: boolean,
): Promise<Sk104PrivateMockEvidence> {
  if (!operatorAttestedAllMockTest) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  const identities = await client.query<Readonly<{ owner_id: unknown; identity_value: unknown }>>(
    `SELECT "id"::text AS "owner_id", "clerk_user_id" AS "identity_value"
     FROM "public"."client_contacts" WHERE "clerk_user_id" IS NOT NULL
     ORDER BY ("id"::text) COLLATE "C", "clerk_user_id" COLLATE "C"`,
  );
  const monetary = await client.query<Readonly<{ source_kind: unknown; owner_id: unknown }>>(`
    SELECT * FROM (
      SELECT 'invoice_paid'::text AS "source_kind", "id"::text AS "owner_id"
      FROM "public"."invoices" WHERE "status"::text = 'paid' OR "paid_at" IS NOT NULL
      UNION ALL
      SELECT 'payment_proof_confirmed', "id"::text
      FROM "public"."payment_proofs"
      WHERE "status"::text = 'confirmed' OR "confirmed_at" IS NOT NULL
    ) AS "monetary_indicator"
    ORDER BY "source_kind" COLLATE "C", "owner_id" COLLATE "C"`);
  const providers = await client.query<
    Readonly<{ source_kind: unknown; owner_id: unknown; provider_value: unknown }>
  >(`
    SELECT * FROM (
      SELECT 'producer_stripe_account'::text AS "source_kind", "id"::text AS "owner_id",
        "stripe_account_id" AS "provider_value"
      FROM "public"."producers" WHERE "stripe_account_id" IS NOT NULL
      UNION ALL
      SELECT 'booking_tranzila_confirmation', "id"::text, "tranzila_confirmation_code"
      FROM "public"."bookings" WHERE "tranzila_confirmation_code" IS NOT NULL
    ) AS "provider_reference"
    ORDER BY "source_kind" COLLATE "C", "owner_id" COLLATE "C",
      "provider_value" COLLATE "C"`);
  const evidence: Sk104PrivateMockEvidence = {
    identities: identities.rows.map((row) => ({
      ownerId: privateUuid(row.owner_id),
      identityValue: privateText(row.identity_value),
      classification: "approved_test" as const,
      attested: true as const,
    })),
    monetaryRows: monetary.rows.map((row) => {
      if (row.source_kind !== "invoice_paid" && row.source_kind !== "payment_proof_confirmed") {
        stop("MONETARY_ROW_NOT_APPROVED_TEST");
      }
      return {
        sourceKind: row.source_kind,
        ownerId: privateUuid(row.owner_id),
        classification: "approved_mock_test" as const,
        attested: true as const,
      };
    }),
    providerReferences: providers.rows.map((row) => {
      if (
        row.source_kind !== "producer_stripe_account" &&
        row.source_kind !== "booking_tranzila_confirmation"
      ) {
        stop("PROVIDER_REFERENCE_NOT_APPROVED_TEST");
      }
      return {
        sourceKind: row.source_kind,
        ownerId: privateUuid(row.owner_id),
        providerValue: privateText(row.provider_value),
        provider: row.source_kind === "producer_stripe_account" ? "stripe" : "tranzila",
        mode: "test" as const,
        attested: true as const,
        chargeEnabled: false as const,
        externalCharge: false as const,
        liveSchedule: false as const,
      };
    }),
  };
  assertPrivateEvidenceShape(evidence);
  return evidence;
}

async function assertExactMockEvidence(
  client: NeonPoolClientLike,
  evidence: Sk104PrivateMockEvidence,
  hmacKey: string,
): Promise<Sha256Digest> {
  assertPrivateEvidenceShape(evidence);
  const identities = await client.query<Readonly<{ owner_id: unknown; identity_value: unknown }>>(
    `SELECT "id"::text AS "owner_id", "clerk_user_id" AS "identity_value"
     FROM "public"."client_contacts" WHERE "clerk_user_id" IS NOT NULL
     ORDER BY ("id"::text) COLLATE "C", "clerk_user_id" COLLATE "C"`,
  );
  const observedIdentities = identities.rows.map(
    (row) => `${privateUuid(row.owner_id)}\0${privateText(row.identity_value)}`,
  );
  const approvedIdentities = evidence.identities.map(
    (row) => `${row.ownerId}\0${row.identityValue}`,
  );
  if (!exactStrings(observedIdentities, approvedIdentities)) {
    stop("IDENTITY_NOT_APPROVED_TEST");
  }

  const monetary = await client.query<Readonly<{ source_kind: unknown; owner_id: unknown }>>(`
    SELECT * FROM (
      SELECT 'invoice_paid'::text AS "source_kind", "id"::text AS "owner_id"
      FROM "public"."invoices" WHERE "status"::text = 'paid' OR "paid_at" IS NOT NULL
      UNION ALL
      SELECT 'payment_proof_confirmed', "id"::text
      FROM "public"."payment_proofs"
      WHERE "status"::text = 'confirmed' OR "confirmed_at" IS NOT NULL
    ) AS "monetary_indicator"
    ORDER BY "source_kind" COLLATE "C", "owner_id" COLLATE "C"`);
  const observedMonetary = monetary.rows.map((row) => {
    if (row.source_kind !== "invoice_paid" && row.source_kind !== "payment_proof_confirmed") {
      stop("MONETARY_ROW_NOT_APPROVED_TEST");
    }
    return `${row.source_kind}\0${privateUuid(row.owner_id)}`;
  });
  const approvedMonetary = evidence.monetaryRows.map((row) => `${row.sourceKind}\0${row.ownerId}`);
  if (!exactStrings(observedMonetary, approvedMonetary)) {
    stop("MONETARY_ROW_NOT_APPROVED_TEST");
  }

  const providers = await client.query<
    Readonly<{ source_kind: unknown; owner_id: unknown; provider_value: unknown }>
  >(`
    SELECT * FROM (
      SELECT 'producer_stripe_account'::text AS "source_kind", "id"::text AS "owner_id",
        "stripe_account_id" AS "provider_value"
      FROM "public"."producers" WHERE "stripe_account_id" IS NOT NULL
      UNION ALL
      SELECT 'booking_tranzila_confirmation', "id"::text, "tranzila_confirmation_code"
      FROM "public"."bookings" WHERE "tranzila_confirmation_code" IS NOT NULL
    ) AS "provider_reference"
    ORDER BY "source_kind" COLLATE "C", "owner_id" COLLATE "C",
      "provider_value" COLLATE "C"`);
  const observedProviders = providers.rows.map((row) => {
    if (
      row.source_kind !== "producer_stripe_account" &&
      row.source_kind !== "booking_tranzila_confirmation"
    ) {
      stop("PROVIDER_REFERENCE_NOT_APPROVED_TEST");
    }
    return `${row.source_kind}\0${privateUuid(row.owner_id)}\0${privateText(row.provider_value)}`;
  });
  const approvedProviders = evidence.providerReferences.map(
    (row) => `${row.sourceKind}\0${row.ownerId}\0${row.providerValue}`,
  );
  if (!exactStrings(observedProviders, approvedProviders)) {
    stop("PROVIDER_REFERENCE_NOT_APPROVED_TEST");
  }

  const prohibited = await client.query<CountRow>(`
    SELECT (
      (SELECT count(*) FROM "public"."producers"
       WHERE "stripe_charges_enabled" IS TRUE OR "tranzila_terminal_name" IS NOT NULL)
      + (SELECT count(*) FROM "public"."bookings"
         WHERE "stripe_checkout_session_id" IS NOT NULL)
      + (SELECT count(*) FROM "public"."invoices"
         WHERE "stripe_checkout_session_id" IS NOT NULL
            OR "stripe_payment_intent_id" IS NOT NULL)
      + (SELECT count(*) FROM "public"."projects"
         WHERE "stripe_customer_id" IS NOT NULL
            OR "stripe_payment_method_id" IS NOT NULL
            OR "stripe_subscription_schedule_id" IS NOT NULL)
      + (SELECT count(*) FROM "public"."stripe_customers")
    )::text AS "count"`);
  if (prohibited.rows.length !== 1 || safeCount(prohibited.rows[0]?.count) !== 0) {
    stop("LIVE_PAYMENT_ACTIVITY");
  }

  const protectedEvidence = {
    identities: evidence.identities
      .map((row) =>
        protectValue(
          hmacKey,
          `sk104-identity\0${row.ownerId}\0${row.identityValue}\0${row.classification}\0${String(row.attested)}`,
        ),
      )
      .sort(compareUtf8Bytes),
    monetaryRows: evidence.monetaryRows
      .map((row) =>
        protectValue(
          hmacKey,
          `sk104-monetary\0${row.sourceKind}\0${row.ownerId}\0${row.classification}\0${String(row.attested)}`,
        ),
      )
      .sort(compareUtf8Bytes),
    providerReferences: evidence.providerReferences
      .map((row) =>
        protectValue(
          hmacKey,
          `provider-reference\0${row.sourceKind}\0${row.ownerId}\0${row.providerValue}`,
        ),
      )
      .sort(compareUtf8Bytes),
  };
  return sha256Digest(canonicalJson(protectedEvidence));
}

function privateManifestBody(
  manifest: Sk104PrivateProductionDatabaseManifest,
): PrivateDatabaseManifestBody {
  return {
    contract: manifest.contract,
    sourceSchemaFingerprint: manifest.sourceSchemaFingerprint,
    resetRowsFingerprint: manifest.resetRowsFingerprint,
    preservedRowCountsFingerprint: manifest.preservedRowCountsFingerprint,
    preservedBusinessFingerprint: manifest.preservedBusinessFingerprint,
    storageReferencesFingerprint: manifest.storageReferencesFingerprint,
    mockEvidenceFingerprint: manifest.mockEvidenceFingerprint,
    rows: manifest.rows,
    storageReferences: manifest.storageReferences,
    mockEvidence: manifest.mockEvidence,
  };
}

function bindPrivateManifest(
  body: PrivateDatabaseManifestBody,
  hmacKey: string,
): Sk104PrivateProductionDatabaseManifest {
  return {
    ...body,
    bindingToken: protectValue(
      hmacKey,
      `sk104-private-production-database-manifest\0${canonicalJson(body)}`,
    ),
  };
}

export function assertSk104PrivateProductionDatabaseManifest(
  manifest: Sk104PrivateProductionDatabaseManifest,
  hmacKey: string,
): Sk104PrivateProductionDatabaseManifest {
  const untrustedContract: unknown = manifest.contract;
  if (untrustedContract !== "sk104-private-production-database-manifest-v1") {
    stop("PRIVATE_ENVELOPE_MISMATCH");
  }
  assertProtectedToken(manifest.bindingToken);
  const expected = bindPrivateManifest(privateManifestBody(manifest), hmacKey);
  if (!sameDigest(expected.bindingToken, manifest.bindingToken)) {
    stop("PRIVATE_ENVELOPE_MISMATCH");
  }
  if (
    manifest.rows.length !== SK104_RESET_ROW_COUNT ||
    manifest.storageReferences.length !== SK104_RESET_STORAGE_REFERENCE_COUNT
  ) {
    stop("PRIVATE_ENVELOPE_MISMATCH");
  }
  assertPrivateEvidenceShape(manifest.mockEvidence);
  return manifest;
}

/** Read-only discovery. The returned object is private and must never be logged. */
export async function discoverSk104PrivateProductionDatabaseManifest(
  client: NeonPoolClientLike,
  hmacKey: string,
  mockEvidence: Sk104PrivateMockEvidence,
): Promise<Sk104PrivateProductionDatabaseManifest> {
  if (hmacKey.length < 32) stop("MANIFEST_INPUT_INVALID");
  if ((await classifyDatabaseSchemaState(client)) !== "baseline") {
    stop("DATABASE_VERIFICATION_MISMATCH");
  }
  const sourceSchemaFingerprint = await collectCatalogFingerprint(client);
  const reset = await collectResetRows(client, hmacKey);
  const preserved = await collectPreservedEvidence(client, hmacKey);
  const storage = await collectStorageReferences(client, hmacKey);
  const mockEvidenceFingerprint = await assertExactMockEvidence(client, mockEvidence, hmacKey);
  return bindPrivateManifest(
    {
      contract: "sk104-private-production-database-manifest-v1",
      sourceSchemaFingerprint,
      resetRowsFingerprint: reset.fingerprint,
      preservedRowCountsFingerprint: preserved.rowCountsFingerprint,
      preservedBusinessFingerprint: preserved.businessFingerprint,
      storageReferencesFingerprint: storage.fingerprint,
      mockEvidenceFingerprint,
      rows: reset.rows,
      storageReferences: storage.references,
      mockEvidence,
    },
    hmacKey,
  );
}

function assertPrivateManifestMatchesProductionContract(
  privateManifest: Sk104PrivateProductionDatabaseManifest,
  productionManifest: Sk104ProductionManifest,
): void {
  if (
    !sameDigest(
      privateManifest.sourceSchemaFingerprint,
      productionManifest.sourceSchemaFingerprint,
    ) ||
    !sameDigest(privateManifest.resetRowsFingerprint, productionManifest.resetRowsFingerprint) ||
    !sameDigest(
      privateManifest.preservedRowCountsFingerprint,
      productionManifest.preservedRowCountsFingerprint,
    ) ||
    !sameDigest(
      privateManifest.preservedBusinessFingerprint,
      productionManifest.preservedBusinessFingerprint,
    ) ||
    !sameDigest(
      privateManifest.storageReferencesFingerprint,
      productionManifest.storageReferencesFingerprint,
    ) ||
    !sameDigest(privateManifest.mockEvidenceFingerprint, productionManifest.mockEvidenceFingerprint)
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
}

function baselineStateFingerprint(manifest: Sk104PrivateProductionDatabaseManifest): Sha256Digest {
  return sha256Digest(
    canonicalJson({
      state: "baseline",
      sourceSchemaFingerprint: manifest.sourceSchemaFingerprint,
      resetRowsFingerprint: manifest.resetRowsFingerprint,
      preservedRowCountsFingerprint: manifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: manifest.preservedBusinessFingerprint,
      storageReferencesFingerprint: manifest.storageReferencesFingerprint,
      mockEvidenceFingerprint: manifest.mockEvidenceFingerprint,
    }),
  );
}

function assertHistoricalApproval(
  approval: Sk104CutoverApproval,
  manifest: Sk104ProductionManifest,
  action: "execute" | "restore",
): Sk104CutoverApproval {
  if (approval.action !== action) stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  // Reconciliation and restore verification are read-only. Validate that the
  // approval was genuine and valid when issued without extending its mutation
  // window after a long-running database or network operation.
  return assertSk104CutoverApproval(approval, manifest, approval.approvedAt);
}

type MigrationLedgerRow = Readonly<{ filename: unknown; digest: unknown }>;

async function assertExactMigrationLedger(
  client: NeonPoolClientLike,
  expectedBundleDigest: Sha256Digest,
): Promise<Sha256Digest> {
  assertSha256Digest(expectedBundleDigest);
  const relation = await client.query<Readonly<{ relation: unknown }>>(
    `SELECT to_regclass('skitza_migrations.applied')::text AS "relation"`,
  );
  if (
    relation.rows.length !== 1 ||
    typeof relation.rows[0]?.relation !== "string" ||
    relation.rows[0].relation.length === 0
  ) {
    stop("MIGRATION_DIGEST_MISMATCH");
  }
  const result = await client.query<MigrationLedgerRow>(
    `SELECT "filename", "digest" FROM "skitza_migrations"."applied"
     ORDER BY "filename" COLLATE "C"`,
  );
  if (result.rows.length !== SK104_APPROVED_MIGRATION_FILES.length) {
    stop("MIGRATION_DIGEST_MISMATCH");
  }
  const normalized = result.rows.map((row, index) => {
    const filename = row.filename;
    const digest = row.digest;
    if (
      filename !== SK104_APPROVED_MIGRATION_FILES[index] ||
      typeof digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(digest)
    ) {
      stop("MIGRATION_DIGEST_MISMATCH");
    }
    return { filename, digest };
  });
  // This intentionally mirrors packages/db/apply-migrations.mjs. JSON key
  // insertion order is part of that immutable bundle's digest contract.
  const observedBundleDigest = sha256Digest(JSON.stringify(normalized));
  if (!sameDigest(observedBundleDigest, expectedBundleDigest)) {
    stop("MIGRATION_DIGEST_MISMATCH");
  }
  return observedBundleDigest;
}

async function assertNoMigrationLedger(client: NeonPoolClientLike): Promise<void> {
  const result = await client.query<
    Readonly<{ migration_namespace: unknown; ledger_relation: unknown }>
  >(`SELECT to_regnamespace('skitza_migrations')::text AS "migration_namespace",
      to_regclass('skitza_migrations.applied')::text AS "ledger_relation"`);
  if (result.rows.length !== 1) stop("MIGRATION_DIGEST_MISMATCH");
  const row = result.rows[0];
  if (!row || row.migration_namespace !== null || row.ledger_relation !== null) {
    stop("MIGRATION_DIGEST_MISMATCH");
  }
}

function buildDatabaseReceipt(
  manifest: Sk104ProductionManifest,
  approval: Sk104CutoverApproval,
  privateManifest: Sk104PrivateProductionDatabaseManifest,
  migrationBundleDigest: Sha256Digest,
  postEvidence: Awaited<ReturnType<typeof collectPostResetDatabaseEvidence>>,
): Sk104ProductionDatabaseReceipt {
  return {
    contract: "sk104-production-database-receipt-v1",
    manifestDigest: manifest.digest,
    approvalDigest: approval.digest,
    migrationBundleDigest,
    deletedRowCount: SK104_RESET_ROW_COUNT,
    sourceSchemaFingerprint: privateManifest.sourceSchemaFingerprint,
    targetSchemaFingerprint: postEvidence.schemaFingerprint,
    preservedRowCountsFingerprint: postEvidence.preserved.rowCountsFingerprint,
    preservedBusinessFingerprint: postEvidence.preserved.businessFingerprint,
    databaseStateFingerprint: sha256Digest(canonicalJson(postEvidence)),
    committed: true,
  };
}

function freshClient(
  client: NeonPoolClientLike,
  assertFresh: MutationFreshnessCheck,
): NeonPoolClientLike {
  return {
    query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      parameters?: readonly unknown[],
    ): Promise<PgQueryResult<Row>> => {
      assertFresh();
      return client.query<Row>(statement, parameters);
    },
    release: () => {
      client.release();
    },
  };
}

function expectedIdsByTable(rows: readonly Sk104PrivateResetRow[]): Map<ResetTable, string[]> {
  const result = new Map<ResetTable, string[]>(
    SK104_RESET_INVENTORY.map((entry) => [entry.table, []]),
  );
  for (const row of rows) {
    const ids = result.get(row.table);
    privateUuid(row.id);
    if (!ids || ids.includes(row.id)) stop("PRIVATE_ENVELOPE_MISMATCH");
    ids.push(row.id);
  }
  for (const inventory of SK104_RESET_INVENTORY) {
    if (result.get(inventory.table)?.length !== inventory.count) {
      stop("PRIVATE_ENVELOPE_MISMATCH");
    }
  }
  return result;
}

async function stageProviderEvidence(
  client: NeonPoolClientLike,
  evidence: readonly Sk104PrivateProviderEvidence[],
  manifest: Sk104ProductionManifest,
  approval: Sk104CutoverApproval,
  assertFresh: MutationFreshnessCheck,
): Promise<void> {
  assertFresh();
  await client.query(
    `SELECT set_config('skitza.sk90_artifact_digest', $1, true),
      set_config('skitza.sk90_manifest_digest', $2, true),
      set_config('skitza.sk90_policy_digest', $3, true),
      set_config('skitza.sk90_provider_challenge', $4, true)`,
    [
      manifest.digest,
      manifest.digest,
      manifest.target.policyDigest,
      approval.approvalChallengeToken,
    ],
  );
  assertFresh();
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
    assertFresh();
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
        manifest.digest,
        manifest.digest,
        manifest.target.policyDigest,
        approval.approvalChallengeToken,
      ],
    );
  }
}

async function breakResetCycles(
  client: NeonPoolClientLike,
  ids: ReadonlyMap<ResetTable, readonly string[]>,
  assertFresh: MutationFreshnessCheck,
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
    assertFresh();
    await client.query(statement, [ids.get(table) ?? []]);
  }
}

async function deleteExactRows(
  client: NeonPoolClientLike,
  ids: ReadonlyMap<ResetTable, readonly string[]>,
  assertFresh: MutationFreshnessCheck,
): Promise<typeof SK104_RESET_ROW_COUNT> {
  let deleted = 0;
  for (const table of DELETE_ORDER) {
    const expected = ids.get(table) ?? [];
    assertFresh();
    if (table === "stripe_customers") {
      const result = await client.query(`DELETE FROM "public"."stripe_customers" WHERE FALSE`);
      if ((result.rowCount ?? 0) !== 0 || expected.length !== 0) stop("FINAL_DRIFT_DETECTED");
      continue;
    }
    const result = await client.query<Readonly<{ identity: unknown }>>(
      `DELETE FROM "public"."${table}" WHERE "id" = ANY($1::uuid[]) RETURNING "id"::text AS "identity"`,
      [expected],
    );
    const returned = result.rows.map((row) => privateUuid(row.identity));
    if (!exactStrings(returned, expected)) stop("FINAL_DRIFT_DETECTED");
    deleted += returned.length;
  }
  if (deleted !== SK104_RESET_ROW_COUNT) stop("FINAL_DRIFT_DETECTED");
  for (const inventory of SK104_RESET_INVENTORY) {
    const result = await client.query<CountRow>(
      `SELECT count(*)::text AS "count" FROM "public"."${inventory.table}"`,
    );
    if (result.rows.length !== 1 || safeCount(result.rows[0]?.count) !== 0) {
      stop("FINAL_DRIFT_DETECTED");
    }
  }
  return SK104_RESET_ROW_COUNT;
}

async function assertConcurrentWriteBlocked(pool: NeonPoolLike, statement: string): Promise<void> {
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

async function assertConcurrentWriteStop(pool: NeonPoolLike): Promise<void> {
  await assertConcurrentWriteBlocked(
    pool,
    `INSERT INTO "public"."notifications" ("producer_id", "kind", "title", "body") SELECT "id", 'comment_created', 'sk104-probe', '' FROM "public"."producers" ORDER BY "id" LIMIT 1`,
  );
  await assertConcurrentWriteBlocked(
    pool,
    `UPDATE "public"."products" SET "position" = "position" WHERE "id" = (SELECT "id" FROM "public"."products" ORDER BY "id" LIMIT 1)`,
  );
}

function observationDigest(observation: ProductionTargetObservation): Sha256Digest {
  return sha256Digest(canonicalJson(observation));
}

function migrationBinding(
  manifest: Sk104ProductionManifest,
  approval: Sk104CutoverApproval,
  target: ProductionTargetObservation,
): Sk104ProductionMigrationBinding {
  return {
    artifactDigest: manifest.digest,
    manifestDigest: manifest.digest,
    policyDigest: manifest.target.policyDigest,
    targetDatabaseFingerprint: target.databaseFingerprint,
    canonicalProductionTargetDatabaseFingerprint: manifest.target.approvedDatabaseFingerprint,
    targetObservationDigest: observationDigest(target),
    executionApprovalDigest: approval.executionPlanDigest,
    freshAuthorizationDigest: approval.digest,
    migrationBundleDigest: approval.migrationBundleDigest,
    actionChallengeToken: approval.approvalChallengeToken,
  };
}

async function assertPostCutover(
  client: NeonPoolClientLike,
  evidence: Awaited<ReturnType<typeof collectPostResetDatabaseEvidence>>,
  manifest: Sk104ProductionManifest,
): Promise<void> {
  if (
    !sameDigest(evidence.schemaFingerprint, manifest.targetSchemaFingerprint) ||
    evidence.resetRowCount !== 0 ||
    !sameDigest(evidence.preserved.rowCountsFingerprint, manifest.preservedRowCountsFingerprint) ||
    !sameDigest(evidence.preserved.businessFingerprint, manifest.preservedBusinessFingerprint) ||
    evidence.foreignKeyViolationCount !== 0 ||
    evidence.orphanRowCount !== 0 ||
    evidence.ownershipViolationCount !== 0 ||
    evidence.prohibitedLegacyRowCount !== 0 ||
    evidence.syntheticPurchaseCount !== 0
  ) {
    stop("POST_RESET_INTEGRITY_MISMATCH");
  }
  for (const table of SK104_POST_CUTOVER_EMPTY_TABLES) {
    const result = await client.query<CountRow>(
      `SELECT count(*)::text AS "count" FROM "public"."${table}"`,
    );
    if (result.rows.length !== 1 || safeCount(result.rows[0]?.count) !== 0) {
      stop("POST_RESET_INTEGRITY_MISMATCH");
    }
  }
}

type ExactDatabaseStateObservation =
  | Readonly<{
      state: "baseline";
      observedManifest: Sk104PrivateProductionDatabaseManifest;
      databaseStateFingerprint: Sha256Digest;
    }>
  | Readonly<{
      state: "post";
      postEvidence: Awaited<ReturnType<typeof collectPostResetDatabaseEvidence>>;
      migrationBundleDigest: Sha256Digest;
      databaseStateFingerprint: Sha256Digest;
    }>
  | Readonly<{ state: "mixed" }>;

async function observeExactDatabaseStateOnClient(
  client: NeonPoolClientLike,
  input: Readonly<{
    manifest: Sk104ProductionManifest;
    privateManifest: Sk104PrivateProductionDatabaseManifest;
    hmacKey: string;
    expectedMigrationBundleDigest: Sha256Digest;
  }>,
): Promise<ExactDatabaseStateObservation> {
  const markerState = await classifyDatabaseSchemaState(client);
  if (markerState === "mixed") return { state: "mixed" };
  try {
    if (markerState === "baseline") {
      await assertNoMigrationLedger(client);
      const observedManifest = await discoverSk104PrivateProductionDatabaseManifest(
        client,
        input.hmacKey,
        input.privateManifest.mockEvidence,
      );
      if (!sameDigest(observedManifest.bindingToken, input.privateManifest.bindingToken)) {
        return { state: "mixed" };
      }
      assertPrivateManifestMatchesProductionContract(observedManifest, input.manifest);
      return {
        state: "baseline",
        observedManifest,
        databaseStateFingerprint: baselineStateFingerprint(observedManifest),
      };
    }

    const postEvidence = await collectPostResetDatabaseEvidence(client, input.hmacKey);
    await assertPostCutover(client, postEvidence, input.manifest);
    const migrationBundleDigest = await assertExactMigrationLedger(
      client,
      input.expectedMigrationBundleDigest,
    );
    return {
      state: "post",
      postEvidence,
      migrationBundleDigest,
      databaseStateFingerprint: sha256Digest(canonicalJson(postEvidence)),
    };
  } catch (error) {
    // A successfully queried target that is neither the exact approved
    // baseline nor the exact approved post-state is an explicit mixed state.
    // Unknown transport/runtime errors still fail closed instead of being
    // misreported as data drift.
    if (error instanceof Sk90ResetSafetyError) return { state: "mixed" };
    throw error;
  }
}

async function connect(pool: NeonPoolLike): Promise<NeonPoolClientLike> {
  try {
    return await pool.connect();
  } catch {
    return stop("UNEXPECTED_FAILURE");
  }
}

export class Sk104ProductionDatabaseAdapter {
  constructor(
    private readonly transactionPool: NeonPoolLike,
    private readonly concurrentProbePool: NeonPoolLike,
    private readonly leasePool: NeonPoolLike,
    private readonly now: () => Date,
    private readonly snapshotContext: Sk104VerifiedSnapshotContext | null = null,
  ) {}

  /**
   * Hold one crash-released PostgreSQL session lease across every external
   * cutover mutation. A second runner fails immediately instead of entering
   * an already-started durable phase.
   */
  async withExclusiveRunLease<Result>(
    input: Readonly<{
      approvedDatabaseFingerprint: Sha256Digest;
      forbiddenDatabaseFingerprint: Sha256Digest;
      parentProofAdvisoryLockKey: string;
    }>,
    operation: (lease: Readonly<{ parentProofAdvisoryLockKey: string }>) => Promise<Result>,
  ): Promise<Result> {
    assertSha256Digest(input.approvedDatabaseFingerprint);
    assertSha256Digest(input.forbiddenDatabaseFingerprint);
    const parentProofAdvisoryLockKey = assertRunLeaseProofKey(input.parentProofAdvisoryLockKey);
    const client = await connect(this.leasePool);
    let globalLeaseAcquired = false;
    let childProbeAcquired = false;
    let parentProofAcquired = false;
    const tryAcquire = async (key: string): Promise<boolean> => {
      const result = await client.query<Readonly<{ acquired: unknown }>>(
        "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
        [key],
      );
      return result.rows.length === 1 && result.rows[0]?.acquired === true;
    };
    const release = async (key: string): Promise<boolean> => {
      const result = await client.query<Readonly<{ released: unknown }>>(
        "SELECT pg_advisory_unlock($1::bigint) AS released",
        [key],
      );
      return result.rows.length === 1 && result.rows[0]?.released === true;
    };
    try {
      assertCanonicalProductionTarget(await observeProductionDatabaseTarget(client), {
        targetClass: "canonical_production",
        approvedDatabaseFingerprint: input.approvedDatabaseFingerprint,
        forbiddenDatabaseFingerprint: input.forbiddenDatabaseFingerprint,
      });
      globalLeaseAcquired = await tryAcquire(SK104_RUN_LEASE_ADVISORY_LOCK_KEY);
      if (!globalLeaseAcquired) stop("LOCK_CONTRACT_INVALID");

      // A child psql can outlive a killed parent. Probe its fixed session lock
      // before admitting a new runner, then release the probe immediately.
      childProbeAcquired = await tryAcquire(SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY);
      if (!childProbeAcquired) stop("LOCK_CONTRACT_INVALID");
      if (!(await release(SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY))) {
        stop("LOCK_CONTRACT_INVALID");
      }
      childProbeAcquired = false;

      parentProofAcquired = await tryAcquire(parentProofAdvisoryLockKey);
      if (!parentProofAcquired) stop("LOCK_CONTRACT_INVALID");
      return await operation({ parentProofAdvisoryLockKey });
    } catch (error) {
      if (error instanceof Sk90ResetSafetyError || error instanceof Sk104CutoverSafetyError) {
        throw error;
      }
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      let cleanupFailed = false;
      try {
        if (childProbeAcquired) {
          try {
            cleanupFailed = !(await release(SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY));
          } catch {
            cleanupFailed = true;
          }
        }
        if (parentProofAcquired) {
          try {
            cleanupFailed = !(await release(parentProofAdvisoryLockKey)) || cleanupFailed;
          } catch {
            cleanupFailed = true;
          }
        }
        if (globalLeaseAcquired) {
          try {
            cleanupFailed = !(await release(SK104_RUN_LEASE_ADVISORY_LOCK_KEY)) || cleanupFailed;
          } catch {
            cleanupFailed = true;
          }
        }
      } finally {
        client.release();
      }
      if (cleanupFailed) stop("LOCK_CONTRACT_INVALID");
    }
  }

  /** Read-only canonical baseline inspection driven by the operator's exact mock/test attestation. */
  async inspectAttestedBaseline(
    input: Readonly<{
      approvedDatabaseFingerprint: Sha256Digest;
      forbiddenDatabaseFingerprint: Sha256Digest;
      hmacKey: string;
      operatorAttestedAllMockTest: true;
    }>,
  ): Promise<Sk104PrivateProductionDatabaseManifest> {
    assertSha256Digest(input.approvedDatabaseFingerprint);
    assertSha256Digest(input.forbiddenDatabaseFingerprint);
    const client = await connect(this.transactionPool);
    let transactionOpen = false;
    try {
      assertCanonicalProductionTarget(await observeProductionDatabaseTarget(client), {
        targetClass: "canonical_production",
        approvedDatabaseFingerprint: input.approvedDatabaseFingerprint,
        forbiddenDatabaseFingerprint: input.forbiddenDatabaseFingerprint,
      });
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionOpen = true;
      const evidence = await discoverSk104AttestedMockEvidence(
        client,
        input.operatorAttestedAllMockTest,
      );
      const manifest = await discoverSk104PrivateProductionDatabaseManifest(
        client,
        input.hmacKey,
        evidence,
      );
      await client.query("ROLLBACK");
      transactionOpen = false;
      return manifest;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the first sanitized failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError || error instanceof Sk104CutoverSafetyError) {
        throw error;
      }
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      client.release();
    }
  }

  private async withCanonicalReadOnlyTransaction<Result>(
    manifest: Sk104ProductionManifest,
    operation: (client: NeonPoolClientLike) => Promise<Result>,
  ): Promise<Result> {
    const client = await connect(this.transactionPool);
    let transactionOpen = false;
    try {
      // Observe the provider identity on the same physical connection before
      // entering read-only mode (the shared target observer intentionally
      // rejects transaction_read_only=on).
      assertCanonicalProductionTarget(await observeProductionDatabaseTarget(client), {
        targetClass: "canonical_production",
        approvedDatabaseFingerprint: manifest.target.approvedDatabaseFingerprint,
        forbiddenDatabaseFingerprint: manifest.target.forbiddenDatabaseFingerprint,
      });
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionOpen = true;
      const result = await operation(client);
      await client.query("ROLLBACK");
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original sanitized failure.
        }
      }
      if (error instanceof Sk90ResetSafetyError || error instanceof Sk104CutoverSafetyError) {
        throw error;
      }
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      client.release();
    }
  }

  async withVerifiedExportedSnapshot<Result>(
    useSnapshot: (snapshot: string) => Promise<Result>,
  ): Promise<Result>;
  async withVerifiedExportedSnapshot<Result>(
    context: Sk104VerifiedSnapshotContext,
    useSnapshot: (snapshot: string) => Promise<Result>,
  ): Promise<Result>;
  async withVerifiedExportedSnapshot<Result>(
    contextOrUseSnapshot: Sk104VerifiedSnapshotContext | ((snapshot: string) => Promise<Result>),
    explicitUseSnapshot?: (snapshot: string) => Promise<Result>,
  ): Promise<Result> {
    const context =
      typeof contextOrUseSnapshot === "function" ? this.snapshotContext : contextOrUseSnapshot;
    const useSnapshot =
      typeof contextOrUseSnapshot === "function" ? contextOrUseSnapshot : explicitUseSnapshot;
    if (context === null || typeof useSnapshot !== "function") {
      stop("ARTIFACT_BINDING_MISMATCH");
    }
    const manifest = assertSk104ProductionManifest(context.manifest);
    const privateManifest = assertSk104PrivateProductionDatabaseManifest(
      context.privateManifest,
      context.hmacKey,
    );
    assertPrivateManifestMatchesProductionContract(privateManifest, manifest);

    return this.withCanonicalReadOnlyTransaction(manifest, async (client) => {
      await assertNoMigrationLedger(client);
      const observed = await discoverSk104PrivateProductionDatabaseManifest(
        client,
        context.hmacKey,
        privateManifest.mockEvidence,
      );
      if (!sameDigest(observed.bindingToken, privateManifest.bindingToken)) {
        stop("FINAL_DRIFT_DETECTED");
      }
      assertPrivateManifestMatchesProductionContract(observed, manifest);
      const snapshotResult = await client.query<Readonly<{ snapshot: unknown }>>(
        `SELECT pg_export_snapshot() AS "snapshot"`,
      );
      if (snapshotResult.rows.length !== 1) stop("DATABASE_VERIFICATION_MISMATCH");
      const snapshot = privateText(snapshotResult.rows[0]?.snapshot);
      // Awaiting here keeps the exporting transaction and its connection open
      // until pg_dump has finished importing the snapshot.
      return useSnapshot(snapshot);
    });
  }

  async observeState(
    input: Readonly<
      Sk104VerifiedSnapshotContext & {
        expectedMigrationBundleDigest: Sha256Digest;
      }
    >,
  ): Promise<Sk104ProductionDatabaseStateObservation> {
    const manifest = assertSk104ProductionManifest(input.manifest);
    const privateManifest = assertSk104PrivateProductionDatabaseManifest(
      input.privateManifest,
      input.hmacKey,
    );
    assertPrivateManifestMatchesProductionContract(privateManifest, manifest);
    assertSha256Digest(input.expectedMigrationBundleDigest);
    const observation = await this.withCanonicalReadOnlyTransaction(manifest, (client) =>
      observeExactDatabaseStateOnClient(client, {
        manifest,
        privateManifest,
        hmacKey: input.hmacKey,
        expectedMigrationBundleDigest: input.expectedMigrationBundleDigest,
      }),
    );
    if (observation.state === "baseline") {
      return {
        state: "baseline",
        databaseStateFingerprint: observation.databaseStateFingerprint,
      };
    }
    if (observation.state === "post") {
      return {
        state: "post",
        migrationBundleDigest: observation.migrationBundleDigest,
        databaseStateFingerprint: observation.databaseStateFingerprint,
      };
    }
    return { state: "mixed" };
  }

  /**
   * Recover only the response lost after COMMIT. This path is read-only: it
   * never repeats a migration, UPDATE, or DELETE and succeeds only for the
   * exact approved post-state and exact immutable migration ledger.
   */
  async reconcileCommitted(
    input: Readonly<
      Sk104VerifiedSnapshotContext & {
        approval: Sk104CutoverApproval;
      }
    >,
  ): Promise<Sk104ProductionDatabaseReceipt> {
    const manifest = assertSk104ProductionManifest(input.manifest);
    const approval = assertHistoricalApproval(input.approval, manifest, "execute");
    const privateManifest = assertSk104PrivateProductionDatabaseManifest(
      input.privateManifest,
      input.hmacKey,
    );
    assertPrivateManifestMatchesProductionContract(privateManifest, manifest);
    const observation = await this.withCanonicalReadOnlyTransaction(manifest, (client) =>
      observeExactDatabaseStateOnClient(client, {
        manifest,
        privateManifest,
        hmacKey: input.hmacKey,
        expectedMigrationBundleDigest: approval.migrationBundleDigest,
      }),
    );
    if (observation.state !== "post") stop("PHASE_STATE_INVALID");
    return buildDatabaseReceipt(
      manifest,
      approval,
      privateManifest,
      observation.migrationBundleDigest,
      observation.postEvidence,
    );
  }

  async verifyRestoredBaseline(
    input: Readonly<
      Sk104VerifiedSnapshotContext & {
        approval: Sk104CutoverApproval;
      }
    >,
  ): Promise<Sk104RestoredBaselineReceipt> {
    const manifest = assertSk104ProductionManifest(input.manifest);
    const approval = assertHistoricalApproval(input.approval, manifest, "restore");
    const privateManifest = assertSk104PrivateProductionDatabaseManifest(
      input.privateManifest,
      input.hmacKey,
    );
    assertPrivateManifestMatchesProductionContract(privateManifest, manifest);
    const observation = await this.withCanonicalReadOnlyTransaction(manifest, (client) =>
      observeExactDatabaseStateOnClient(client, {
        manifest,
        privateManifest,
        hmacKey: input.hmacKey,
        expectedMigrationBundleDigest: approval.migrationBundleDigest,
      }),
    );
    if (observation.state !== "baseline") stop("RESTORE_PROOF_MISMATCH");
    return {
      contract: "sk104-restored-baseline-receipt-v1",
      manifestDigest: manifest.digest,
      approvalDigest: approval.digest,
      sourceSchemaFingerprint: observation.observedManifest.sourceSchemaFingerprint,
      resetRowsFingerprint: observation.observedManifest.resetRowsFingerprint,
      preservedRowCountsFingerprint: observation.observedManifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: observation.observedManifest.preservedBusinessFingerprint,
      storageReferencesFingerprint: observation.observedManifest.storageReferencesFingerprint,
      databaseStateFingerprint: observation.databaseStateFingerprint,
      verified: true,
    };
  }

  async execute(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      approval: Sk104CutoverApproval;
      privateManifest: Sk104PrivateProductionDatabaseManifest;
      hmacKey: string;
      migration: Sk104ProductionMigrationTransactionPort;
    }>,
  ): Promise<Sk104ProductionDatabaseReceipt> {
    const manifest = assertSk104ProductionManifest(input.manifest);
    if (input.approval.action !== "execute") {
      stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    }
    const privateManifest = assertSk104PrivateProductionDatabaseManifest(
      input.privateManifest,
      input.hmacKey,
    );
    assertPrivateManifestMatchesProductionContract(privateManifest, manifest);
    if (
      !exactMigrationFiles(input.migration.filenames) ||
      !sameDigest(input.migration.bundleDigest, input.approval.migrationBundleDigest)
    ) {
      stop("MIGRATION_DIGEST_MISMATCH");
    }
    const assertFresh = (): void => {
      const current = this.now();
      if (!Number.isFinite(current.getTime())) stop("FRESHNESS_PROOF_INVALID");
      assertSk104CutoverApproval(input.approval, manifest, current.toISOString());
    };
    assertFresh();

    const expectedIds = expectedIdsByTable(privateManifest.rows);
    const client = await connect(this.transactionPool);
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK90_MIGRATION_ADVISORY_LOCK_KEY,
      ]);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        SK104_DATABASE_ADVISORY_LOCK_KEY,
      ]);
      if ((await classifyDatabaseSchemaState(client)) !== "baseline") {
        stop("DATABASE_VERIFICATION_MISMATCH");
      }
      await client.query(
        `LOCK TABLE ${SK104_REQUIRED_LOCK_TABLES.map((table) => `"public"."${table}"`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`,
      );

      const target = assertCanonicalProductionTarget(
        await observeProductionDatabaseTarget(client),
        {
          targetClass: "canonical_production",
          approvedDatabaseFingerprint: manifest.target.approvedDatabaseFingerprint,
          forbiddenDatabaseFingerprint: manifest.target.forbiddenDatabaseFingerprint,
        },
      );
      const observed = await discoverSk104PrivateProductionDatabaseManifest(
        client,
        input.hmacKey,
        privateManifest.mockEvidence,
      );
      if (!sameDigest(observed.bindingToken, privateManifest.bindingToken)) {
        stop("FINAL_DRIFT_DETECTED");
      }
      assertPrivateManifestMatchesProductionContract(observed, manifest);
      assertFresh();
      await assertConcurrentWriteStop(this.concurrentProbePool);
      await stageProviderEvidence(
        client,
        privateManifest.mockEvidence.providerReferences,
        manifest,
        input.approval,
        assertFresh,
      );
      await breakResetCycles(client, expectedIds, assertFresh);
      await deleteExactRows(client, expectedIds, assertFresh);

      assertFresh();
      const boundClient = freshClient(client, assertFresh);
      await input.migration.applyApprovedBundleInTransaction(
        boundClient,
        migrationBinding(manifest, input.approval, target),
      );
      const targetAfterMigration = assertCanonicalProductionTarget(
        await observeProductionDatabaseTarget(boundClient),
        {
          targetClass: "canonical_production",
          approvedDatabaseFingerprint: manifest.target.approvedDatabaseFingerprint,
          forbiddenDatabaseFingerprint: manifest.target.forbiddenDatabaseFingerprint,
        },
      );
      if (!sameDigest(target.databaseFingerprint, targetAfterMigration.databaseFingerprint)) {
        stop("DATABASE_TARGET_MISMATCH");
      }
      const postEvidence = await collectPostResetDatabaseEvidence(boundClient, input.hmacKey);
      await assertPostCutover(boundClient, postEvidence, manifest);
      const migrationBundleDigest = await assertExactMigrationLedger(
        boundClient,
        input.migration.bundleDigest,
      );
      const receipt = buildDatabaseReceipt(
        manifest,
        input.approval,
        privateManifest,
        migrationBundleDigest,
        postEvidence,
      );
      assertFresh();
      await client.query("COMMIT");
      transactionOpen = false;
      return receipt;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The first sanitized failure remains authoritative.
        }
      }
      if (error instanceof Sk90ResetSafetyError || error instanceof Sk104CutoverSafetyError) {
        throw error;
      }
      throw new Sk90ResetSafetyError("UNEXPECTED_FAILURE");
    } finally {
      client.release();
    }
  }
}
