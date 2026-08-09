import { Buffer } from "node:buffer";

import {
  AGREEMENT_PDF_CONTENT_TYPE,
  agreementPdfFileError,
  type AgreementPdfClientSnapshot,
} from "~/lib/agreement-pdf";

const CONTRACT_PREFIX = "skitza-private-agreement:v1:";
// The cleanup discriminator sits inside the live prefix deliberately. Older
// deployments see `cleanup:<payload>` as invalid base64url and fail closed.
const CLEANUP_CONTRACT_PREFIX = `${CONTRACT_PREFIX}cleanup:`;
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_LEDGER_REVISIONS = 512;

export class AgreementPdfContractError extends Error {
  constructor(message = "Private agreement metadata is invalid") {
    super(message);
    this.name = "AgreementPdfContractError";
  }
}

export type AgreementPdfDocument = Readonly<{
  storageBucket: "docs";
  storageKey: string;
  originalFileName: string;
  contentType: typeof AGREEMENT_PDF_CONTENT_TYPE;
  sizeBytes: number;
  objectEtag: string;
  sha256: string;
}>;

export type AgreementPdfRevision = Readonly<{
  revisionId: string;
  effectiveAt: string;
  document: AgreementPdfDocument | null;
}>;

export type AgreementPdfLedger = Readonly<{
  version: 1;
  revisions: readonly AgreementPdfRevision[];
}>;

export type AgreementPdfContract =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "legacy" }>
  | Readonly<{ kind: "ledger"; ledger: AgreementPdfLedger }>
  | Readonly<{ kind: "cleanup"; ledger: AgreementPdfLedger }>;

function fail(): never {
  throw new AgreementPdfContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseDocument(value: unknown): AgreementPdfDocument | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "storageBucket",
      "storageKey",
      "originalFileName",
      "contentType",
      "sizeBytes",
      "objectEtag",
      "sha256",
    ]) ||
    value.storageBucket !== "docs" ||
    typeof value.storageKey !== "string" ||
    !/^agreement-pdfs\/[a-f0-9]{64}$/.test(value.storageKey) ||
    typeof value.originalFileName !== "string" ||
    typeof value.contentType !== "string" ||
    typeof value.sizeBytes !== "number" ||
    agreementPdfFileError({
      originalFileName: value.originalFileName,
      contentType: value.contentType,
      sizeBytes: value.sizeBytes,
    }) !== null ||
    typeof value.objectEtag !== "string" ||
    value.objectEtag.length === 0 ||
    value.objectEtag.length > 200 ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.sha256)
  ) {
    fail();
  }
  return Object.freeze({
    storageBucket: "docs",
    storageKey: value.storageKey,
    originalFileName: value.originalFileName.trim(),
    contentType: AGREEMENT_PDF_CONTENT_TYPE,
    sizeBytes: value.sizeBytes,
    objectEtag: value.objectEtag,
    sha256: value.sha256,
  });
}

function parseLedger(value: unknown): AgreementPdfLedger {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["version", "revisions"]) ||
    value.version !== 1 ||
    !Array.isArray(value.revisions) ||
    value.revisions.length === 0 ||
    value.revisions.length > MAX_LEDGER_REVISIONS
  ) {
    fail();
  }
  const ids = new Set<string>();
  let previousTime = -Infinity;
  const revisions = value.revisions.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !exactKeys(candidate, ["revisionId", "effectiveAt", "document"]) ||
      typeof candidate.revisionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        candidate.revisionId,
      ) ||
      ids.has(candidate.revisionId) ||
      typeof candidate.effectiveAt !== "string"
    ) {
      fail();
    }
    const effectiveAt = new Date(candidate.effectiveAt);
    const effectiveTime = effectiveAt.getTime();
    if (
      Number.isNaN(effectiveTime) ||
      effectiveAt.toISOString() !== candidate.effectiveAt ||
      effectiveTime < previousTime
    ) {
      fail();
    }
    ids.add(candidate.revisionId);
    previousTime = effectiveTime;
    return Object.freeze({
      revisionId: candidate.revisionId,
      effectiveAt: candidate.effectiveAt,
      document: parseDocument(candidate.document),
    });
  });
  return Object.freeze({ version: 1, revisions: Object.freeze(revisions) });
}

export function parseAgreementPdfContract(value: string | null | undefined): AgreementPdfContract {
  if (value === null || value === undefined || value.trim().length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const kind = value.startsWith(CLEANUP_CONTRACT_PREFIX)
    ? ("cleanup" as const)
    : value.startsWith(CONTRACT_PREFIX)
      ? ("ledger" as const)
      : null;
  if (!kind) return Object.freeze({ kind: "legacy" });
  const prefix = kind === "ledger" ? CONTRACT_PREFIX : CLEANUP_CONTRACT_PREFIX;
  const encoded = value.slice(prefix.length);
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil((MAX_LEDGER_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    fail();
  }
  let json: string;
  let decoded: unknown;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length > MAX_LEDGER_BYTES || bytes.toString("base64url") !== encoded) fail();
    json = bytes.toString("utf8");
    decoded = JSON.parse(json) as unknown;
  } catch (error) {
    if (error instanceof AgreementPdfContractError) throw error;
    fail();
  }
  const ledger = parseLedger(decoded);
  if (JSON.stringify(ledger) !== json) fail();
  return Object.freeze({ kind, ledger });
}

export function currentAgreementPdfRevision(
  value: string | null | undefined,
): AgreementPdfRevision | null {
  const parsed = parseAgreementPdfContract(value);
  return parsed.kind === "ledger" ? (parsed.ledger.revisions.at(-1) ?? null) : null;
}

export function findAgreementPdfRevision(
  value: string | null | undefined,
  revisionId: string,
): AgreementPdfRevision | null {
  const parsed = parseAgreementPdfContract(value);
  if (parsed.kind !== "ledger") return null;
  return parsed.ledger.revisions.find((revision) => revision.revisionId === revisionId) ?? null;
}

export function agreementPdfContractReferencesStorageKey(
  value: string | null | undefined,
  storageKey: string,
): boolean {
  const parsed = parseAgreementPdfContract(value);
  if (parsed.kind !== "ledger" && parsed.kind !== "cleanup") return false;
  return parsed.ledger.revisions.some((revision) => revision.document?.storageKey === storageKey);
}

export function agreementPdfContractStorageKeys(
  value: string | null | undefined,
): readonly string[] {
  const parsed = parseAgreementPdfContract(value);
  if (parsed.kind !== "ledger" && parsed.kind !== "cleanup") return Object.freeze([]);
  return Object.freeze([
    ...new Set(
      parsed.ledger.revisions.flatMap((revision) =>
        revision.document ? [revision.document.storageKey] : [],
      ),
    ),
  ]);
}

export function agreementPdfContractDocumentsForCleanup(
  value: string | null | undefined,
): readonly AgreementPdfDocument[] {
  const parsed = parseAgreementPdfContract(value);
  if (parsed.kind !== "ledger" && parsed.kind !== "cleanup") return Object.freeze([]);
  const documents = new Map<string, AgreementPdfDocument>();
  for (const revision of parsed.ledger.revisions) {
    const document = revision.document;
    if (!document) continue;
    const existing = documents.get(document.storageKey);
    if (existing && JSON.stringify(existing) !== JSON.stringify(document)) fail();
    documents.set(document.storageKey, document);
  }
  return Object.freeze([...documents.values()]);
}

export function assertAgreementPdfContractCanAppend(value: string | null | undefined): void {
  const parsed = parseAgreementPdfContract(value);
  if (parsed.kind === "cleanup") fail();
  const previous = parsed.kind === "ledger" ? parsed.ledger.revisions : [];
  if (previous.length >= MAX_LEDGER_REVISIONS) fail();
  const worstCaseRevision = {
    revisionId: "ffffffff-ffff-4fff-bfff-ffffffffffff",
    effectiveAt: "9999-12-31T23:59:59.999Z",
    document: {
      storageBucket: "docs",
      storageKey: `agreement-pdfs/${"f".repeat(64)}`,
      originalFileName: `${"x".repeat(196)}.pdf`,
      contentType: AGREEMENT_PDF_CONTENT_TYPE,
      sizeBytes: 15 * 1024 * 1024,
      objectEtag: "x".repeat(200),
      sha256: "f".repeat(64),
    },
  };
  const candidateBytes = Buffer.byteLength(
    JSON.stringify({ version: 1, revisions: [...previous, worstCaseRevision] }),
    "utf8",
  );
  if (candidateBytes > MAX_LEDGER_BYTES) fail();
}

export function agreementPdfClientSnapshot(
  revision: AgreementPdfRevision | null,
): AgreementPdfClientSnapshot | null {
  if (!revision?.document) return null;
  return Object.freeze({
    documentId: revision.revisionId,
    originalFileName: revision.document.originalFileName,
    contentType: revision.document.contentType,
    sizeBytes: revision.document.sizeBytes,
    objectEtag: revision.document.objectEtag,
    sha256: revision.document.sha256,
  });
}

export function appendAgreementPdfRevision(
  currentValue: string | null | undefined,
  revision: AgreementPdfRevision,
): string {
  const parsed = parseAgreementPdfContract(currentValue);
  if (parsed.kind === "cleanup") fail();
  const previous = parsed.kind === "ledger" ? parsed.ledger.revisions : [];
  const ledger = parseLedger({ version: 1, revisions: [...previous, revision] });
  const encoded = Buffer.from(JSON.stringify(ledger), "utf8").toString("base64url");
  if (encoded.length > Math.ceil((MAX_LEDGER_BYTES * 4) / 3) + 4) fail();
  return `${CONTRACT_PREFIX}${encoded}`;
}

/**
 * Mark a no-history archived product's ledger as terminal cleanup metadata.
 * The bytes stay canonical and discoverable, but no current agreement can be
 * served or appended while object deletion is pending.
 */
export function markAgreementPdfContractForCleanup(value: string | null | undefined): string {
  const parsed = parseAgreementPdfContract(value);
  if (parsed.kind === "cleanup") return value as string;
  if (parsed.kind !== "ledger" || !value?.startsWith(CONTRACT_PREFIX)) fail();
  return `${CLEANUP_CONTRACT_PREFIX}${value.slice(CONTRACT_PREFIX.length)}`;
}

export function isAgreementPdfContractPendingCleanup(value: string | null | undefined): boolean {
  return parseAgreementPdfContract(value).kind === "cleanup";
}

export function agreementPdfProducerSummary(value: string | null | undefined): Readonly<{
  agreementPdf: Pick<
    AgreementPdfClientSnapshot,
    "documentId" | "originalFileName" | "sizeBytes"
  > | null;
  legacyAgreementLinkPresent: boolean;
}> {
  const parsed = parseAgreementPdfContract(value);
  if (parsed.kind === "legacy") {
    return Object.freeze({ agreementPdf: null, legacyAgreementLinkPresent: true });
  }
  const revision = parsed.kind === "ledger" ? (parsed.ledger.revisions.at(-1) ?? null) : null;
  const snapshot = agreementPdfClientSnapshot(revision);
  return Object.freeze({
    agreementPdf: snapshot
      ? {
          documentId: snapshot.documentId,
          originalFileName: snapshot.originalFileName,
          sizeBytes: snapshot.sizeBytes,
        }
      : null,
    legacyAgreementLinkPresent: false,
  });
}
