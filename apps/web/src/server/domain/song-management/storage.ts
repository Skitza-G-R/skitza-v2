import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";

import { exactObjectIsAbsent } from "~/server/audio/multipart-storage-recovery";
import { BUCKETS, getR2 } from "~/server/storage/r2";

import type { ExactAudioStoragePort, ExactAudioStorageObservation } from "./service";

const DELETION_FINGERPRINT_METADATA_KEY = "skitza-deletion-fingerprint";

async function observeExactObject(input: { key: string }): Promise<ExactAudioStorageObservation> {
  let head: HeadObjectCommandOutput;
  try {
    head = await getR2().send(
      new HeadObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.key,
      }),
    );
  } catch (headError) {
    // A generic HEAD 404 is not authoritative enough for destructive work:
    // bucket, permission, and service errors can be flattened by S3-compatible
    // APIs. The exhaustive exact-prefix listing preserves those failures and
    // is the only way this adapter reports absence.
    if (await exactObjectIsAbsent(input.key)) return { kind: "absent" };
    throw headError;
  }
  const deletionFingerprint = head.Metadata?.[DELETION_FINGERPRINT_METADATA_KEY];
  if (deletionFingerprint !== undefined) {
    if (deletionFingerprint.trim().length === 0) {
      throw new Error("The exact audio deletion marker metadata was incomplete");
    }
    return { kind: "erased_marker", deletionFingerprint };
  }
  if (
    typeof head.ETag !== "string" ||
    head.ETag.trim().length === 0 ||
    typeof head.ContentLength !== "number" ||
    !Number.isSafeInteger(head.ContentLength) ||
    head.ContentLength <= 0
  ) {
    // HEAD positively observed an object. Missing identity metadata can never
    // be reinterpreted as absence, even if another service response disagrees.
    throw new Error("The exact audio object metadata was incomplete");
  }
  return {
    kind: "present",
    objectEtag: head.ETag,
    sizeBytes: head.ContentLength,
  };
}

/** Production adapter for one already-authorized, immutable audio identity. */
export function r2ExactAudioStoragePort(): ExactAudioStoragePort {
  return {
    observeExactObject,
    conditionallyEraseExactObject: async (input) => {
      // Cloudflare documents If-Match for PutObject, but not DeleteObject.
      // Atomically replacing the matching bytes with a one-byte marker makes
      // the destructive identity check real before ordinary deletion.
      await getR2().send(
        new PutObjectCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
          IfMatch: input.ifMatch,
          Body: new Uint8Array([0]),
          ContentType: "application/x-skitza-deleted-audio-marker",
          CacheControl: "no-store",
          Metadata: {
            [DELETION_FINGERPRINT_METADATA_KEY]: input.deletionFingerprint,
          },
        }),
      );
    },
    deleteErasedMarker: async (input) => {
      await getR2().send(
        new DeleteObjectCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
        }),
      );
    },
  };
}
