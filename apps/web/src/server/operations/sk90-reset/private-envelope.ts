import { randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { chmod, link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  compareUtf8Bytes,
  protectValue,
  sameDigest,
  sha256Digest,
  type JsonValue,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import { stop } from "./errors";
import type { SanitizedResetManifest } from "./manifest";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function errno(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function assertOwner(stats: Stats): void {
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    stop("PHASE_STATE_INVALID");
  }
}

function assertPrivateDirectoryStats(stats: Stats): void {
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    (stats.mode & 0o777) !== PRIVATE_DIRECTORY_MODE
  ) {
    stop("PHASE_STATE_INVALID");
  }
  assertOwner(stats);
}

function assertPrivateFileStats(stats: Stats): void {
  if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o777) !== PRIVATE_FILE_MODE) {
    stop("PHASE_STATE_INVALID");
  }
  assertOwner(stats);
}

/** Require one dedicated owner-only directory. Parent directories are never changed. */
export async function ensureOwnerOnlyDirectory(path: string, create = false): Promise<string> {
  const absolute = resolve(path);
  let stats: Stats;
  try {
    stats = await lstat(absolute);
  } catch (error) {
    if (!create || errno(error) !== "ENOENT") stop("PHASE_STATE_INVALID");
    try {
      await mkdir(absolute, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (mkdirError) {
      // Two exact runners may race to create the same private directory. The
      // immutable journal/approval claims decide the winner after both verify
      // the directory that actually exists.
      if (errno(mkdirError) !== "EEXIST") stop("PHASE_STATE_INVALID");
    }
    try {
      stats = await lstat(absolute);
    } catch {
      stop("PHASE_STATE_INVALID");
    }
  }
  assertPrivateDirectoryStats(stats);
  return absolute;
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    await handle.sync();
  } catch {
    stop("PHASE_STATE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function assertReplaceablePrivateFile(path: string): Promise<boolean> {
  try {
    assertPrivateFileStats(await lstat(path));
    return true;
  } catch (error) {
    if (errno(error) === "ENOENT") return false;
    stop("PHASE_STATE_INVALID");
  }
}

async function privateTemporaryFile(path: string, contents: string): Promise<string> {
  const directory = dirname(path);
  const temporary = join(directory, `.${basename(path)}.${randomBytes(16).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    await chmod(temporary, PRIVATE_FILE_MODE);
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
    assertPrivateFileStats(await handle.stat());
    return temporary;
  } catch {
    await unlink(temporary).catch(() => undefined);
    stop("PHASE_STATE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return stop("PHASE_STATE_INVALID");
}

/** Read through O_NOFOLLOW and reject non-owner or group/world-readable files. */
export async function readOwnerOnlyUtf8(path: string): Promise<string> {
  const absolute = resolve(path);
  await ensureOwnerOnlyDirectory(dirname(absolute));
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    assertPrivateFileStats(await handle.stat());
    return await handle.readFile({ encoding: "utf8" });
  } catch {
    stop("PHASE_STATE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return stop("PHASE_STATE_INVALID");
}

/** Atomic owner-only replacement. Existing symlinks or permissive files are refused. */
export async function writeOwnerOnlyUtf8Atomic(path: string, contents: string): Promise<void> {
  const absolute = resolve(path);
  const directory = await ensureOwnerOnlyDirectory(dirname(absolute), true);
  await assertReplaceablePrivateFile(absolute);
  const temporary = await privateTemporaryFile(absolute, contents);
  try {
    await rename(temporary, absolute);
    assertPrivateFileStats(await lstat(absolute));
    await syncDirectory(directory);
  } catch {
    await unlink(temporary).catch(() => undefined);
    stop("PHASE_STATE_INVALID");
  }
}

/**
 * Publish an immutable revision with an atomic hard-link claim. EEXIST is a
 * compare-and-swap loss; no existing state is overwritten.
 */
export async function publishOwnerOnlyUtf8Exclusive(path: string, contents: string): Promise<void> {
  const absolute = resolve(path);
  const directory = await ensureOwnerOnlyDirectory(dirname(absolute), true);
  if (await assertReplaceablePrivateFile(absolute)) stop("PHASE_STATE_INVALID");
  const temporary = await privateTemporaryFile(absolute, contents);
  try {
    await link(temporary, absolute);
    assertPrivateFileStats(await lstat(absolute));
    await syncDirectory(directory);
    await unlink(temporary);
    await syncDirectory(directory);
  } catch {
    await unlink(temporary).catch(() => undefined);
    stop("PHASE_STATE_INVALID");
  }
}

export type PrivateResetRow = Readonly<{
  category: string;
  table: string;
  id: string;
  payload: JsonValue;
}>;

export type PrivateStorageReference = Readonly<{
  bucketRole: "audio" | "docs";
  key: string;
  referencedBy: "reset" | "preserved";
}>;

export type PrivateStorageObject = Readonly<{
  bucketRole: "audio" | "docs";
  key: string;
  ownership: "reset_exclusive" | "preserved_only";
  sizeBytes: number;
  contentFingerprint: Sha256Digest;
  metadataFingerprint: Sha256Digest;
}>;

export type PrivateProviderReference = Readonly<{
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

type PrivateEnvelopeBody = Readonly<{
  contract: "sk90-private-execution-envelope-v1";
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  targetPolicyDigest: Sha256Digest;
  rows: readonly PrivateResetRow[];
  storageReferences: readonly PrivateStorageReference[];
  storageObjects: readonly PrivateStorageObject[];
  providerReferences: readonly PrivateProviderReference[];
}>;

export type PrivateExecutionEnvelope = PrivateEnvelopeBody &
  Readonly<{ bindingToken: ProtectedToken }>;

export function privateExecutionEnvelopeDigest(
  envelope: PrivateExecutionEnvelope,
): Sha256Digest {
  return sha256Digest(canonicalJson(envelope));
}

export type RecomputedPrivateTokens = Readonly<{
  rows: readonly Readonly<{
    category: string;
    table: string;
    protectedId: ProtectedToken;
    protectedContent: ProtectedToken;
  }>[];
  storageReferences: readonly Readonly<{
    bucketRole: "audio" | "docs";
    protectedKey: ProtectedToken;
    referencedBy: "reset" | "preserved";
  }>[];
  storageObjects: readonly Readonly<{
    bucketRole: "audio" | "docs";
    protectedKey: ProtectedToken;
    ownership: "reset_exclusive" | "preserved_only";
    sizeBytes: number;
    contentFingerprint: Sha256Digest;
    metadataFingerprint: Sha256Digest;
  }>[];
  providerReferences: readonly Readonly<{
    token: ProtectedToken;
    provider: "stripe" | "tranzila";
    mode: "test";
    attested: true;
    chargeEnabled: false;
    externalCharge: false;
    liveSchedule: false;
  }>[];
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertSafeLabel(value: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value)) stop("MANIFEST_INPUT_INVALID");
}

function normalizedEnvelopeBody(body: PrivateEnvelopeBody): PrivateEnvelopeBody {
  assertSha256Digest(body.artifactDigest);
  assertSha256Digest(body.manifestDigest);
  assertSha256Digest(body.targetPolicyDigest);

  const rowIdentities = new Set<string>();
  const rows = body.rows.map((row) => {
    assertSafeLabel(row.category);
    assertSafeLabel(row.table);
    if (typeof row.id !== "string" || row.id.length === 0) stop("MANIFEST_INPUT_INVALID");
    canonicalJson(row.payload);
    const identity = `${row.table}\0${row.id}`;
    if (rowIdentities.has(identity)) stop("MANIFEST_DUPLICATE_ENTRY");
    rowIdentities.add(identity);
    return { category: row.category, table: row.table, id: row.id, payload: row.payload };
  });

  const storageIdentities = new Set<string>();
  const storageReferences = body.storageReferences.map((reference) => {
    const bucketRole: unknown = reference.bucketRole;
    const referencedBy: unknown = reference.referencedBy;
    if (
      (bucketRole !== "audio" && bucketRole !== "docs") ||
      (referencedBy !== "reset" && referencedBy !== "preserved") ||
      typeof reference.key !== "string" ||
      reference.key.length === 0
    ) {
      stop("MANIFEST_INPUT_INVALID");
    }
    const identity = `${reference.bucketRole}\0${reference.key}\0${reference.referencedBy}`;
    if (storageIdentities.has(identity)) stop("MANIFEST_DUPLICATE_ENTRY");
    storageIdentities.add(identity);
    return {
      bucketRole: reference.bucketRole,
      key: reference.key,
      referencedBy: reference.referencedBy,
    };
  });

  const storageObjectIdentities = new Set<string>();
  const storageObjects = body.storageObjects.map((object) => {
    const untrusted = object as unknown as Record<keyof PrivateStorageObject, unknown>;
    if (
      (untrusted.bucketRole !== "audio" && untrusted.bucketRole !== "docs") ||
      (untrusted.ownership !== "reset_exclusive" && untrusted.ownership !== "preserved_only") ||
      typeof untrusted.key !== "string" ||
      untrusted.key.length === 0 ||
      typeof untrusted.sizeBytes !== "number" ||
      !Number.isSafeInteger(untrusted.sizeBytes) ||
      untrusted.sizeBytes < 0 ||
      typeof untrusted.contentFingerprint !== "string" ||
      typeof untrusted.metadataFingerprint !== "string"
    ) {
      stop("MANIFEST_INPUT_INVALID");
    }
    assertSha256Digest(untrusted.contentFingerprint);
    assertSha256Digest(untrusted.metadataFingerprint);
    const identity = `${untrusted.bucketRole}\0${untrusted.key}`;
    if (storageObjectIdentities.has(identity)) stop("MANIFEST_DUPLICATE_ENTRY");
    storageObjectIdentities.add(identity);
    return { ...object };
  });

  if (body.providerReferences.length !== 7) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  const providerIdentities = new Set<string>();
  let stripeCount = 0;
  let tranzilaCount = 0;
  const providerReferences = body.providerReferences.map((reference) => {
    const untrusted = reference as unknown as Record<keyof PrivateProviderReference, unknown>;
    const sourceKind = untrusted.sourceKind;
    const provider = untrusted.provider;
    if (
      (sourceKind !== "producer_stripe_account" &&
        sourceKind !== "booking_tranzila_confirmation") ||
      (provider !== "stripe" && provider !== "tranzila") ||
      typeof untrusted.ownerId !== "string" ||
      !UUID_PATTERN.test(untrusted.ownerId) ||
      typeof untrusted.providerValue !== "string" ||
      untrusted.providerValue.length === 0 ||
      untrusted.mode !== "test" ||
      untrusted.attested !== true ||
      untrusted.chargeEnabled !== false ||
      untrusted.externalCharge !== false ||
      untrusted.liveSchedule !== false ||
      (sourceKind === "producer_stripe_account" ? provider !== "stripe" : provider !== "tranzila")
    ) {
      stop("PROVIDER_REFERENCE_NOT_APPROVED_TEST");
    }
    const identity = `${reference.sourceKind}\0${reference.ownerId}\0${reference.providerValue}`;
    if (providerIdentities.has(identity)) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
    providerIdentities.add(identity);
    if (reference.sourceKind === "producer_stripe_account") stripeCount += 1;
    else tranzilaCount += 1;
    return { ...reference };
  });
  if (stripeCount !== 3 || tranzilaCount !== 4) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");

  return {
    contract: "sk90-private-execution-envelope-v1",
    artifactDigest: body.artifactDigest,
    manifestDigest: body.manifestDigest,
    targetPolicyDigest: body.targetPolicyDigest,
    rows,
    storageReferences,
    storageObjects,
    providerReferences,
  };
}

function envelopeBinding(key: string, body: PrivateEnvelopeBody): ProtectedToken {
  return protectValue(key, `sk90-private-execution-envelope\0${canonicalJson(body)}`);
}

export function bindPrivateExecutionEnvelope(
  input: Omit<PrivateEnvelopeBody, "contract">,
  hmacKey: string,
): PrivateExecutionEnvelope {
  const body = normalizedEnvelopeBody({
    contract: "sk90-private-execution-envelope-v1",
    ...input,
  });
  return { ...body, bindingToken: envelopeBinding(hmacKey, body) };
}

export function assertPrivateExecutionEnvelope(
  value: unknown,
  hmacKey: string,
  expected?: Readonly<{
    artifactDigest: Sha256Digest;
    manifestDigest: Sha256Digest;
    targetPolicyDigest: Sha256Digest;
  }>,
): PrivateExecutionEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  const candidate = value as Partial<PrivateExecutionEnvelope>;
  if (
    candidate.contract !== "sk90-private-execution-envelope-v1" ||
    typeof candidate.artifactDigest !== "string" ||
    typeof candidate.manifestDigest !== "string" ||
    typeof candidate.targetPolicyDigest !== "string" ||
    !Array.isArray(candidate.rows) ||
    !Array.isArray(candidate.storageReferences) ||
    !Array.isArray(candidate.storageObjects) ||
    !Array.isArray(candidate.providerReferences) ||
    typeof candidate.bindingToken !== "string"
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  const body = normalizedEnvelopeBody(candidate as PrivateEnvelopeBody);
  assertProtectedToken(candidate.bindingToken);
  if (!sameDigest(candidate.bindingToken, envelopeBinding(hmacKey, body))) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  if (expected) {
    assertSha256Digest(expected.artifactDigest);
    assertSha256Digest(expected.manifestDigest);
    assertSha256Digest(expected.targetPolicyDigest);
    if (
      !sameDigest(body.artifactDigest, expected.artifactDigest) ||
      !sameDigest(body.manifestDigest, expected.manifestDigest) ||
      !sameDigest(body.targetPolicyDigest, expected.targetPolicyDigest)
    ) {
      stop("ARTIFACT_BINDING_MISMATCH");
    }
  }
  return { ...body, bindingToken: candidate.bindingToken };
}

export function recomputePrivateEnvelopeTokens(
  envelope: PrivateExecutionEnvelope,
  hmacKey: string,
): RecomputedPrivateTokens {
  const checked = assertPrivateExecutionEnvelope(envelope, hmacKey);
  const rows = checked.rows
    .map((row) => ({
      category: row.category,
      table: row.table,
      protectedId: protectValue(hmacKey, `row-id\0${row.table}\0${row.id}`),
      protectedContent: protectValue(
        hmacKey,
        `row-content\0${row.table}\0${canonicalJson(row.payload)}`,
      ),
    }))
    .sort((left, right) =>
      compareUtf8Bytes(`${left.table}:${left.protectedId}`, `${right.table}:${right.protectedId}`),
    );
  const storageReferences = checked.storageReferences
    .map((reference) => ({
      bucketRole: reference.bucketRole,
      protectedKey: protectValue(hmacKey, `storage-key\0${reference.bucketRole}\0${reference.key}`),
      referencedBy: reference.referencedBy,
    }))
    .sort((left, right) =>
      compareUtf8Bytes(
        `${left.bucketRole}:${left.protectedKey}:${left.referencedBy}`,
        `${right.bucketRole}:${right.protectedKey}:${right.referencedBy}`,
      ),
    );
  const storageObjects = checked.storageObjects
    .map((object) => ({
      bucketRole: object.bucketRole,
      protectedKey: protectValue(hmacKey, `storage-key\0${object.bucketRole}\0${object.key}`),
      ownership: object.ownership,
      sizeBytes: object.sizeBytes,
      contentFingerprint: object.contentFingerprint,
      metadataFingerprint: object.metadataFingerprint,
    }))
    .sort((left, right) =>
      compareUtf8Bytes(
        `${left.bucketRole}:${left.protectedKey}`,
        `${right.bucketRole}:${right.protectedKey}`,
      ),
    );
  const providerReferences = checked.providerReferences
    .map((reference) => ({
      token: protectValue(
        hmacKey,
        `provider-reference\0${reference.sourceKind}\0${reference.ownerId}\0${reference.providerValue}`,
      ),
      provider: reference.provider,
      mode: reference.mode,
      attested: reference.attested,
      chargeEnabled: reference.chargeEnabled,
      externalCharge: reference.externalCharge,
      liveSchedule: reference.liveSchedule,
    }))
    .sort((left, right) => compareUtf8Bytes(left.token, right.token));
  return { rows, storageReferences, storageObjects, providerReferences };
}

/** Exact protected full-namespace fingerprint shared with the R2 adapter. */
export function privateStorageNamespaceFingerprint(
  envelope: PrivateExecutionEnvelope,
  hmacKey: string,
): Sha256Digest {
  const objects = recomputePrivateEnvelopeTokens(envelope, hmacKey).storageObjects.map(
    ({
      bucketRole,
      protectedKey,
      ownership,
      sizeBytes,
      contentFingerprint,
      metadataFingerprint,
    }) => ({
      bucketRole,
      protectedKey,
      ownership,
      sizeBytes,
      contentFingerprint,
      metadataFingerprint,
    }),
  );
  return sha256Digest(canonicalJson(objects));
}

/** Recompute every private token and compare it with the approved sanitized manifest. */
export function assertPrivateEnvelopeMatchesManifest(
  envelope: PrivateExecutionEnvelope,
  manifest: SanitizedResetManifest,
  hmacKey: string,
): true {
  const checked = assertPrivateExecutionEnvelope(envelope, hmacKey, {
    artifactDigest: envelope.artifactDigest,
    manifestDigest: manifest.digest,
    targetPolicyDigest: manifest.targetPolicyDigest,
  });
  const observed = recomputePrivateEnvelopeTokens(checked, hmacKey);
  const expectedRows = [...manifest.rows].sort((left, right) =>
    compareUtf8Bytes(`${left.table}:${left.protectedId}`, `${right.table}:${right.protectedId}`),
  );
  const expectedStorage = manifest.storageReferences
    .map(({ bucketRole, protectedKey, referencedBy }) => ({
      bucketRole,
      protectedKey,
      referencedBy,
    }))
    .sort((left, right) =>
      compareUtf8Bytes(
        `${left.bucketRole}:${left.protectedKey}:${left.referencedBy}`,
        `${right.bucketRole}:${right.protectedKey}:${right.referencedBy}`,
      ),
    );
  const expectedStorageObjects = manifest.storageObjects
    .map((object) => ({
      bucketRole: object.bucketRole,
      protectedKey: object.protectedKey,
      ownership: object.ownership,
      contentFingerprint: object.contentFingerprint,
    }))
    .sort((left, right) =>
      compareUtf8Bytes(
        `${left.bucketRole}:${left.protectedKey}`,
        `${right.bucketRole}:${right.protectedKey}`,
      ),
    );
  const observedStorageObjects = observed.storageObjects.map(
    ({ bucketRole, protectedKey, ownership, contentFingerprint }) => ({
      bucketRole,
      protectedKey,
      ownership,
      contentFingerprint,
    }),
  );
  const providerReferenceTokensFingerprint = sha256Digest(
    canonicalJson(observed.providerReferences.map(({ token }) => token).sort(compareUtf8Bytes)),
  );
  if (
    canonicalJson(observed.rows) !== canonicalJson(expectedRows) ||
    canonicalJson(observed.storageReferences) !== canonicalJson(expectedStorage) ||
    canonicalJson(observedStorageObjects) !== canonicalJson(expectedStorageObjects) ||
    !sameDigest(
      providerReferenceTokensFingerprint,
      manifest.mockEvidenceCoverage.providerReferenceTokensFingerprint,
    )
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  return true;
}

export async function writePrivateExecutionEnvelope(
  path: string,
  envelope: PrivateExecutionEnvelope,
  hmacKey: string,
): Promise<void> {
  const checked = assertPrivateExecutionEnvelope(envelope, hmacKey);
  await writeOwnerOnlyUtf8Atomic(path, canonicalJson(checked));
}

export async function readPrivateExecutionEnvelope(
  path: string,
  hmacKey: string,
  expected?: Parameters<typeof assertPrivateExecutionEnvelope>[2],
): Promise<PrivateExecutionEnvelope> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readOwnerOnlyUtf8(path)) as unknown;
  } catch {
    stop("PHASE_STATE_INVALID");
  }
  return assertPrivateExecutionEnvelope(parsed, hmacKey, expected);
}
