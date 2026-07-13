#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { neonConfig, Pool } from "@neondatabase/serverless";
import WebSocket from "ws";

neonConfig.webSocketConstructor = WebSocket;

export const CURRENT_TABLES = [
  "producers",
  "products",
  "client_contacts",
  "portfolio_tracks",
  "availability_blocks",
  "availability_blackouts",
  "producer_external_links",
  "producer_notes",
  "projects",
  "project_tracks",
  "bookings",
  "track_versions",
  "track_comments",
  "purchase_requests",
  "payment_proofs",
  "agreement_acceptances",
  "stripe_customers",
  "invoices",
  "notifications",
];

export const LEGACY_TABLES = [
  "contracts",
  "contract_events",
  "contract_fields",
  "contract_recipients",
  "magic_links",
  "magic_link_views",
  "waitlist",
  "leads",
  "packages",
  "store_purchase_intents",
];

const INSERT_ORDER = [
  "producers",
  "products",
  "client_contacts",
  "portfolio_tracks",
  "availability_blocks",
  "availability_blackouts",
  "producer_external_links",
  "producer_notes",
  "projects",
  "project_tracks",
  "bookings",
  "track_versions",
  "track_comments",
  "purchase_requests",
  "payment_proofs",
  "agreement_acceptances",
  "stripe_customers",
  "invoices",
  "notifications",
];

const BOOKING_STATUSES = new Set([
  "pending_approval",
  "pending_payment",
  "confirmed",
  "rejected",
  "cancelled",
]);

const PROJECT_STAGES = new Set([
  "lead",
  "booked",
  "in_production",
  "final_review",
  "paid",
  "archived",
]);

const ENV = {
  sourceUrl: "SKITZA_CONSOLIDATION_SOURCE_DATABASE_URL",
  targetUrl: "SKITZA_CONSOLIDATION_TARGET_DATABASE_URL",
  sourceProjectId: "SKITZA_CONSOLIDATION_SOURCE_PROJECT_ID",
  sourceBranchId: "SKITZA_CONSOLIDATION_SOURCE_BRANCH_ID",
  targetProjectId: "SKITZA_CONSOLIDATION_TARGET_PROJECT_ID",
  targetBranchId: "SKITZA_CONSOLIDATION_TARGET_BRANCH_ID",
  snapshotTimestamp: "SKITZA_CONSOLIDATION_SNAPSHOT_TIMESTAMP",
  metadataFile: "SKITZA_CONSOLIDATION_NEON_METADATA_FILE",
  approvedDigest: "SKITZA_CONSOLIDATION_APPROVED_MANIFEST_DIGEST",
  expectedSourceDigest: "SKITZA_CONSOLIDATION_EXPECTED_SOURCE_DIGEST",
  expectedTargetDigest: "SKITZA_CONSOLIDATION_EXPECTED_TARGET_DIGEST",
  productionSourceOriginUrl: "SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_ORIGIN_DATABASE_URL",
  productionSourceOriginBranchId: "SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_ORIGIN_BRANCH_ID",
  productionSourceSnapshotUrl: "SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_SNAPSHOT_DATABASE_URL",
  productionSourceSnapshotBranchId: "SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_SNAPSHOT_BRANCH_ID",
  productionTargetUrl: "SKITZA_CONSOLIDATION_PRODUCTION_TARGET_DATABASE_URL",
  productionTargetBranchId: "SKITZA_CONSOLIDATION_PRODUCTION_TARGET_BRANCH_ID",
  productionTargetRestoreUrl: "SKITZA_CONSOLIDATION_PRODUCTION_TARGET_RESTORE_DATABASE_URL",
  productionTargetRestoreBranchId: "SKITZA_CONSOLIDATION_PRODUCTION_TARGET_RESTORE_BRANCH_ID",
  productionTargetSnapshotId: "SKITZA_CONSOLIDATION_PRODUCTION_TARGET_SNAPSHOT_ID",
  productionTargetSnapshotPreviewUrl:
    "SKITZA_CONSOLIDATION_PRODUCTION_TARGET_SNAPSHOT_PREVIEW_DATABASE_URL",
  productionTargetSnapshotPreviewBranchId:
    "SKITZA_CONSOLIDATION_PRODUCTION_TARGET_SNAPSHOT_PREVIEW_BRANCH_ID",
  productionRunId: "SKITZA_CONSOLIDATION_PRODUCTION_RUN_ID",
  freezeAttestationFile: "SKITZA_CONSOLIDATION_FREEZE_ATTESTATION_FILE",
  approvedProductionDigest: "SKITZA_CONSOLIDATION_APPROVED_PRODUCTION_MANIFEST_DIGEST",
  productionConfirmation: "SKITZA_CONSOLIDATION_PRODUCTION_CONFIRMATION",
  expectedProductionTargetDigest: "SKITZA_CONSOLIDATION_EXPECTED_PRODUCTION_TARGET_DIGEST",
  productionSourceNeonApiKey: "SKITZA_CONSOLIDATION_PRODUCTION_SOURCE_NEON_API_KEY",
  productionTargetNeonApiKey: "SKITZA_CONSOLIDATION_PRODUCTION_TARGET_NEON_API_KEY",
};

const CANONICAL_TARGET_PROJECT_ID = "raspy-pine-96654399";
const CANONICAL_SOURCE_PROJECT_ID = "quiet-sun-92221754";
const EXPECTED_DATABASE_NAME = "neondb";
const PRODUCTION_SAFETY_WINDOW_MS = 30 * 60 * 1000;
const UNKNOWN_COMMIT_OUTCOME_CODE = "SKITZA_PRODUCTION_COMMIT_OUTCOME_UNKNOWN";
const COMPLETE_FINGERPRINT_VERSION = 2;
const REQUIRED_FROZEN_WRITERS = [
  "background_workers",
  "clerk_webhooks",
  "manual_database_changes",
  "payment_webhooks",
  "scheduled_jobs",
  "web_mutations",
];

// Columns from deliberately removed systems may never be projected into the
// active schema. Any other populated source-only column is a hard stop.
const ALLOWED_REMOVED_SOURCE_COLUMNS = new Set([
  "projects.share_token",
  "projects.share_token_hash",
  "track_versions.status",
]);

const REQUIRED_FOREIGN_KEYS = [
  ["products", ["producer_id"], "producers", ["id"]],
  ["client_contacts", ["producer_id"], "producers", ["id"]],
  ["portfolio_tracks", ["producer_id"], "producers", ["id"]],
  ["availability_blocks", ["producer_id"], "producers", ["id"]],
  ["availability_blackouts", ["producer_id"], "producers", ["id"]],
  ["producer_external_links", ["producer_id"], "producers", ["id"]],
  ["producer_notes", ["producer_id"], "producers", ["id"]],
  ["projects", ["producer_id"], "producers", ["id"]],
  ["projects", ["booking_id"], "bookings", ["id"]],
  ["projects", ["product_id"], "products", ["id"]],
  ["project_tracks", ["project_id"], "projects", ["id"]],
  ["bookings", ["producer_id"], "producers", ["id"]],
  ["bookings", ["product_id"], "products", ["id"]],
  ["bookings", ["project_id"], "projects", ["id"]],
  ["bookings", ["song_id"], "project_tracks", ["id"]],
  ["track_versions", ["track_id"], "project_tracks", ["id"]],
  ["track_comments", ["version_id"], "track_versions", ["id"]],
  ["purchase_requests", ["producer_id"], "producers", ["id"]],
  ["purchase_requests", ["client_contact_id"], "client_contacts", ["id"]],
  ["purchase_requests", ["product_id"], "products", ["id"]],
  ["purchase_requests", ["project_id"], "projects", ["id"]],
  ["purchase_requests", ["booking_id"], "bookings", ["id"]],
  ["payment_proofs", ["purchase_request_id"], "purchase_requests", ["id"]],
  ["payment_proofs", ["producer_id"], "producers", ["id"]],
  ["payment_proofs", ["project_id"], "projects", ["id"]],
  ["agreement_acceptances", ["purchase_request_id"], "purchase_requests", ["id"]],
  ["agreement_acceptances", ["producer_id"], "producers", ["id"]],
  ["agreement_acceptances", ["client_contact_id"], "client_contacts", ["id"]],
  ["stripe_customers", ["producer_id"], "producers", ["id"]],
  ["stripe_customers", ["client_contact_id"], "client_contacts", ["id"]],
  ["invoices", ["producer_id"], "producers", ["id"]],
  ["invoices", ["project_id"], "projects", ["id"]],
  ["invoices", ["booking_id"], "bookings", ["id"]],
  ["invoices", ["payment_plan_project_id"], "projects", ["id"]],
  ["invoices", ["purchase_request_id"], "purchase_requests", ["id"]],
  ["invoices", ["payment_proof_id"], "payment_proofs", ["id"]],
  ["notifications", ["producer_id"], "producers", ["id"]],
  ["notifications", ["project_id"], "projects", ["id"]],
  ["notifications", ["track_version_id"], "track_versions", ["id"]],
  ["notifications", ["comment_id"], "track_comments", ["id"]],
  ["notifications", ["booking_id"], "bookings", ["id"]],
  ["notifications", ["purchase_request_id"], "purchase_requests", ["id"]],
];

const REQUIRED_UNIQUE_CONSTRAINTS = [
  ["producers", ["clerk_user_id"]],
  ["producers", ["slug"]],
  ["client_contacts", ["producer_id", "email_hash"]],
  ["producer_external_links", ["producer_id", "platform"]],
  ["projects", ["invite_token"]],
  ["purchase_requests", ["ref_number"]],
  ["payment_proofs", ["storage_key"]],
  ["agreement_acceptances", ["purchase_request_id"]],
  ["stripe_customers", ["producer_id", "client_contact_id"]],
];

const REQUIRED_UNIQUE_INDEX_NAMES = new Map([
  ["invoices_stripe_payment_intent_unique", "invoices"],
  ["invoices_payment_proof_unique", "invoices"],
  ["payment_proofs_one_pending_per_request", "payment_proofs"],
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function manifestDigest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalObjectSetFingerprint(rows) {
  const objectDigests = rows.map((row) => manifestDigest(row)).sort();
  return {
    count: objectDigests.length,
    digest: manifestDigest(objectDigests),
  };
}

function exactRowSetFingerprint(rowTexts) {
  const rowDigests = rowTexts.map((rowText) => sha256Bytes(rowText)).sort();
  return {
    count: rowDigests.length,
    rowDigests,
    digest: manifestDigest(rowDigests),
  };
}

function sortedEntries(value) {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value ?? {});
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

export function buildCompleteDatabaseFingerprint({
  schemaObjects,
  baseTableRows,
  materializedViewRows = {},
  sequenceStates = [],
}) {
  const objectSets = Object.fromEntries(
    sortedEntries(schemaObjects).map(([category, rows]) => [
      category,
      canonicalObjectSetFingerprint(rows),
    ]),
  );
  const schemaContract = {
    algorithm: "sha256-canonical-public-schema-objects-v2",
    objectSets,
  };
  const schema = { ...schemaContract, digest: manifestDigest(schemaContract) };

  const tables = Object.fromEntries(
    sortedEntries(baseTableRows).map(([table, rowTexts]) => [
      table,
      exactRowSetFingerprint(rowTexts),
    ]),
  );
  const materializedViews = Object.fromEntries(
    sortedEntries(materializedViewRows).map(([view, rowTexts]) => [
      view,
      exactRowSetFingerprint(rowTexts),
    ]),
  );
  const sequences = canonicalObjectSetFingerprint(sequenceStates);
  const dataContract = {
    algorithm: "sha256-exact-public-relation-rows-v2",
    tables,
    materializedViews,
    sequences,
  };
  const data = { ...dataContract, digest: manifestDigest(dataContract) };
  const contract = { version: COMPLETE_FINGERPRINT_VERSION, schema, data };
  return { ...contract, digest: manifestDigest(contract) };
}

function endpointIdentity(hostname) {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  labels[0] = labels[0]?.replace(/-pooler$/, "");
  return labels.join(".");
}

function databaseIdentity(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    if (!databaseName || databaseName.includes("/")) throw new Error("missing database name");
    return `${endpointIdentity(parsed.hostname)}/${databaseName}`;
  } catch {
    throw new Error("A database URL is malformed; credentials were not displayed.");
  }
}

export function databaseIdentityDigest(rawUrl) {
  return manifestDigest({ database: databaseIdentity(rawUrl) });
}

function databaseName(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) throw new Error();
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("A database URL is malformed; credentials were not displayed.");
  }
}

export function assertDistinctDatabaseUrls(sourceUrl, targetUrl) {
  const source = databaseIdentity(sourceUrl);
  const target = databaseIdentity(targetUrl);
  if (source === target) {
    throw new Error("Source and target must be distinct databases; refusing the same database.");
  }
}

function unwrapMetadata(value, key) {
  return value?.[key] ?? value;
}

export function assertRehearsalTarget({
  targetUrl,
  targetProjectId,
  targetBranchId,
  project: projectInput,
  branch: branchInput,
  endpoints: endpointsInput,
}) {
  const project = unwrapMetadata(projectInput, "project");
  const branch = unwrapMetadata(branchInput, "branch");
  const endpoints = unwrapMetadata(endpointsInput, "endpoints") ?? [];
  if (targetProjectId !== CANONICAL_TARGET_PROJECT_ID) {
    throw new Error("SK-80 is hard-bound to the canonical skitza-v3 project.");
  }
  if (!project || project.id !== targetProjectId) {
    throw new Error("The Neon project metadata does not match the requested rehearsal project.");
  }
  if (!branch || branch.id !== targetBranchId || branch.project_id !== targetProjectId) {
    throw new Error("The Neon branch metadata does not match the requested rehearsal branch.");
  }
  if (branch.default === true || project.default_branch_id === branch.id) {
    throw new Error(
      "Refusing to write to the default branch; SK-80 accepts a rehearsal child only.",
    );
  }
  if (!branch.parent_id) {
    throw new Error("Refusing a root branch; the rehearsal target must be a child branch.");
  }
  if (branch.parent_id !== project.default_branch_id) {
    throw new Error("The rehearsal target must be a direct child of the canonical default branch.");
  }
  if (branch.protected === true) {
    throw new Error("Refusing a protected branch for the SK-80 rehearsal.");
  }
  if (typeof branch.name !== "string" || !branch.name.startsWith("sk-80-rehearsal-")) {
    throw new Error("The target branch name must start with sk-80-rehearsal-.");
  }

  let targetHost;
  try {
    const parsed = new URL(targetUrl);
    targetHost = endpointIdentity(parsed.hostname);
    if (databaseName(targetUrl) !== EXPECTED_DATABASE_NAME) {
      throw new Error("wrong database");
    }
  } catch {
    throw new Error(
      "The rehearsal target URL or database name is invalid; credentials were not displayed.",
    );
  }

  const readWriteEndpoints = endpoints.filter(
    (endpoint) =>
      endpoint.branch_id === targetBranchId &&
      endpoint.type === "read_write" &&
      endpoint.disabled !== true,
  );
  const hostMatches = readWriteEndpoints.some(
    (endpoint) => endpoint.host && endpointIdentity(endpoint.host) === targetHost,
  );
  if (!hostMatches) {
    throw new Error("The target URL host is not the rehearsal branch read-write endpoint.");
  }
}

export function assertSourceDatabase({
  sourceUrl,
  sourceProjectId,
  sourceBranchId,
  project: projectInput,
  branch: branchInput,
  endpoints: endpointsInput,
}) {
  const project = unwrapMetadata(projectInput, "project");
  const branch = unwrapMetadata(branchInput, "branch");
  const endpoints = unwrapMetadata(endpointsInput, "endpoints") ?? [];
  if (sourceProjectId !== CANONICAL_SOURCE_PROJECT_ID) {
    throw new Error("SK-80 is hard-bound to the old skitza source project.");
  }
  if (!project || project.id !== sourceProjectId) {
    throw new Error("The Neon source project metadata does not match the requested source.");
  }
  if (!branch || branch.id !== sourceBranchId || branch.project_id !== sourceProjectId) {
    throw new Error("The Neon source branch metadata does not match the requested source.");
  }
  if (branch.default !== true || project.default_branch_id !== branch.id) {
    throw new Error("The SK-80 source must be the old project's current default branch.");
  }
  let sourceHost;
  try {
    sourceHost = endpointIdentity(new URL(sourceUrl).hostname);
    if (databaseName(sourceUrl) !== EXPECTED_DATABASE_NAME) throw new Error("wrong database");
  } catch {
    throw new Error("The source URL or database name is invalid; credentials were not displayed.");
  }
  const hostMatches = endpoints.some(
    (endpoint) =>
      endpoint.branch_id === sourceBranchId &&
      endpoint.disabled !== true &&
      endpoint.host &&
      endpointIdentity(endpoint.host) === sourceHost,
  );
  if (!hostMatches) {
    throw new Error("The source URL host is not an enabled endpoint for the source branch.");
  }
}

function metadataParts(value) {
  return {
    project: unwrapMetadata(value?.project, "project"),
    branch: unwrapMetadata(value?.branch, "branch"),
    endpoints: unwrapMetadata(value?.endpoints, "endpoints") ?? [],
  };
}

function assertBranchEndpoint({ url, branchId, endpoints, requireReadWrite, label }) {
  let host;
  try {
    host = endpointIdentity(new URL(url).hostname);
    if (databaseName(url) !== EXPECTED_DATABASE_NAME) throw new Error("wrong database");
  } catch {
    throw new Error(`${label} URL or database name is invalid; credentials were not displayed.`);
  }
  const matches = endpoints.some(
    (endpoint) =>
      endpoint.branch_id === branchId &&
      endpoint.disabled !== true &&
      (!requireReadWrite || endpoint.type === "read_write") &&
      endpoint.host &&
      endpointIdentity(endpoint.host) === host,
  );
  if (!matches) throw new Error(`${label} URL does not match an enabled branch endpoint.`);
}

function assertFreshDirectChild({
  branch,
  parentBranchId,
  prefix,
  runId,
  snapshotTimestamp,
  attestedAt,
  label,
}) {
  if (branch.default === true || branch.id === parentBranchId) {
    throw new Error(`${label} must be a separate direct-child safety branch.`);
  }
  if (branch.parent_id !== parentBranchId) {
    throw new Error(`${label} must be a direct child of the current default branch.`);
  }
  if (branch.name !== `${prefix}${runId}`) {
    throw new Error(`${label} name must be exactly ${prefix}<run-id>.`);
  }
  if (branch.expires_at !== undefined && branch.expires_at !== null) {
    throw new Error(`${label} must not have an expiration time.`);
  }
  if (branch.ttl_interval_seconds !== undefined && branch.ttl_interval_seconds !== null) {
    throw new Error(`${label} must not retain an automatic-deletion TTL.`);
  }
  if (branch.current_state !== "ready") {
    throw new Error(`${label} must be fully ready before production planning.`);
  }
  const createdAt = Date.parse(branch.created_at);
  const snapshotAt = Date.parse(snapshotTimestamp);
  const frozenAt = Date.parse(attestedAt);
  if ([createdAt, snapshotAt, frozenAt].some(Number.isNaN)) {
    throw new Error(`${label} freshness metadata is invalid.`);
  }
  if (
    createdAt < frozenAt ||
    createdAt > snapshotAt ||
    snapshotAt - createdAt > PRODUCTION_SAFETY_WINDOW_MS
  ) {
    throw new Error(`${label} is not a fresh branch created within 30 minutes after the freeze.`);
  }
}

export function assertProductionSourceBranches({
  sourceOriginUrl,
  sourceSnapshotUrl,
  sourceProjectId,
  sourceOriginBranchId,
  sourceSnapshotBranchId,
  runId,
  snapshotTimestamp,
  attestedAt,
  origin: originInput,
  snapshot: snapshotInput,
}) {
  if (sourceProjectId !== CANONICAL_SOURCE_PROJECT_ID) {
    throw new Error("SK-80 production is hard-bound to the old skitza source project.");
  }
  const origin = metadataParts(originInput);
  const snapshot = metadataParts(snapshotInput);
  if (
    origin.project?.id !== sourceProjectId ||
    origin.branch?.id !== sourceOriginBranchId ||
    origin.branch?.project_id !== sourceProjectId
  ) {
    throw new Error("The production source-origin metadata does not match the requested branch.");
  }
  if (origin.project.default_branch_id !== sourceOriginBranchId || origin.branch.default !== true) {
    throw new Error(
      "The production source origin must be the old project's exact current default.",
    );
  }
  if (
    snapshot.project?.id !== sourceProjectId ||
    snapshot.project.default_branch_id !== sourceOriginBranchId ||
    snapshot.branch?.id !== sourceSnapshotBranchId ||
    snapshot.branch?.project_id !== sourceProjectId
  ) {
    throw new Error("The production source-snapshot metadata does not match the requested branch.");
  }
  assertFreshDirectChild({
    branch: snapshot.branch,
    parentBranchId: sourceOriginBranchId,
    prefix: "sk-80-source-snapshot-",
    runId,
    snapshotTimestamp,
    attestedAt,
    label: "The production source snapshot",
  });
  assertBranchEndpoint({
    url: sourceOriginUrl,
    branchId: sourceOriginBranchId,
    endpoints: origin.endpoints,
    requireReadWrite: false,
    label: "The production source origin",
  });
  assertBranchEndpoint({
    url: sourceSnapshotUrl,
    branchId: sourceSnapshotBranchId,
    endpoints: snapshot.endpoints,
    requireReadWrite: false,
    label: "The production source snapshot",
  });
}

export function assertProductionTargetBranches({
  targetUrl,
  targetRestoreUrl,
  targetProjectId,
  targetBranchId,
  targetRestoreBranchId,
  runId,
  snapshotTimestamp,
  attestedAt,
  current: currentInput,
  restore: restoreInput,
}) {
  if (targetProjectId !== CANONICAL_TARGET_PROJECT_ID) {
    throw new Error("SK-80 production is hard-bound to the canonical skitza-v3 project.");
  }
  const current = metadataParts(currentInput);
  const restore = metadataParts(restoreInput);
  if (
    current.project?.id !== targetProjectId ||
    current.branch?.id !== targetBranchId ||
    current.branch?.project_id !== targetProjectId
  ) {
    throw new Error("The production target metadata does not match the requested branch.");
  }
  if (current.project.default_branch_id !== targetBranchId || current.branch.default !== true) {
    throw new Error("The production target must be the canonical project's exact current default.");
  }
  if (
    restore.project?.id !== targetProjectId ||
    restore.project.default_branch_id !== targetBranchId ||
    restore.branch?.id !== targetRestoreBranchId ||
    restore.branch?.project_id !== targetProjectId
  ) {
    throw new Error("The production restore metadata does not match the requested branch.");
  }
  assertFreshDirectChild({
    branch: restore.branch,
    parentBranchId: targetBranchId,
    prefix: "sk-80-target-restore-",
    runId,
    snapshotTimestamp,
    attestedAt,
    label: "The production target restore point",
  });
  assertBranchEndpoint({
    url: targetUrl,
    branchId: targetBranchId,
    endpoints: current.endpoints,
    requireReadWrite: true,
    label: "The production target",
  });
  assertBranchEndpoint({
    url: targetRestoreUrl,
    branchId: targetRestoreBranchId,
    endpoints: restore.endpoints,
    requireReadWrite: false,
    label: "The production target restore point",
  });
}

export function assertProductionTargetSnapshot({
  targetSnapshotPreviewUrl,
  targetProjectId,
  targetBranchId,
  targetSnapshotId,
  targetSnapshotPreviewBranchId,
  runId,
  snapshotTimestamp,
  attestedAt,
  snapshot: snapshotInput,
  preview: previewInput,
}) {
  const snapshot = unwrapMetadata(snapshotInput, "snapshot");
  const preview = metadataParts(previewInput);
  if (
    !snapshot ||
    snapshot.id !== targetSnapshotId ||
    snapshot.source_branch_id !== targetBranchId ||
    snapshot.manual !== true
  ) {
    throw new Error(
      "The production target manual snapshot does not match the canonical default branch.",
    );
  }
  if (snapshot.name !== `sk-80-target-manual-snapshot-${runId}`) {
    throw new Error(
      "The production target manual snapshot name must exactly bind the production run ID.",
    );
  }
  if (snapshot.expires_at !== undefined && snapshot.expires_at !== null) {
    throw new Error("The production target manual snapshot must not expire.");
  }
  if (!snapshot.timestamp && !snapshot.lsn) {
    throw new Error("The production target manual snapshot must report a timestamp or LSN.");
  }

  const createdAt = Date.parse(snapshot.created_at);
  const snapshotAt = Date.parse(snapshotTimestamp);
  const frozenAt = Date.parse(attestedAt);
  if (
    [createdAt, snapshotAt, frozenAt].some(Number.isNaN) ||
    createdAt < frozenAt ||
    createdAt > snapshotAt ||
    snapshotAt - createdAt > PRODUCTION_SAFETY_WINDOW_MS
  ) {
    throw new Error(
      "The production target manual snapshot is not fresh enough for this frozen run.",
    );
  }
  if (snapshot.timestamp !== undefined) {
    const capturedAt = Date.parse(snapshot.timestamp);
    if (Number.isNaN(capturedAt) || capturedAt < frozenAt || capturedAt > snapshotAt) {
      throw new Error(
        "The production target manual snapshot capture time is outside the frozen run.",
      );
    }
  }

  if (
    preview.project?.id !== targetProjectId ||
    preview.project.default_branch_id !== targetBranchId ||
    preview.branch?.id !== targetSnapshotPreviewBranchId ||
    preview.branch?.project_id !== targetProjectId ||
    preview.branch?.default === true ||
    preview.branch?.restored_from !== targetSnapshotId ||
    preview.branch?.restored_as !== targetBranchId ||
    preview.branch?.restore_status !== "restored"
  ) {
    throw new Error(
      "The production target snapshot preview does not match the required manual snapshot.",
    );
  }
  if (preview.branch.name !== `sk-80-target-snapshot-preview-${runId}`) {
    throw new Error(
      "The production target snapshot preview name must exactly bind the production run ID.",
    );
  }
  if (preview.branch.expires_at !== undefined && preview.branch.expires_at !== null) {
    throw new Error("The production target snapshot preview must not expire.");
  }
  if (
    preview.branch.ttl_interval_seconds !== undefined &&
    preview.branch.ttl_interval_seconds !== null
  ) {
    throw new Error("The production target snapshot preview must not retain an automatic TTL.");
  }
  if (preview.branch.current_state !== "ready") {
    throw new Error("The production target snapshot preview must be fully ready.");
  }
  const previewCreatedAt = Date.parse(preview.branch.created_at);
  if (
    Number.isNaN(previewCreatedAt) ||
    previewCreatedAt < createdAt ||
    previewCreatedAt > snapshotAt ||
    snapshotAt - previewCreatedAt > PRODUCTION_SAFETY_WINDOW_MS
  ) {
    throw new Error(
      "The production target snapshot preview is not fresh enough for this frozen run.",
    );
  }
  assertBranchEndpoint({
    url: targetSnapshotPreviewUrl,
    branchId: targetSnapshotPreviewBranchId,
    endpoints: preview.endpoints,
    requireReadWrite: false,
    label: "The production target snapshot preview",
  });
}

export function assertMatchingCompleteFingerprints(label, left, right) {
  if (!left?.digest || !right?.digest || left.digest !== right.digest) {
    throw new Error(`${label} complete schema/data fingerprints do not match.`);
  }
}

export function productionConfirmation({
  targetProjectId,
  targetBranchId,
  runId,
  snapshotTimestamp,
  digest,
}) {
  return `APPLY SK-80 TO ${targetProjectId}/${targetBranchId} RUN ${runId} SNAPSHOT ${snapshotTimestamp} DIGEST ${digest}`;
}

export function assertProductionApproval(config, digest, suppliedConfirmation) {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("The approved production manifest digest must be an exact SHA-256 digest.");
  }
  const expected = productionConfirmation({
    targetProjectId: config.targetProjectId,
    targetBranchId: config.targetBranchId,
    runId: config.runId,
    snapshotTimestamp: config.snapshotTimestamp,
    digest,
  });
  if (suppliedConfirmation !== expected) {
    throw new Error("The typed production confirmation does not exactly match this guarded run.");
  }
}

export function normalizeBookingStatus(value) {
  if (value === "pending") return "pending_approval";
  if (BOOKING_STATUSES.has(value)) return value;
  throw new Error(`Unsupported booking status: ${String(value)}`);
}

export function normalizeProjectStage(value) {
  if (PROJECT_STAGES.has(value)) return value;
  throw new Error(`Legacy project stage ${String(value)} requires a human decision.`);
}

function rowValue(row, snake, camel) {
  return row[snake] ?? row[camel];
}

function normalizedEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

export function planProducerMappings(sourceRows, targetRows) {
  const targetByClerk = new Map(
    targetRows.map((row) => [rowValue(row, "clerk_user_id", "clerkUserId"), row]),
  );
  const targetBySlug = new Map(targetRows.map((row) => [row.slug, row]));
  const targetById = new Map(targetRows.map((row) => [row.id, row]));
  const mappings = [];
  const conflicts = [];

  for (const source of sourceRows) {
    const clerk = rowValue(source, "clerk_user_id", "clerkUserId");
    const sameClerk = targetByClerk.get(clerk);
    if (sameClerk) {
      const projectedTarget = Object.fromEntries(
        Object.keys(source).map((key) => [key, sameClerk[key]]),
      );
      mappings.push({
        sourceId: source.id,
        targetId: sameClerk.id,
        action:
          source.id === sameClerk.id && stableStringify(projectedTarget) === stableStringify(source)
            ? "already_present"
            : "target_wins",
      });
      continue;
    }

    const sameSlug = targetBySlug.get(source.slug);
    if (sameSlug) {
      conflicts.push({
        type: "slug_conflict",
        sourceId: source.id,
        targetId: sameSlug.id,
      });
      continue;
    }

    const sameId = targetById.get(source.id);
    if (sameId) {
      conflicts.push({
        type: "producer_uuid_conflict",
        sourceId: source.id,
        targetId: sameId.id,
      });
      continue;
    }

    mappings.push({ sourceId: source.id, targetId: source.id, action: "insert" });
  }

  return { mappings, conflicts };
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error("Unsafe database identifier rejected.");
  }
  return `"${value}"`;
}

function quoteCatalogIdentifier(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error("Invalid catalog identifier rejected.");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function opaqueRowRef(table, row) {
  const identity =
    row.id ??
    [row.producer_id, row.client_contact_id, row.purchase_request_id].filter(Boolean).join(":") ??
    stableStringify(row);
  return createHash("sha256").update(`${table}:${identity}`).digest("hex").slice(0, 24);
}

class ProductionCommitOutcomeUnknownError extends Error {
  constructor(expectedTargetDigest) {
    const digest = /^[a-f0-9]{64}$/.test(expectedTargetDigest)
      ? expectedTargetDigest
      : "unavailable";
    super(
      "Production COMMIT outcome is unknown. Do not retry apply-production and do not assume rollback. " +
        `Keep every writer frozen and run verify-production with the expected target digest ${digest}.`,
    );
    this.name = "ProductionCommitOutcomeUnknownError";
    this.code = UNKNOWN_COMMIT_OUTCOME_CODE;
  }
}

function safeError(error, fallback) {
  // Database errors can echo row values, storage keys, emails, or vendor IDs.
  // Only a caller-authored unknown-COMMIT instruction may cross the CLI boundary.
  if (error?.code === UNKNOWN_COMMIT_OUTCOME_CODE) return error.message;
  return fallback;
}

export async function commitProductionTransaction(client, expectedTargetDigest) {
  try {
    await client.query("commit");
  } catch {
    // A transport failure can arrive after PostgreSQL committed. Retrying the
    // merge or issuing ROLLBACK would be unsafe and cannot establish outcome.
    throw new ProductionCommitOutcomeUnknownError(expectedTargetDigest);
  }
}

export function assertSourceOriginUnchangedBeforeCommit(approvedFingerprint, freshFingerprint) {
  if (
    !approvedFingerprint?.digest ||
    !freshFingerprint?.digest ||
    approvedFingerprint.digest !== freshFingerprint.digest
  ) {
    throw new Error(
      "The fresh source-origin fingerprint changed immediately before commit; production must not commit.",
    );
  }
}

async function neonGet(path, apiKey) {
  const response = await fetch(`https://console.neon.tech/api/v2${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Neon metadata request failed with status ${response.status}.`);
  }
  return response.json();
}

export async function assertNeonApiKeyCannotReadProject(apiKey, deniedProjectId, request = fetch) {
  let response;
  try {
    response = await request(
      `https://console.neon.tech/api/v2/projects/${encodeURIComponent(deniedProjectId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
  } catch {
    throw new Error("Neon API-key scope verification could not reach Neon.");
  }
  if (response.ok) {
    throw new Error("A production Neon API key can read the opposite project; scope is too broad.");
  }
  if (![403, 404].includes(response.status)) {
    throw new Error("Neon API-key scope verification returned an unexpected status.");
  }
}

export function selectOnlyProductionSnapshot(snapshots, expectedSnapshotId) {
  if (!Array.isArray(snapshots) || snapshots.length !== 1) {
    throw new Error(
      "The canonical target must have exactly one manual snapshot reserved for this run.",
    );
  }
  if (snapshots[0]?.id !== expectedSnapshotId) {
    throw new Error("The canonical target's only snapshot is not the requested SK-80 snapshot.");
  }
  return snapshots[0];
}

async function loadProjectMetadata(projectId, branchId, apiKey) {
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const branchPath = `${projectPath}/branches/${encodeURIComponent(branchId)}`;
  const [projectResponse, branch, endpoints, branchesResponse] = await Promise.all([
    neonGet(projectPath, apiKey),
    neonGet(branchPath, apiKey),
    neonGet(`${branchPath}/endpoints`, apiKey),
    neonGet(`${projectPath}/branches`, apiKey),
  ]);
  const project = unwrapMetadata(projectResponse, "project");
  const branches = unwrapMetadata(branchesResponse, "branches") ?? [];
  const defaultBranch = branches.find((candidate) => candidate.default === true);
  if (!defaultBranch) throw new Error("Neon did not report a default branch for the project.");
  project.default_branch_id = defaultBranch.id;
  return { project, branch, endpoints };
}

async function loadProjectSnapshots(projectId, apiKey) {
  const response = await neonGet(`/projects/${encodeURIComponent(projectId)}/snapshots`, apiKey);
  return unwrapMetadata(response, "snapshots") ?? [];
}

async function loadNeonMetadata(config, { requireLive }) {
  if (process.env.NEON_API_KEY) {
    const [source, target] = await Promise.all([
      loadProjectMetadata(config.sourceProjectId, config.sourceBranchId, process.env.NEON_API_KEY),
      loadProjectMetadata(config.targetProjectId, config.targetBranchId, process.env.NEON_API_KEY),
    ]);
    return { source, target, live: true };
  }

  if (requireLive) {
    throw new Error("NEON_API_KEY is required for every rehearsal write operation.");
  }
  const metadataPath = process.env[ENV.metadataFile];
  if (!metadataPath || !existsSync(metadataPath)) {
    throw new Error(`Set NEON_API_KEY or ${ENV.metadataFile} for guarded read-only planning.`);
  }
  const raw = readFileSync(metadataPath, "utf8");
  if (/postgres(?:ql)?:\/\/|password|api[_-]?key/i.test(raw)) {
    throw new Error("The Neon metadata file contains forbidden connection or credential data.");
  }
  const parsed = JSON.parse(raw);
  if (!parsed.source || !parsed.target) {
    throw new Error("The Neon metadata file must contain separate source and target metadata.");
  }
  return { source: parsed.source, target: parsed.target, live: false };
}

async function loadProductionNeonMetadata(config) {
  const { sourceApiKey, targetApiKey } = readProductionApiKeys();
  const [
    sourceOrigin,
    sourceSnapshot,
    targetCurrent,
    targetRestore,
    targetSnapshotPreview,
    targetSnapshots,
  ] = await Promise.all([
    loadProjectMetadata(config.sourceProjectId, config.sourceOriginBranchId, sourceApiKey),
    loadProjectMetadata(config.sourceProjectId, config.sourceSnapshotBranchId, sourceApiKey),
    loadProjectMetadata(config.targetProjectId, config.targetBranchId, targetApiKey),
    loadProjectMetadata(config.targetProjectId, config.targetRestoreBranchId, targetApiKey),
    loadProjectMetadata(config.targetProjectId, config.targetSnapshotPreviewBranchId, targetApiKey),
    loadProjectSnapshots(config.targetProjectId, targetApiKey),
    assertNeonApiKeyCannotReadProject(sourceApiKey, config.targetProjectId),
    assertNeonApiKeyCannotReadProject(targetApiKey, config.sourceProjectId),
  ]);
  const targetSnapshot = selectOnlyProductionSnapshot(targetSnapshots, config.targetSnapshotId);
  return {
    sourceOrigin,
    sourceSnapshot,
    targetCurrent,
    targetRestore,
    targetSnapshot,
    targetSnapshotPreview,
    targetSnapshotInventoryCount: targetSnapshots.length,
    live: true,
  };
}

async function guardProductionMetadata(config) {
  const metadata = await loadProductionNeonMetadata(config);
  assertProductionSourceBranches({
    sourceOriginUrl: config.sourceOriginUrl,
    sourceSnapshotUrl: config.sourceSnapshotUrl,
    sourceProjectId: config.sourceProjectId,
    sourceOriginBranchId: config.sourceOriginBranchId,
    sourceSnapshotBranchId: config.sourceSnapshotBranchId,
    runId: config.runId,
    snapshotTimestamp: config.snapshotTimestamp,
    attestedAt: config.freezeAttestation.attestedAt,
    origin: metadata.sourceOrigin,
    snapshot: metadata.sourceSnapshot,
  });
  assertProductionTargetBranches({
    targetUrl: config.targetUrl,
    targetRestoreUrl: config.targetRestoreUrl,
    targetProjectId: config.targetProjectId,
    targetBranchId: config.targetBranchId,
    targetRestoreBranchId: config.targetRestoreBranchId,
    runId: config.runId,
    snapshotTimestamp: config.snapshotTimestamp,
    attestedAt: config.freezeAttestation.attestedAt,
    current: metadata.targetCurrent,
    restore: metadata.targetRestore,
  });
  assertProductionTargetSnapshot({
    targetSnapshotPreviewUrl: config.targetSnapshotPreviewUrl,
    targetProjectId: config.targetProjectId,
    targetBranchId: config.targetBranchId,
    targetSnapshotId: config.targetSnapshotId,
    targetSnapshotPreviewBranchId: config.targetSnapshotPreviewBranchId,
    runId: config.runId,
    snapshotTimestamp: config.snapshotTimestamp,
    attestedAt: config.freezeAttestation.attestedAt,
    snapshot: metadata.targetSnapshot,
    preview: metadata.targetSnapshotPreview,
  });
  return metadata;
}

async function guardConsolidationMetadata(config, options) {
  const metadata = await loadNeonMetadata(config, options);
  assertSourceDatabase({
    ...metadata.source,
    sourceUrl: config.sourceUrl,
    sourceProjectId: config.sourceProjectId,
    sourceBranchId: config.sourceBranchId,
  });
  assertRehearsalTarget({
    ...metadata.target,
    targetUrl: config.targetUrl,
    targetProjectId: config.targetProjectId,
    targetBranchId: config.targetBranchId,
  });
  return metadata;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readConfig() {
  const snapshotTimestamp = requiredEnv(ENV.snapshotTimestamp);
  if (Number.isNaN(Date.parse(snapshotTimestamp)) || !snapshotTimestamp.endsWith("Z")) {
    throw new Error(`${ENV.snapshotTimestamp} must be a valid UTC ISO-8601 timestamp.`);
  }
  const config = {
    sourceUrl: requiredEnv(ENV.sourceUrl),
    targetUrl: requiredEnv(ENV.targetUrl),
    sourceProjectId: requiredEnv(ENV.sourceProjectId),
    sourceBranchId: requiredEnv(ENV.sourceBranchId),
    targetProjectId: requiredEnv(ENV.targetProjectId),
    targetBranchId: requiredEnv(ENV.targetBranchId),
    snapshotTimestamp,
  };
  assertDistinctDatabaseUrls(config.sourceUrl, config.targetUrl);
  return config;
}

export function readProductionApiKeys(environment = process.env) {
  const sourceApiKey = environment[ENV.productionSourceNeonApiKey];
  const targetApiKey = environment[ENV.productionTargetNeonApiKey];
  if (!sourceApiKey || !targetApiKey) {
    throw new Error("Separate source and target Neon API keys are required for production.");
  }
  if (sourceApiKey === targetApiKey) {
    throw new Error("Production source and target Neon API keys must be different.");
  }
  return { sourceApiKey, targetApiKey };
}

function assertDistinctProductionDatabases(config) {
  const identities = [
    config.sourceOriginUrl,
    config.sourceSnapshotUrl,
    config.targetUrl,
    config.targetRestoreUrl,
    config.targetSnapshotPreviewUrl,
  ].map(databaseIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new Error(
      "Every production origin, snapshot, target, restore, and preview database must differ.",
    );
  }
}

function readFreezeAttestation(path, runId, snapshotTimestamp, { requireCurrent }) {
  if (!existsSync(path)) throw new Error("The freeze-attestation file does not exist.");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) {
    throw new Error("The freeze-attestation path must be a small, regular, non-symlink file.");
  }
  const raw = readFileSync(path, "utf8");
  if (/postgres(?:ql)?:\/\/|password|api[_-]?key|database[_-]?url/i.test(raw)) {
    throw new Error("The freeze-attestation file contains forbidden credential-like data.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The freeze-attestation file must contain valid JSON.");
  }
  if (
    parsed.issue !== "SK-80" ||
    parsed.runId !== runId ||
    parsed.writersFrozen !== true ||
    parsed.attestedBy !== "Gili" ||
    stableStringify([...(parsed.writers ?? [])].sort()) !== stableStringify(REQUIRED_FROZEN_WRITERS)
  ) {
    throw new Error("The freeze attestation does not bind this run and every required writer.");
  }
  const attestedAt = Date.parse(parsed.attestedAt);
  const snapshotAt = Date.parse(snapshotTimestamp);
  const now = Date.now();
  if (
    Number.isNaN(attestedAt) ||
    attestedAt > snapshotAt ||
    snapshotAt - attestedAt > PRODUCTION_SAFETY_WINDOW_MS
  ) {
    throw new Error("The freeze attestation must be within 30 minutes before the snapshot time.");
  }
  if (
    requireCurrent &&
    (snapshotAt > now + 60 * 1000 || now - snapshotAt > PRODUCTION_SAFETY_WINDOW_MS)
  ) {
    throw new Error("The production snapshot time is not fresh enough for a write-capable mode.");
  }
  return {
    digest: createHash("sha256").update(raw).digest("hex"),
    attestedAt: new Date(attestedAt).toISOString(),
    modifiedAt: stat.mtime.toISOString(),
  };
}

function readProductionConfig(mode) {
  readProductionApiKeys();
  const snapshotTimestamp = requiredEnv(ENV.snapshotTimestamp);
  if (Number.isNaN(Date.parse(snapshotTimestamp)) || !snapshotTimestamp.endsWith("Z")) {
    throw new Error(`${ENV.snapshotTimestamp} must be a valid UTC ISO-8601 timestamp.`);
  }
  const runId = requiredEnv(ENV.productionRunId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,80}$/.test(runId)) {
    throw new Error(`${ENV.productionRunId} must be an opaque 8-81 character run ID.`);
  }
  const sourceProjectId = requiredEnv(ENV.sourceProjectId);
  const targetProjectId = requiredEnv(ENV.targetProjectId);
  if (
    sourceProjectId !== CANONICAL_SOURCE_PROJECT_ID ||
    targetProjectId !== CANONICAL_TARGET_PROJECT_ID
  ) {
    throw new Error("The production project IDs do not match the SK-80 hard binding.");
  }
  const freezeAttestation = readFreezeAttestation(
    requiredEnv(ENV.freezeAttestationFile),
    runId,
    snapshotTimestamp,
    { requireCurrent: mode !== "verify-production" },
  );
  const config = {
    sourceOriginUrl: requiredEnv(ENV.productionSourceOriginUrl),
    sourceOriginBranchId: requiredEnv(ENV.productionSourceOriginBranchId),
    sourceSnapshotUrl: requiredEnv(ENV.productionSourceSnapshotUrl),
    sourceSnapshotBranchId: requiredEnv(ENV.productionSourceSnapshotBranchId),
    targetUrl: requiredEnv(ENV.productionTargetUrl),
    targetBranchId: requiredEnv(ENV.productionTargetBranchId),
    targetRestoreUrl: requiredEnv(ENV.productionTargetRestoreUrl),
    targetRestoreBranchId: requiredEnv(ENV.productionTargetRestoreBranchId),
    targetSnapshotId: requiredEnv(ENV.productionTargetSnapshotId),
    targetSnapshotPreviewUrl: requiredEnv(ENV.productionTargetSnapshotPreviewUrl),
    targetSnapshotPreviewBranchId: requiredEnv(ENV.productionTargetSnapshotPreviewBranchId),
    sourceProjectId,
    targetProjectId,
    runId,
    snapshotTimestamp,
    freezeAttestation,
  };
  assertDistinctProductionDatabases(config);
  return config;
}

function createPool(connectionString) {
  return new Pool({ connectionString, max: 1 });
}

async function closePool(pool) {
  try {
    await pool.end();
  } catch {
    // Cleanup failure must not print a connection string.
    console.error("[consolidation] database pool cleanup failed");
  }
}

async function listTables(db) {
  const result = await db.query(
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
  );
  return new Set(result.rows.map((row) => row.table_name));
}

async function loadColumns(db, tableNames) {
  const result = await db.query(
    `select table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position
       from information_schema.columns
      where table_schema='public' and table_name=any($1::text[])
      order by table_name,ordinal_position`,
    [tableNames],
  );
  const tables = new Map();
  for (const row of result.rows) {
    const columns = tables.get(row.table_name) ?? [];
    columns.push(row);
    tables.set(row.table_name, columns);
  }
  return tables;
}

async function loadConstraints(db, tableNames) {
  const result = await db.query(
    `select c.conname as name,
            child.relname as table_name,
            c.contype as type,
            c.convalidated as validated,
            array(select a.attname
                    from unnest(c.conkey) with ordinality as k(attnum,ord)
                    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
                   order by k.ord) as columns,
            parent.relname as referenced_table,
            array(select a.attname
                    from unnest(c.confkey) with ordinality as k(attnum,ord)
                    join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum
                   order by k.ord) as referenced_columns
       from pg_constraint c
       join pg_class child on child.oid=c.conrelid
       join pg_namespace n on n.oid=child.relnamespace
       left join pg_class parent on parent.oid=c.confrelid
      where n.nspname='public' and child.relname=any($1::text[])
      order by child.relname,c.conname`,
    [tableNames],
  );
  const parseColumns = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || value === "{}") return [];
    return value.slice(1, -1).split(",");
  };
  return result.rows.map((row) => ({
    ...row,
    columns: parseColumns(row.columns),
    referenced_columns: parseColumns(row.referenced_columns),
  }));
}

async function loadIndexes(db, tableNames) {
  const result = await db.query(
    `select tablename as table_name,indexname as name,indexdef as definition
       from pg_indexes
      where schemaname='public' and tablename=any($1::text[])
      order by tablename,indexname`,
    [tableNames],
  );
  return result.rows;
}

function schemaFingerprint(columns, enums, constraints, indexes) {
  const columnSummary = Object.fromEntries(
    [...columns.entries()].map(([table, tableColumns]) => [
      table,
      tableColumns.map((column) => ({
        name: column.column_name,
        type: column.data_type,
        udt: column.udt_name,
        nullable: column.is_nullable,
        default: column.column_default,
      })),
    ]),
  );
  const enumSummary = Object.fromEntries([...enums.entries()]);
  const contract = { columns: columnSummary, enums: enumSummary, constraints, indexes };
  return { digest: manifestDigest(contract) };
}

async function loadEnums(db) {
  const result = await db.query(
    `select t.typname,e.enumlabel,e.enumsortorder
       from pg_type t join pg_enum e on e.enumtypid=t.oid
       join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public'
      order by t.typname,e.enumsortorder`,
  );
  const enums = new Map();
  for (const row of result.rows) {
    const values = enums.get(row.typname) ?? [];
    values.push(row.enumlabel);
    enums.set(row.typname, values);
  }
  return enums;
}

async function loadRows(db, table) {
  const name = quoteIdentifier(table);
  const result = await db.query(
    `select to_jsonb(t) as row from public.${name} t order by md5(to_jsonb(t)::text)`,
  );
  return result.rows.map((item) => item.row);
}

async function loadAllRows(db, presentTables) {
  const rows = new Map();
  for (const table of CURRENT_TABLES) {
    rows.set(table, presentTables.has(table) ? await loadRows(db, table) : []);
  }
  return rows;
}

async function tableDigest(db, table) {
  const name = quoteIdentifier(table);
  const result = await db.query(
    `select count(*)::int as count,
            md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by md5(to_jsonb(t)::text)),'')) as digest
       from public.${name} t`,
  );
  return { count: Number(result.rows[0].count), digest: result.rows[0].digest };
}

async function databaseFingerprint(db, presentTables) {
  const tables = {};
  for (const table of CURRENT_TABLES) {
    if (presentTables.has(table)) tables[table] = await tableDigest(db, table);
  }
  return { tables, digest: manifestDigest(tables) };
}

async function loadCompleteSchemaObjects(db) {
  const [
    relations,
    columns,
    enums,
    constraints,
    indexes,
    views,
    sequences,
    triggers,
    policies,
    routines,
  ] = await Promise.all([
    db.query(
      `select c.relname as name,
              c.relkind as kind,
              c.relpersistence as persistence,
              c.relrowsecurity as row_security,
              c.relforcerowsecurity as force_row_security,
              c.relreplident as replica_identity,
              c.relispartition as is_partition,
              pg_get_userbyid(c.relowner) as owner,
              coalesce(c.relacl::text,'') as acl,
              coalesce(c.reloptions::text,'') as options,
              case when c.relkind='p' then pg_get_partkeydef(c.oid) end as partition_key,
              case when c.relispartition then pg_get_expr(c.relpartbound,c.oid,true) end as partition_bound
         from pg_class c
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
        order by c.relkind,c.relname`,
    ),
    db.query(
      `select table_name,
              column_name,
              ordinal_position,
              data_type,
              udt_schema,
              udt_name,
              is_nullable,
              column_default,
              character_maximum_length,
              numeric_precision,
              numeric_scale,
              datetime_precision,
              collation_schema,
              collation_name,
              is_identity,
              identity_generation,
              identity_start,
              identity_increment,
              identity_maximum,
              identity_minimum,
              identity_cycle,
              is_generated,
              generation_expression
         from information_schema.columns
        where table_schema='public'
        order by table_name,ordinal_position`,
    ),
    db.query(
      `select t.typname as type_name,e.enumlabel as label,e.enumsortorder as sort_order
         from pg_type t
         join pg_enum e on e.enumtypid=t.oid
         join pg_namespace n on n.oid=t.typnamespace
        where n.nspname='public'
        order by t.typname,e.enumsortorder`,
    ),
    db.query(
      `select c.conname as name,
              relation.relname as relation_name,
              domain.typname as domain_name,
              c.contype as type,
              c.convalidated as validated,
              c.condeferrable as deferrable,
              c.condeferred as initially_deferred,
              pg_get_constraintdef(c.oid,true) as definition
         from pg_constraint c
         join pg_namespace n on n.oid=c.connamespace
         left join pg_class relation on relation.oid=c.conrelid
         left join pg_type domain on domain.oid=c.contypid
        where n.nspname='public'
        order by coalesce(relation.relname,domain.typname),c.conname`,
    ),
    db.query(
      `select indexes.tablename as table_name,
              indexes.indexname as name,
              indexes.indexdef as definition,
              index_state.indisunique as is_unique,
              index_state.indisprimary as is_primary,
              index_state.indisexclusion as is_exclusion,
              index_state.indimmediate as is_immediate,
              index_state.indisclustered as is_clustered,
              index_state.indisvalid as is_valid,
              index_state.indisready as is_ready,
              index_state.indislive as is_live,
              index_state.indisreplident as is_replica_identity,
              index_state.indnullsnotdistinct as nulls_not_distinct
         from pg_indexes indexes
         join pg_class index_relation on index_relation.relname=indexes.indexname
         join pg_namespace index_namespace
           on index_namespace.oid=index_relation.relnamespace
          and index_namespace.nspname=indexes.schemaname
         join pg_index index_state on index_state.indexrelid=index_relation.oid
        where indexes.schemaname='public'
        order by indexes.tablename,indexes.indexname`,
    ),
    db.query(
      `select c.relname as name,
              c.relkind as kind,
              coalesce(c.reloptions::text,'') as options,
              pg_get_viewdef(c.oid,true) as definition
         from pg_class c
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('v','m')
        order by c.relkind,c.relname`,
    ),
    db.query(
      `select sequence_relation.relname as name,
              format_type(sequence_state.seqtypid,null) as data_type,
              sequence_state.seqstart::text as start_value,
              sequence_state.seqincrement::text as increment_by,
              sequence_state.seqmax::text as max_value,
              sequence_state.seqmin::text as min_value,
              sequence_state.seqcache::text as cache_size,
              sequence_state.seqcycle as cycles,
              owner_relation.relname as owned_by_table,
              owner_column.attname as owned_by_column
         from pg_class sequence_relation
         join pg_namespace n on n.oid=sequence_relation.relnamespace
         join pg_sequence sequence_state on sequence_state.seqrelid=sequence_relation.oid
         left join pg_depend dependency
           on dependency.classid='pg_class'::regclass
          and dependency.objid=sequence_relation.oid
          and dependency.objsubid=0
          and dependency.refclassid='pg_class'::regclass
          and dependency.deptype in ('a','i')
         left join pg_class owner_relation on owner_relation.oid=dependency.refobjid
         left join pg_attribute owner_column
           on owner_column.attrelid=dependency.refobjid
          and owner_column.attnum=dependency.refobjsubid
        where n.nspname='public' and sequence_relation.relkind='S'
        order by sequence_relation.relname`,
    ),
    db.query(
      `select relation.relname as table_name,
              trigger.tgname as name,
              trigger.tgenabled as enabled,
              pg_get_triggerdef(trigger.oid,true) as definition
         from pg_trigger trigger
         join pg_class relation on relation.oid=trigger.tgrelid
         join pg_namespace n on n.oid=relation.relnamespace
        where n.nspname='public' and not trigger.tgisinternal
        order by relation.relname,trigger.tgname`,
    ),
    db.query(
      `select relation.relname as table_name,
              policy.polname as name,
              policy.polcmd as command,
              policy.polpermissive as permissive,
              array(select case when role_oid=0 then 'PUBLIC' else pg_get_userbyid(role_oid) end
                      from unnest(policy.polroles) role_oid
                     order by role_oid) as roles,
              pg_get_expr(policy.polqual,policy.polrelid,true) as using_expression,
              pg_get_expr(policy.polwithcheck,policy.polrelid,true) as check_expression
         from pg_policy policy
         join pg_class relation on relation.oid=policy.polrelid
         join pg_namespace n on n.oid=relation.relnamespace
        where n.nspname='public'
        order by relation.relname,policy.polname`,
    ),
    db.query(
      `select routine.proname as name,
              routine.prokind as kind,
              pg_get_function_identity_arguments(routine.oid) as identity_arguments,
              pg_get_userbyid(routine.proowner) as owner,
              coalesce(routine.proacl::text,'') as acl,
              pg_get_functiondef(routine.oid) as definition
         from pg_proc routine
         join pg_namespace n on n.oid=routine.pronamespace
        where n.nspname='public' and routine.prokind in ('f','p','w')
        order by routine.proname,pg_get_function_identity_arguments(routine.oid)`,
    ),
  ]);
  return {
    relations: relations.rows,
    columns: columns.rows,
    enums: enums.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    views: views.rows,
    sequences: sequences.rows,
    triggers: triggers.rows,
    policies: policies.rows,
    routines: routines.rows,
  };
}

async function completeRelationRows(db, relation) {
  const result = await db.query(
    `select to_jsonb(t)::text as row_text
       from public.${quoteCatalogIdentifier(relation)} t
      order by to_jsonb(t)::text`,
  );
  return result.rows.map((row) => row.row_text);
}

async function loadSequenceStates(db, sequences) {
  const states = [];
  for (const sequence of sequences) {
    const result = await db.query(
      `select last_value::text as last_value,is_called
         from public.${quoteCatalogIdentifier(sequence.name)}`,
    );
    states.push({ name: sequence.name, ...result.rows[0] });
  }
  return states;
}

async function completeDatabaseFingerprint(db) {
  const presentTables = await listTables(db);
  const tableNames = [...presentTables].sort();
  const schemaObjects = await loadCompleteSchemaObjects(db);
  const materializedViewNames = schemaObjects.views
    .filter((view) => view.kind === "m")
    .map((view) => view.name)
    .sort();
  const baseTableRows = {};
  const materializedViewRows = {};
  for (const table of tableNames) baseTableRows[table] = await completeRelationRows(db, table);
  for (const view of materializedViewNames) {
    materializedViewRows[view] = await completeRelationRows(db, view);
  }
  const sequenceStates = await loadSequenceStates(db, schemaObjects.sequences);
  return buildCompleteDatabaseFingerprint({
    schemaObjects,
    baseTableRows,
    materializedViewRows,
    sequenceStates,
  });
}

export function fingerprintActions(actions) {
  const rows = actions.map(({ kind, table, row }) => ({ kind, table, row }));
  return { count: rows.length, digest: manifestDigest(rows) };
}

async function legacyCounts(db, presentTables) {
  const counts = {};
  for (const table of LEGACY_TABLES) {
    if (!presentTables.has(table)) {
      counts[table] = 0;
      continue;
    }
    const name = quoteIdentifier(table);
    const result = await db.query(`select count(*)::int as count from public.${name}`);
    counts[table] = Number(result.rows[0].count);
  }
  return counts;
}

function columnNames(columnMap, table) {
  return new Set((columnMap.get(table) ?? []).map((column) => column.column_name));
}

function projectRow(table, row, targetColumns, overrides = {}) {
  const projected = {};
  for (const [key, value] of Object.entries(row)) {
    if (ALLOWED_REMOVED_SOURCE_COLUMNS.has(`${table}.${key}`)) continue;
    if (targetColumns.has(key)) projected[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (targetColumns.has(key)) projected[key] = value;
  }
  return projected;
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeComparable(item)]),
    );
  }
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return new Date(value).toISOString();
  }
  return value;
}

function rowsEqualOnProjectedColumns(existing, projected) {
  const comparable = Object.fromEntries(Object.keys(projected).map((key) => [key, existing[key]]));
  return (
    stableStringify(normalizeComparable(comparable)) ===
    stableStringify(normalizeComparable(projected))
  );
}

function primaryKey(table, row) {
  if (table === "stripe_customers") return `${row.producer_id}:${row.client_contact_id}`;
  return row.id;
}

function byPrimaryKey(table, rows) {
  return new Map(rows.map((row) => [primaryKey(table, row), row]));
}

function addBlocker(blockers, type, table, row, detail) {
  blockers.push({ type, table, ref: row ? opaqueRowRef(table, row) : undefined, detail });
}

function uniqueValueConflict(table, row, targetRows) {
  const specs = {
    projects: ["invite_token"],
    purchase_requests: ["ref_number"],
    payment_proofs: ["storage_key"],
    agreement_acceptances: ["purchase_request_id"],
  };
  const columns = specs[table] ?? [];
  for (const column of columns) {
    if (row[column] == null) continue;
    const conflict = targetRows.find(
      (target) =>
        target[column] === row[column] && primaryKey(table, target) !== primaryKey(table, row),
    );
    if (conflict) return { column, conflict };
  }
  if (table === "producer_external_links") {
    const conflict = targetRows.find(
      (target) =>
        target.producer_id === row.producer_id &&
        target.platform === row.platform &&
        target.id !== row.id,
    );
    if (conflict) return { column: "producer_id+platform", conflict };
  }
  return null;
}

function createActionRecorder(sourceRows, targetRows) {
  const counts = {};
  for (const table of CURRENT_TABLES) {
    counts[table] = {
      source: sourceRows.get(table)?.length ?? 0,
      targetBefore: targetRows.get(table)?.length ?? 0,
      insert: 0,
      alreadyPresent: 0,
      targetWins: 0,
      skippedConfiguration: 0,
    };
  }
  const actions = [];
  const transforms = {};
  return {
    counts,
    actions,
    transforms,
    recordTransform(type) {
      transforms[type] = (transforms[type] ?? 0) + 1;
    },
    record(action) {
      actions.push(action);
      if (action.kind === "insert") counts[action.table].insert += 1;
      if (action.kind === "already_present") counts[action.table].alreadyPresent += 1;
      if (action.kind === "target_wins") counts[action.table].targetWins += 1;
      if (action.kind === "skip_configuration") {
        counts[action.table].skippedConfiguration += 1;
      }
    },
  };
}

function insertOrClassify({ table, row, targetRows, targetColumns, recorder, blockers }) {
  const projected = projectRow(table, row, targetColumns);
  const existing = byPrimaryKey(table, targetRows).get(primaryKey(table, projected));
  if (existing) {
    if (rowsEqualOnProjectedColumns(existing, projected)) {
      recorder.record({ kind: "already_present", table, row: projected });
    } else {
      addBlocker(blockers, "uuid_conflict", table, projected, "same key has different data");
    }
    return;
  }

  const uniqueConflict = uniqueValueConflict(table, projected, targetRows);
  if (uniqueConflict) {
    addBlocker(
      blockers,
      "unique_value_conflict",
      table,
      projected,
      `conflict on ${uniqueConflict.column}`,
    );
    return;
  }
  recorder.record({ kind: "insert", table, row: projected });
}

function transformForeignKeys(row, producerMap, contactMap) {
  const transformed = { ...row };
  if (transformed.producer_id && producerMap.has(transformed.producer_id)) {
    transformed.producer_id = producerMap.get(transformed.producer_id);
  }
  if (transformed.client_contact_id && contactMap.has(transformed.client_contact_id)) {
    transformed.client_contact_id = contactMap.get(transformed.client_contact_id);
  }
  return transformed;
}

function sameColumnList(left, right) {
  return stableStringify(left ?? []) === stableStringify(right ?? []);
}

function validateSchemaContract({
  sourceColumns,
  targetColumns,
  targetConstraints,
  targetIndexes,
  sourceRows,
  blockers,
  recorder,
}) {
  for (const table of CURRENT_TABLES) {
    const targetColumnNames = columnNames(targetColumns, table);
    const targetByName = new Map(
      (targetColumns.get(table) ?? []).map((column) => [column.column_name, column]),
    );
    for (const column of sourceColumns.get(table) ?? []) {
      const key = `${table}.${column.column_name}`;
      if (ALLOWED_REMOVED_SOURCE_COLUMNS.has(key)) {
        const populated = (sourceRows.get(table) ?? []).filter(
          (row) => row[column.column_name] !== null && row[column.column_name] !== undefined,
        );
        if (populated.length > 0) recorder.recordTransform(`excluded_removed_column:${key}`);
        if (targetColumnNames.has(column.column_name)) {
          addBlocker(
            blockers,
            "retired_target_column_present",
            table,
            null,
            `target still exposes retired column ${column.column_name}`,
          );
        }
        continue;
      }
      if (targetColumnNames.has(column.column_name)) {
        const targetColumn = targetByName.get(column.column_name);
        if (targetColumn.udt_name !== column.udt_name) {
          addBlocker(
            blockers,
            "source_target_column_type_mismatch",
            table,
            null,
            `column ${column.column_name} changes type from ${column.udt_name} to ${targetColumn.udt_name}`,
          );
        }
        continue;
      }
      const populated = (sourceRows.get(table) ?? []).filter(
        (row) => row[column.column_name] !== null && row[column.column_name] !== undefined,
      );
      if (populated.length > 0) {
        addBlocker(
          blockers,
          "populated_source_column_not_supported",
          table,
          populated[0],
          `target lacks populated source column ${column.column_name}`,
        );
      }
    }
  }

  for (const constraint of targetConstraints) {
    if (constraint.validated === false) {
      addBlocker(
        blockers,
        "target_constraint_not_validated",
        constraint.table_name,
        null,
        `constraint ${constraint.name} is not validated`,
      );
    }
  }

  for (const [table, columns, referencedTable, referencedColumns] of REQUIRED_FOREIGN_KEYS) {
    const match = targetConstraints.some(
      (constraint) =>
        constraint.type === "f" &&
        constraint.table_name === table &&
        constraint.referenced_table === referencedTable &&
        sameColumnList(constraint.columns, columns) &&
        sameColumnList(constraint.referenced_columns, referencedColumns),
    );
    if (!match) {
      addBlocker(
        blockers,
        "required_foreign_key_missing",
        table,
        null,
        `${columns.join("+")} must reference ${referencedTable}.${referencedColumns.join("+")}`,
      );
    }
  }

  for (const [table, columns] of REQUIRED_UNIQUE_CONSTRAINTS) {
    const constraintMatch = targetConstraints.some(
      (constraint) =>
        new Set(["p", "u"]).has(constraint.type) &&
        constraint.table_name === table &&
        sameColumnList(constraint.columns, columns),
    );
    const indexMatch = targetIndexes.some((index) => {
      if (index.table_name !== table || !/create\s+unique\s+index/i.test(index.definition)) {
        return false;
      }
      const match = index.definition.match(/\(([^)]+)\)/);
      if (!match) return false;
      const indexedColumns = match[1].split(",").map((value) => value.trim().replaceAll('"', ""));
      return sameColumnList(indexedColumns, columns);
    });
    if (!constraintMatch && !indexMatch) {
      addBlocker(
        blockers,
        "required_unique_constraint_missing",
        table,
        null,
        `unique key ${columns.join("+")} is missing`,
      );
    }
  }

  for (const [name, table] of REQUIRED_UNIQUE_INDEX_NAMES) {
    const index = targetIndexes.find((candidate) => candidate.name === name);
    if (!index || !/create\s+unique\s+index/i.test(index.definition)) {
      addBlocker(
        blockers,
        "required_unique_index_missing",
        index?.table_name ?? table,
        null,
        `required unique index ${name} is missing`,
      );
    }
  }
}

function buildExpectedRows(targetRows, actions) {
  const expected = new Map(
    CURRENT_TABLES.map((table) => [table, [...(targetRows.get(table) ?? [])]]),
  );
  for (const action of actions) {
    if (action.kind === "insert") expected.get(action.table).push(action.row);
  }
  return expected;
}

function validateUniqueRows(table, columns, rows, blockers, { predicate = () => true } = {}) {
  const seen = new Map();
  for (const row of rows) {
    if (!predicate(row)) continue;
    const values = columns.map((column) => row[column]);
    if (values.some((value) => value === null || value === undefined)) continue;
    const key = stableStringify(values);
    if (seen.has(key)) {
      addBlocker(
        blockers,
        "duplicate_unique_key_in_expected_target",
        table,
        row,
        `duplicate expected key ${columns.join("+")}`,
      );
    } else {
      seen.set(key, row);
    }
  }
}

function validateExpectedFinalState({ expectedRows, targetColumns, targetEnums, blockers }) {
  for (const table of CURRENT_TABLES) {
    const rows = expectedRows.get(table) ?? [];
    const definitions = targetColumns.get(table) ?? [];
    for (const row of rows) {
      for (const column of definitions) {
        const value = row[column.column_name];
        if (column.is_nullable === "NO" && value === null) {
          addBlocker(
            blockers,
            "null_for_not_null_column",
            table,
            row,
            `column ${column.column_name} is not nullable`,
          );
        }
        const labels = targetEnums.get(column.udt_name);
        if (labels && value !== null && value !== undefined && !labels.includes(value)) {
          addBlocker(
            blockers,
            "unsupported_target_enum_value",
            table,
            row,
            `column ${column.column_name} rejects the planned value`,
          );
        }
      }
    }
  }

  for (const [table, columns] of REQUIRED_UNIQUE_CONSTRAINTS) {
    validateUniqueRows(table, columns, expectedRows.get(table) ?? [], blockers);
  }
  validateUniqueRows(
    "invoices",
    ["stripe_payment_intent_id"],
    expectedRows.get("invoices") ?? [],
    blockers,
  );
  validateUniqueRows(
    "invoices",
    ["payment_proof_id"],
    expectedRows.get("invoices") ?? [],
    blockers,
  );
  validateUniqueRows(
    "payment_proofs",
    ["purchase_request_id"],
    expectedRows.get("payment_proofs") ?? [],
    blockers,
    { predicate: (row) => row.status === "pending" },
  );

  for (const [table, columns, referencedTable, referencedColumns] of REQUIRED_FOREIGN_KEYS) {
    const parents = new Set(
      (expectedRows.get(referencedTable) ?? []).map((row) =>
        stableStringify(referencedColumns.map((column) => row[column])),
      ),
    );
    for (const row of expectedRows.get(table) ?? []) {
      const values = columns.map((column) => row[column]);
      if (values.some((value) => value === null || value === undefined)) continue;
      if (!parents.has(stableStringify(values))) {
        addBlocker(
          blockers,
          "missing_expected_foreign_key_parent",
          table,
          row,
          `${columns.join("+")} has no ${referencedTable} parent`,
        );
      }
    }
  }
}

async function buildPlan(config, sourcePool, targetPool, { operation = "rehearsal" } = {}) {
  const [sourceTables, targetTables] = await Promise.all([
    listTables(sourcePool),
    listTables(targetPool),
  ]);
  const [
    sourceColumns,
    targetColumns,
    sourceEnums,
    targetEnums,
    sourceConstraints,
    targetConstraints,
    sourceIndexes,
    targetIndexes,
    sourceRows,
    targetRows,
    excluded,
    targetLegacyBefore,
    sourceFingerprint,
    targetFingerprint,
  ] = await Promise.all([
    loadColumns(sourcePool, CURRENT_TABLES),
    loadColumns(targetPool, CURRENT_TABLES),
    loadEnums(sourcePool),
    loadEnums(targetPool),
    loadConstraints(sourcePool, CURRENT_TABLES),
    loadConstraints(targetPool, CURRENT_TABLES),
    loadIndexes(sourcePool, CURRENT_TABLES),
    loadIndexes(targetPool, CURRENT_TABLES),
    loadAllRows(sourcePool, sourceTables),
    loadAllRows(targetPool, targetTables),
    legacyCounts(sourcePool, sourceTables),
    legacyCounts(targetPool, targetTables),
    databaseFingerprint(sourcePool, sourceTables),
    databaseFingerprint(targetPool, targetTables),
  ]);
  const sourceSchemaFingerprint = schemaFingerprint(
    sourceColumns,
    sourceEnums,
    sourceConstraints,
    sourceIndexes,
  );
  const targetSchemaFingerprint = schemaFingerprint(
    targetColumns,
    targetEnums,
    targetConstraints,
    targetIndexes,
  );

  const blockers = [];
  for (const table of CURRENT_TABLES) {
    if (!sourceTables.has(table)) {
      addBlocker(blockers, "source_table_missing", table, null, "current table missing in source");
    }
    if (!targetTables.has(table)) {
      addBlocker(blockers, "target_table_missing", table, null, "current table missing in target");
    }
  }

  const bookingLabels = new Set(targetEnums.get("booking_status") ?? []);
  for (const status of BOOKING_STATUSES) {
    if (!bookingLabels.has(status)) {
      addBlocker(
        blockers,
        "target_enum_missing",
        "bookings",
        null,
        `booking_status lacks ${status}`,
      );
    }
  }
  const projectLabels = new Set(targetEnums.get("project_stage") ?? []);
  for (const stage of PROJECT_STAGES) {
    if (!projectLabels.has(stage)) {
      addBlocker(blockers, "target_enum_missing", "projects", null, `project_stage lacks ${stage}`);
    }
  }

  const recorder = createActionRecorder(sourceRows, targetRows);
  validateSchemaContract({
    sourceColumns,
    targetColumns,
    targetConstraints,
    targetIndexes,
    sourceRows,
    blockers,
    recorder,
  });
  const producerPlan = planProducerMappings(
    sourceRows.get("producers"),
    targetRows.get("producers"),
  );
  for (const conflict of producerPlan.conflicts) {
    blockers.push({
      type: conflict.type,
      table: "producers",
      ref: createHash("sha256").update(conflict.sourceId).digest("hex").slice(0, 24),
    });
  }
  const producerMap = new Map(
    producerPlan.mappings.map((mapping) => [mapping.sourceId, mapping.targetId]),
  );
  const producerMappingBySource = new Map(
    producerPlan.mappings.map((mapping) => [mapping.sourceId, mapping]),
  );
  const remappedProducerIds = new Set(
    producerPlan.mappings
      .filter(
        (mapping) => mapping.action === "target_wins" && mapping.sourceId !== mapping.targetId,
      )
      .map((mapping) => mapping.sourceId),
  );

  for (const mapping of producerPlan.mappings) {
    const source = sourceRows.get("producers").find((row) => row.id === mapping.sourceId);
    if (mapping.action === "target_wins") {
      recorder.record({ kind: "target_wins", table: "producers", row: source });
      continue;
    }
    if (mapping.action === "already_present") {
      recorder.record({ kind: "already_present", table: "producers", row: source });
      continue;
    }
    insertOrClassify({
      table: "producers",
      row: source,
      targetRows: targetRows.get("producers"),
      targetColumns: columnNames(targetColumns, "producers"),
      recorder,
      blockers,
    });
  }

  const contactMap = new Map();
  const targetContactsByIdentity = new Map(
    targetRows.get("client_contacts").map((row) => [`${row.producer_id}:${row.email_hash}`, row]),
  );
  const targetContactsByEmail = new Map(
    targetRows
      .get("client_contacts")
      .map((row) => [`${row.producer_id}:${normalizedEmail(row.email)}`, row]),
  );
  for (const source of sourceRows.get("client_contacts")) {
    const transformed = transformForeignKeys(source, producerMap, contactMap);
    const identity = `${transformed.producer_id}:${transformed.email_hash}`;
    const target = targetContactsByIdentity.get(identity);
    const emailIdentity = `${transformed.producer_id}:${normalizedEmail(transformed.email)}`;
    const emailTarget = targetContactsByEmail.get(emailIdentity);
    if (emailTarget && emailTarget.id !== target?.id) {
      addBlocker(
        blockers,
        "contact_email_identity_conflict",
        "client_contacts",
        source,
        "normalized email matches a different canonical contact",
      );
      continue;
    }
    if (target) {
      const projected = projectRow(
        "client_contacts",
        transformed,
        columnNames(targetColumns, "client_contacts"),
      );
      if (source.id === target.id && rowsEqualOnProjectedColumns(target, projected)) {
        contactMap.set(source.id, target.id);
        recorder.record({ kind: "already_present", table: "client_contacts", row: projected });
        continue;
      }
      addBlocker(
        blockers,
        "contact_identity_collision_requires_decision",
        "client_contacts",
        source,
        "matching contact is not byte-equivalent; automatic dedupe is forbidden",
      );
      continue;
    }
    contactMap.set(source.id, source.id);
    insertOrClassify({
      table: "client_contacts",
      row: transformed,
      targetRows: targetRows.get("client_contacts"),
      targetColumns: columnNames(targetColumns, "client_contacts"),
      recorder,
      blockers,
    });
  }

  for (const source of sourceRows.get("products")) {
    let transformed = transformForeignKeys(source, producerMap, contactMap);
    const mapping = producerMappingBySource.get(source.producer_id);
    const existingSameId = byPrimaryKey("products", targetRows.get("products")).get(source.id);
    const projectedBeforePolicy = projectRow(
      "products",
      transformed,
      columnNames(targetColumns, "products"),
    );
    const productAlreadyPresent =
      existingSameId && rowsEqualOnProjectedColumns(existingSameId, projectedBeforePolicy);
    const producerNeedsSharedPolicy =
      mapping?.action === "target_wins" ||
      (mapping?.action === "already_present" && !productAlreadyPresent);
    const sameName = targetRows
      .get("products")
      .some(
        (target) =>
          target.id !== transformed.id &&
          target.producer_id === transformed.producer_id &&
          String(target.name).trim().toLowerCase() ===
            String(transformed.name).trim().toLowerCase(),
      );
    if (producerNeedsSharedPolicy && sameName) {
      transformed = {
        ...transformed,
        active: false,
        archived_at: config.snapshotTimestamp,
      };
      recorder.recordTransform("same_name_product_imported_archived");
    }
    insertOrClassify({
      table: "products",
      row: transformed,
      targetRows: targetRows.get("products"),
      targetColumns: columnNames(targetColumns, "products"),
      recorder,
      blockers,
    });
  }

  for (const table of ["availability_blocks", "availability_blackouts"]) {
    for (const source of sourceRows.get(table)) {
      const mapping = producerMappingBySource.get(source.producer_id);
      const transformed = transformForeignKeys(source, producerMap, contactMap);
      const existing = byPrimaryKey(table, targetRows.get(table)).get(source.id);
      const projected = projectRow(table, transformed, columnNames(targetColumns, table));
      const alreadyPresent = existing && rowsEqualOnProjectedColumns(existing, projected);
      if (
        mapping?.action === "target_wins" ||
        (mapping?.action === "already_present" && !alreadyPresent)
      ) {
        recorder.record({ kind: "skip_configuration", table, row: source });
        recorder.recordTransform(`shared_schedule_target_wins:${table}`);
        continue;
      }
      insertOrClassify({
        table,
        row: transformed,
        targetRows: targetRows.get(table),
        targetColumns: columnNames(targetColumns, table),
        recorder,
        blockers,
      });
    }
  }

  const handled = new Set([
    "producers",
    "products",
    "client_contacts",
    "availability_blocks",
    "availability_blackouts",
  ]);
  const remappedProjectIds = new Set(
    sourceRows
      .get("projects")
      .filter((row) => remappedProducerIds.has(row.producer_id))
      .map((row) => row.id),
  );
  if (remappedProjectIds.size > 0) {
    for (const project of sourceRows
      .get("projects")
      .filter((row) => remappedProjectIds.has(row.id))) {
      addBlocker(
        blockers,
        "asset_namespace_remap_required",
        "projects",
        project,
        "shared producer owns source projects; R2 keys need a separate lossless copy plan",
      );
    }
  }
  for (const track of sourceRows.get("portfolio_tracks")) {
    if (remappedProducerIds.has(track.producer_id)) {
      addBlocker(
        blockers,
        "asset_namespace_remap_required",
        "portfolio_tracks",
        track,
        "shared producer owns source audio; R2 keys need a separate lossless copy plan",
      );
    }
  }
  for (const proof of sourceRows.get("payment_proofs")) {
    if (remappedProducerIds.has(proof.producer_id) && proof.storage_key) {
      addBlocker(
        blockers,
        "asset_namespace_remap_required",
        "payment_proofs",
        proof,
        "shared producer owns source proof storage; R2 keys need a separate lossless copy plan",
      );
    }
  }

  for (const table of INSERT_ORDER) {
    if (handled.has(table)) continue;
    for (const source of sourceRows.get(table)) {
      let transformed = transformForeignKeys(source, producerMap, contactMap);
      try {
        if (table === "bookings") {
          const originalStatus = transformed.status;
          transformed.status = normalizeBookingStatus(originalStatus);
          if (transformed.status !== originalStatus) {
            recorder.recordTransform(`booking_status:${originalStatus}->${transformed.status}`);
          }
        }
        if (table === "projects") {
          const originalStage = transformed.stage;
          transformed.stage = normalizeProjectStage(originalStage);
          if (transformed.stage !== originalStage) {
            recorder.recordTransform(`project_stage:${originalStage}->${transformed.stage}`);
          }
        }
      } catch (error) {
        addBlocker(
          blockers,
          "unsupported_enum_value",
          table,
          source,
          safeError(error, "unsupported enum value"),
        );
        continue;
      }
      insertOrClassify({
        table,
        row: transformed,
        targetRows: targetRows.get(table),
        targetColumns: columnNames(targetColumns, table),
        recorder,
        blockers,
      });
    }
  }

  for (const action of recorder.actions.filter((item) => item.kind === "insert")) {
    for (const column of targetColumns.get(action.table) ?? []) {
      if (
        column.is_nullable === "NO" &&
        column.column_default == null &&
        !(column.column_name in action.row)
      ) {
        addBlocker(
          blockers,
          "required_target_column_missing",
          action.table,
          action.row,
          `required target column ${column.column_name} is unavailable`,
        );
      }
    }
  }

  const expectedRows = buildExpectedRows(targetRows, recorder.actions);
  validateExpectedFinalState({ expectedRows, targetColumns, targetEnums, blockers });
  const expectedCounts = Object.fromEntries(
    CURRENT_TABLES.map((table) => [table, expectedRows.get(table)?.length ?? 0]),
  );

  const production = operation === "production";
  const safeManifest = {
    version: production ? 3 : 2,
    ...(production ? { operation: "production_merge_plan" } : {}),
    issue: "SK-80",
    snapshotTimestamp: config.snapshotTimestamp,
    sourceRole: production ? "old_skitza_frozen_snapshot" : "old_skitza_read_only",
    targetRole: production ? "skitza_v3_production_default" : "skitza_v3_rehearsal_child",
    configurationIdentity: {
      sourceDatabase: databaseIdentityDigest(config.sourceUrl),
      targetDatabase: databaseIdentityDigest(config.targetUrl),
      sourceProjectId: config.sourceProjectId,
      sourceBranchId: config.sourceBranchId,
      targetProjectId: config.targetProjectId,
      targetBranchId: config.targetBranchId,
      databaseName: EXPECTED_DATABASE_NAME,
    },
    rules: {
      sharedProducer: "target_wins",
      sharedSchedule: "target_wins",
      sameNameSourceProduct: "import_archived",
      contactIdentityCollision: "block_unless_byte_equivalent_same_uuid",
      legacyProjectStage: "human_decision",
      otherCurrentRows: "preserve_ids_and_projected_values",
      retiredSourceColumns: "exclude_and_refuse_on_target",
      legacyTables: "retain_in_untouched_source_only",
      pendingBooking: "pending_approval",
    },
    counts: recorder.counts,
    expectedCounts,
    transforms: recorder.transforms,
    excludedLegacyRows: excluded,
    targetLegacyRowsBefore: targetLegacyBefore,
    producerMappings: producerPlan.mappings.reduce((summary, mapping) => {
      summary[mapping.action] = (summary[mapping.action] ?? 0) + 1;
      return summary;
    }, {}),
    sourceSchemaFingerprint,
    targetSchemaFingerprint,
    sourceFingerprint,
    actionFingerprint: fingerprintActions(recorder.actions),
    targetFingerprint,
    blockers,
  };
  safeManifest.digest = manifestDigest(safeManifest);

  return {
    manifest: safeManifest,
    actions: recorder.actions,
    targetTables,
    sourceTables,
    targetColumns,
    targetRows,
    sourceRows,
    expectedRows,
    producerPlan,
  };
}

export function prepareInsert(table, row, columnDefinitions, overrides = {}) {
  const finalRow = { ...row, ...overrides };
  const columns = Object.keys(finalRow);
  if (columns.length === 0) throw new Error(`No insertable columns for ${table}.`);
  const definitions = new Map(
    (columnDefinitions ?? []).map((column) => [column.column_name, column]),
  );
  const values = [];
  const placeholders = columns.map((column, index) => {
    const definition = definitions.get(column);
    if (!definition) throw new Error(`Target column ${table}.${column} is not in the schema.`);
    const value = finalRow[column];
    if (definition.data_type === "json" || definition.data_type === "jsonb") {
      values.push(value === null ? null : JSON.stringify(value));
      return `$${index + 1}::${definition.data_type}`;
    }
    values.push(value);
    return `$${index + 1}`;
  });
  const sql = `insert into public.${quoteIdentifier(table)} (${columns
    .map(quoteIdentifier)
    .join(",")}) values (${placeholders.join(",")})`;
  return { sql, values };
}

async function insertRow(client, table, row, columnDefinitions, overrides = {}) {
  const statement = prepareInsert(table, row, columnDefinitions, overrides);
  await client.query(statement.sql, statement.values);
}

async function verifyConstraintState(db) {
  const result = await db.query(
    `select conrelid::regclass::text as table_name,conname
       from pg_constraint
      where connamespace='public'::regnamespace and not convalidated
      order by 1,2`,
  );
  return result.rows.map((row) => ({ table: row.table_name, constraint: row.conname }));
}

async function countForeignKeyOrphans(db, [table, columns, referencedTable, referencedColumns]) {
  const joins = columns
    .map(
      (column, index) =>
        `child.${quoteIdentifier(column)}=parent.${quoteIdentifier(referencedColumns[index])}`,
    )
    .join(" and ");
  const populated = columns
    .map((column) => `child.${quoteIdentifier(column)} is not null`)
    .join(" and ");
  const missing = `parent.${quoteIdentifier(referencedColumns[0])} is null`;
  const result = await db.query(
    `select count(*)::int as count
       from public.${quoteIdentifier(table)} child
       left join public.${quoteIdentifier(referencedTable)} parent on ${joins}
      where ${populated} and ${missing}`,
  );
  return Number(result.rows[0].count);
}

async function countDuplicateKeys(db, table, columns, predicate = "true") {
  const selected = columns.map(quoteIdentifier).join(",");
  const populated = columns.map((column) => `${quoteIdentifier(column)} is not null`).join(" and ");
  const result = await db.query(
    `select count(*)::int as count from (
       select ${selected}
         from public.${quoteIdentifier(table)}
        where (${predicate}) and ${populated}
        group by ${selected}
       having count(*) > 1
     ) duplicates`,
  );
  return Number(result.rows[0].count);
}

function rowsForProducer(rows, producerId) {
  return rows
    .filter((row) => row.producer_id === producerId)
    .map((row) => stableStringify(row))
    .sort();
}

async function verifyTargetState(db, plan) {
  const [actualRows, actualFingerprint, actualLegacy, unvalidatedConstraints] = await Promise.all([
    loadAllRows(db, plan.targetTables),
    databaseFingerprint(db, plan.targetTables),
    legacyCounts(db, plan.targetTables),
    verifyConstraintState(db),
  ]);
  const countMismatches = [];
  const rowMismatches = [];
  const semanticIssues = [];
  for (const table of CURRENT_TABLES) {
    const expectedCount = plan.manifest.expectedCounts[table];
    const actualCount = actualRows.get(table)?.length ?? 0;
    if (actualCount !== expectedCount) countMismatches.push({ table, expectedCount, actualCount });

    const actualByKey = byPrimaryKey(table, actualRows.get(table) ?? []);
    for (const before of plan.targetRows.get(table) ?? []) {
      const actual = actualByKey.get(primaryKey(table, before));
      if (!actual || !rowsEqualOnProjectedColumns(actual, before)) {
        rowMismatches.push({ table, ref: opaqueRowRef(table, before), kind: "target_changed" });
      }
    }
    for (const action of plan.actions.filter(
      (candidate) => candidate.kind === "insert" && candidate.table === table,
    )) {
      const actual = actualByKey.get(primaryKey(table, action.row));
      if (!actual || !rowsEqualOnProjectedColumns(actual, action.row)) {
        rowMismatches.push({
          table,
          ref: opaqueRowRef(table, action.row),
          kind: "insert_mismatch",
        });
      }
    }
  }

  const foreignKeyOrphans = [];
  for (const spec of REQUIRED_FOREIGN_KEYS) {
    const count = await countForeignKeyOrphans(db, spec);
    if (count > 0) foreignKeyOrphans.push({ table: spec[0], columns: spec[1], count });
  }
  const duplicateKeys = [];
  const duplicateSpecs = [
    ...REQUIRED_UNIQUE_CONSTRAINTS.map((spec) => [spec[0], spec[1], "true"]),
    ["invoices", ["stripe_payment_intent_id"], "stripe_payment_intent_id is not null"],
    ["invoices", ["payment_proof_id"], "payment_proof_id is not null"],
    ["payment_proofs", ["purchase_request_id"], "status='pending'"],
  ];
  for (const [table, columns, predicate] of duplicateSpecs) {
    const count = await countDuplicateKeys(db, table, columns, predicate);
    if (count > 0) duplicateKeys.push({ table, columns, count });
  }

  for (const mapping of plan.producerPlan.mappings) {
    const producer = (actualRows.get("producers") ?? []).find((row) => row.id === mapping.targetId);
    if (!producer) {
      semanticIssues.push({
        rule: "producer_mapping",
        ref: opaqueRowRef("producers", { id: mapping.sourceId }),
      });
    }
    if (mapping.action !== "target_wins") continue;
    for (const table of ["availability_blocks", "availability_blackouts"]) {
      const before = rowsForProducer(plan.targetRows.get(table) ?? [], mapping.targetId);
      const after = rowsForProducer(actualRows.get(table) ?? [], mapping.targetId);
      if (stableStringify(before) !== stableStringify(after)) {
        semanticIssues.push({ rule: "shared_schedule_target_wins", table });
      }
    }
    for (const sourceProduct of (plan.sourceRows.get("products") ?? []).filter(
      (row) => row.producer_id === mapping.sourceId,
    )) {
      const duplicateName = (plan.targetRows.get("products") ?? []).some(
        (row) =>
          row.id !== sourceProduct.id &&
          row.producer_id === mapping.targetId &&
          String(row.name).trim().toLowerCase() === String(sourceProduct.name).trim().toLowerCase(),
      );
      if (!duplicateName) continue;
      const imported = (actualRows.get("products") ?? []).find(
        (row) => row.id === sourceProduct.id,
      );
      if (
        !imported ||
        imported.producer_id !== mapping.targetId ||
        imported.active !== false ||
        new Date(imported.archived_at).toISOString() !==
          new Date(plan.manifest.snapshotTimestamp).toISOString()
      ) {
        semanticIssues.push({
          rule: "same_name_product_imported_archived",
          ref: opaqueRowRef("products", sourceProduct),
        });
      }
    }
  }

  const legacyMismatches = Object.entries(plan.manifest.targetLegacyRowsBefore)
    .filter(([table, count]) => actualLegacy[table] !== count)
    .map(([table, expected]) => ({ table, expected, actual: actualLegacy[table] }));
  const valid =
    countMismatches.length === 0 &&
    rowMismatches.length === 0 &&
    foreignKeyOrphans.length === 0 &&
    duplicateKeys.length === 0 &&
    semanticIssues.length === 0 &&
    legacyMismatches.length === 0 &&
    unvalidatedConstraints.length === 0;
  return {
    valid,
    targetFingerprintAfter: actualFingerprint,
    countMismatches,
    rowMismatches,
    foreignKeyOrphans,
    duplicateKeys,
    semanticIssues,
    legacyMismatches,
    unvalidatedConstraints,
  };
}

function totalInserts(manifest) {
  return Object.values(manifest.counts).reduce((total, count) => total + count.insert, 0);
}

function printManifest(manifest) {
  const serialized = JSON.stringify(manifest, null, 2);
  if (/postgres(?:ql)?:\/\/|@[^\s"]+\/neondb|password/i.test(serialized)) {
    throw new Error("Manifest safety check rejected credential-like output.");
  }
  process.stdout.write(`${serialized}\n`);
}

async function runWithPools(config, callback) {
  const sourcePool = createPool(config.sourceUrl);
  const targetPool = createPool(config.targetUrl);
  try {
    return await callback(sourcePool, targetPool);
  } finally {
    await Promise.all([closePool(sourcePool), closePool(targetPool)]);
  }
}

export async function withReadOnlySnapshot(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

function productionMergeConfig(config) {
  return {
    sourceUrl: config.sourceSnapshotUrl,
    targetUrl: config.targetUrl,
    sourceProjectId: config.sourceProjectId,
    sourceBranchId: config.sourceSnapshotBranchId,
    targetProjectId: config.targetProjectId,
    targetBranchId: config.targetBranchId,
    snapshotTimestamp: config.snapshotTimestamp,
  };
}

function branchBinding(value) {
  const project = unwrapMetadata(value.project, "project");
  const branch = unwrapMetadata(value.branch, "branch");
  return {
    projectId: project.id,
    projectDefaultBranchId: project.default_branch_id,
    branchId: branch.id,
    branchName: branch.name ?? null,
    parentBranchId: branch.parent_id ?? null,
    default: branch.default === true,
    createdAt: branch.created_at ?? null,
    expiresAt: branch.expires_at ?? null,
    ttlIntervalSeconds: branch.ttl_interval_seconds ?? null,
    currentState: branch.current_state ?? null,
    restoredFrom: branch.restored_from ?? null,
    restoredAs: branch.restored_as ?? null,
    restoreStatus: branch.restore_status ?? null,
  };
}

function snapshotBinding(snapshotInput) {
  const snapshot = unwrapMetadata(snapshotInput, "snapshot");
  return {
    snapshotId: snapshot.id,
    name: snapshot.name,
    sourceBranchId: snapshot.source_branch_id,
    lsn: snapshot.lsn ?? null,
    timestamp: snapshot.timestamp ?? null,
    createdAt: snapshot.created_at,
    expiresAt: snapshot.expires_at ?? null,
    manual: snapshot.manual === true,
  };
}

async function buildProductionPlan(
  config,
  metadata,
  sourceOriginClient,
  sourceSnapshotClient,
  targetBeforeClient,
  targetRestoreClient,
  targetSnapshotPreviewClient,
) {
  const targetBeforePromise = completeDatabaseFingerprint(targetBeforeClient);
  const targetRestorePromise =
    targetBeforeClient === targetRestoreClient
      ? targetBeforePromise
      : completeDatabaseFingerprint(targetRestoreClient);
  const targetSnapshotPreviewPromise = completeDatabaseFingerprint(targetSnapshotPreviewClient);
  const [
    sourceOriginComplete,
    sourceSnapshotComplete,
    targetBeforeComplete,
    targetRestoreComplete,
    targetSnapshotPreviewComplete,
  ] = await Promise.all([
    completeDatabaseFingerprint(sourceOriginClient),
    completeDatabaseFingerprint(sourceSnapshotClient),
    targetBeforePromise,
    targetRestorePromise,
    targetSnapshotPreviewPromise,
  ]);
  assertMatchingCompleteFingerprints(
    "Source origin and frozen source snapshot",
    sourceOriginComplete,
    sourceSnapshotComplete,
  );
  assertMatchingCompleteFingerprints(
    "Production target and target restore point",
    targetBeforeComplete,
    targetRestoreComplete,
  );
  assertMatchingCompleteFingerprints(
    "Production target and restored manual-snapshot preview",
    targetBeforeComplete,
    targetSnapshotPreviewComplete,
  );
  const mergePlan = await buildPlan(
    productionMergeConfig(config),
    sourceSnapshotClient,
    targetBeforeClient,
    { operation: "production" },
  );
  const manifest = {
    version: 2,
    kind: "skitza_neon_production_approval",
    issue: "SK-80",
    runId: config.runId,
    snapshotTimestamp: config.snapshotTimestamp,
    freezeAttestation: config.freezeAttestation,
    configurationIdentity: {
      sourceProjectId: config.sourceProjectId,
      sourceOriginBranchId: config.sourceOriginBranchId,
      sourceSnapshotBranchId: config.sourceSnapshotBranchId,
      targetProjectId: config.targetProjectId,
      targetBranchId: config.targetBranchId,
      targetRestoreBranchId: config.targetRestoreBranchId,
      targetSnapshotId: config.targetSnapshotId,
      targetSnapshotPreviewBranchId: config.targetSnapshotPreviewBranchId,
      sourceOriginDatabase: databaseIdentityDigest(config.sourceOriginUrl),
      sourceSnapshotDatabase: databaseIdentityDigest(config.sourceSnapshotUrl),
      targetDatabase: databaseIdentityDigest(config.targetUrl),
      targetRestoreDatabase: databaseIdentityDigest(config.targetRestoreUrl),
      targetSnapshotPreviewDatabase: databaseIdentityDigest(config.targetSnapshotPreviewUrl),
      databaseName: EXPECTED_DATABASE_NAME,
    },
    branchBindings: {
      sourceOrigin: branchBinding(metadata.sourceOrigin),
      sourceSnapshot: branchBinding(metadata.sourceSnapshot),
      targetCurrent: branchBinding(metadata.targetCurrent),
      targetRestore: branchBinding(metadata.targetRestore),
      targetSnapshot: snapshotBinding(metadata.targetSnapshot),
      targetSnapshotPreview: branchBinding(metadata.targetSnapshotPreview),
    },
    targetSnapshotInventoryCount: metadata.targetSnapshotInventoryCount,
    completeFingerprints: {
      sourceOrigin: sourceOriginComplete,
      sourceSnapshot: sourceSnapshotComplete,
      targetBefore: targetBeforeComplete,
      targetRestore: targetRestoreComplete,
      targetSnapshotPreview: targetSnapshotPreviewComplete,
    },
    policyArtifacts: productionPolicyArtifactFingerprints(),
    mergePlan: mergePlan.manifest,
    blockers: mergePlan.manifest.blockers,
  };
  manifest.digest = manifestDigest(manifest);
  return { manifest, mergePlan };
}

async function runWithProductionPools(config, callback) {
  const pools = {
    sourceOrigin: createPool(config.sourceOriginUrl),
    sourceSnapshot: createPool(config.sourceSnapshotUrl),
    target: createPool(config.targetUrl),
    targetRestore: createPool(config.targetRestoreUrl),
    targetSnapshotPreview: createPool(config.targetSnapshotPreviewUrl),
  };
  try {
    return await callback(pools);
  } finally {
    await Promise.all(Object.values(pools).map(closePool));
  }
}

async function readFreshSourceOriginFingerprint(config) {
  // This deliberately uses a new connection to the live origin, outside the
  // long-held repeatable-read snapshot used to build the production plan.
  const pool = createPool(config.sourceOriginUrl);
  let client;
  try {
    client = await pool.connect();
    await client.query("set default_transaction_read_only = on");
    return await completeDatabaseFingerprint(client);
  } finally {
    client?.release();
    await closePool(pool);
  }
}

async function withProductionReadSnapshots(pools, callback) {
  return withReadOnlySnapshot(pools.sourceOrigin, (sourceOriginClient) =>
    withReadOnlySnapshot(pools.sourceSnapshot, (sourceSnapshotClient) =>
      withReadOnlySnapshot(pools.target, (targetClient) =>
        withReadOnlySnapshot(pools.targetRestore, (targetRestoreClient) =>
          withReadOnlySnapshot(pools.targetSnapshotPreview, (targetSnapshotPreviewClient) =>
            callback({
              sourceOriginClient,
              sourceSnapshotClient,
              targetClient,
              targetRestoreClient,
              targetSnapshotPreviewClient,
            }),
          ),
        ),
      ),
    ),
  );
}

async function runProductionPlan(config) {
  const metadata = await guardProductionMetadata(config);
  return runWithProductionPools(config, (pools) =>
    withProductionReadSnapshots(
      pools,
      ({
        sourceOriginClient,
        sourceSnapshotClient,
        targetClient,
        targetRestoreClient,
        targetSnapshotPreviewClient,
      }) =>
        buildProductionPlan(
          config,
          metadata,
          sourceOriginClient,
          sourceSnapshotClient,
          targetClient,
          targetRestoreClient,
          targetSnapshotPreviewClient,
        ),
    ),
  );
}

async function runPlan(config) {
  await guardConsolidationMetadata(config, { requireLive: false });
  return runWithPools(config, async (sourcePool, targetPool) =>
    withReadOnlySnapshot(sourcePool, (sourceClient) =>
      withReadOnlySnapshot(targetPool, (targetClient) =>
        buildPlan(config, sourceClient, targetClient),
      ),
    ),
  );
}

export function resolveMigrationPaths(moduleUrl = import.meta.url) {
  return {
    script: fileURLToPath(new URL("./apply-migrations.mjs", moduleUrl)),
    cwd: fileURLToPath(new URL(".", moduleUrl)),
  };
}

export function resolveProductionPolicyArtifactPaths(moduleUrl = import.meta.url) {
  return {
    consolidationScript: {
      repositoryPath: "packages/db/consolidate-neon.mjs",
      path: fileURLToPath(new URL("./consolidate-neon.mjs", moduleUrl)),
    },
    databasePackage: {
      repositoryPath: "packages/db/package.json",
      path: fileURLToPath(new URL("./package.json", moduleUrl)),
    },
    consolidationRunbook: {
      repositoryPath: "docs/runbooks/neon-consolidation.md",
      path: fileURLToPath(new URL("../../docs/runbooks/neon-consolidation.md", moduleUrl)),
    },
  };
}

function exactRegularFileSha256(path) {
  if (!existsSync(path)) throw new Error("A production policy artifact is missing.");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("A production policy artifact must be a regular, non-symlink file.");
  }
  return sha256Bytes(readFileSync(path));
}

export function productionPolicyArtifactFingerprints(moduleUrl = import.meta.url) {
  const artifactPaths = resolveProductionPolicyArtifactPaths(moduleUrl);
  const artifacts = Object.fromEntries(
    Object.entries(artifactPaths).map(([role, artifact]) => [
      role,
      {
        repositoryPath: artifact.repositoryPath,
        sha256: exactRegularFileSha256(artifact.path),
      },
    ]),
  );
  const contract = { algorithm: "sha256-exact-file-bytes-v1", artifacts };
  return { ...contract, digest: manifestDigest(contract) };
}

async function prepareRehearsal(config) {
  await guardConsolidationMetadata(config, { requireLive: true });
  const paths = resolveMigrationPaths();
  const child = spawnSync(process.execPath, [paths.script], {
    cwd: paths.cwd,
    env: {
      DATABASE_URL: config.targetUrl,
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
    },
    stdio: "inherit",
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error("Rehearsal schema preparation failed; the migration runner stopped safely.");
  }
}

async function rehearse(config) {
  await guardConsolidationMetadata(config, { requireLive: true });
  const approvedDigest = requiredEnv(ENV.approvedDigest);

  return runWithPools(config, async (sourcePool, targetPool) => {
    return withReadOnlySnapshot(sourcePool, async (sourceClient) => {
      await guardConsolidationMetadata(config, { requireLive: true });
      const client = await targetPool.connect();
      try {
        await client.query("begin isolation level serializable");
        await client.query("select pg_advisory_xact_lock(hashtext('skitza-sk-80-consolidation'))");
        const plan = await buildPlan(config, sourceClient, client);
        if (plan.manifest.digest !== approvedDigest) {
          throw new Error(
            "The rebuilt manifest digest differs from the approved rehearsal digest.",
          );
        }
        if (plan.manifest.blockers.length > 0) {
          throw new Error("The rehearsal plan is blocked; no target writes were attempted.");
        }

        const inserts = plan.actions.filter((action) => action.kind === "insert");
        const byTable = new Map(
          INSERT_ORDER.map((table) => [table, inserts.filter((action) => action.table === table)]),
        );
        const projectPatches = [];
        for (const table of INSERT_ORDER) {
          for (const action of byTable.get(table)) {
            const definitions = plan.targetColumns.get(table) ?? [];
            if (table === "projects" && action.row.booking_id) {
              projectPatches.push({ id: action.row.id, bookingId: action.row.booking_id });
              await insertRow(client, table, action.row, definitions, { booking_id: null });
            } else {
              await insertRow(client, table, action.row, definitions);
            }
          }
          if (table === "bookings") {
            for (const patch of projectPatches) {
              await client.query("update public.projects set booking_id=$1 where id=$2", [
                patch.bookingId,
                patch.id,
              ]);
            }
          }
        }
        await client.query("set constraints all immediate");
        const postPlan = await buildPlan(config, sourceClient, client);
        if (postPlan.manifest.blockers.length > 0 || totalInserts(postPlan.manifest) !== 0) {
          throw new Error("Post-rehearsal idempotency verification failed.");
        }
        const verification = await verifyTargetState(client, plan);
        if (!verification.valid) {
          throw new Error(
            "Rehearsal verification failed inside the transaction; all writes rolled back.",
          );
        }
        await client.query("commit");
        plan.manifest.verification = verification;
        plan.manifest.digest = manifestDigest({ ...plan.manifest, digest: undefined });
        return plan;
      } catch (error) {
        try {
          await client.query("rollback");
        } catch {
          // Preserve the original sanitized failure.
        }
        throw error;
      } finally {
        client.release();
      }
    });
  });
}

async function verifyRehearsal(config) {
  await guardConsolidationMetadata(config, { requireLive: false });
  const expectedSourceDigest = requiredEnv(ENV.expectedSourceDigest);
  const expectedTargetDigest = requiredEnv(ENV.expectedTargetDigest);
  return runWithPools(config, async (sourcePool, targetPool) => {
    return withReadOnlySnapshot(sourcePool, (sourceClient) =>
      withReadOnlySnapshot(targetPool, async (targetClient) => {
        const plan = await buildPlan(config, sourceClient, targetClient);
        const verification = await verifyTargetState(targetClient, plan);
        verification.proposedInserts = totalInserts(plan.manifest);
        verification.idempotent = verification.proposedInserts === 0;
        verification.sourceFingerprintMatches =
          plan.manifest.sourceFingerprint.digest === expectedSourceDigest;
        verification.targetFingerprintMatches =
          verification.targetFingerprintAfter.digest === expectedTargetDigest;
        plan.manifest.verification = verification;
        plan.manifest.digest = manifestDigest({ ...plan.manifest, digest: undefined });
        if (
          plan.manifest.blockers.length > 0 ||
          !verification.valid ||
          !verification.idempotent ||
          !verification.sourceFingerprintMatches ||
          !verification.targetFingerprintMatches
        ) {
          throw new Error("Rehearsal verification failed; inspect the read-only manifest.");
        }
        return plan;
      }),
    );
  });
}

export function productionTargetLockStatement(tableNames = CURRENT_TABLES) {
  const tables = [...new Set(tableNames)].sort();
  if (tables.length === 0) {
    throw new Error("Production cannot fingerprint or lock an empty public base-table set.");
  }
  const names = tables.map((table) => `public.${quoteCatalogIdentifier(table)}`).join(",");
  return `lock table ${names} in share row exclusive mode`;
}

export async function beginLockedProductionTransaction(client) {
  // Discover relations before BEGIN so this catalog read cannot establish the
  // SERIALIZABLE snapshot. LOCK must be the transaction's first
  // snapshot-relevant command; otherwise a concurrent writer could commit
  // while LOCK waits and remain invisible to the transaction.
  const tableNames = [...(await listTables(client))].sort();
  await client.query("begin isolation level serializable");
  await client.query("set local lock_timeout = '10s'");
  await client.query("set local statement_timeout = '120s'");
  await client.query(productionTargetLockStatement(tableNames));

  // Re-read after the locks establish the transaction view. A concurrently
  // added table was not in the lock set and must abort the run.
  const currentTableNames = [...(await listTables(client))].sort();
  if (stableStringify(currentTableNames) !== stableStringify(tableNames)) {
    throw new Error("The public target base-table set changed while production locks were taken.");
  }
  return tableNames;
}

export function assertLockedTargetTablesMatchFingerprint(lockedTableNames, fingerprint) {
  const locked = [...new Set(lockedTableNames)].sort();
  const fingerprinted = Object.keys(fingerprint?.data?.tables ?? {}).sort();
  if (stableStringify(locked) !== stableStringify(fingerprinted)) {
    throw new Error("The locked target base-table set does not match the complete fingerprint.");
  }
}

async function executePlannedInserts(client, plan) {
  const inserts = plan.actions.filter((action) => action.kind === "insert");
  const byTable = new Map(
    INSERT_ORDER.map((table) => [table, inserts.filter((action) => action.table === table)]),
  );
  const projectPatches = [];
  for (const table of INSERT_ORDER) {
    for (const action of byTable.get(table)) {
      const definitions = plan.targetColumns.get(table) ?? [];
      if (table === "projects" && action.row.booking_id) {
        projectPatches.push({ id: action.row.id, bookingId: action.row.booking_id });
        await insertRow(client, table, action.row, definitions, { booking_id: null });
      } else {
        await insertRow(client, table, action.row, definitions);
      }
    }
    if (table === "bookings") {
      for (const patch of projectPatches) {
        await client.query("update public.projects set booking_id=$1 where id=$2", [
          patch.bookingId,
          patch.id,
        ]);
      }
    }
  }
}

export async function preserveAcknowledgedProductionReceipt(
  operation,
  getAcknowledgedReceipt,
  warn = console.error,
) {
  try {
    return await operation();
  } catch (error) {
    const receipt = getAcknowledgedReceipt();
    if (!receipt) throw error;
    warn(
      "[consolidation] production COMMIT was acknowledged; a read-only cleanup failed after success",
    );
    return receipt;
  }
}

function productionResultReceipt({ approvedManifest, targetFingerprintAfter }) {
  const receipt = {
    version: 1,
    kind: "skitza_neon_production_result_receipt",
    issue: "SK-80",
    runId: approvedManifest.runId,
    snapshotTimestamp: approvedManifest.snapshotTimestamp,
    approvedManifestDigest: approvedManifest.digest,
    sourceSnapshotFingerprint: approvedManifest.completeFingerprints.sourceSnapshot.digest,
    targetRestoreFingerprint: approvedManifest.completeFingerprints.targetRestore.digest,
    targetSnapshotId: approvedManifest.configurationIdentity.targetSnapshotId,
    targetSnapshotPreviewFingerprint:
      approvedManifest.completeFingerprints.targetSnapshotPreview.digest,
    actionFingerprint: approvedManifest.mergePlan.actionFingerprint.digest,
    targetFingerprintAfter: targetFingerprintAfter.digest,
    expectedCounts: approvedManifest.mergePlan.expectedCounts,
    verification: { valid: true, idempotent: true },
  };
  return { ...receipt, resultReceiptDigest: manifestDigest(receipt) };
}

async function applyProduction(config) {
  await guardProductionMetadata(config);
  const approvedDigest = requiredEnv(ENV.approvedProductionDigest);
  const suppliedConfirmation = requiredEnv(ENV.productionConfirmation);
  assertProductionApproval(config, approvedDigest, suppliedConfirmation);

  return runWithProductionPools(config, async (pools) => {
    let acknowledgedReceipt;
    return preserveAcknowledgedProductionReceipt(
      () =>
        withReadOnlySnapshot(pools.sourceOrigin, (sourceOriginClient) =>
          withReadOnlySnapshot(pools.sourceSnapshot, (sourceSnapshotClient) =>
            withReadOnlySnapshot(pools.targetRestore, (targetRestoreClient) =>
              withReadOnlySnapshot(
                pools.targetSnapshotPreview,
                async (targetSnapshotPreviewClient) => {
                  const metadata = await guardProductionMetadata(config);
                  const client = await pools.target.connect();
                  let commitAttempted = false;
                  try {
                    const lockedTargetTableNames = await beginLockedProductionTransaction(client);
                    await client.query(
                      "select pg_advisory_xact_lock(hashtext('skitza-sk-80-production-consolidation'))",
                    );
                    const productionPlan = await buildProductionPlan(
                      config,
                      metadata,
                      sourceOriginClient,
                      sourceSnapshotClient,
                      client,
                      targetRestoreClient,
                      targetSnapshotPreviewClient,
                    );
                    assertLockedTargetTablesMatchFingerprint(
                      lockedTargetTableNames,
                      productionPlan.manifest.completeFingerprints.targetBefore,
                    );
                    if (productionPlan.manifest.digest !== approvedDigest) {
                      throw new Error(
                        "The rebuilt production manifest differs from the exactly approved digest.",
                      );
                    }
                    if (productionPlan.manifest.blockers.length > 0) {
                      throw new Error("The production plan is blocked; no inserts were attempted.");
                    }

                    await executePlannedInserts(client, productionPlan.mergePlan);
                    await client.query("set constraints all immediate");
                    const postPlan = await buildPlan(
                      productionMergeConfig(config),
                      sourceSnapshotClient,
                      client,
                      { operation: "production" },
                    );
                    if (
                      postPlan.manifest.blockers.length > 0 ||
                      totalInserts(postPlan.manifest) !== 0
                    ) {
                      throw new Error(
                        "Production idempotency verification failed inside the transaction.",
                      );
                    }
                    const verification = await verifyTargetState(client, productionPlan.mergePlan);
                    if (!verification.valid) {
                      throw new Error(
                        "Production verification failed inside the transaction; all inserts were rolled back.",
                      );
                    }
                    const targetFingerprintAfter = await completeDatabaseFingerprint(client);
                    const receipt = productionResultReceipt({
                      approvedManifest: productionPlan.manifest,
                      targetFingerprintAfter,
                    });
                    const freshSourceOriginFingerprint =
                      await readFreshSourceOriginFingerprint(config);
                    assertSourceOriginUnchangedBeforeCommit(
                      productionPlan.manifest.completeFingerprints.sourceOrigin,
                      freshSourceOriginFingerprint,
                    );
                    commitAttempted = true;
                    await commitProductionTransaction(client, targetFingerprintAfter.digest);
                    acknowledgedReceipt = receipt;
                    return acknowledgedReceipt;
                  } catch (error) {
                    if (commitAttempted || error?.code === UNKNOWN_COMMIT_OUTCOME_CODE) throw error;
                    try {
                      await client.query("rollback");
                    } catch {
                      // Preserve the original credential-safe failure.
                    }
                    throw error;
                  } finally {
                    client.release();
                  }
                },
              ),
            ),
          ),
        ),
      () => acknowledgedReceipt,
    );
  });
}

async function verifyProduction(config) {
  const metadata = await guardProductionMetadata(config);
  const approvedDigest = requiredEnv(ENV.approvedProductionDigest);
  const expectedTargetDigest = requiredEnv(ENV.expectedProductionTargetDigest);
  if (!/^[a-f0-9]{64}$/.test(approvedDigest) || !/^[a-f0-9]{64}$/.test(expectedTargetDigest)) {
    throw new Error("Production verification digests must be exact SHA-256 values.");
  }
  return runWithProductionPools(config, (pools) =>
    withProductionReadSnapshots(
      pools,
      async ({
        sourceOriginClient,
        sourceSnapshotClient,
        targetClient,
        targetRestoreClient,
        targetSnapshotPreviewClient,
      }) => {
        const referencePlan = await buildProductionPlan(
          config,
          metadata,
          sourceOriginClient,
          sourceSnapshotClient,
          targetRestoreClient,
          targetRestoreClient,
          targetSnapshotPreviewClient,
        );
        if (referencePlan.manifest.digest !== approvedDigest) {
          throw new Error(
            "The frozen source or restore point no longer matches the approved plan.",
          );
        }
        const currentPlan = await buildPlan(
          productionMergeConfig(config),
          sourceSnapshotClient,
          targetClient,
          { operation: "production" },
        );
        const verification = await verifyTargetState(targetClient, referencePlan.mergePlan);
        verification.proposedInserts = totalInserts(currentPlan.manifest);
        verification.idempotent = verification.proposedInserts === 0;
        const targetFingerprintAfter = await completeDatabaseFingerprint(targetClient);
        verification.targetFingerprintMatches =
          targetFingerprintAfter.digest === expectedTargetDigest;
        verification.sourceSnapshotUnchanged =
          referencePlan.manifest.completeFingerprints.sourceOrigin.digest ===
          referencePlan.manifest.completeFingerprints.sourceSnapshot.digest;
        verification.restorePointUnchanged =
          referencePlan.manifest.completeFingerprints.targetBefore.digest ===
          referencePlan.manifest.completeFingerprints.targetRestore.digest;
        verification.snapshotPreviewUnchanged =
          referencePlan.manifest.completeFingerprints.targetBefore.digest ===
          referencePlan.manifest.completeFingerprints.targetSnapshotPreview.digest;
        if (
          currentPlan.manifest.blockers.length > 0 ||
          !verification.valid ||
          !verification.idempotent ||
          !verification.targetFingerprintMatches ||
          !verification.sourceSnapshotUnchanged ||
          !verification.restorePointUnchanged ||
          !verification.snapshotPreviewUnchanged
        ) {
          throw new Error("Production read-only verification failed.");
        }
        return {
          ...productionResultReceipt({
            approvedManifest: referencePlan.manifest,
            targetFingerprintAfter,
          }),
          checks: verification,
        };
      },
    ),
  );
}

async function main() {
  const mode = process.argv[2];
  if (
    !new Set([
      "plan",
      "prepare-rehearsal",
      "rehearse",
      "verify",
      "plan-production",
      "apply-production",
      "verify-production",
    ]).has(mode)
  ) {
    throw new Error(
      "Usage: consolidate-neon.mjs <plan|prepare-rehearsal|rehearse|verify|plan-production|apply-production|verify-production>",
    );
  }
  if (mode === "plan-production") {
    const config = readProductionConfig(mode);
    const plan = await runProductionPlan(config);
    printManifest(plan.manifest);
    process.exitCode = plan.manifest.blockers.length > 0 ? 2 : 0;
    return;
  }
  if (mode === "apply-production") {
    const receipt = await applyProduction(readProductionConfig(mode));
    printManifest(receipt);
    return;
  }
  if (mode === "verify-production") {
    const receipt = await verifyProduction(readProductionConfig(mode));
    printManifest(receipt);
    return;
  }
  const config = readConfig();

  if (mode === "plan") {
    const plan = await runPlan(config);
    printManifest(plan.manifest);
    process.exitCode = plan.manifest.blockers.length > 0 ? 2 : 0;
    return;
  }
  if (mode === "prepare-rehearsal") {
    await prepareRehearsal(config);
    const plan = await runPlan(config);
    printManifest(plan.manifest);
    process.exitCode = plan.manifest.blockers.length > 0 ? 2 : 0;
    return;
  }
  if (mode === "rehearse") {
    const plan = await rehearse(config);
    printManifest(plan.manifest);
    return;
  }
  const plan = await verifyRehearsal(config);
  printManifest(plan.manifest);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    console.error(`[consolidation] ${safeError(error, "operation failed safely")}`);
    process.exitCode = 1;
  });
}
