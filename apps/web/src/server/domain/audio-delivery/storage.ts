import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import { BUCKETS, getR2 } from "~/server/storage/r2";

import type { AudioByteRange } from "./http";

export class AudioDeliveryStorageError extends Error {
  constructor() {
    super("Audio delivery was not found");
    this.name = "AudioDeliveryStorageError";
  }
}

export type ExactAudioObjectDelivery = Readonly<{
  body: ReadableStream<Uint8Array>;
  contentType: string | undefined;
  contentLength: number;
}>;

function storageError(): never {
  throw new AudioDeliveryStorageError();
}

function containsAsciiControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint >= 0 && codePoint <= 31) || codePoint === 127;
  });
}

function assertStorageInput(
  input: Readonly<{
    storageKey: string;
    objectEtag: string;
    sizeBytes: number;
    range?: AudioByteRange | null;
  }>,
): void {
  if (
    typeof input.storageKey !== "string" ||
    input.storageKey.length === 0 ||
    input.storageKey.length > 1_024 ||
    input.storageKey.trim() !== input.storageKey ||
    containsAsciiControl(input.storageKey) ||
    typeof input.objectEtag !== "string" ||
    input.objectEtag.length === 0 ||
    input.objectEtag.length > 512 ||
    input.objectEtag.trim() !== input.objectEtag ||
    /[\r\n]/.test(input.objectEtag) ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0
  ) {
    storageError();
  }

  if (
    input.range &&
    (!Number.isSafeInteger(input.range.start) ||
      !Number.isSafeInteger(input.range.end) ||
      !Number.isSafeInteger(input.range.length) ||
      input.range.start < 0 ||
      input.range.end < input.range.start ||
      input.range.end >= input.sizeBytes ||
      input.range.length !== input.range.end - input.range.start + 1)
  ) {
    storageError();
  }
}

/** Fetch one already-authorized immutable audio identity without returning its key to callers. */
export async function readExactAudioObject(
  input: Readonly<{
    storageKey: string;
    objectEtag: string;
    sizeBytes: number;
    range?: AudioByteRange | null;
  }>,
  client: S3Client = getR2(),
): Promise<ExactAudioObjectDelivery> {
  assertStorageInput(input);
  const expectedLength = input.range?.length ?? input.sizeBytes;
  const expectedContentRange = input.range
    ? `bytes ${String(input.range.start)}-${String(input.range.end)}/${String(input.sizeBytes)}`
    : undefined;

  try {
    const object = await client.send(
      new GetObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.storageKey,
        IfMatch: input.objectEtag,
        ...(input.range
          ? { Range: `bytes=${String(input.range.start)}-${String(input.range.end)}` }
          : {}),
      }),
    );
    if (
      !object.Body ||
      object.ETag !== input.objectEtag ||
      object.ContentLength !== expectedLength ||
      (input.range && object.ContentRange !== expectedContentRange)
    ) {
      storageError();
    }
    const body = object.Body.transformToWebStream();
    return Object.freeze({
      body,
      contentType: object.ContentType,
      contentLength: object.ContentLength,
    });
  } catch {
    storageError();
  }
}
