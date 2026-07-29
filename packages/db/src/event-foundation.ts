import { createHash } from "node:crypto";

export type FoundationEnvironment = "live" | "test";
export type SafeFoundationMetadata = Readonly<Record<string, boolean | number | string | null>>;

export type FoundationIntent = Readonly<{
  environment: FoundationEnvironment;
  intentType: string;
  operationDigest: string;
  operationKey: string;
}>;

export type EventFoundationErrorCode =
  | "ENVIRONMENT_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "UNSAFE_METADATA"
  | "WRITE_NOT_DURABLE";

export class EventFoundationError extends Error {
  readonly code: EventFoundationErrorCode;

  constructor(code: EventFoundationErrorCode) {
    super(code);
    this.name = "EventFoundationError";
    this.code = code;
  }
}

const SAFE_METADATA_RULES = Object.freeze({
  admin_support_note: Object.freeze({
    noteCreated: "literal_true",
  }),
  admin_system_problem: Object.freeze({
    hasPrivateNote: "boolean",
    state: "problem_state",
  }),
  domain_event: Object.freeze({
    changed: "boolean",
    fieldCount: "non_negative_integer",
  }),
  operational_run: Object.freeze({
    batchSize: "non_negative_integer",
    durationMs: "non_negative_integer",
  }),
} as const);

export type SafeFoundationMetadataProfile = keyof typeof SAFE_METADATA_RULES;
type SafeMetadataRule = "boolean" | "literal_true" | "non_negative_integer" | "problem_state";

export const SAFE_FOUNDATION_METADATA_KEYS = Object.freeze({
  admin_support_note: Object.freeze(["noteCreated"] as const),
  admin_system_problem: Object.freeze(["hasPrivateNote", "state"] as const),
  domain_event: Object.freeze(["changed", "fieldCount"] as const),
  operational_run: Object.freeze(["batchSize", "durationMs"] as const),
});

const METADATA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const MAX_SAFE_METADATA_ENTRIES = 16;
const MAX_SAFE_METADATA_STRING_LENGTH = 200;
const OPERATION_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function stop(code: EventFoundationErrorCode): never {
  throw new EventFoundationError(code);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) stop("UNSAFE_METADATA");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object") stop("UNSAFE_METADATA");

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    stop("UNSAFE_METADATA");
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function canonicalFoundationDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function safeMetadataRule(
  profile: SafeFoundationMetadataProfile,
  key: string,
): SafeMetadataRule | undefined {
  const rules = SAFE_METADATA_RULES[profile] as Readonly<Record<string, SafeMetadataRule>>;
  return rules[key];
}

function isSafeMetadataValue(rule: SafeMetadataRule, value: unknown): boolean {
  if (rule === "boolean") return typeof value === "boolean";
  if (rule === "literal_true") return value === true;
  if (rule === "non_negative_integer") {
    return Number.isSafeInteger(value) && (value as number) >= 0;
  }
  return (
    typeof value === "string" &&
    value.length <= MAX_SAFE_METADATA_STRING_LENGTH &&
    (value === "new" || value === "seen" || value === "resolved")
  );
}

export function safeFoundationMetadata(
  profile: SafeFoundationMetadataProfile,
  value: unknown,
): SafeFoundationMetadata {
  if (!Object.hasOwn(SAFE_METADATA_RULES, profile)) {
    return stop("UNSAFE_METADATA");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return stop("UNSAFE_METADATA");
  }

  const entries = Object.entries(value);
  const profileKeyCount = SAFE_FOUNDATION_METADATA_KEYS[profile].length;
  if (entries.length > MAX_SAFE_METADATA_ENTRIES || entries.length > profileKeyCount) {
    return stop("UNSAFE_METADATA");
  }

  const safe: Record<string, boolean | number | string | null> = {};
  for (const [key, item] of entries) {
    if (!METADATA_KEY_PATTERN.test(key)) {
      return stop("UNSAFE_METADATA");
    }
    const rule = safeMetadataRule(profile, key);
    if (!rule || !isSafeMetadataValue(rule, item)) {
      return stop("UNSAFE_METADATA");
    }
    safe[key] = item as boolean | number | string;
  }
  return Object.freeze(safe);
}

function verifyStoredIntent(
  boundEnvironment: FoundationEnvironment,
  intent: FoundationIntent,
  stored: FoundationIntent,
): void {
  if (stored.environment !== boundEnvironment || intent.environment !== boundEnvironment) {
    return stop("ENVIRONMENT_MISMATCH");
  }
  if (
    stored.operationKey !== intent.operationKey ||
    stored.operationDigest !== intent.operationDigest ||
    stored.intentType !== intent.intentType ||
    !OPERATION_DIGEST_PATTERN.test(stored.operationDigest)
  ) {
    return stop("IDEMPOTENCY_CONFLICT");
  }
}

/**
 * Completes one insert-on-conflict write without turning a conflicting retry
 * into success. The caller's insert must use a database uniqueness constraint
 * scoped by the bound environment; `find` reads through that same scope.
 */
export async function commitIdempotentFoundationWrite<T extends FoundationIntent>({
  boundEnvironment,
  find,
  insert,
  intent,
}: Readonly<{
  boundEnvironment: FoundationEnvironment;
  find: () => Promise<T | null>;
  insert: () => Promise<T | null>;
  intent: FoundationIntent;
}>): Promise<Readonly<{ record: T; replayed: boolean }>> {
  if (intent.environment !== boundEnvironment) {
    return stop("ENVIRONMENT_MISMATCH");
  }
  if (
    intent.operationKey.trim().length === 0 ||
    intent.intentType.trim().length === 0 ||
    !OPERATION_DIGEST_PATTERN.test(intent.operationDigest)
  ) {
    return stop("IDEMPOTENCY_CONFLICT");
  }

  const inserted = await insert();
  if (inserted) {
    verifyStoredIntent(boundEnvironment, intent, inserted);
    return { record: inserted, replayed: false };
  }

  const existing = await find();
  if (!existing) return stop("WRITE_NOT_DURABLE");
  verifyStoredIntent(boundEnvironment, intent, existing);
  return { record: existing, replayed: true };
}
