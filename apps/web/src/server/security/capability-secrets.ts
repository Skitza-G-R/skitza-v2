/**
 * Application-owned signing secrets for private, server-issued capabilities.
 *
 * Production always requires `SKITZA_CAPABILITY_SECRET` and never falls back
 * to a Clerk credential. For the zero-break first cutover, install the exact
 * current Clerk key under the new variable before deploying this code, and
 * then leave the app-owned value unchanged when Clerk changes. A Clerk fallback
 * remains available only in local development and tests for compatibility.
 */
export type CapabilityVerificationSecrets = string | readonly string[];

export type CapabilitySecretRing = Readonly<{
  active: string;
  verification: readonly string[];
}>;

const MINIMUM_DEDICATED_SECRET_LENGTH = 32;
const MINIMUM_LEGACY_SECRET_LENGTH = 20;
const MAXIMUM_LEGACY_SECRETS = 8;

function validSecret(value: unknown, minimumLength: number): value is string {
  return typeof value === "string" && value.length >= minimumLength && value.trim() === value;
}

function legacySecrets(raw: string | undefined): readonly string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("SKITZA_CAPABILITY_LEGACY_SECRETS must be a JSON string array");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("SKITZA_CAPABILITY_LEGACY_SECRETS must be a JSON string array");
  }
  const candidates = parsed as unknown[];
  if (
    candidates.length > MAXIMUM_LEGACY_SECRETS ||
    candidates.some((secret) => !validSecret(secret, MINIMUM_LEGACY_SECRET_LENGTH))
  ) {
    throw new Error(
      "SKITZA_CAPABILITY_LEGACY_SECRETS must contain at most 8 secrets of at least 20 characters",
    );
  }
  return candidates as string[];
}

export function configuredCapabilitySecrets(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CapabilitySecretRing {
  const dedicated = env.SKITZA_CAPABILITY_SECRET;
  if (dedicated === undefined) {
    if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
      throw new Error("Missing SKITZA_CAPABILITY_SECRET");
    }
    const clerkFallback = env.CLERK_SECRET_KEY;
    if (!clerkFallback) {
      throw new Error("Missing SKITZA_CAPABILITY_SECRET");
    }
    // Preserve local and test setup compatibility without weakening a deployed
    // environment. Do not parse the rotation list until the dedicated rollout.
    return Object.freeze({
      active: clerkFallback,
      verification: Object.freeze([clerkFallback]),
    });
  }
  if (!validSecret(dedicated, MINIMUM_DEDICATED_SECRET_LENGTH)) {
    throw new Error(
      "SKITZA_CAPABILITY_SECRET must be at least 32 characters without surrounding whitespace",
    );
  }

  const verification = [dedicated, ...legacySecrets(env.SKITZA_CAPABILITY_LEGACY_SECRETS)].filter(
    (secret, index, all) => all.indexOf(secret) === index,
  );
  return Object.freeze({
    active: dedicated,
    verification: Object.freeze(verification),
  });
}

/**
 * Resolve which key verified an existing capability. The callback must be a
 * pure verification step; callers then use the returned key for any object-key
 * derivation or storage operation tied to that capability.
 */
export function resolveCapabilitySecret<Value>(
  secrets: CapabilityVerificationSecrets,
  verify: (secret: string) => Value,
): Readonly<{ secret: string; value: Value }> {
  const candidates = typeof secrets === "string" ? [secrets] : secrets;
  let firstError: unknown;
  for (const secret of candidates) {
    try {
      return Object.freeze({ secret, value: verify(secret) });
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError instanceof Error) throw firstError;
  throw new Error("No application capability verification secrets are configured");
}
