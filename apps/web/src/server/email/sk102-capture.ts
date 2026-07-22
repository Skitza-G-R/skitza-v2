import { randomUUID } from "node:crypto";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  sk102Fingerprint,
  type ApprovedSk102Runtime,
  type Sk102EmailKind,
} from "@skitza/db/sk102-runtime";

import { BUCKETS, getR2 } from "~/server/storage/r2";

import type { EmailMessage, EmailRequestOptions } from "./client";

const CAPTURE_ROOT = "sk102-email-sink";

export function sk102EmailCapturePrefix(slot: string, kind?: Sk102EmailKind): string {
  return `${CAPTURE_ROOT}/${slot}/${kind ? `${kind}/` : ""}`;
}

type CaptureInput = Readonly<{
  runtime: ApprovedSk102Runtime;
  kind: Sk102EmailKind;
  message: EmailMessage;
  options?: EmailRequestOptions;
  client?: S3Client;
}>;

export async function captureSk102Email(input: CaptureInput) {
  if (BUCKETS.docs !== input.runtime.docsBucket) {
    throw new Error("SK102_EMAIL_BUCKET_FORBIDDEN");
  }
  if (input.message.from !== input.runtime.emailFrom) {
    throw new Error("SK102_EMAIL_FROM_FORBIDDEN");
  }
  const captureId = randomUUID();
  const capturedAt = new Date().toISOString();
  const key = `${sk102EmailCapturePrefix(input.runtime.slot, input.kind)}${capturedAt}-${captureId}.json`;
  const record = {
    schema: "sk102-email-capture-v1",
    slot: input.runtime.slot,
    kind: input.kind,
    capturedAt,
    from: input.message.from,
    to: input.message.to,
    cc: input.message.cc,
    bcc: input.message.bcc,
    replyTo: input.message.replyTo,
    subject: input.message.subject,
    html: input.message.html,
    idempotencyFingerprint: input.options?.idempotencyKey
      ? sk102Fingerprint(input.options.idempotencyKey)
      : null,
  } as const;

  await (input.client ?? getR2()).send(
    new PutObjectCommand({
      Bucket: input.runtime.docsBucket,
      Key: key,
      Body: JSON.stringify(record),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "private, no-store, max-age=0",
      Metadata: {
        "sk102-schema": record.schema,
        "sk102-slot": input.runtime.slot,
        "sk102-kind": input.kind,
      },
    }),
  );

  return { data: { id: `sk102-capture-${captureId}` }, error: null };
}
