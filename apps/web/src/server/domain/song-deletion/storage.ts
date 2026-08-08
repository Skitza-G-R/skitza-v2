import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { exactObjectIsAbsent } from "~/server/audio/multipart-storage-recovery";
import { BUCKETS, getR2 } from "~/server/storage/r2";

const PEAKS_DELETION_FINGERPRINT_METADATA = "skitza-peaks-deletion";

export type LegacyPeaksDeletionIdentity = Readonly<{
  versionId: string;
  key: string;
}>;

type PeaksObservation =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "present"; objectEtag: string }>
  | Readonly<{ kind: "marker"; deletionFingerprint: string }>;

function deletionFingerprint(input: LegacyPeaksDeletionIdentity): string {
  return `sha256:${createHash("sha256")
    .update(`skitza:legacy-peaks-deletion:v1\0${input.versionId}\0${input.key}`, "utf8")
    .digest("hex")}`;
}

async function observePeaksObject(
  input: LegacyPeaksDeletionIdentity,
  client: S3Client,
): Promise<PeaksObservation> {
  let head;
  try {
    head = await client.send(
      new HeadObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.key,
      }),
    );
  } catch (headError) {
    if (await exactObjectIsAbsent(input.key, client)) return { kind: "absent" };
    throw headError;
  }
  const marker = head.Metadata?.[PEAKS_DELETION_FINGERPRINT_METADATA];
  if (marker !== undefined) {
    if (!/^sha256:[0-9a-f]{64}$/.test(marker)) {
      throw new Error("The legacy waveform deletion marker was invalid");
    }
    return { kind: "marker", deletionFingerprint: marker };
  }
  if (typeof head.ETag !== "string" || head.ETag.trim().length === 0) {
    throw new Error("The legacy waveform object identity was incomplete");
  }
  return { kind: "present", objectEtag: head.ETag };
}

/** Delete one receipt-authorized legacy waveform object and prove absence. */
export async function reconcileLegacyPeaksDeletion(
  input: LegacyPeaksDeletionIdentity,
  client: S3Client = getR2(),
): Promise<void> {
  if (!input.key.startsWith("peaks/") || input.key.length > 1024) {
    throw new Error("The legacy waveform deletion key was invalid");
  }
  const expectedFingerprint = deletionFingerprint(input);
  let observation = await observePeaksObject(input, client);
  if (observation.kind === "absent") return;
  if (observation.kind === "present") {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
          IfMatch: observation.objectEtag,
          Body: new Uint8Array([0]),
          ContentType: "application/x-skitza-deleted-waveform-marker",
          CacheControl: "no-store",
          Metadata: {
            [PEAKS_DELETION_FINGERPRINT_METADATA]: expectedFingerprint,
          },
        }),
      );
    } catch {
      // Resolve an ambiguous conditional write with an exact observation.
    }
    observation = await observePeaksObject(input, client);
  }
  if (
    observation.kind !== "marker" ||
    observation.deletionFingerprint !== expectedFingerprint
  ) {
    throw new Error("The legacy waveform object could not be erased safely");
  }
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.key,
      }),
    );
  } catch {
    // Exact-prefix absence below resolves an ambiguous delete response.
  }
  if (!(await exactObjectIsAbsent(input.key, client))) {
    throw new Error("The legacy waveform deletion could not be verified");
  }
}
