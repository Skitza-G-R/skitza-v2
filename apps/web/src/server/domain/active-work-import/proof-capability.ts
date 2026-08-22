import { createHmac, timingSafeEqual } from "node:crypto";

import {
  assertProofUploadMetadata,
  normalizeProofFileName,
  PaymentProofPolicyError,
  type ProofContentType,
} from "../payment-proofs/policy";
import {
  createPrivateProofUpload,
  finalizePrivateProofUpload,
  type FinalizedProofObject,
} from "../payment-proofs/storage";
import { ActiveWorkImportDomainError } from "./service";

const DOMAIN = "skitza:active-work-import-proof:v2";
const MAX_TOKEN_LENGTH = 4_096;

export class ActiveWorkImportProofCapabilityError extends Error {
  constructor() {
    super("The imported payment proof is invalid");
    this.name = "ActiveWorkImportProofCapabilityError";
  }
}

export type ActiveWorkImportProofCapability = Readonly<{
  version: 2;
  kind: "active_work_import_proof";
  uploadId: string;
  producerId: string;
  batchId: string;
  rowId: string;
  paymentOperationKey: string;
  originalFileName: string;
  contentType: ProofContentType;
  sizeBytes: number;
}>;

function fail(): never {
  throw new ActiveWorkImportProofCapabilityError();
}

function signingKey(serverSecret: string): Buffer {
  if (typeof serverSecret !== "string" || serverSecret.length < 20) {
    throw new Error("Import proof capabilities require the configured server auth secret");
  }
  return createHmac("sha256", serverSecret).update(`${DOMAIN}:signing-key`).digest();
}

function identifier(value: unknown, maximum = 200): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    value.length <= maximum
  );
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function exactKeys(value: Record<string, unknown>): void {
  const expected = [
    "version",
    "kind",
    "uploadId",
    "producerId",
    "batchId",
    "rowId",
    "paymentOperationKey",
    "originalFileName",
    "contentType",
    "sizeBytes",
  ].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail();
  }
}

function assertPayload(value: unknown): ActiveWorkImportProofCapability {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const payload = value as Record<string, unknown>;
  exactKeys(payload);
  if (
    payload.version !== 2 ||
    payload.kind !== "active_work_import_proof" ||
    typeof payload.uploadId !== "string" ||
    !/^[0-9a-f]{64}$/.test(payload.uploadId) ||
    !uuid(payload.producerId) ||
    !uuid(payload.batchId) ||
    !uuid(payload.rowId) ||
    !identifier(payload.paymentOperationKey) ||
    typeof payload.originalFileName !== "string" ||
    typeof payload.contentType !== "string" ||
    typeof payload.sizeBytes !== "number"
  ) {
    fail();
  }
  try {
    const originalFileName = normalizeProofFileName(payload.originalFileName);
    const metadata = {
      contentType: payload.contentType,
      sizeBytes: payload.sizeBytes,
    };
    assertProofUploadMetadata(metadata);
    return Object.freeze({
      version: 2,
      kind: "active_work_import_proof",
      uploadId: payload.uploadId,
      producerId: payload.producerId,
      batchId: payload.batchId,
      rowId: payload.rowId,
      paymentOperationKey: payload.paymentOperationKey,
      originalFileName,
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
    });
  } catch {
    fail();
  }
}

function canonical(payload: ActiveWorkImportProofCapability): string {
  return JSON.stringify({
    version: payload.version,
    kind: payload.kind,
    uploadId: payload.uploadId,
    producerId: payload.producerId,
    batchId: payload.batchId,
    rowId: payload.rowId,
    paymentOperationKey: payload.paymentOperationKey,
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

export function createActiveWorkImportProofCapability(
  serverSecret: string,
  input: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    paymentOperationKey: string;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
  }>,
): Readonly<{ token: string; payload: ActiveWorkImportProofCapability }> {
  const paymentOperationKey = input.paymentOperationKey.trim();
  if (!identifier(paymentOperationKey)) fail();
  let originalFileName: string;
  const metadata = {
    contentType: input.contentType.trim().toLowerCase(),
    sizeBytes: input.sizeBytes,
  };
  try {
    originalFileName = normalizeProofFileName(input.originalFileName);
    assertProofUploadMetadata(metadata);
  } catch (error) {
    // A producer-supplied file that the proof policy rejects is ordinary
    // invalid input with a plain reason, not a broken capability.
    if (error instanceof PaymentProofPolicyError) {
      throw new ActiveWorkImportDomainError("INVALID_INPUT", error.message);
    }
    throw error;
  }
  const base = assertPayload({
    version: 2,
    kind: "active_work_import_proof",
    uploadId: createHmac("sha256", signingKey(serverSecret))
      .update(
        [
          `${DOMAIN}:upload`,
          input.producerId,
          input.batchId,
          input.rowId,
          paymentOperationKey,
          originalFileName,
          metadata.contentType,
          String(metadata.sizeBytes),
        ].join("\0"),
        "utf8",
      )
      .digest("hex"),
    producerId: input.producerId,
    batchId: input.batchId,
    rowId: input.rowId,
    paymentOperationKey,
    originalFileName,
    contentType: metadata.contentType,
    sizeBytes: metadata.sizeBytes,
  });
  const encoded = Buffer.from(canonical(base), "utf8").toString("base64url");
  return {
    token: `${encoded}.${signature(serverSecret, encoded).toString("base64url")}`,
    payload: base,
  };
}

export function verifyActiveWorkImportProofCapability(
  serverSecret: string,
  token: string,
  expected: Readonly<{
    producerId: string;
    batchId: string;
    rowId: string;
    paymentOperationKey: string;
  }>,
): ActiveWorkImportProofCapability {
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
    payload.rowId !== expected.rowId ||
    payload.paymentOperationKey !== expected.paymentOperationKey
  ) {
    fail();
  }
  return payload;
}

function storageDescriptor(payload: ActiveWorkImportProofCapability) {
  return {
    uploadId: payload.uploadId,
    originalFileName: payload.originalFileName,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
  };
}

export async function createActiveWorkImportProofUpload(
  serverSecret: string,
  payload: ActiveWorkImportProofCapability,
): Promise<{ uploadUrl: string; expiresInSeconds: number }> {
  return createPrivateProofUpload(serverSecret, storageDescriptor(payload));
}

export async function finalizeActiveWorkImportProofUpload(
  serverSecret: string,
  payload: ActiveWorkImportProofCapability,
): Promise<FinalizedProofObject> {
  return finalizePrivateProofUpload(serverSecret, storageDescriptor(payload));
}
