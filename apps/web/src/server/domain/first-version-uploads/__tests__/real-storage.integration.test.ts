import { randomBytes, randomUUID } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  client: null as S3Client | null,
  bucket: null as string | null,
}));

vi.mock("~/server/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("~/server/storage/r2")>("~/server/storage/r2");
  const client = (): S3Client => {
    if (runtime.client === null) {
      throw new Error("The isolated SK-197 storage client is unavailable");
    }
    return runtime.client;
  };
  return {
    ...actual,
    BUCKETS: {
      get audio(): string {
        if (runtime.bucket === null) {
          throw new Error("The isolated SK-197 storage bucket is unavailable");
        }
        return runtime.bucket;
      },
      docs: "unused-sk197-isolated-docs",
    },
    getR2: client,
    getR2BrowserUpload: client,
    getR2SingleAttempt: client,
  };
});

import { exactObjectIsAbsentInBucket } from "~/server/audio/multipart-storage-recovery";
import {
  buildFirstVersionStagingKey,
  createFirstVersionUploadUrl,
  finalizeFirstVersionUpload,
  observeFirstVersionUpload,
  reconcileFirstVersionFinalDeletion,
  reconcileFirstVersionStagingDeletion,
} from "../storage";

const MUTATION_ACK = "I_ACKNOWLEDGE_SK197_ISOLATED_R2_MUTATION";
const COMPLETION_TOKEN_METADATA = "skitza-upload-token";
const STAGING_SEAL_METADATA = "skitza-staging-seal";
const STAGING_SEAL_CONTENT_TYPE = "application/x-skitza-sealed-first-version-staging-marker";
const AUDIO_CONTENT_TYPE = "audio/wav";
const AUDIO_BYTES = new Uint8Array(4_096);

const dedicatedEnvironment = {
  endpoint: process.env.SK197_R2_TEST_ENDPOINT,
  accessKeyId: process.env.SK197_R2_TEST_ACCESS_KEY_ID,
  secretAccessKey: process.env.SK197_R2_TEST_SECRET_ACCESS_KEY,
  bucket: process.env.SK197_R2_TEST_BUCKET,
  mutationAck: process.env.SK197_R2_TEST_MUTATION_ACK,
};
const configuredValues = Object.values(dedicatedEnvironment).filter((value) => value !== undefined);
const describeWithDedicatedStorage = configuredValues.length > 0 ? describe : describe.skip;

type DedicatedStorageConfig = Readonly<{
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}>;

type OwnedObject = Readonly<{
  identity: StorageIdentity;
  role: "staging" | "final";
}>;

type OwnedObjectObservation = Readonly<{
  owned: OwnedObject;
  objectEtag: string;
  isStagingSeal: boolean;
}>;

type StorageIdentity = Readonly<{
  key: string;
  sizeBytes: number;
  contentType: string;
  completionToken: string;
}>;

type UploadCapability = Awaited<ReturnType<typeof createFirstVersionUploadUrl>>;

function stop(message: string): never {
  throw new Error(message);
}

function loadDedicatedStorageConfig(): DedicatedStorageConfig {
  const { endpoint, accessKeyId, secretAccessKey, bucket, mutationAck } = dedicatedEnvironment;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !mutationAck) {
    stop("The isolated SK-197 storage test environment is incomplete");
  }
  if (mutationAck !== MUTATION_ACK) {
    stop("The isolated SK-197 storage mutation acknowledgement is invalid");
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    stop("The isolated SK-197 storage endpoint is invalid");
  }
  const hasCleanEndpointShape =
    parsedEndpoint.username === "" &&
    parsedEndpoint.password === "" &&
    parsedEndpoint.pathname === "/" &&
    parsedEndpoint.search === "" &&
    parsedEndpoint.hash === "";
  if (!hasCleanEndpointShape) {
    stop("The isolated SK-197 storage endpoint shape is unsafe");
  }

  const localPort = Number(parsedEndpoint.port);
  const isLocalhost =
    (parsedEndpoint.protocol === "http:" || parsedEndpoint.protocol === "https:") &&
    parsedEndpoint.hostname === "127.0.0.1" &&
    parsedEndpoint.port !== "" &&
    Number.isInteger(localPort) &&
    localPort >= 1_024 &&
    localPort <= 65_535;
  if (!isLocalhost) {
    stop("The isolated SK-197 storage endpoint must be loopback-only");
  }

  const bucketIsSafe =
    /^sk197-isolated-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      bucket,
    );
  if (!bucketIsSafe) {
    stop("The SK-197 storage bucket name is not a random issue-owned UUID bucket");
  }

  const credentialsAreClean =
    accessKeyId === accessKeyId.trim() &&
    secretAccessKey === secretAccessKey.trim() &&
    accessKeyId.length >= 3 &&
    secretAccessKey.length >= 8;
  if (!credentialsAreClean) {
    stop("The isolated SK-197 storage credentials are invalid");
  }

  return {
    endpoint: parsedEndpoint.toString(),
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

let config: DedicatedStorageConfig | null = null;
let runId = "";
let ownedObjects: OwnedObject[] = [];
let staleCapabilities: UploadCapability[] = [];
let bucketCreated = false;

function isolatedClient(): S3Client {
  if (runtime.client === null) stop("The isolated SK-197 storage client is unavailable");
  return runtime.client;
}

function isolatedBucket(): string {
  if (runtime.bucket === null) stop("The isolated SK-197 storage bucket is unavailable");
  return runtime.bucket;
}

function registerOwnedObject(identity: StorageIdentity, role: OwnedObject["role"]): OwnedObject {
  const { key } = identity;
  const stagingPrefix = `first-version-staging/producers/sk197-smoke-${runId}/intents/`;
  const finalPrefix = `sk197-first-version-smoke/${runId}/final/`;
  if ((!key.startsWith(stagingPrefix) && !key.startsWith(finalPrefix)) || key.includes("..")) {
    stop("The SK-197 smoke-test object key escaped its random owned prefix");
  }
  if (ownedObjects.some((candidate) => candidate.identity.key === key)) {
    stop("The SK-197 smoke test attempted to reuse an owned object key");
  }
  if (
    (role === "staging" && !key.startsWith(stagingPrefix)) ||
    (role === "final" && !key.startsWith(finalPrefix))
  ) {
    stop("The SK-197 smoke-test object role did not match its owned prefix");
  }
  const owned = { identity, role };
  ownedObjects.push(owned);
  return owned;
}

function newStagingIdentity(): StorageIdentity {
  const completionToken = randomBytes(32).toString("hex");
  const key = buildFirstVersionStagingKey({
    producerId: `sk197-smoke-${runId}`,
    intentId: randomUUID(),
  });
  const identity = {
    key,
    sizeBytes: AUDIO_BYTES.byteLength,
    contentType: AUDIO_CONTENT_TYPE,
    completionToken,
  };
  registerOwnedObject(identity, "staging");
  return identity;
}

function newFinalIdentity(staging: StorageIdentity): StorageIdentity {
  const key = `sk197-first-version-smoke/${runId}/final/${randomUUID()}.wav`;
  const identity = { ...staging, key };
  registerOwnedObject(identity, "final");
  return identity;
}

function uploadBody(): Blob {
  return new Blob([AUDIO_BYTES], { type: AUDIO_CONTENT_TYPE });
}

async function putCapability(capability: UploadCapability): Promise<void> {
  const response = await fetch(capability.uploadUrl, {
    method: "PUT",
    headers: capability.headers,
    body: uploadBody(),
  });
  if (!response.ok) stop("The isolated SK-197 presigned PUT failed");
}

async function createTrackedUploadCapability(identity: StorageIdentity): Promise<UploadCapability> {
  const capability = await createFirstVersionUploadUrl(identity);
  staleCapabilities.push(capability);
  return capability;
}

async function expectCapabilityBlocked(capability: UploadCapability): Promise<void> {
  const response = await fetch(capability.uploadUrl, {
    method: "PUT",
    headers: capability.headers,
    body: uploadBody(),
  });
  expect([409, 412]).toContain(response.status);
}

async function expectExactStagingSeal(identity: StorageIdentity): Promise<void> {
  const head = await isolatedClient().send(
    new HeadObjectCommand({ Bucket: isolatedBucket(), Key: identity.key }),
  );
  expect(head.ContentLength).toBe(1);
  expect(head.ContentType).toBe(STAGING_SEAL_CONTENT_TYPE);
  expect(head.Metadata?.[COMPLETION_TOKEN_METADATA]).toBe(identity.completionToken);
  expect(head.Metadata?.[STAGING_SEAL_METADATA]).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(head.ETag).toEqual(expect.any(String));
}

async function runIsolatedScenario(scenario: () => Promise<void>): Promise<void> {
  try {
    await scenario();
  } catch {
    stop("The isolated SK-197 storage lifecycle failed; storage identifiers were suppressed");
  }
}

async function exactBucketExists(client: S3Client, bucket: string): Promise<boolean> {
  const output = await client.send(new ListBucketsCommand({}));
  const names = (output.Buckets ?? []).map((candidate) => candidate.Name);
  if (names.some((name) => typeof name !== "string" || name.length === 0)) {
    stop("The isolated SK-197 bucket listing was invalid");
  }
  return names.includes(bucket);
}

async function listBucketKeys(client: S3Client, bucket: string): Promise<string[]> {
  const keys: string[] = [];
  const seenKeys = new Set<string>();
  const seenCursors = new Set<string>();
  let continuationToken: string | undefined;

  for (let page = 0; page < 100; page += 1) {
    const output = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1_000,
        ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
      }),
    );
    if (typeof output.IsTruncated !== "boolean") {
      stop("The isolated SK-197 object listing was incomplete");
    }
    for (const object of output.Contents ?? []) {
      if (typeof object.Key !== "string" || object.Key.length === 0 || seenKeys.has(object.Key)) {
        stop("The isolated SK-197 object listing identity was invalid");
      }
      seenKeys.add(object.Key);
      keys.push(object.Key);
    }
    if (!output.IsTruncated) {
      if (output.NextContinuationToken !== undefined) {
        stop("The isolated SK-197 object listing cursor was invalid");
      }
      return keys;
    }
    const next = output.NextContinuationToken;
    if (typeof next !== "string" || next.length === 0 || seenCursors.has(next)) {
      stop("The isolated SK-197 object listing cursor was invalid");
    }
    seenCursors.add(next);
    continuationToken = next;
  }

  stop("The isolated SK-197 object listing exceeded its safe page limit");
}

async function preflightOwnedObjects(): Promise<OwnedObjectObservation[]> {
  const client = isolatedClient();
  const bucket = isolatedBucket();
  const expected = new Map(ownedObjects.map((owned) => [owned.identity.key, owned]));
  if (expected.size !== ownedObjects.length) {
    stop("The isolated SK-197 ownership registry contained a duplicate key");
  }

  const observations: OwnedObjectObservation[] = [];
  for (const key of await listBucketKeys(client, bucket)) {
    const owned = expected.get(key);
    if (!owned) {
      stop("The isolated SK-197 bucket contained an object outside the ownership registry");
    }
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const objectEtag = head.ETag?.trim();
    if (
      !objectEtag ||
      head.Metadata?.[COMPLETION_TOKEN_METADATA] !== owned.identity.completionToken
    ) {
      stop("The isolated SK-197 object ownership metadata was invalid");
    }

    const sealFingerprint = head.Metadata[STAGING_SEAL_METADATA];
    const isStagingSeal = sealFingerprint !== undefined;
    if (
      isStagingSeal &&
      (owned.role !== "staging" ||
        head.ContentLength !== 1 ||
        head.ContentType !== STAGING_SEAL_CONTENT_TYPE ||
        !/^sha256:[0-9a-f]{64}$/.test(sealFingerprint))
    ) {
      stop("The isolated SK-197 staging seal identity was invalid");
    }
    if (
      !isStagingSeal &&
      (head.ContentLength !== owned.identity.sizeBytes ||
        head.ContentType?.trim().toLowerCase() !== owned.identity.contentType)
    ) {
      stop("The isolated SK-197 uploaded object identity was invalid");
    }
    observations.push({ owned, objectEtag, isStagingSeal });
  }
  return observations;
}

async function deleteOwnedObservation(observation: OwnedObjectObservation): Promise<void> {
  const client = isolatedClient();
  const bucket = isolatedBucket();
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: observation.owned.identity.key,
        IfMatch: observation.objectEtag,
      }),
    );
  } catch {
    // Exact listing resolves an ambiguous provider response below.
  }
  if (!(await exactObjectIsAbsentInBucket(bucket, observation.owned.identity.key, client))) {
    stop("The isolated SK-197 cleanup could not prove exact-key absence");
  }
}

async function bestEffortResealStagingObjects(): Promise<void> {
  for (const owned of ownedObjects) {
    if (owned.role !== "staging") continue;
    try {
      await reconcileFirstVersionStagingDeletion(owned.identity);
    } catch {
      // Teardown already failed. Preserve as many stale-capability barriers as possible.
    }
  }
}

async function proveCapabilitiesFailAfterBucketDeletion(): Promise<void> {
  for (const capability of staleCapabilities) {
    let response: Response;
    try {
      response = await fetch(capability.uploadUrl, {
        method: "PUT",
        headers: capability.headers,
        body: uploadBody(),
      });
    } catch {
      stop("A stale SK-197 capability could not be checked after bucket deletion");
    }
    if (response.ok) {
      stop("A stale SK-197 capability remained writable after bucket deletion");
    }
  }
}

async function tearDownOwnedBucket(): Promise<void> {
  const client = isolatedClient();
  const bucket = isolatedBucket();
  let sealRemovalStarted = false;

  try {
    const observations = await preflightOwnedObjects();
    for (const observation of observations.filter((candidate) => !candidate.isStagingSeal)) {
      await deleteOwnedObservation(observation);
    }

    sealRemovalStarted = true;
    for (const observation of observations.filter((candidate) => candidate.isStagingSeal)) {
      await deleteOwnedObservation(observation);
    }
    if ((await listBucketKeys(client, bucket)).length !== 0) {
      stop("The isolated SK-197 bucket was not empty after exact cleanup");
    }

    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    if (await exactBucketExists(client, bucket)) {
      stop("The isolated SK-197 bucket still existed after deletion");
    }
    bucketCreated = false;
    await proveCapabilitiesFailAfterBucketDeletion();
  } catch {
    if (sealRemovalStarted && bucketCreated) {
      await bestEffortResealStagingObjects();
    }
    stop("The isolated SK-197 teardown failed; storage identifiers were suppressed");
  } finally {
    ownedObjects = [];
    staleCapabilities = [];
  }
}

describeWithDedicatedStorage("SK-197 staged audio — isolated real storage", () => {
  beforeAll(async () => {
    config = loadDedicatedStorageConfig();
    const client = new S3Client({
      region: "us-east-1",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      maxAttempts: 1,
    });
    runtime.client = client;
    runtime.bucket = config.bucket;
    ownedObjects = [];
    staleCapabilities = [];
    bucketCreated = false;
    try {
      if (await exactBucketExists(client, config.bucket)) {
        stop("The isolated SK-197 bucket already exists and is not owned by this run");
      }
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      bucketCreated = true;
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch {
      stop("The isolated SK-197 bucket could not be created with exclusive ownership");
    }
  }, 30_000);

  beforeEach(() => {
    runId = randomUUID();
  });

  afterAll(async () => {
    try {
      if (bucketCreated) await tearDownOwnedBucket();
    } finally {
      runtime.client?.destroy();
      runtime.client = null;
      runtime.bucket = null;
      config = null;
      bucketCreated = false;
    }
  }, 60_000);

  it("seals an empty canceled intent and permanently blocks its stale PUT capability", async () => {
    await runIsolatedScenario(async () => {
      const staging = newStagingIdentity();
      const capability = await createTrackedUploadCapability(staging);

      await reconcileFirstVersionStagingDeletion(staging);
      await reconcileFirstVersionStagingDeletion(staging);

      await expectExactStagingSeal(staging);
      await expectCapabilityBlocked(capability);
    });
  }, 60_000);

  it("uploads, verifies, copies, re-verifies, seals, and rejects a stale replay", async () => {
    await runIsolatedScenario(async () => {
      const staging = newStagingIdentity();
      const final = newFinalIdentity(staging);
      const capability = await createTrackedUploadCapability(staging);

      await putCapability(capability);
      await expect(observeFirstVersionUpload(staging)).resolves.toMatchObject({
        sizeBytes: AUDIO_BYTES.byteLength,
        contentType: AUDIO_CONTENT_TYPE,
      });
      await expect(
        finalizeFirstVersionUpload({
          stagingKey: staging.key,
          finalKey: final.key,
          sizeBytes: final.sizeBytes,
          contentType: final.contentType,
          completionToken: final.completionToken,
        }),
      ).resolves.toMatchObject({
        sizeBytes: AUDIO_BYTES.byteLength,
        contentType: AUDIO_CONTENT_TYPE,
      });
      await expect(observeFirstVersionUpload(final)).resolves.toMatchObject({
        sizeBytes: AUDIO_BYTES.byteLength,
        contentType: AUDIO_CONTENT_TYPE,
      });
      await reconcileFirstVersionStagingDeletion(staging);

      await expectExactStagingSeal(staging);
      await expectCapabilityBlocked(capability);
    });
  }, 60_000);

  it("seals the replaced upload before accepting a new independently owned staging object", async () => {
    await runIsolatedScenario(async () => {
      const replaced = newStagingIdentity();
      const replacement = newStagingIdentity();
      const replacedCapability = await createTrackedUploadCapability(replaced);

      await putCapability(replacedCapability);
      await reconcileFirstVersionStagingDeletion(replaced);
      await expectExactStagingSeal(replaced);
      await expectCapabilityBlocked(replacedCapability);

      const replacementCapability = await createTrackedUploadCapability(replacement);
      await putCapability(replacementCapability);
      await expect(observeFirstVersionUpload(replacement)).resolves.toMatchObject({
        sizeBytes: AUDIO_BYTES.byteLength,
        contentType: AUDIO_CONTENT_TYPE,
      });
      expect(replacement.key).not.toBe(replaced.key);
      await reconcileFirstVersionStagingDeletion(replacement);
      await expectExactStagingSeal(replacement);
      await expectCapabilityBlocked(replacementCapability);
    });
  }, 60_000);

  it("erases an orphan final copy, proves absence, and seals its staging capability", async () => {
    await runIsolatedScenario(async () => {
      const staging = newStagingIdentity();
      const final = newFinalIdentity(staging);
      const capability = await createTrackedUploadCapability(staging);

      await putCapability(capability);
      await finalizeFirstVersionUpload({
        stagingKey: staging.key,
        finalKey: final.key,
        sizeBytes: final.sizeBytes,
        contentType: final.contentType,
        completionToken: final.completionToken,
      });
      await reconcileFirstVersionFinalDeletion(final);
      await expect(
        exactObjectIsAbsentInBucket(isolatedBucket(), final.key, isolatedClient()),
      ).resolves.toBe(true);
      await reconcileFirstVersionStagingDeletion(staging);

      await expectExactStagingSeal(staging);
      await expectCapabilityBlocked(capability);
    });
  }, 60_000);
});
