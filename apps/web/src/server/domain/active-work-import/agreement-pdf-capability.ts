import { createHmac, timingSafeEqual } from "node:crypto";

import { AGREEMENT_PDF_CONTENT_TYPE, agreementPdfFileError } from "~/lib/agreement-pdf";

import {
  createPrivateAgreementPdfUpload,
  finalizePrivateAgreementPdfUpload,
} from "../agreement-pdfs/storage";
import type { AgreementPdfDocument } from "../agreement-pdfs/contract";
import { ActiveWorkImportDomainError } from "./service";

const DOMAIN = "skitza:active-work-import-agreement-pdf:v1";
const MAX_TOKEN_LENGTH = 4_096;

export class ActiveWorkImportAgreementPdfCapabilityError extends Error {
  constructor() {
    super("The imported agreement PDF is invalid");
    this.name = "ActiveWorkImportAgreementPdfCapabilityError";
  }
}

/**
 * Signed reference to one agreement PDF staged for one import row. Like the
 * payment-proof capability it carries no clock: the draft may be created days
 * after the file was chosen. Only storage expiry (1-day staging lifecycle)
 * can invalidate it, and that surfaces as "attach it again".
 */
export type ActiveWorkImportAgreementPdfCapability = Readonly<{
  version: 1;
  kind: "active_work_import_agreement_pdf";
  uploadId: string;
  producerId: string;
  batchId: string;
  rowId: string;
  originalFileName: string;
  contentType: typeof AGREEMENT_PDF_CONTENT_TYPE;
  sizeBytes: number;
}>;

function fail(): never {
  throw new ActiveWorkImportAgreementPdfCapabilityError();
}

function signingKey(serverSecret: string): Buffer {
  if (typeof serverSecret !== "string" || serverSecret.length < 20) {
    throw new Error("Import agreement PDF capabilities require the configured server auth secret");
  }
  return createHmac("sha256", serverSecret).update(`${DOMAIN}:signing-key`).digest();
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

const PAYLOAD_KEYS = [
  "version",
  "kind",
  "uploadId",
  "producerId",
  "batchId",
  "rowId",
  "originalFileName",
  "contentType",
  "sizeBytes",
].sort();

function assertPayload(value: unknown): ActiveWorkImportAgreementPdfCapability {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const payload = value as Record<string, unknown>;
  const actual = Object.keys(payload).sort();
  if (
    actual.length !== PAYLOAD_KEYS.length ||
    actual.some((key, index) => key !== PAYLOAD_KEYS[index]) ||
    payload.version !== 1 ||
    payload.kind !== "active_work_import_agreement_pdf" ||
    typeof payload.uploadId !== "string" ||
    !/^[0-9a-f]{64}$/.test(payload.uploadId) ||
    !uuid(payload.producerId) ||
    !uuid(payload.batchId) ||
    !uuid(payload.rowId) ||
    typeof payload.originalFileName !== "string" ||
    typeof payload.contentType !== "string" ||
    typeof payload.sizeBytes !== "number" ||
    agreementPdfFileError({
      originalFileName: payload.originalFileName,
      contentType: payload.contentType,
      sizeBytes: payload.sizeBytes,
    }) !== null
  ) {
    fail();
  }
  return Object.freeze({
    version: 1,
    kind: "active_work_import_agreement_pdf",
    uploadId: payload.uploadId,
    producerId: payload.producerId,
    batchId: payload.batchId,
    rowId: payload.rowId,
    originalFileName: payload.originalFileName.trim(),
    contentType: AGREEMENT_PDF_CONTENT_TYPE,
    sizeBytes: payload.sizeBytes,
  });
}

function canonical(payload: ActiveWorkImportAgreementPdfCapability): string {
  return JSON.stringify({
    version: payload.version,
    kind: payload.kind,
    uploadId: payload.uploadId,
    producerId: payload.producerId,
    batchId: payload.batchId,
    rowId: payload.rowId,
    originalFileName: payload.originalFileName,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
  });
}

function signature(serverSecret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", signingKey(serverSecret))
    .update(`${DOMAIN}\0${encodedPayload}`, "utf8")
    .digest();
}

export function createActiveWorkImportAgreementPdfCapability(
  serverSecret: string,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
  }>,
): Readonly<{ token: string; payload: ActiveWorkImportAgreementPdfCapability }> {
  const originalFileName = input.originalFileName.trim();
  const contentType = input.contentType.trim().toLowerCase();
  // A producer-supplied file the PDF policy rejects is ordinary invalid input
  // with a plain reason, not a broken capability.
  const fileError = agreementPdfFileError({
    originalFileName,
    contentType,
    sizeBytes: input.sizeBytes,
  });
  if (fileError) throw new ActiveWorkImportDomainError("INVALID_INPUT", fileError);
  const base = assertPayload({
    version: 1,
    kind: "active_work_import_agreement_pdf",
    uploadId: createHmac("sha256", signingKey(serverSecret))
      .update(
        [
          `${DOMAIN}:upload`,
          input.producerId,
          input.batchId,
          input.rowId,
          originalFileName,
          contentType,
          String(input.sizeBytes),
        ].join("\0"),
        "utf8",
      )
      .digest("hex"),
    producerId: input.producerId,
    batchId: input.batchId,
    rowId: input.rowId,
    originalFileName,
    contentType,
    sizeBytes: input.sizeBytes,
  });
  const encoded = Buffer.from(canonical(base), "utf8").toString("base64url");
  return {
    token: `${encoded}.${signature(serverSecret, encoded).toString("base64url")}`,
    payload: base,
  };
}

export function verifyActiveWorkImportAgreementPdfCapability(
  serverSecret: string,
  token: string,
  expected: Readonly<{ producerId: string; batchId: string; rowId: string }>,
): ActiveWorkImportAgreementPdfCapability {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    fail();
  }
  const [encoded, suppliedText] = token.split(".");
  if (!encoded || !suppliedText) fail();
  let supplied: Buffer;
  let decoded: unknown;
  try {
    supplied = Buffer.from(suppliedText, "base64url");
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail();
  }
  if (supplied.toString("base64url") !== suppliedText) fail();
  const expectedSignature = signature(serverSecret, encoded);
  if (
    supplied.length !== expectedSignature.length ||
    !timingSafeEqual(supplied, expectedSignature)
  ) {
    fail();
  }
  const payload = assertPayload(decoded);
  if (
    Buffer.from(canonical(payload), "utf8").toString("base64url") !== encoded ||
    payload.producerId !== expected.producerId ||
    payload.batchId !== expected.batchId ||
    payload.rowId !== expected.rowId
  ) {
    fail();
  }
  return payload;
}

export async function createActiveWorkImportAgreementPdfUpload(
  serverSecret: string,
  payload: ActiveWorkImportAgreementPdfCapability,
): Promise<{ uploadUrl: string; expiresInSeconds: number }> {
  return createPrivateAgreementPdfUpload(serverSecret, payload);
}

export async function finalizeActiveWorkImportAgreementPdfUpload(
  serverSecret: string,
  payload: ActiveWorkImportAgreementPdfCapability,
): Promise<AgreementPdfDocument> {
  return finalizePrivateAgreementPdfUpload(serverSecret, payload);
}
