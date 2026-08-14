import { createHash } from "node:crypto";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

export type RelinkRole = "artist" | "producer";

export type ClerkIdentityRelinkPrincipal = Readonly<{
  canonicalClerkUserId: string;
  targetProviderClerkUserId: string;
  verifiedEmailHash: string;
  expectedRoles: readonly RelinkRole[];
  expectedArtistLinkCount: number;
}>;

export type ClerkIdentityRelinkManifest = Readonly<{
  version: 1;
  batchId: string;
  sourceClerkInstanceId: string;
  targetClerkInstanceId: string;
  producerInvitationCutoff: string;
  evidenceRef: string;
  principals: readonly ClerkIdentityRelinkPrincipal[];
}>;

export class ClerkIdentityRelinkError extends Error {
  constructor(
    readonly code:
      | "RELINK_MANIFEST_INVALID"
      | "RELINK_INVENTORY_MISMATCH"
      | "RELINK_PROVIDER_EVIDENCE_MISMATCH"
      | "RELINK_BINDING_CONFLICT"
      | "RELINK_APPROVAL_INVALID",
  ) {
    super(code);
    this.name = "ClerkIdentityRelinkError";
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  return value;
}

function evidenceRef(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 255 ||
    value.includes("\u0000")
  ) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  return value;
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== "string") {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  return value;
}

function principal(value: unknown): ClerkIdentityRelinkPrincipal {
  const input = record(value);
  exactKeys(input, [
    "canonicalClerkUserId",
    "targetProviderClerkUserId",
    "verifiedEmailHash",
    "expectedRoles",
    "expectedArtistLinkCount",
  ]);
  if (!Array.isArray(input.expectedRoles)) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  const expectedRoles: RelinkRole[] = input.expectedRoles.map((role: unknown) => {
    if (role !== "artist" && role !== "producer") {
      throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
    }
    return role as RelinkRole;
  });
  if (
    expectedRoles.length !== 1 ||
    !Number.isInteger(input.expectedArtistLinkCount) ||
    (input.expectedArtistLinkCount as number) < 0
  ) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  const role = expectedRoles[0];
  if (role === undefined) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  const expectedArtistLinkCount = input.expectedArtistLinkCount as number;
  if (
    (role === "producer" && expectedArtistLinkCount !== 0) ||
    (role === "artist" && expectedArtistLinkCount === 0)
  ) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }

  const canonicalClerkUserId = identifier(input.canonicalClerkUserId);
  const targetProviderClerkUserId = identifier(input.targetProviderClerkUserId);
  if (canonicalClerkUserId === targetProviderClerkUserId) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  return Object.freeze({
    canonicalClerkUserId,
    targetProviderClerkUserId,
    verifiedEmailHash: sha256(input.verifiedEmailHash),
    expectedRoles: Object.freeze([role]),
    expectedArtistLinkCount,
  });
}

/**
 * Parses only an explicit six-pair manifest. Email addresses are forbidden;
 * the same precomputed verified-email hash must be proved on both exact Clerk
 * user IDs by the provider verifier.
 */
export function parseClerkIdentityRelinkManifest(value: unknown): ClerkIdentityRelinkManifest {
  const input = record(value);
  exactKeys(input, [
    "version",
    "batchId",
    "sourceClerkInstanceId",
    "targetClerkInstanceId",
    "producerInvitationCutoff",
    "evidenceRef",
    "principals",
  ]);
  if (input.version !== 1 || !Array.isArray(input.principals) || input.principals.length !== 6) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  if (typeof input.batchId !== "string" || !UUID.test(input.batchId)) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  const sourceClerkInstanceId = identifier(input.sourceClerkInstanceId);
  const targetClerkInstanceId = identifier(input.targetClerkInstanceId);
  if (sourceClerkInstanceId === targetClerkInstanceId) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  const principals = input.principals.map(principal);
  const canonicalIds = new Set(principals.map((item) => item.canonicalClerkUserId));
  const targetIds = new Set(principals.map((item) => item.targetProviderClerkUserId));
  const producerCount = principals.filter((item) => item.expectedRoles[0] === "producer").length;
  const artistLinkCounts = principals
    .filter((item) => item.expectedRoles[0] === "artist")
    .map((item) => item.expectedArtistLinkCount)
    .sort((left, right) => left - right);
  if (
    canonicalIds.size !== 6 ||
    targetIds.size !== 6 ||
    principals.some((item) => targetIds.has(item.canonicalClerkUserId)) ||
    producerCount !== 2 ||
    artistLinkCounts.join(",") !== "1,1,1,2"
  ) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }

  return Object.freeze({
    version: 1,
    batchId: input.batchId,
    sourceClerkInstanceId,
    targetClerkInstanceId,
    producerInvitationCutoff: canonicalInstant(input.producerInvitationCutoff),
    evidenceRef: evidenceRef(input.evidenceRef),
    principals: Object.freeze(principals),
  });
}

function canonicalManifest(manifest: ClerkIdentityRelinkManifest): string {
  return JSON.stringify({
    version: manifest.version,
    batchId: manifest.batchId,
    sourceClerkInstanceId: manifest.sourceClerkInstanceId,
    targetClerkInstanceId: manifest.targetClerkInstanceId,
    producerInvitationCutoff: manifest.producerInvitationCutoff,
    evidenceRef: manifest.evidenceRef,
    principals: [...manifest.principals]
      .sort((left, right) => left.canonicalClerkUserId.localeCompare(right.canonicalClerkUserId))
      .map((item) => ({
        canonicalClerkUserId: item.canonicalClerkUserId,
        targetProviderClerkUserId: item.targetProviderClerkUserId,
        verifiedEmailHash: item.verifiedEmailHash,
        expectedRoles: [...item.expectedRoles],
        expectedArtistLinkCount: item.expectedArtistLinkCount,
      })),
  });
}

export function clerkIdentityRelinkManifestDigest(manifest: ClerkIdentityRelinkManifest): string {
  return `sha256:${createHash("sha256").update(canonicalManifest(manifest)).digest("hex")}`;
}

export function requireClerkIdentityRelinkApproval(
  operation: "activate" | "reject-stage" | "stage",
  manifest: ClerkIdentityRelinkManifest,
  approval: string | undefined,
): void {
  const expected = `${operation}:${manifest.batchId}:${clerkIdentityRelinkManifestDigest(manifest)}`;
  if (approval !== expected) {
    throw new ClerkIdentityRelinkError("RELINK_APPROVAL_INVALID");
  }
}
