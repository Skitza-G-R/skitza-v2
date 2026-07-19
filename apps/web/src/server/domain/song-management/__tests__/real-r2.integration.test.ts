import { randomBytes, randomUUID } from "node:crypto";

import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, it, vi } from "vitest";

import {
  computeStoredAudioIdentityFingerprint,
  reconcileExactStoredAudioDeletion,
  type ExactAudioStoragePort,
} from "../service";

const runtime = vi.hoisted(() => ({
  client: null as S3Client | null,
  bucket: null as string | null,
}));

// Keep this real-storage test disconnected from the app's normal R2 variables.
vi.mock("~/server/storage/r2", () => ({
  BUCKETS: {
    get audio(): string {
      if (runtime.bucket === null) throw new Error("The isolated R2 test bucket is unavailable");
      return runtime.bucket;
    },
  },
  getR2: (): S3Client => {
    if (runtime.client === null) throw new Error("The isolated R2 test client is unavailable");
    return runtime.client;
  },
}));

import { exactObjectIsAbsent } from "~/server/audio/multipart-storage-recovery";

import { r2ExactAudioStoragePort } from "../storage";

const TEST_PREFIX = "sk8-song-management-smoke/";
const OWNER_METADATA_KEY = "skitza-sk8-smoke-token";
const MARKER_METADATA_KEY = "skitza-deletion-fingerprint";
const MUTATION_ACK = "I_ACKNOWLEDGE_SK8_ISOLATED_R2_MUTATION";

const dedicatedEnvironment = {
  endpoint: process.env.SK8_R2_TEST_ENDPOINT,
  accessKeyId: process.env.SK8_R2_TEST_ACCESS_KEY_ID,
  secretAccessKey: process.env.SK8_R2_TEST_SECRET_ACCESS_KEY,
  bucket: process.env.SK8_R2_TEST_BUCKET,
  mutationAck: process.env.SK8_R2_TEST_MUTATION_ACK,
};
const hasDedicatedEnvironment = Object.values(dedicatedEnvironment).every(
  (value) => typeof value === "string" && value.length > 0,
);
const describeWithDedicatedR2 = hasDedicatedEnvironment ? describe : describe.skip;

type DedicatedR2Config = Readonly<{
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}>;

function stop(message: string): never {
  throw new Error(message);
}

function loadDedicatedR2Config(): DedicatedR2Config {
  const { endpoint, accessKeyId, secretAccessKey, bucket, mutationAck } = dedicatedEnvironment;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !mutationAck) {
    stop("The isolated SK-8 R2 smoke-test environment is incomplete");
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    stop("The isolated SK-8 R2 endpoint is invalid");
  }
  if (
    parsedEndpoint.protocol !== "https:" ||
    parsedEndpoint.username !== "" ||
    parsedEndpoint.password !== "" ||
    parsedEndpoint.port !== "" ||
    parsedEndpoint.pathname !== "/" ||
    parsedEndpoint.search !== "" ||
    parsedEndpoint.hash !== "" ||
    !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(parsedEndpoint.hostname)
  ) {
    stop("The isolated SK-8 endpoint is not a Cloudflare R2 S3 endpoint");
  }

  const bucketIsSafe =
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) &&
    !bucket.includes("..") &&
    /(?:^|[.-])(?:test|testing|sandbox|isolated)(?:$|[.-])/.test(bucket) &&
    !/(?:^|[.-])(?:prod|production|live)(?:$|[.-])/.test(bucket);
  if (!bucketIsSafe) stop("The SK-8 R2 bucket is not clearly isolated from live storage");
  if (
    accessKeyId !== accessKeyId.trim() ||
    secretAccessKey !== secretAccessKey.trim() ||
    accessKeyId.length < 16 ||
    secretAccessKey.length < 32
  ) {
    stop("The isolated SK-8 R2 credentials are invalid");
  }
  if (mutationAck !== MUTATION_ACK) {
    stop("The isolated SK-8 R2 mutation acknowledgement is invalid");
  }

  return {
    endpoint: parsedEndpoint.toString(),
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

async function cleanupOwnedKey(input: {
  client: S3Client;
  port: ExactAudioStoragePort;
  bucket: string;
  key: string;
  ownerToken: string;
  deletionFingerprint: string | null;
}): Promise<void> {
  let head;
  try {
    head = await input.client.send(
      new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
  } catch {
    if (await exactObjectIsAbsent(input.key)) return;
    stop("The isolated R2 cleanup target could not be observed safely");
  }

  const markerFingerprint = head.Metadata?.[MARKER_METADATA_KEY];
  if (markerFingerprint === undefined) {
    if (
      head.Metadata?.[OWNER_METADATA_KEY] !== input.ownerToken ||
      typeof head.ETag !== "string" ||
      head.ETag.length === 0
    ) {
      stop("The isolated R2 cleanup found an object it does not own");
    }
    const cleanupFingerprint = `sk8-smoke-cleanup:${input.ownerToken}`;
    try {
      await input.port.conditionallyEraseExactObject({
        key: input.key,
        ifMatch: head.ETag,
        deletionFingerprint: cleanupFingerprint,
      });
    } catch {
      // A response can be lost after the conditional marker was committed.
    }
    const afterErase = await input.port.observeExactObject({ key: input.key });
    if (
      afterErase.kind !== "erased_marker" ||
      afterErase.deletionFingerprint !== cleanupFingerprint
    ) {
      stop("The isolated R2 cleanup could not prove its conditional marker");
    }
  } else if (
    input.deletionFingerprint === null ||
    markerFingerprint !== input.deletionFingerprint
  ) {
    stop("The isolated R2 cleanup found a marker it does not own");
  }

  try {
    await input.client.send(
      new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
  } catch {
    // Authoritative listing below resolves an ambiguous delete response.
  }
  if (!(await exactObjectIsAbsent(input.key))) {
    stop("The isolated R2 cleanup could not prove exact-key absence");
  }
}

describeWithDedicatedR2("SK-8 exact deletion — isolated real R2", () => {
  it(
    "conditionally erases one random object and converges across retries",
    async () => {
      const config = loadDedicatedR2Config();
      const client = new S3Client({
        region: "auto",
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        maxAttempts: 1,
      });
      runtime.client = client;
      runtime.bucket = config.bucket;

      const key = `${TEST_PREFIX}${randomUUID()}.bin`;
      const ownerToken = randomUUID();
      const bytes = randomBytes(257);
      const productionPort = r2ExactAudioStoragePort();
      let deletionFingerprint: string | null = null;
      let smokeFailed = false;
      let cleanupFailed = false;

      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: "audio/wav",
            CacheControl: "no-store",
            Metadata: { [OWNER_METADATA_KEY]: ownerToken },
          }),
        );

        const initial = await productionPort.observeExactObject({ key });
        if (initial.kind !== "present" || initial.sizeBytes !== bytes.byteLength) {
          stop("The isolated R2 HEAD did not preserve the test audio identity");
        }
        deletionFingerprint = computeStoredAudioIdentityFingerprint({
          key,
          objectEtag: initial.objectEtag,
          sizeBytes: initial.sizeBytes,
        });

        const conditionalEtags: string[] = [];
        const observedPort: ExactAudioStoragePort = {
          ...productionPort,
          conditionallyEraseExactObject: async (eraseInput) => {
            conditionalEtags.push(eraseInput.ifMatch);
            await productionPort.conditionallyEraseExactObject(eraseInput);
          },
        };
        const identity = {
          key,
          objectEtag: initial.objectEtag,
          sizeBytes: initial.sizeBytes,
          fingerprint: deletionFingerprint,
        };

        await Promise.all([
          reconcileExactStoredAudioDeletion(observedPort, identity),
          reconcileExactStoredAudioDeletion(observedPort, identity),
        ]);
        if (
          conditionalEtags.length === 0 ||
          conditionalEtags.some((etag) => etag !== initial.objectEtag)
        ) {
          stop("The isolated R2 conditional marker did not use the HEAD identity");
        }
        const repeated = await reconcileExactStoredAudioDeletion(observedPort, identity);
        if (repeated.kind !== "already_absent" || !(await exactObjectIsAbsent(key))) {
          stop("The isolated R2 exact deletion did not converge idempotently");
        }
      } catch {
        smokeFailed = true;
      } finally {
        try {
          await cleanupOwnedKey({
            client,
            port: productionPort,
            bucket: config.bucket,
            key,
            ownerToken,
            deletionFingerprint,
          });
        } catch {
          cleanupFailed = true;
        }
        runtime.client = null;
        runtime.bucket = null;
        client.destroy();
      }

      if (cleanupFailed) {
        stop("The isolated SK-8 R2 cleanup failed; storage identifiers were suppressed");
      }
      if (smokeFailed) {
        stop("The isolated SK-8 R2 smoke test failed; storage identifiers were suppressed");
      }
    },
    60_000,
  );
});
