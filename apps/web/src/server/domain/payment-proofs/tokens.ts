import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { assertProofUploadMetadata, normalizeProofFileName, type ProofContentType } from "./policy";

const TOKEN_DOMAIN = "skitza:private-payment-proof:v1";
const MAX_TOKEN_LENGTH = 4_096;
export const PROOF_EVIDENCE_TTL_SECONDS = 5 * 60;
export const PROOF_UPLOAD_TTL_SECONDS = 10 * 60;

export class ProofTokenError extends Error {
  constructor() {
    super("Private payment evidence was not found");
    this.name = "ProofTokenError";
  }
}

export type ProofUploadTokenPayload = Readonly<{
  version: 1;
  kind: "proof_upload";
  uploadId: string;
  purchaseId: string;
  installmentId: string;
  viewerClerkUserId: string;
  originalFileName: string;
  contentType: ProofContentType;
  sizeBytes: number;
  expiresAtEpochSeconds: number;
}>;

export type ProofEvidenceTokenPayload = Readonly<{
  version: 1;
  kind: "proof_evidence";
  proofId: string;
  viewerClerkUserId: string;
  viewerRole: "artist" | "producer";
  expiresAtEpochSeconds: number;
}>;

type ProofTokenPayload = ProofUploadTokenPayload | ProofEvidenceTokenPayload;

function tokenError(): never {
  throw new ProofTokenError();
}

function signingKey(serverSecret: string): Buffer {
  if (typeof serverSecret !== "string" || serverSecret.length < 20) {
    throw new Error("Private proof tokens require the configured server auth secret");
  }
  return createHmac("sha256", serverSecret).update(`${TOKEN_DOMAIN}:signing-key`).digest();
}

function sign(serverSecret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", signingKey(serverSecret))
    .update(`${TOKEN_DOMAIN}\0${encodedPayload}`, "utf8")
    .digest();
}

function requiredIdentifier(value: unknown, maximum = 200): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    value.length <= maximum
  );
}

function validExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    tokenError();
  }
}

function assertPayload(value: unknown): ProofTokenPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) tokenError();
  const payload = value as Record<string, unknown>;
  if (payload.version !== 1) tokenError();

  if (payload.kind === "proof_upload") {
    assertExactKeys(payload, [
      "version",
      "kind",
      "uploadId",
      "purchaseId",
      "installmentId",
      "viewerClerkUserId",
      "originalFileName",
      "contentType",
      "sizeBytes",
      "expiresAtEpochSeconds",
    ]);
    if (
      typeof payload.uploadId !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.uploadId) ||
      !requiredIdentifier(payload.purchaseId) ||
      !requiredIdentifier(payload.installmentId) ||
      !requiredIdentifier(payload.viewerClerkUserId) ||
      typeof payload.originalFileName !== "string" ||
      typeof payload.contentType !== "string" ||
      typeof payload.sizeBytes !== "number" ||
      !validExpiry(payload.expiresAtEpochSeconds)
    ) {
      tokenError();
    }
    try {
      const originalFileName = normalizeProofFileName(payload.originalFileName);
      assertProofUploadMetadata({
        contentType: payload.contentType,
        sizeBytes: payload.sizeBytes,
      });
      return Object.freeze({
        version: 1,
        kind: "proof_upload",
        uploadId: payload.uploadId,
        purchaseId: payload.purchaseId,
        installmentId: payload.installmentId,
        viewerClerkUserId: payload.viewerClerkUserId,
        originalFileName,
        contentType: payload.contentType as ProofContentType,
        sizeBytes: payload.sizeBytes,
        expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
      });
    } catch {
      tokenError();
    }
  }

  if (payload.kind === "proof_evidence") {
    assertExactKeys(payload, [
      "version",
      "kind",
      "proofId",
      "viewerClerkUserId",
      "viewerRole",
      "expiresAtEpochSeconds",
    ]);
    if (
      !requiredIdentifier(payload.proofId) ||
      !requiredIdentifier(payload.viewerClerkUserId) ||
      (payload.viewerRole !== "artist" && payload.viewerRole !== "producer") ||
      !validExpiry(payload.expiresAtEpochSeconds)
    ) {
      tokenError();
    }
    return Object.freeze({
      version: 1,
      kind: "proof_evidence",
      proofId: payload.proofId,
      viewerClerkUserId: payload.viewerClerkUserId,
      viewerRole: payload.viewerRole,
      expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
    });
  }

  return tokenError();
}

function canonicalPayload(payload: ProofTokenPayload): string {
  if (payload.kind === "proof_upload") {
    return JSON.stringify({
      version: 1,
      kind: "proof_upload",
      uploadId: payload.uploadId,
      purchaseId: payload.purchaseId,
      installmentId: payload.installmentId,
      viewerClerkUserId: payload.viewerClerkUserId,
      originalFileName: payload.originalFileName,
      contentType: payload.contentType,
      sizeBytes: payload.sizeBytes,
      expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
    });
  }
  return JSON.stringify({
    version: 1,
    kind: "proof_evidence",
    proofId: payload.proofId,
    viewerClerkUserId: payload.viewerClerkUserId,
    viewerRole: payload.viewerRole,
    expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
  });
}

function signToken(serverSecret: string, payloadValue: ProofTokenPayload): string {
  const payload = assertPayload(payloadValue);
  const encodedPayload = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(serverSecret, encodedPayload).toString("base64url")}`;
}

function verifyToken(serverSecret: string, token: string, now: Date): ProofTokenPayload {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
    Number.isNaN(now.getTime())
  ) {
    tokenError();
  }
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) tokenError();

  let suppliedSignature: Buffer;
  let decoded: unknown;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
    decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    tokenError();
  }
  if (suppliedSignature.toString("base64url") !== encodedSignature) tokenError();
  const expectedSignature = sign(serverSecret, encodedPayload);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    tokenError();
  }
  const payload = assertPayload(decoded);
  if (Buffer.from(canonicalPayload(payload), "utf8").toString("base64url") !== encodedPayload) {
    tokenError();
  }
  if (payload.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) tokenError();
  return payload;
}

export function createProofUploadToken(
  serverSecret: string,
  input: Omit<ProofUploadTokenPayload, "version" | "kind" | "uploadId" | "expiresAtEpochSeconds">,
  now = new Date(),
): { token: string; payload: ProofUploadTokenPayload } {
  const payload = assertPayload({
    version: 1,
    kind: "proof_upload",
    uploadId: randomBytes(32).toString("hex"),
    ...input,
    expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + PROOF_UPLOAD_TTL_SECONDS,
  });
  if (payload.kind !== "proof_upload") tokenError();
  return { token: signToken(serverSecret, payload), payload };
}

export function verifyProofUploadToken(
  serverSecret: string,
  token: string,
  now = new Date(),
): ProofUploadTokenPayload {
  const payload = verifyToken(serverSecret, token, now);
  if (payload.kind !== "proof_upload") tokenError();
  return payload;
}

export function verifyOwnedProofUploadToken(
  serverSecret: string,
  token: string,
  expected: Readonly<{
    viewerClerkUserId: string;
    purchaseId: string;
    installmentId: string;
  }>,
  now = new Date(),
): ProofUploadTokenPayload {
  const payload = verifyProofUploadToken(serverSecret, token, now);
  if (
    payload.viewerClerkUserId !== expected.viewerClerkUserId ||
    payload.purchaseId !== expected.purchaseId ||
    payload.installmentId !== expected.installmentId
  ) {
    tokenError();
  }
  return payload;
}

export function createProofEvidenceToken(
  serverSecret: string,
  input: Omit<ProofEvidenceTokenPayload, "version" | "kind" | "expiresAtEpochSeconds">,
  now = new Date(),
): string {
  return signToken(serverSecret, {
    version: 1,
    kind: "proof_evidence",
    ...input,
    expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + PROOF_EVIDENCE_TTL_SECONDS,
  });
}

export function verifyProofEvidenceToken(
  serverSecret: string,
  token: string,
  now = new Date(),
): ProofEvidenceTokenPayload {
  const payload = verifyToken(serverSecret, token, now);
  if (payload.kind !== "proof_evidence") tokenError();
  return payload;
}

/** Server-only derivation: clients see neither permanent object key. */
export function proofObjectKeys(
  serverSecret: string,
  uploadId: string,
): { stagingKey: string; finalKey: string } {
  if (!/^[a-f0-9]{64}$/.test(uploadId)) tokenError();
  const key = signingKey(serverSecret);
  const opaque = (purpose: "staging" | "evidence") =>
    createHmac("sha256", key)
      .update(`${TOKEN_DOMAIN}:object:${purpose}\0${uploadId}`, "utf8")
      .digest("hex");
  return {
    stagingKey: `proof-staging/${opaque("staging")}`,
    finalKey: `proof-evidence/${opaque("evidence")}`,
  };
}
