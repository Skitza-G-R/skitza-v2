import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SK102_ENVIRONMENT_FILE = join(".skitza", "sk102-browser.env");

const ALLOWED_NAMES = new Set([
  "SK102_E2E_MODE",
  "SK102_DISPOSABLE_CONFIRMATION",
  "SK102_SLOT",
  "SK102_PAYMENT_MODE",
  "NEXT_TELEMETRY_DISABLED",
  "SK102_BROWSER_ORIGIN",
  "SITE_URL",
  "DATABASE_URL",
  "SK102_DATABASE_OBSERVED_TARGET_FINGERPRINT",
  "SK102_DATABASE_APPROVED_TARGET_FINGERPRINT",
  "SK102_DATABASE_FORBIDDEN_TARGET_FINGERPRINTS",
  "SK102_DATABASE_APPROVED_ENDPOINT_FINGERPRINT",
  "SK102_DATABASE_FORBIDDEN_ENDPOINT_FINGERPRINTS",
  "SK102_DATABASE_APPROVED_CREDENTIAL_FINGERPRINT",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "SK102_CLERK_APPROVED_TARGET_FINGERPRINT",
  "SK102_CLERK_APPROVED_CREDENTIAL_FINGERPRINT",
  "SK102_CLERK_FORBIDDEN_TARGET_FINGERPRINTS",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_AUDIO",
  "R2_BUCKET_DOCS",
  "SK102_R2_ALLOWED_ORIGIN",
  "SK102_R2_APPROVED_TARGET_FINGERPRINT",
  "SK102_R2_APPROVED_CREDENTIAL_FINGERPRINT",
  "SK102_R2_FORBIDDEN_TARGET_FINGERPRINTS",
  "SK102_PROTECTED_SITE_HOSTS",
  "SK102_PROTECTED_R2_BUCKETS",
  "SK102_EMAIL_MODE",
  "SK102_EMAIL_ALLOWED_RECIPIENT_DOMAIN",
  "SK102_EMAIL_FROM",
  "SKITZA_E2E_PRODUCER_CLERK_USER_ID",
  "SKITZA_E2E_ARTIST_CLERK_USER_ID",
  "SKITZA_E2E_PRODUCER_EMAIL",
  "SKITZA_E2E_ARTIST_EMAIL",
]);

export function sk102EnvironmentFilePath(repositoryRoot: string): string {
  const root = resolve(repositoryRoot);
  const target = resolve(root, SK102_ENVIRONMENT_FILE);
  const child = relative(root, target);
  if (child !== SK102_ENVIRONMENT_FILE) {
    throw new Error("SK102_ENV_FILE_PATH_INVALID");
  }
  return target;
}

/**
 * Loads one fixed, ignored, mode-0600 file without printing values. The parser
 * deliberately accepts only literal NAME=value lines and the SK-102 allowlist;
 * it does not execute shell syntax, interpolate variables, or load ordinary
 * application provider settings.
 */
export function loadSk102EnvironmentFile(
  repositoryRoot: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const target = sk102EnvironmentFilePath(repositoryRoot);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("SK102_ENV_FILE_INVALID");
  }
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600) {
    throw new Error("SK102_ENV_FILE_INVALID");
  }
  const physicalRoot = realpathSync(resolve(repositoryRoot));
  const physicalTarget = realpathSync(target);
  const physicalChild = relative(physicalRoot, physicalTarget);
  if (physicalChild !== SK102_ENVIRONMENT_FILE || stats.size <= 0 || stats.size > 64 * 1024) {
    throw new Error("SK102_ENV_FILE_INVALID");
  }

  const parsed = new Map<string, string>();
  const source = readFileSync(physicalTarget, "utf8");
  for (const rawLine of source.split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(rawLine);
    if (!match) throw new Error("SK102_ENV_FILE_INVALID");
    const [, name, value] = match;
    if (
      !name ||
      value === undefined ||
      !value ||
      value !== value.trim() ||
      /^(?:["'])|(?:["'])$/u.test(value) ||
      !ALLOWED_NAMES.has(name) ||
      parsed.has(name)
    ) {
      throw new Error("SK102_ENV_FILE_INVALID");
    }
    parsed.set(name, value);
  }
  if (parsed.size === 0) throw new Error("SK102_ENV_FILE_INVALID");

  for (const [name, value] of parsed) {
    const existing = environment[name];
    if (existing !== undefined && existing !== value) {
      throw new Error("SK102_ENV_FILE_CONFLICT");
    }
  }
  for (const [name, value] of parsed) {
    environment[name] = value;
  }
  return true;
}
