import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { AGREEMENT_PDF_CONTENT_TYPE, agreementPdfFileError } from "~/lib/agreement-pdf";

const TOKEN_DOMAIN = "skitza:private-agreement-pdf:v1";
const MAX_TOKEN_LENGTH = 4_096;
export const AGREEMENT_PDF_UPLOAD_TTL_SECONDS = 10 * 60;

export class AgreementPdfTokenError extends Error {
  constructor() {
    super("Private agreement upload was not found");
    this.name = "AgreementPdfTokenError";
  }
}

export type AgreementPdfUploadTokenPayload = Readonly<{
  version: 1;
  kind: "agreement_pdf_upload";
  uploadId: string;
  producerId: string;
  viewerClerkUserId: string;
  originalFileName: string;
  contentType: typeof AGREEMENT_PDF_CONTENT_TYPE;
  sizeBytes: number;
  expiresAtEpochSeconds: number;
}>;

function tokenError(): never {
  throw new AgreementPdfTokenError();
}

function signingKey(serverSecret: string): Buffer {
  if (typeof serverSecret !== "string" || serverSecret.length < 20) {
    throw new Error("Private agreement uploads require the configured server auth secret");
  }
  return createHmac("sha256", serverSecret).update(`${TOKEN_DOMAIN}:signing-key`).digest();
}

function sign(serverSecret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", signingKey(serverSecret))
    .update(`${TOKEN_DOMAIN}\0${encodedPayload}`, "utf8")
    .digest();
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value
  );
}

function assertPayload(value: unknown): AgreementPdfUploadTokenPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) tokenError();
  const payload = value as Record<string, unknown>;
  const actual = Object.keys(payload).sort();
  const expected = [
    "version",
    "kind",
    "uploadId",
    "producerId",
    "viewerClerkUserId",
    "originalFileName",
    "contentType",
    "sizeBytes",
    "expiresAtEpochSeconds",
  ].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    payload.version !== 1 ||
    payload.kind !== "agreement_pdf_upload" ||
    typeof payload.uploadId !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.uploadId) ||
    !validIdentifier(payload.producerId) ||
    !validIdentifier(payload.viewerClerkUserId) ||
    typeof payload.originalFileName !== "string" ||
    typeof payload.contentType !== "string" ||
    typeof payload.sizeBytes !== "number" ||
    agreementPdfFileError({
      originalFileName: payload.originalFileName,
      contentType: payload.contentType,
      sizeBytes: payload.sizeBytes,
    }) !== null ||
    typeof payload.expiresAtEpochSeconds !== "number" ||
    !Number.isSafeInteger(payload.expiresAtEpochSeconds) ||
    payload.expiresAtEpochSeconds <= 0
  ) {
    tokenError();
  }
  return Object.freeze({
    version: 1,
    kind: "agreement_pdf_upload",
    uploadId: payload.uploadId,
    producerId: payload.producerId,
    viewerClerkUserId: payload.viewerClerkUserId,
    originalFileName: payload.originalFileName.trim(),
    contentType: AGREEMENT_PDF_CONTENT_TYPE,
    sizeBytes: payload.sizeBytes,
    expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
  });
}

function canonicalPayload(payload: AgreementPdfUploadTokenPayload): string {
  return JSON.stringify({
    version: 1,
    kind: "agreement_pdf_upload",
    uploadId: payload.uploadId,
    producerId: payload.producerId,
    viewerClerkUserId: payload.viewerClerkUserId,
    originalFileName: payload.originalFileName,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
  });
}

export function createAgreementPdfUploadToken(
  serverSecret: string,
  input: Pick<
    AgreementPdfUploadTokenPayload,
    "producerId" | "viewerClerkUserId" | "originalFileName" | "contentType" | "sizeBytes"
  >,
  now = new Date(),
): { token: string; payload: AgreementPdfUploadTokenPayload } {
  const payload = assertPayload({
    version: 1,
    kind: "agreement_pdf_upload",
    uploadId: randomBytes(32).toString("hex"),
    ...input,
    expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + AGREEMENT_PDF_UPLOAD_TTL_SECONDS,
  });
  const encoded = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
  return { token: `${encoded}.${sign(serverSecret, encoded).toString("base64url")}`, payload };
}

function verifyOwnedAgreementPdfUploadTokenInternal(
  serverSecret: string,
  token: string,
  expected: Readonly<{ producerId: string; viewerClerkUserId: string }>,
  input: Readonly<{ requireUnexpired: boolean; now: Date }>,
): AgreementPdfUploadTokenPayload {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
    Number.isNaN(input.now.getTime())
  ) {
    tokenError();
  }
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) tokenError();
  let supplied: Buffer;
  let decoded: unknown;
  try {
    supplied = Buffer.from(signature, "base64url");
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  } catch {
    tokenError();
  }
  if (supplied.toString("base64url") !== signature) tokenError();
  const expectedSignature = sign(serverSecret, encoded);
  if (
    supplied.length !== expectedSignature.length ||
    !timingSafeEqual(supplied, expectedSignature)
  ) {
    tokenError();
  }
  const payload = assertPayload(decoded);
  if (
    Buffer.from(canonicalPayload(payload), "utf8").toString("base64url") !== encoded ||
    (input.requireUnexpired &&
      payload.expiresAtEpochSeconds <= Math.floor(input.now.getTime() / 1_000)) ||
    payload.producerId !== expected.producerId ||
    payload.viewerClerkUserId !== expected.viewerClerkUserId
  ) {
    tokenError();
  }
  return payload;
}

export function verifyOwnedAgreementPdfUploadToken(
  serverSecret: string,
  token: string,
  expected: Readonly<{ producerId: string; viewerClerkUserId: string }>,
  now = new Date(),
): AgreementPdfUploadTokenPayload {
  return verifyOwnedAgreementPdfUploadTokenInternal(serverSecret, token, expected, {
    requireUnexpired: true,
    now,
  });
}

/**
 * Cancellation may arrive after the upload capability expires. The signature,
 * canonical payload, producer, and signed-in actor remain mandatory; only the
 * expiry check is relaxed because this path can delete the staging key only.
 */
export function verifyOwnedAgreementPdfUploadTokenForCleanup(
  serverSecret: string,
  token: string,
  expected: Readonly<{ producerId: string; viewerClerkUserId: string }>,
): AgreementPdfUploadTokenPayload {
  return verifyOwnedAgreementPdfUploadTokenInternal(serverSecret, token, expected, {
    requireUnexpired: false,
    now: new Date(),
  });
}

export function agreementPdfObjectKeys(
  serverSecret: string,
  uploadId: string,
): { stagingKey: string; finalKey: string } {
  if (!/^[a-f0-9]{64}$/.test(uploadId)) tokenError();
  const key = signingKey(serverSecret);
  const opaque = (purpose: "staging" | "document") =>
    createHmac("sha256", key)
      .update(`${TOKEN_DOMAIN}:object:${purpose}\0${uploadId}`, "utf8")
      .digest("hex");
  return {
    stagingKey: `agreement-pdf-staging/${opaque("staging")}`,
    finalKey: `agreement-pdfs/${opaque("document")}`,
  };
}
