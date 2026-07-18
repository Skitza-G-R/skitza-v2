import { createHash, randomBytes } from "node:crypto";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  protectValue,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import type { NeonPoolClientLike, NeonPoolLike } from "./database-adapter";
import type { DurableAction } from "./durable-state";
import { Sk90ResetSafetyError, stop } from "./errors";
import {
  assertFreshProofWindow,
  assertRehearsalTarget,
  rehearsalTargetPolicyDigest,
  targetObservationDigest,
  type RehearsalTargetPolicy,
} from "./policy";
import { assertSk90R2RehearsalConfig } from "./r2-rehearsal";
import type {
  ChallengeBoundTargetObservation,
  Sk90IndependentTargetObserver,
  TargetObservationRequest,
} from "./runner";
import type { Sk90R2RehearsalConfig, Sk90S3Client, StorageBucketRole } from "./storage-port";

const TARGET_IDENTITY_QUERY = `SELECT
  current_database() AS "currentDatabase",
  private_marker AS "privateMarker"
FROM skitza_rehearsal.target_identity`;
const TARGET_ATTESTATION_NAME = "target-identity";
const MAX_FRESHNESS_MS = 5 * 60 * 1000;

type ApprovedFingerprintBoundary = Readonly<{
  approved: Sha256Digest;
  forbidden: readonly Sha256Digest[];
}>;

export type ApprovedTargetPolicyBoundaries = Readonly<{
  targetClass: "isolated_nonproduction";
  policyDigest: Sha256Digest;
  database: ApprovedFingerprintBoundary;
  storage: ApprovedFingerprintBoundary;
  isolation: RehearsalTargetPolicy["isolation"];
}>;

export type PrivateDatabaseTargetAttestation = Readonly<{
  expectedCurrentDatabase: string;
  expectedPrivateMarker: string;
}>;

export type PrivateStorageTargetAttestation = Readonly<{
  bucketRole: StorageBucketRole;
  expectedEtag: string;
  expectedSizeBytes: number;
  expectedContentFingerprint: Sha256Digest;
}>;

export type ActiveTargetObserverInput = Readonly<{
  hmacKey: string;
  databasePool: NeonPoolLike;
  storageClient: Sk90S3Client;
  storageConfig: Sk90R2RehearsalConfig;
  databaseAttestation: PrivateDatabaseTargetAttestation;
  storageAttestations: Readonly<{
    audio: PrivateStorageTargetAttestation & Readonly<{ bucketRole: "audio" }>;
    docs: PrivateStorageTargetAttestation & Readonly<{ bucketRole: "docs" }>;
  }>;
  approvedPolicy: ApprovedTargetPolicyBoundaries;
}>;

export type ActiveTargetObserverConfiguration = Omit<
  ActiveTargetObserverInput,
  "databasePool" | "storageClient"
>;

export type DatabaseTargetFingerprintInput = Readonly<{
  currentDatabase: string;
  privateMarker: string;
}>;

export type StorageTargetFingerprintEntry = Readonly<{
  bucketRole: StorageBucketRole;
  bucket: string;
  objectKey: string;
  etag: string;
  sizeBytes: number;
  contentFingerprint: Sha256Digest;
}>;

export type StorageTargetFingerprintInput = Readonly<{
  endpointOrigin: string;
  namespace: string;
  attestations: readonly StorageTargetFingerprintEntry[];
}>;

export type BoundTargetObservation = ChallengeBoundTargetObservation &
  Readonly<{ bindingDigest: Sha256Digest }>;

type DatabaseIdentityRow = Readonly<{
  currentDatabase: unknown;
  privateMarker: unknown;
}>;

function assertPrivateText(value: string): void {
  if (value.length === 0 || value.includes("\0")) stop("REHEARSAL_ENV_INVALID");
}

function assertFreshRequest(input: TargetObservationRequest): void {
  assertProtectedToken(input.challengeToken);
  const issuedAt = Date.parse(input.issuedAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    new Date(issuedAt).toISOString() !== input.issuedAt ||
    new Date(expiresAt).toISOString() !== input.expiresAt ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_FRESHNESS_MS ||
    !isDurableAction(input.action)
  ) {
    stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  }
}

function isDurableAction(action: string): action is DurableAction {
  const exactActions: readonly string[] = [
    "prepare",
    "database_reset",
    "storage_delete",
    "post_reset_verify",
    "second_run",
    "manual_restore",
    "manual_restore_verify",
    "reconcile_quarantine",
    "reconcile_database_commit",
    "reconcile_storage_delete",
    "reconcile_post_reset",
    "reconcile_restore",
    "reconcile_second_run",
    "reconcile_rollback_interruption",
    "quarantine:final",
    "rollback_interrupt_database:after_partial_storage_delete",
    "rollback_interrupt_storage:after_partial_storage_delete",
  ];
  if (exactActions.includes(action)) return true;
  return [
    "before_database_commit",
    "after_database_commit_before_storage_delete",
    "after_partial_storage_delete",
  ].some(
    (point) =>
      action === `quarantine:rollback:${point}` ||
      (point !== "after_partial_storage_delete" && action === `rollback_interrupt:${point}`) ||
      action === `rollback_restore:${point}` ||
      action === `rollback_verify:${point}`,
  );
}

/** Returns only a sanitized digest; neither raw database value is retained. */
export function databaseTargetFingerprint(input: DatabaseTargetFingerprintInput): Sha256Digest {
  assertPrivateText(input.currentDatabase);
  assertPrivateText(input.privateMarker);
  return sha256Digest(
    canonicalJson({
      contract: "sk90-database-target-identity-v1",
      currentDatabase: input.currentDatabase,
      privateMarker: input.privateMarker,
    }),
  );
}

/** Returns only a sanitized digest of both authenticated storage attestations. */
export function storageTargetFingerprint(input: StorageTargetFingerprintInput): Sha256Digest {
  assertPrivateText(input.endpointOrigin);
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpointOrigin);
  } catch {
    stop("REHEARSAL_ENV_INVALID");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.origin !== input.endpointOrigin ||
    endpoint.username !== "" ||
    endpoint.password !== ""
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
  assertPrivateText(input.namespace);
  if (
    input.attestations.length !== 2 ||
    input.attestations[0]?.bucketRole !== "audio" ||
    input.attestations[1]?.bucketRole !== "docs"
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
  for (const attestation of input.attestations) {
    assertPrivateText(attestation.bucket);
    assertPrivateText(attestation.objectKey);
    assertPrivateText(attestation.etag);
    assertSha256Digest(attestation.contentFingerprint);
    if (!Number.isSafeInteger(attestation.sizeBytes) || attestation.sizeBytes < 1) {
      stop("REHEARSAL_ENV_INVALID");
    }
  }
  return sha256Digest(
    canonicalJson({
      contract: "sk90-storage-target-attestations-v1",
      endpointOrigin: input.endpointOrigin,
      namespace: input.namespace,
      attestations: input.attestations,
    }),
  );
}

export function targetAttestationObjectKey(namespace: string): string {
  assertPrivateText(namespace);
  const namespaceDigest = sha256Digest(namespace).slice("sha256:".length);
  return `sk90-target-attestation/${namespaceDigest}/${TARGET_ATTESTATION_NAME}`;
}

function observationBindingBody(
  observation: Omit<BoundTargetObservation, "bindingDigest">,
): Readonly<{
  contract: "sk90-challenge-bound-target-observation-v1";
  action: DurableAction;
  challengeToken: ProtectedToken;
  issuedAt: string;
  expiresAt: string;
  policy: RehearsalTargetPolicy;
}> {
  return {
    contract: "sk90-challenge-bound-target-observation-v1",
    action: observation.action,
    challengeToken: observation.challengeToken,
    issuedAt: observation.issuedAt,
    expiresAt: observation.expiresAt,
    policy: observation.policy,
  };
}

export function challengeBoundTargetObservationDigest(
  observation: Omit<BoundTargetObservation, "bindingDigest">,
): Sha256Digest {
  return sha256Digest(canonicalJson(observationBindingBody(observation)));
}

export function assertChallengeBoundTargetObservation(observation: BoundTargetObservation): true {
  assertFreshRequest(observation);
  assertSha256Digest(observation.bindingDigest);
  const target = assertRehearsalTarget(
    observation.policy,
    rehearsalTargetPolicyDigest(observation.policy),
  );
  assertFreshProofWindow({
    challengeToken: observation.challengeToken,
    targetObservationDigest: targetObservationDigest(target),
    issuedAt: observation.issuedAt,
    expiresAt: observation.expiresAt,
  });
  if (!sameDigest(observation.bindingDigest, challengeBoundTargetObservationDigest(observation))) {
    stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  }
  return true;
}

function samePrivateValue(observed: string, expected: string): boolean {
  return sameDigest(sha256Digest(observed), sha256Digest(expected));
}

async function consumeBody(
  body: unknown,
): Promise<Readonly<{ sizeBytes: number; contentFingerprint: Sha256Digest }>> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const consume = (chunk: Uint8Array): void => {
    sizeBytes += chunk.byteLength;
    if (!Number.isSafeInteger(sizeBytes)) stop("STORAGE_TARGET_MISMATCH");
    hash.update(chunk);
  };

  if (body instanceof Uint8Array) {
    consume(body);
  } else if (
    typeof body === "object" &&
    body !== null &&
    typeof Reflect.get(body, Symbol.asyncIterator) === "function"
  ) {
    for await (const chunk of body as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array)) stop("STORAGE_TARGET_MISMATCH");
      consume(chunk);
    }
  } else {
    stop("STORAGE_TARGET_MISMATCH");
  }

  return {
    sizeBytes,
    contentFingerprint: `sha256:${hash.digest("hex")}`,
  };
}

function redactUnknown(error: unknown): never {
  if (error instanceof Sk90ResetSafetyError) throw error;
  stop("UNEXPECTED_FAILURE");
}

/** Validate every private attestation and policy binding before creating clients. */
export function assertActiveTargetObserverConfiguration(
  input: ActiveTargetObserverConfiguration,
): true {
  assertSk90R2RehearsalConfig(input.storageConfig);
  if (input.hmacKey.length < 32) stop("REHEARSAL_ENV_INVALID");
  assertPrivateText(input.databaseAttestation.expectedCurrentDatabase);
  assertPrivateText(input.databaseAttestation.expectedPrivateMarker);
  const objectKey = targetAttestationObjectKey(input.storageConfig.namespace);
  const roles = ["audio", "docs"] as const;
  const fingerprintEntries: StorageTargetFingerprintEntry[] = [];
  for (const role of roles) {
    const attestation = input.storageAttestations[role];
    const observedRole: unknown = attestation.bucketRole;
    if (
      observedRole !== role ||
      attestation.expectedEtag.length === 0 ||
      !Number.isSafeInteger(attestation.expectedSizeBytes) ||
      attestation.expectedSizeBytes < 1
    ) {
      stop("REHEARSAL_ENV_INVALID");
    }
    assertSha256Digest(attestation.expectedContentFingerprint);
    fingerprintEntries.push({
      bucketRole: role,
      bucket: input.storageConfig.buckets[role],
      objectKey,
      etag: attestation.expectedEtag,
      sizeBytes: attestation.expectedSizeBytes,
      contentFingerprint: attestation.expectedContentFingerprint,
    });
  }
  assertSha256Digest(input.approvedPolicy.policyDigest);
  const expectedDatabaseFingerprint = databaseTargetFingerprint({
    currentDatabase: input.databaseAttestation.expectedCurrentDatabase,
    privateMarker: input.databaseAttestation.expectedPrivateMarker,
  });
  const expectedStorageFingerprint = storageTargetFingerprint({
    endpointOrigin: new URL(input.storageConfig.endpoint).origin,
    namespace: input.storageConfig.namespace,
    attestations: fingerprintEntries,
  });
  if (
    !sameDigest(expectedDatabaseFingerprint, input.approvedPolicy.database.approved) ||
    !sameDigest(expectedStorageFingerprint, input.approvedPolicy.storage.approved)
  ) {
    stop("TARGET_POLICY_MISMATCH");
  }
  const policy: RehearsalTargetPolicy = {
    targetClass: input.approvedPolicy.targetClass,
    database: {
      observed: expectedDatabaseFingerprint,
      approved: input.approvedPolicy.database.approved,
      forbidden: input.approvedPolicy.database.forbidden,
    },
    storage: {
      observed: expectedStorageFingerprint,
      approved: input.approvedPolicy.storage.approved,
      forbidden: input.approvedPolicy.storage.forbidden,
    },
    isolation: input.approvedPolicy.isolation,
  };
  assertRehearsalTarget(policy, input.approvedPolicy.policyDigest);
  return true;
}

export class ActiveSk90TargetObserver implements Sk90IndependentTargetObserver {
  readonly #input: ActiveTargetObserverInput;
  readonly #issuedChallenges = new Map<ProtectedToken, DurableAction>();

  constructor(input: ActiveTargetObserverInput) {
    assertActiveTargetObserverConfiguration(input);
    this.#input = input;
  }

  freshChallenge(action: DurableAction): Promise<ProtectedToken> {
    if (!isDurableAction(action)) stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    const nonce = randomBytes(32).toString("hex");
    const challenge = protectValue(
      this.#input.hmacKey,
      canonicalJson({
        contract: "sk90-active-target-challenge-v1",
        action,
        nonce,
      }),
    );
    this.#issuedChallenges.set(challenge, action);
    return Promise.resolve(challenge);
  }

  async observe(input: TargetObservationRequest): Promise<BoundTargetObservation> {
    assertFreshRequest(input);
    const issuedAction = this.#issuedChallenges.get(input.challengeToken);
    this.#issuedChallenges.delete(input.challengeToken);
    if (issuedAction === undefined || issuedAction !== input.action) {
      stop("FRESHNESS_NONCE_REUSED");
    }
    const [databaseFingerprint, storageFingerprint] = await Promise.all([
      this.#observeDatabase(),
      this.#observeStorage(),
    ]);
    const policy: RehearsalTargetPolicy = {
      targetClass: this.#input.approvedPolicy.targetClass,
      database: {
        observed: databaseFingerprint,
        approved: this.#input.approvedPolicy.database.approved,
        forbidden: this.#input.approvedPolicy.database.forbidden,
      },
      storage: {
        observed: storageFingerprint,
        approved: this.#input.approvedPolicy.storage.approved,
        forbidden: this.#input.approvedPolicy.storage.forbidden,
      },
      isolation: this.#input.approvedPolicy.isolation,
    };
    assertRehearsalTarget(policy, this.#input.approvedPolicy.policyDigest);
    const body: Omit<BoundTargetObservation, "bindingDigest"> = {
      action: input.action,
      challengeToken: input.challengeToken,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      policy,
    };
    const observation: BoundTargetObservation = {
      ...body,
      bindingDigest: challengeBoundTargetObservationDigest(body),
    };
    assertChallengeBoundTargetObservation(observation);
    return observation;
  }

  async #observeDatabase(): Promise<Sha256Digest> {
    let client: NeonPoolClientLike;
    try {
      client = await this.#input.databasePool.connect();
    } catch (error) {
      redactUnknown(error);
    }

    let queryResult:
      | Readonly<{
          rows: readonly DatabaseIdentityRow[];
          rowCount?: number | null;
        }>
      | undefined;
    let queryError: unknown;
    try {
      queryResult = await client.query<DatabaseIdentityRow>(TARGET_IDENTITY_QUERY);
    } catch (error) {
      queryError = error;
    }
    try {
      client.release();
    } catch (error) {
      redactUnknown(error);
    }
    if (queryError !== undefined) redactUnknown(queryError);
    if (
      !queryResult ||
      queryResult.rows.length !== 1 ||
      (queryResult.rowCount !== undefined &&
        queryResult.rowCount !== null &&
        queryResult.rowCount !== 1)
    ) {
      stop("DATABASE_TARGET_MISMATCH");
    }
    const row = queryResult.rows[0];
    if (
      typeof row?.currentDatabase !== "string" ||
      typeof row.privateMarker !== "string" ||
      !samePrivateValue(
        row.currentDatabase,
        this.#input.databaseAttestation.expectedCurrentDatabase,
      ) ||
      !samePrivateValue(row.privateMarker, this.#input.databaseAttestation.expectedPrivateMarker)
    ) {
      stop("DATABASE_TARGET_MISMATCH");
    }
    return databaseTargetFingerprint({
      currentDatabase: row.currentDatabase,
      privateMarker: row.privateMarker,
    });
  }

  async #observeStorage(): Promise<Sha256Digest> {
    const roles = ["audio", "docs"] as const;
    const objectKey = targetAttestationObjectKey(this.#input.storageConfig.namespace);
    const attestations = await Promise.all(
      roles.map(async (bucketRole): Promise<StorageTargetFingerprintEntry> => {
        const expected = this.#input.storageAttestations[bucketRole];
        const bucket = this.#input.storageConfig.buckets[bucketRole];
        let output;
        try {
          output = await this.#input.storageClient.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: objectKey,
              IfMatch: expected.expectedEtag,
            }),
          );
        } catch (error) {
          redactUnknown(error);
        }
        if (
          output.ETag !== expected.expectedEtag ||
          !Number.isSafeInteger(output.ContentLength) ||
          output.ContentLength !== expected.expectedSizeBytes
        ) {
          stop("STORAGE_TARGET_MISMATCH");
        }
        let consumed;
        try {
          consumed = await consumeBody(output.Body);
        } catch (error) {
          redactUnknown(error);
        }
        if (
          consumed.sizeBytes !== output.ContentLength ||
          !sameDigest(consumed.contentFingerprint, expected.expectedContentFingerprint)
        ) {
          stop("STORAGE_TARGET_MISMATCH");
        }
        return {
          bucketRole,
          bucket,
          objectKey,
          etag: expected.expectedEtag,
          sizeBytes: consumed.sizeBytes,
          contentFingerprint: consumed.contentFingerprint,
        };
      }),
    );
    return storageTargetFingerprint({
      endpointOrigin: new URL(this.#input.storageConfig.endpoint).origin,
      namespace: this.#input.storageConfig.namespace,
      attestations,
    });
  }
}

export function createActiveSk90TargetObserver(
  input: ActiveTargetObserverInput,
): ActiveSk90TargetObserver {
  return new ActiveSk90TargetObserver(input);
}
