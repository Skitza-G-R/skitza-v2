import { createHash } from "node:crypto";

export const SK102_BROWSER_ORIGIN = "http://127.0.0.1:3102" as const;
export const SK102_EMAIL_KINDS = [
  "booking-request",
  "booking-confirmed",
  "session-reminder-24h",
  "session-reminder-1h",
  "track-version-uploaded",
  "producer-comment-reply",
  "artist-comment",
  "booking-cancelled-or-rescheduled",
  "client-invite",
  "private-offer",
  "purchase-approved",
  "proof-verified",
  "proof-rejected",
  "payment-reminder",
  "purchase-declined",
] as const;

export type Sk102EmailKind = (typeof SK102_EMAIL_KINDS)[number];
export type Sk102Fingerprint = `sha256:${string}`;
export type Sk102Environment = Readonly<Record<string, string | undefined>>;

export type ApprovedSk102Runtime = Readonly<{
  __brand: "approved-sk102-runtime-v1";
  slot: string;
  siteUrl: string;
  browserOrigin: typeof SK102_BROWSER_ORIGIN;
  paymentMode: "off_app_test";
  databaseUrl: string;
  databaseName: string;
  databaseTargetFingerprint: Sk102Fingerprint;
  databaseEndpointFingerprint: Sk102Fingerprint;
  databaseCredentialFingerprint: Sk102Fingerprint;
  clerkPublishableKey: string;
  clerkSecretKey: string;
  clerkWebhookSecret: string;
  clerkTargetFingerprint: Sk102Fingerprint;
  clerkCredentialFingerprint: Sk102Fingerprint;
  r2Endpoint: string;
  r2Credentials: Readonly<{ accessKeyId: string; secretAccessKey: string }>;
  audioBucket: string;
  docsBucket: string;
  r2TargetFingerprint: Sk102Fingerprint;
  r2CredentialFingerprint: Sk102Fingerprint;
  emailMode: "r2_capture";
  emailAllowedRecipientDomain: string;
  emailFrom: string;
}>;

type ApprovedCommon = Pick<
  ApprovedSk102Runtime,
  "slot" | "siteUrl" | "browserOrigin" | "paymentMode"
>;

type ApprovedDatabase = Pick<
  ApprovedSk102Runtime,
  | "databaseUrl"
  | "databaseName"
  | "databaseTargetFingerprint"
  | "databaseEndpointFingerprint"
  | "databaseCredentialFingerprint"
>;

type ApprovedR2 = Pick<
  ApprovedSk102Runtime,
  | "r2Endpoint"
  | "r2Credentials"
  | "audioBucket"
  | "docsBucket"
  | "r2TargetFingerprint"
  | "r2CredentialFingerprint"
>;

type ApprovedClerk = Pick<
  ApprovedSk102Runtime,
  | "clerkPublishableKey"
  | "clerkSecretKey"
  | "clerkWebhookSecret"
  | "clerkTargetFingerprint"
  | "clerkCredentialFingerprint"
>;

type ApprovedEmail = Pick<
  ApprovedSk102Runtime,
  "emailMode" | "emailAllowedRecipientDomain" | "emailFrom"
>;

const MODE_NAME = "SK102_E2E_MODE";
const MODE_VALUE = "isolated_nonproduction";
const DISPOSABLE_CONFIRMATION = "isolated-disposable";
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_DATABASE_NAME = /(?:^|[_-])(?:sk102|e2e|test|testing|sandbox|isolated)(?:[_-]|$)/i;
const SAFE_BUCKET_NAME = /(?:^|[.-])(?:sk102|e2e|test|testing|sandbox|isolated)(?:[.-]|$)/i;
const DANGEROUS_TARGET_NAME = /(?:^|[._-])(?:prod|production|live)(?:[._-]|$)/i;
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SLOT_PATTERN = /^sk102-[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const LIVE_SITE_HOSTS = new Set(["skitza.app", "www.skitza.app"]);
const LIVE_BUCKET_NAMES = new Set(["skitza-audio", "skitza-docs"]);
const AMBIENT_DATABASE_NAMES = [
  "DATABASE_URL_TEST",
  "DATABASE_URL_NEON",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;
const AMBIENT_LIBPQ_NAMES = new Set([
  "PGAPPNAME",
  "PGCHANNELBINDING",
  "PGCONNECT_TIMEOUT",
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGOPTIONS",
  "PGPASSFILE",
  "PGPASSWORD",
  "PGPORT",
  "PGREQUIRESSL",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCERT",
  "PGSSLCRL",
  "PGSSLKEY",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGTARGETSESSIONATTRS",
  "PGUSER",
]);
const FORBIDDEN_EXTERNAL_SERVICE_NAMES = [
  "ACCESS_TOKEN",
  "CRON_SECRET",
  "MAKE_WAITLIST_WEBHOOK_URL",
  "MAGIC_LINK_SECRET",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
  "POSTHOG_API_KEY",
  "POSTHOG_HOST",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "SONG_PUBLIC_LINK_SECRET",
  "SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
] as const;
const ALLOWED_CLERK_ENVIRONMENT_NAMES = new Set([
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "SKITZA_E2E_PRODUCER_CLERK_USER_ID",
  "SKITZA_E2E_ARTIST_CLERK_USER_ID",
]);
const FORBIDDEN_NETWORK_ENVIRONMENT_NAMES = new Set([
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_USE_ENV_PROXY",
  "OPENSSL_CONF",
  "OPENSSL_MODULES",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "AWS_CA_BUNDLE",
  "NPM_CONFIG_PROXY",
  "NPM_CONFIG_HTTPS_PROXY",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "npm_config_proxy",
  "npm_config_https_proxy",
]);

function stop(code: string): never {
  throw new Error(code);
}

function value(environment: Sk102Environment, name: string): string | null {
  const candidate = environment[name]?.trim();
  return candidate ? candidate : null;
}

function required(environment: Sk102Environment, name: string, code: string): string {
  return value(environment, name) ?? stop(code);
}

function requireFingerprint(
  environment: Sk102Environment,
  name: string,
  code: string,
): Sk102Fingerprint {
  const candidate = required(environment, name, code);
  if (!FINGERPRINT_PATTERN.test(candidate)) stop(code);
  return candidate as Sk102Fingerprint;
}

function fingerprintList(
  environment: Sk102Environment,
  name: string,
  minimum: number,
  code: string,
): readonly Sk102Fingerprint[] {
  const entries = required(environment, name, code)
    .split(",")
    .map((entry) => entry.trim());
  if (
    entries.length < minimum ||
    new Set(entries).size !== entries.length ||
    entries.some((entry) => !FINGERPRINT_PATTERN.test(entry))
  ) {
    stop(code);
  }
  return entries as readonly Sk102Fingerprint[];
}

function configuredList(environment: Sk102Environment, name: string): readonly string[] {
  const raw = value(environment, name);
  if (!raw) return [];
  const entries = raw.split(",").map((entry) => entry.trim().toLowerCase());
  if (entries.some((entry) => !entry) || new Set(entries).size !== entries.length) {
    stop("SK102_PROTECTED_TARGET_LIST_INVALID");
  }
  return entries;
}

function equalFingerprint(left: string, right: string): boolean {
  return left.length === right.length && left === right;
}

export function sk102Fingerprint(valueToHash: string): Sk102Fingerprint {
  return `sha256:${createHash("sha256").update(valueToHash, "utf8").digest("hex")}`;
}

export function sk102DatabaseEndpointFingerprint(
  connectionString: string | undefined,
): Sk102Fingerprint | null {
  if (!connectionString) return null;
  try {
    const url = new URL(connectionString);
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      !url.pathname ||
      url.pathname === "/" ||
      url.hash ||
      !databaseUrlOptionsAreSafe(url)
    ) {
      return null;
    }
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (!databaseName || databaseName.includes("/")) return null;
    return sk102Fingerprint(
      JSON.stringify([
        "sk102-database-endpoint-v1",
        url.hostname.toLowerCase(),
        url.port || "5432",
        databaseName,
      ]),
    );
  } catch {
    return null;
  }
}

export function sk102DatabaseCredentialFingerprint(
  connectionString: string | undefined,
): Sk102Fingerprint | null {
  if (!connectionString) return null;
  try {
    const url = new URL(connectionString);
    if (!url.username || !url.password || !databaseUrlOptionsAreSafe(url)) return null;
    return sk102Fingerprint(
      JSON.stringify([
        "sk102-database-credential-v1",
        decodeURIComponent(url.username),
        decodeURIComponent(url.password),
      ]),
    );
  } catch {
    return null;
  }
}

function databaseUrlOptionsAreSafe(url: URL): boolean {
  const entries = [...url.searchParams.entries()];
  if (entries.some(([name]) => name !== "sslmode" && name !== "channel_binding")) return false;
  const sslModes = url.searchParams.getAll("sslmode");
  if (
    sslModes.length !== 1 ||
    (sslModes[0]?.toLowerCase() !== "require" && sslModes[0]?.toLowerCase() !== "verify-full")
  ) {
    return false;
  }
  const channelBindings = url.searchParams.getAll("channel_binding");
  return (
    channelBindings.length <= 1 &&
    (channelBindings.length === 0 || channelBindings[0]?.toLowerCase() === "require")
  );
}

export function sk102R2TargetFingerprint(input: {
  accountId: string;
  audioBucket: string;
  docsBucket: string;
}): Sk102Fingerprint {
  return sk102Fingerprint(
    JSON.stringify([
      "sk102-r2-target-v1",
      input.accountId.toLowerCase(),
      input.audioBucket.toLowerCase(),
      input.docsBucket.toLowerCase(),
    ]),
  );
}

export function sk102R2CredentialFingerprint(input: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Sk102Fingerprint {
  return sk102Fingerprint(
    JSON.stringify([
      "sk102-r2-credential-v1",
      input.accountId.toLowerCase(),
      input.accessKeyId,
      input.secretAccessKey,
    ]),
  );
}

export function sk102ClerkTargetFingerprint(
  publishableKey: string | undefined,
): Sk102Fingerprint | null {
  const normalized = publishableKey?.trim();
  if (!normalized || !normalized.startsWith("pk_test_") || normalized.length < 24) return null;
  return sk102Fingerprint(JSON.stringify(["sk102-clerk-target-v1", normalized]));
}

export function sk102ClerkCredentialFingerprint(input: {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}): Sk102Fingerprint {
  return sk102Fingerprint(
    JSON.stringify([
      "sk102-clerk-credential-bundle-v1",
      input.publishableKey.trim(),
      input.secretKey.trim(),
      input.webhookSecret.trim(),
    ]),
  );
}

export function sk102ModeRequested(environment: Sk102Environment = process.env): boolean {
  return value(environment, MODE_NAME) !== null;
}

function approvedCommon(environment: Sk102Environment): ApprovedCommon | null {
  const mode = value(environment, MODE_NAME);
  if (mode === null) {
    if (
      Object.entries(environment).some(
        ([name, candidate]) => name.startsWith("SK102_") && Boolean(candidate?.trim()),
      )
    ) {
      stop("SK102_MODE_REQUIRED");
    }
    return null;
  }
  if (mode !== MODE_VALUE) stop("SK102_MODE_INVALID");
  if (
    required(environment, "SK102_DISPOSABLE_CONFIRMATION", "SK102_CONFIRMATION_INVALID") !==
    DISPOSABLE_CONFIRMATION
  ) {
    stop("SK102_CONFIRMATION_INVALID");
  }
  if (environment.VERCEL_ENV?.trim() === "production") {
    stop("SK102_PRODUCTION_DEPLOYMENT_FORBIDDEN");
  }
  if (required(environment, "NEXT_TELEMETRY_DISABLED", "SK102_TELEMETRY_INVALID") !== "1") {
    stop("SK102_TELEMETRY_INVALID");
  }
  if (
    Object.entries(environment).some(
      ([name, candidate]) =>
        FORBIDDEN_NETWORK_ENVIRONMENT_NAMES.has(name) && Boolean(candidate?.trim()),
    )
  ) {
    stop("SK102_NETWORK_ENV_FORBIDDEN");
  }

  const slot = required(environment, "SK102_SLOT", "SK102_SLOT_INVALID");
  if (!SLOT_PATTERN.test(slot)) stop("SK102_SLOT_INVALID");
  if (
    required(environment, "SK102_PAYMENT_MODE", "SK102_PAYMENT_MODE_INVALID") !== "off_app_test"
  ) {
    stop("SK102_PAYMENT_MODE_INVALID");
  }
  if (
    Object.entries(environment).some(
      ([name, candidate]) =>
        Boolean(candidate?.trim()) && /(?:^|_)(?:STRIPE|TRANZILA|PAYPAL|ADYEN)(?:_|$)/.test(name),
    )
  ) {
    stop("SK102_PAYMENT_PROVIDER_ENV_FORBIDDEN");
  }
  if (FORBIDDEN_EXTERNAL_SERVICE_NAMES.some((name) => Boolean(value(environment, name)))) {
    stop("SK102_EXTERNAL_SERVICE_ENV_FORBIDDEN");
  }

  const browserOrigin = required(
    environment,
    "SK102_BROWSER_ORIGIN",
    "SK102_BROWSER_ORIGIN_INVALID",
  );
  if (browserOrigin !== SK102_BROWSER_ORIGIN) stop("SK102_BROWSER_ORIGIN_INVALID");

  const siteUrl = required(environment, "SITE_URL", "SK102_SITE_URL_INVALID");
  try {
    const parsed = new URL(siteUrl);
    const protectedHosts = new Set([
      ...LIVE_SITE_HOSTS,
      ...configuredList(environment, "SK102_PROTECTED_SITE_HOSTS"),
    ]);
    if (
      parsed.origin !== browserOrigin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      protectedHosts.has(parsed.hostname.toLowerCase()) ||
      parsed.hostname.toLowerCase().endsWith(".skitza.app")
    ) {
      stop("SK102_SITE_URL_INVALID");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "SK102_SITE_URL_INVALID") throw error;
    stop("SK102_SITE_URL_INVALID");
  }

  return {
    slot,
    siteUrl,
    browserOrigin: SK102_BROWSER_ORIGIN,
    paymentMode: "off_app_test",
  };
}

function parseDatabaseName(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    return databaseName && !databaseName.includes("/") ? databaseName : null;
  } catch {
    return null;
  }
}

function databaseUsesRequiredTls(connectionString: string): boolean {
  try {
    return databaseUrlOptionsAreSafe(new URL(connectionString));
  } catch {
    return false;
  }
}

function approvedDatabase(
  environment: Sk102Environment,
  connectionString = environment.DATABASE_URL,
): ApprovedDatabase | null {
  const common = approvedCommon(environment);
  if (common === null) return null;
  if (
    AMBIENT_DATABASE_NAMES.some((name) => Boolean(value(environment, name))) ||
    Object.entries(environment).some(
      ([name, candidate]) => AMBIENT_LIBPQ_NAMES.has(name) && Boolean(candidate?.trim()),
    )
  ) {
    stop("SK102_DATABASE_AMBIENT_ENV_FORBIDDEN");
  }

  const databaseUrl = connectionString?.trim() || stop("SK102_DATABASE_URL_INVALID");
  if (sk102DatabaseEndpointFingerprint(databaseUrl) === null) stop("SK102_DATABASE_URL_INVALID");
  const databaseName = parseDatabaseName(databaseUrl) ?? stop("SK102_DATABASE_URL_INVALID");
  if (!databaseUsesRequiredTls(databaseUrl)) stop("SK102_DATABASE_TLS_REQUIRED");
  if (!SAFE_DATABASE_NAME.test(databaseName) || DANGEROUS_TARGET_NAME.test(databaseName)) {
    stop("SK102_DATABASE_NAME_UNSAFE");
  }

  const endpointFingerprint =
    sk102DatabaseEndpointFingerprint(databaseUrl) ?? stop("SK102_DATABASE_URL_INVALID");
  const databaseCredentialFingerprint =
    sk102DatabaseCredentialFingerprint(databaseUrl) ?? stop("SK102_DATABASE_URL_INVALID");
  const approvedEndpoint = requireFingerprint(
    environment,
    "SK102_DATABASE_APPROVED_ENDPOINT_FINGERPRINT",
    "SK102_DATABASE_ENDPOINT_FINGERPRINT_INVALID",
  );
  const forbiddenEndpoints = fingerprintList(
    environment,
    "SK102_DATABASE_FORBIDDEN_ENDPOINT_FINGERPRINTS",
    2,
    "SK102_DATABASE_ENDPOINT_FINGERPRINT_INVALID",
  );
  if (
    !equalFingerprint(endpointFingerprint, approvedEndpoint) ||
    forbiddenEndpoints.some((entry) => equalFingerprint(entry, endpointFingerprint))
  ) {
    stop("SK102_DATABASE_ENDPOINT_FORBIDDEN");
  }

  const observedTarget = requireFingerprint(
    environment,
    "SK102_DATABASE_OBSERVED_TARGET_FINGERPRINT",
    "SK102_DATABASE_TARGET_FINGERPRINT_INVALID",
  );
  const approvedTarget = requireFingerprint(
    environment,
    "SK102_DATABASE_APPROVED_TARGET_FINGERPRINT",
    "SK102_DATABASE_TARGET_FINGERPRINT_INVALID",
  );
  const forbiddenTargets = fingerprintList(
    environment,
    "SK102_DATABASE_FORBIDDEN_TARGET_FINGERPRINTS",
    2,
    "SK102_DATABASE_TARGET_FINGERPRINT_INVALID",
  );
  if (
    !equalFingerprint(observedTarget, approvedTarget) ||
    forbiddenTargets.some((entry) => equalFingerprint(entry, observedTarget))
  ) {
    stop("SK102_DATABASE_TARGET_FORBIDDEN");
  }
  const approvedCredentials = requireFingerprint(
    environment,
    "SK102_DATABASE_APPROVED_CREDENTIAL_FINGERPRINT",
    "SK102_DATABASE_CREDENTIAL_FINGERPRINT_INVALID",
  );
  if (!equalFingerprint(databaseCredentialFingerprint, approvedCredentials)) {
    stop("SK102_DATABASE_CREDENTIAL_FORBIDDEN");
  }

  return {
    databaseUrl,
    databaseName,
    databaseTargetFingerprint: observedTarget,
    databaseEndpointFingerprint: endpointFingerprint,
    databaseCredentialFingerprint,
  };
}

function approvedR2(environment: Sk102Environment): ApprovedR2 | null {
  const common = approvedCommon(environment);
  if (common === null) return null;
  for (const legacy of ["R2_BUCKET", "R2_PUBLIC_BASE", "R2_PUBLIC_HOST"] as const) {
    if (value(environment, legacy)) stop("SK102_R2_AMBIENT_ENV_FORBIDDEN");
  }

  const accountId = required(environment, "R2_ACCOUNT_ID", "SK102_R2_CONFIG_INVALID");
  const accessKeyId = required(environment, "R2_ACCESS_KEY_ID", "SK102_R2_CONFIG_INVALID");
  const secretAccessKey = required(environment, "R2_SECRET_ACCESS_KEY", "SK102_R2_CONFIG_INVALID");
  const audioBucket = required(environment, "R2_BUCKET_AUDIO", "SK102_R2_BUCKET_INVALID");
  const docsBucket = required(environment, "R2_BUCKET_DOCS", "SK102_R2_BUCKET_INVALID");
  const protectedBuckets = new Set([
    ...LIVE_BUCKET_NAMES,
    ...configuredList(environment, "SK102_PROTECTED_R2_BUCKETS"),
  ]);
  if (
    !/^[a-f0-9]{32}$/i.test(accountId) ||
    accessKeyId.length < 16 ||
    secretAccessKey.length < 32 ||
    audioBucket === docsBucket ||
    [audioBucket, docsBucket].some(
      (bucket) =>
        !BUCKET_NAME_PATTERN.test(bucket) ||
        !SAFE_BUCKET_NAME.test(bucket) ||
        DANGEROUS_TARGET_NAME.test(bucket) ||
        protectedBuckets.has(bucket.toLowerCase()),
    )
  ) {
    stop("SK102_R2_BUCKET_INVALID");
  }
  if (
    required(environment, "SK102_R2_ALLOWED_ORIGIN", "SK102_R2_ORIGIN_INVALID") !==
    common.browserOrigin
  ) {
    stop("SK102_R2_ORIGIN_INVALID");
  }

  const targetFingerprint = sk102R2TargetFingerprint({ accountId, audioBucket, docsBucket });
  const credentialFingerprint = sk102R2CredentialFingerprint({
    accountId,
    accessKeyId,
    secretAccessKey,
  });
  const approvedTarget = requireFingerprint(
    environment,
    "SK102_R2_APPROVED_TARGET_FINGERPRINT",
    "SK102_R2_TARGET_FINGERPRINT_INVALID",
  );
  const forbiddenTargets = fingerprintList(
    environment,
    "SK102_R2_FORBIDDEN_TARGET_FINGERPRINTS",
    1,
    "SK102_R2_TARGET_FINGERPRINT_INVALID",
  );
  if (
    !equalFingerprint(targetFingerprint, approvedTarget) ||
    forbiddenTargets.some((entry) => equalFingerprint(entry, targetFingerprint))
  ) {
    stop("SK102_R2_TARGET_FORBIDDEN");
  }
  const approvedCredentials = requireFingerprint(
    environment,
    "SK102_R2_APPROVED_CREDENTIAL_FINGERPRINT",
    "SK102_R2_CREDENTIAL_FINGERPRINT_INVALID",
  );
  if (!equalFingerprint(credentialFingerprint, approvedCredentials)) {
    stop("SK102_R2_CREDENTIAL_FORBIDDEN");
  }

  return {
    r2Endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    r2Credentials: { accessKeyId, secretAccessKey },
    audioBucket,
    docsBucket,
    r2TargetFingerprint: targetFingerprint,
    r2CredentialFingerprint: credentialFingerprint,
  };
}

function approvedClerk(environment: Sk102Environment): ApprovedClerk | null {
  const common = approvedCommon(environment);
  if (common === null) return null;
  if (
    Object.entries(environment).some(
      ([name, candidate]) =>
        Boolean(candidate?.trim()) &&
        /(?:^|_)CLERK(?:_|$)/u.test(name) &&
        !ALLOWED_CLERK_ENVIRONMENT_NAMES.has(name) &&
        !name.startsWith("SK102_CLERK_"),
    )
  ) {
    stop("SK102_CLERK_AMBIENT_ENV_FORBIDDEN");
  }
  const clerkPublishableKey = required(
    environment,
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "SK102_CLERK_CONFIG_INVALID",
  );
  const alternatePublishableKey = value(environment, "CLERK_PUBLISHABLE_KEY");
  const clerkSecretKey = required(environment, "CLERK_SECRET_KEY", "SK102_CLERK_CONFIG_INVALID");
  const clerkWebhookSecret = required(
    environment,
    "CLERK_WEBHOOK_SECRET",
    "SK102_CLERK_CONFIG_INVALID",
  );
  if (
    !clerkPublishableKey.startsWith("pk_test_") ||
    clerkPublishableKey.length < 24 ||
    (alternatePublishableKey !== null && alternatePublishableKey !== clerkPublishableKey) ||
    !clerkSecretKey.startsWith("sk_test_") ||
    clerkSecretKey.length < 24 ||
    !clerkWebhookSecret.startsWith("whsec_") ||
    clerkWebhookSecret.length < 24
  ) {
    stop("SK102_CLERK_CONFIG_INVALID");
  }
  const clerkTargetFingerprint =
    sk102ClerkTargetFingerprint(clerkPublishableKey) ?? stop("SK102_CLERK_CONFIG_INVALID");
  const clerkCredentialFingerprint = sk102ClerkCredentialFingerprint({
    publishableKey: clerkPublishableKey,
    secretKey: clerkSecretKey,
    webhookSecret: clerkWebhookSecret,
  });
  const approvedTarget = requireFingerprint(
    environment,
    "SK102_CLERK_APPROVED_TARGET_FINGERPRINT",
    "SK102_CLERK_TARGET_FINGERPRINT_INVALID",
  );
  const approvedCredentials = requireFingerprint(
    environment,
    "SK102_CLERK_APPROVED_CREDENTIAL_FINGERPRINT",
    "SK102_CLERK_CREDENTIAL_FINGERPRINT_INVALID",
  );
  const forbiddenTargets = fingerprintList(
    environment,
    "SK102_CLERK_FORBIDDEN_TARGET_FINGERPRINTS",
    1,
    "SK102_CLERK_TARGET_FINGERPRINT_INVALID",
  );
  if (
    !equalFingerprint(clerkTargetFingerprint, approvedTarget) ||
    forbiddenTargets.some((entry) => equalFingerprint(entry, clerkTargetFingerprint)) ||
    !equalFingerprint(clerkCredentialFingerprint, approvedCredentials)
  ) {
    stop("SK102_CLERK_TARGET_FORBIDDEN");
  }
  return {
    clerkPublishableKey,
    clerkSecretKey,
    clerkWebhookSecret,
    clerkTargetFingerprint,
    clerkCredentialFingerprint,
  };
}

function approvedEmail(environment: Sk102Environment): ApprovedEmail | null {
  const common = approvedCommon(environment);
  if (common === null) return null;
  if (required(environment, "SK102_EMAIL_MODE", "SK102_EMAIL_MODE_INVALID") !== "r2_capture") {
    stop("SK102_EMAIL_MODE_INVALID");
  }
  const emailAllowedRecipientDomain = required(
    environment,
    "SK102_EMAIL_ALLOWED_RECIPIENT_DOMAIN",
    "SK102_EMAIL_RECIPIENT_DOMAIN_INVALID",
  ).toLowerCase();
  if (emailAllowedRecipientDomain !== "example.com") {
    stop("SK102_EMAIL_RECIPIENT_DOMAIN_INVALID");
  }
  const emailFrom = required(environment, "SK102_EMAIL_FROM", "SK102_EMAIL_FROM_INVALID");
  if (emailFrom !== "Skitza SK-102 <no-reply@sk102.invalid>") {
    stop("SK102_EMAIL_FROM_INVALID");
  }
  return {
    emailMode: "r2_capture",
    emailAllowedRecipientDomain,
    emailFrom,
  };
}

export function assertSk102DatabaseTarget(
  connectionString: string,
  environment: Sk102Environment = process.env,
): ApprovedDatabase | null {
  return approvedDatabase(environment, connectionString);
}

export function assertSk102R2Target(
  environment: Sk102Environment = process.env,
): ApprovedR2 | null {
  return approvedR2(environment);
}

export function assertSk102ClerkTarget(
  environment: Sk102Environment = process.env,
): ApprovedClerk | null {
  return approvedClerk(environment);
}

export function assertSk102EmailRecipients(
  recipients: string | readonly string[],
  environment: Sk102Environment = process.env,
): ApprovedEmail | null {
  const email = approvedEmail(environment);
  if (email === null) return null;
  const list = typeof recipients === "string" ? [recipients] : [...recipients];
  const suffix = `@${email.emailAllowedRecipientDomain}`;
  if (
    list.length === 0 ||
    list.some((recipient) => {
      const normalized = recipient.trim().toLowerCase();
      const at = normalized.lastIndexOf("@");
      const local = at > 0 ? normalized.slice(0, at) : "";
      return !normalized.endsWith(suffix) || !/[+]clerk_test(?:[_-][a-z0-9_-]+)?$/.test(local);
    })
  ) {
    stop("SK102_EMAIL_RECIPIENT_FORBIDDEN");
  }
  return email;
}

export function approvedSk102Runtime(
  environment: Sk102Environment = process.env,
): ApprovedSk102Runtime | null {
  const common = approvedCommon(environment);
  if (common === null) return null;
  const database = approvedDatabase(environment);
  const clerk = approvedClerk(environment);
  const r2 = approvedR2(environment);
  const email = approvedEmail(environment);
  if (!database || !clerk || !r2 || !email) stop("SK102_RUNTIME_APPROVAL_INVALID");
  return Object.freeze({
    __brand: "approved-sk102-runtime-v1" as const,
    ...common,
    ...database,
    ...clerk,
    ...r2,
    ...email,
  });
}

export function isSk102EmailKind(valueToCheck: string): valueToCheck is Sk102EmailKind {
  return (SK102_EMAIL_KINDS as readonly string[]).includes(valueToCheck);
}
