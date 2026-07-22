import { describe, expect, it } from "vitest";
import { Client } from "@neondatabase/serverless";

import {
  approvedSk102Runtime,
  assertSk102ClerkTarget,
  assertSk102DatabaseTarget,
  assertSk102EmailRecipients,
  assertSk102R2Target,
  SK102_BROWSER_ORIGIN,
  sk102ClerkCredentialFingerprint,
  sk102ClerkTargetFingerprint,
  sk102DatabaseCredentialFingerprint,
  sk102DatabaseEndpointFingerprint,
  sk102Fingerprint,
  sk102R2CredentialFingerprint,
  sk102R2TargetFingerprint,
  type Sk102Environment,
} from "../sk102-runtime";

const DATABASE_URL =
  "postgresql://isolated-user:isolated-password@sk102-db.example.invalid/sk102_e2e?sslmode=require";
const ACCOUNT_ID = "a".repeat(32);
const AUDIO_BUCKET = "skitza-sk102-browser-audio";
const DOCS_BUCKET = "skitza-sk102-browser-docs";
const CLERK_PUBLISHABLE_KEY = `pk_test_${"a".repeat(32)}`;
const CLERK_SECRET_KEY = `sk_test_${"b".repeat(32)}`;
const CLERK_WEBHOOK_SECRET = `whsec_${"c".repeat(32)}`;
const APPROVED_DATABASE_TARGET = sk102Fingerprint("approved isolated project and branch");
const FORBIDDEN_DATABASE_TARGET_A = sk102Fingerprint("protected database target a");
const FORBIDDEN_DATABASE_TARGET_B = sk102Fingerprint("protected database target b");
const APPROVED_DATABASE_ENDPOINT = (() => {
  const fingerprint = sk102DatabaseEndpointFingerprint(DATABASE_URL);
  if (!fingerprint) throw new Error("Synthetic SK-102 database URL is invalid");
  return fingerprint;
})();
const APPROVED_DATABASE_CREDENTIALS = (() => {
  const fingerprint = sk102DatabaseCredentialFingerprint(DATABASE_URL);
  if (!fingerprint) throw new Error("Synthetic SK-102 database credentials are invalid");
  return fingerprint;
})();
const FORBIDDEN_DATABASE_ENDPOINT_A = sk102Fingerprint("protected database endpoint a");
const FORBIDDEN_DATABASE_ENDPOINT_B = sk102Fingerprint("protected database endpoint b");
const APPROVED_R2_TARGET = sk102R2TargetFingerprint({
  accountId: ACCOUNT_ID,
  audioBucket: AUDIO_BUCKET,
  docsBucket: DOCS_BUCKET,
});
const FORBIDDEN_R2_TARGET = sk102R2TargetFingerprint({
  accountId: ACCOUNT_ID,
  audioBucket: "skitza-audio",
  docsBucket: "skitza-docs",
});
const APPROVED_R2_CREDENTIALS = sk102R2CredentialFingerprint({
  accountId: ACCOUNT_ID,
  accessKeyId: "A".repeat(20),
  secretAccessKey: "s".repeat(40),
});
const APPROVED_CLERK_TARGET = (() => {
  const fingerprint = sk102ClerkTargetFingerprint(CLERK_PUBLISHABLE_KEY);
  if (!fingerprint) throw new Error("Synthetic SK-102 Clerk key is invalid");
  return fingerprint;
})();
const APPROVED_CLERK_CREDENTIALS = sk102ClerkCredentialFingerprint({
  publishableKey: CLERK_PUBLISHABLE_KEY,
  secretKey: CLERK_SECRET_KEY,
  webhookSecret: CLERK_WEBHOOK_SECRET,
});
const FORBIDDEN_CLERK_TARGET = sk102Fingerprint("existing Clerk development instance");

function safeEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    SK102_E2E_MODE: "isolated_nonproduction",
    SK102_DISPOSABLE_CONFIRMATION: "isolated-disposable",
    SK102_SLOT: "sk102-browser",
    SK102_PAYMENT_MODE: "off_app_test",
    NEXT_TELEMETRY_DISABLED: "1",
    SK102_BROWSER_ORIGIN,
    SITE_URL: SK102_BROWSER_ORIGIN,
    DATABASE_URL,
    SK102_DATABASE_OBSERVED_TARGET_FINGERPRINT: APPROVED_DATABASE_TARGET,
    SK102_DATABASE_APPROVED_TARGET_FINGERPRINT: APPROVED_DATABASE_TARGET,
    SK102_DATABASE_FORBIDDEN_TARGET_FINGERPRINTS: [
      FORBIDDEN_DATABASE_TARGET_A,
      FORBIDDEN_DATABASE_TARGET_B,
    ].join(","),
    SK102_DATABASE_APPROVED_ENDPOINT_FINGERPRINT: APPROVED_DATABASE_ENDPOINT,
    SK102_DATABASE_APPROVED_CREDENTIAL_FINGERPRINT: APPROVED_DATABASE_CREDENTIALS,
    SK102_DATABASE_FORBIDDEN_ENDPOINT_FINGERPRINTS: [
      FORBIDDEN_DATABASE_ENDPOINT_A,
      FORBIDDEN_DATABASE_ENDPOINT_B,
    ].join(","),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY,
    CLERK_WEBHOOK_SECRET,
    SK102_CLERK_APPROVED_TARGET_FINGERPRINT: APPROVED_CLERK_TARGET,
    SK102_CLERK_APPROVED_CREDENTIAL_FINGERPRINT: APPROVED_CLERK_CREDENTIALS,
    SK102_CLERK_FORBIDDEN_TARGET_FINGERPRINTS: FORBIDDEN_CLERK_TARGET,
    R2_ACCOUNT_ID: ACCOUNT_ID,
    R2_ACCESS_KEY_ID: "A".repeat(20),
    R2_SECRET_ACCESS_KEY: "s".repeat(40),
    R2_BUCKET_AUDIO: AUDIO_BUCKET,
    R2_BUCKET_DOCS: DOCS_BUCKET,
    SK102_R2_ALLOWED_ORIGIN: SK102_BROWSER_ORIGIN,
    SK102_R2_APPROVED_TARGET_FINGERPRINT: APPROVED_R2_TARGET,
    SK102_R2_APPROVED_CREDENTIAL_FINGERPRINT: APPROVED_R2_CREDENTIALS,
    SK102_R2_FORBIDDEN_TARGET_FINGERPRINTS: FORBIDDEN_R2_TARGET,
    SK102_PROTECTED_R2_BUCKETS: [
      "skitza-audio",
      "skitza-docs",
      "skitza-sk90-rehearsal-audio",
      "skitza-sk90-rehearsal-docs",
    ].join(","),
    SK102_EMAIL_MODE: "r2_capture",
    SK102_EMAIL_ALLOWED_RECIPIENT_DOMAIN: "example.com",
    SK102_EMAIL_FROM: "Skitza SK-102 <no-reply@sk102.invalid>",
    ...overrides,
  };
}

describe("SK-102 isolated runtime guard", () => {
  it("leaves normal production/runtime behavior unchanged when no SK102 variables exist", () => {
    expect(approvedSk102Runtime({})).toBeNull();
    expect(assertSk102DatabaseTarget(DATABASE_URL, {})).toBeNull();
    expect(assertSk102R2Target({})).toBeNull();
    expect(assertSk102EmailRecipients("customer@example.com", {})).toBeNull();
  });

  it("approves one fully bound local isolated runtime without exposing target values", () => {
    const approved = approvedSk102Runtime(safeEnvironment());
    expect(approved).toMatchObject({
      __brand: "approved-sk102-runtime-v1",
      slot: "sk102-browser",
      browserOrigin: SK102_BROWSER_ORIGIN,
      paymentMode: "off_app_test",
      databaseName: "sk102_e2e",
      audioBucket: AUDIO_BUCKET,
      docsBucket: DOCS_BUCKET,
      emailMode: "r2_capture",
    });
    expect(approved?.databaseEndpointFingerprint).toBe(APPROVED_DATABASE_ENDPOINT);
    expect(approved?.databaseCredentialFingerprint).toBe(APPROVED_DATABASE_CREDENTIALS);
    expect(approved?.clerkTargetFingerprint).toBe(APPROVED_CLERK_TARGET);
    expect(approved?.clerkCredentialFingerprint).toBe(APPROVED_CLERK_CREDENTIALS);
    expect(approved?.r2TargetFingerprint).toBe(APPROVED_R2_TARGET);
    expect(approved?.r2CredentialFingerprint).toBe(APPROVED_R2_CREDENTIALS);
  });

  it("rejects partial mode, production deployment, a protected site, and non-off-app payment", () => {
    expect(() => approvedSk102Runtime({ SK102_SLOT: "sk102-browser" })).toThrow(
      "SK102_MODE_REQUIRED",
    );
    expect(() => approvedSk102Runtime(safeEnvironment({ VERCEL_ENV: "production" }))).toThrow(
      "SK102_PRODUCTION_DEPLOYMENT_FORBIDDEN",
    );
    expect(() =>
      approvedSk102Runtime(
        safeEnvironment({
          SITE_URL: "https://skitza.app",
          SK102_BROWSER_ORIGIN: "https://skitza.app",
        }),
      ),
    ).toThrow("SK102_BROWSER_ORIGIN_INVALID");
    expect(() =>
      approvedSk102Runtime(safeEnvironment({ SK102_PAYMENT_MODE: "stripe_test" })),
    ).toThrow("SK102_PAYMENT_MODE_INVALID");
    expect(() => approvedSk102Runtime(safeEnvironment({ STRIPE_SECRET_KEY: "present" }))).toThrow(
      "SK102_PAYMENT_PROVIDER_ENV_FORBIDDEN",
    );
  });

  it("rejects telemetry, delivery providers, and ambiguous ambient database selectors", () => {
    for (const name of [
      "ACCESS_TOKEN",
      "CRON_SECRET",
      "MAGIC_LINK_SECRET",
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_SENTRY_DSN",
      "SENTRY_DSN",
      "RESEND_API_KEY",
      "SONG_PUBLIC_LINK_SECRET",
    ]) {
      expect(() => approvedSk102Runtime(safeEnvironment({ [name]: "present" })), name).toThrow(
        "SK102_EXTERNAL_SERVICE_ENV_FORBIDDEN",
      );
    }
    expect(() =>
      assertSk102DatabaseTarget(DATABASE_URL, safeEnvironment({ DATABASE_URL_TEST: "present" })),
    ).toThrow("SK102_DATABASE_AMBIENT_ENV_FORBIDDEN");
    expect(() => approvedSk102Runtime(safeEnvironment({ NEXT_TELEMETRY_DISABLED: "0" }))).toThrow(
      "SK102_TELEMETRY_INVALID",
    );
    expect(() =>
      approvedSk102Runtime(safeEnvironment({ NEXT_TELEMETRY_DISABLED: undefined })),
    ).toThrow("SK102_TELEMETRY_INVALID");
  });

  it("rejects ambient TLS, CA, Node-loader, and proxy routing overrides", () => {
    for (const name of [
      "NODE_TLS_REJECT_UNAUTHORIZED",
      "NODE_EXTRA_CA_CERTS",
      "NODE_USE_ENV_PROXY",
      "NODE_OPTIONS",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "OPENSSL_CONF",
      "OPENSSL_MODULES",
      "AWS_CA_BUNDLE",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
      "NPM_CONFIG_PROXY",
      "npm_config_https_proxy",
    ]) {
      expect(() => approvedSk102Runtime(safeEnvironment({ [name]: "present" })), name).toThrow(
        "SK102_NETWORK_ENV_FORBIDDEN",
      );
    }
  });

  it("requires independently approved database target and endpoint fingerprints", () => {
    expect(() =>
      assertSk102DatabaseTarget(
        DATABASE_URL,
        safeEnvironment({
          SK102_DATABASE_OBSERVED_TARGET_FINGERPRINT: FORBIDDEN_DATABASE_TARGET_A,
          SK102_DATABASE_APPROVED_TARGET_FINGERPRINT: FORBIDDEN_DATABASE_TARGET_A,
        }),
      ),
    ).toThrow("SK102_DATABASE_TARGET_FORBIDDEN");

    const otherUrl =
      "postgresql://isolated-user:isolated-password@other.example.invalid/sk102_e2e?sslmode=require";
    expect(() => assertSk102DatabaseTarget(otherUrl, safeEnvironment())).toThrow(
      "SK102_DATABASE_ENDPOINT_FORBIDDEN",
    );
    expect(() =>
      assertSk102DatabaseTarget(
        "postgresql://user:password@example.invalid/production?sslmode=require",
        safeEnvironment(),
      ),
    ).toThrow("SK102_DATABASE_NAME_UNSAFE");
    expect(() =>
      assertSk102DatabaseTarget(
        DATABASE_URL.replace("sslmode=require", "sslmode=disable"),
        safeEnvironment(),
      ),
    ).toThrow("SK102_DATABASE_URL_INVALID");
    expect(() =>
      assertSk102DatabaseTarget(`${DATABASE_URL}&sslmode=disable`, safeEnvironment()),
    ).toThrow("SK102_DATABASE_URL_INVALID");
    expect(() =>
      approvedSk102Runtime(
        safeEnvironment({ DATABASE_URL: DATABASE_URL.replace("isolated-password", "other") }),
      ),
    ).toThrow("SK102_DATABASE_CREDENTIAL_FORBIDDEN");
  });

  it("rejects connection-string and ambient libpq routing overrides before Pool use", () => {
    const reroutedUrl = `${DATABASE_URL}&host=protected.example.invalid`;
    const effectiveClient = new Client({ connectionString: reroutedUrl });
    const effectiveParameters = Reflect.get(effectiveClient, "connectionParameters") as {
      host?: unknown;
    };
    expect(effectiveParameters.host).toBe("protected.example.invalid");
    expect(sk102DatabaseEndpointFingerprint(reroutedUrl)).toBeNull();
    expect(() => approvedSk102Runtime(safeEnvironment({ DATABASE_URL: reroutedUrl }))).toThrow(
      "SK102_DATABASE_URL_INVALID",
    );

    for (const option of [
      "hostaddr=127.0.0.1",
      "port=5433",
      "dbname=other",
      "options=-csearch_path%3Dother",
      "service=other",
      "sslkey=other",
      "sslcert=other",
      "sslrootcert=other",
    ]) {
      expect(() =>
        approvedSk102Runtime(safeEnvironment({ DATABASE_URL: `${DATABASE_URL}&${option}` })),
      ).toThrow("SK102_DATABASE_URL_INVALID");
    }

    for (const name of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGOPTIONS", "PGSERVICE"]) {
      expect(() => approvedSk102Runtime(safeEnvironment({ [name]: "present" }))).toThrow(
        "SK102_DATABASE_AMBIENT_ENV_FORBIDDEN",
      );
    }
  });

  it("accepts only the optional Neon channel-binding query setting", () => {
    expect(() =>
      approvedSk102Runtime(
        safeEnvironment({ DATABASE_URL: `${DATABASE_URL}&channel_binding=require` }),
      ),
    ).not.toThrow();
    expect(() =>
      approvedSk102Runtime(
        safeEnvironment({ DATABASE_URL: `${DATABASE_URL}&channel_binding=disable` }),
      ),
    ).toThrow("SK102_DATABASE_URL_INVALID");
  });

  it("requires explicit isolated buckets and rejects protected or mismatched R2 targets", () => {
    expect(() =>
      assertSk102R2Target(
        safeEnvironment({
          R2_BUCKET_AUDIO: "skitza-audio",
          R2_BUCKET_DOCS: "skitza-docs",
          SK102_R2_APPROVED_TARGET_FINGERPRINT: FORBIDDEN_R2_TARGET,
        }),
      ),
    ).toThrow("SK102_R2_BUCKET_INVALID");
    expect(() =>
      assertSk102R2Target(safeEnvironment({ SK102_R2_ALLOWED_ORIGIN: "https://preview.invalid" })),
    ).toThrow("SK102_R2_ORIGIN_INVALID");
    expect(() =>
      assertSk102R2Target(
        safeEnvironment({ SK102_R2_APPROVED_TARGET_FINGERPRINT: sk102Fingerprint("other r2") }),
      ),
    ).toThrow("SK102_R2_TARGET_FORBIDDEN");
    expect(() =>
      assertSk102R2Target(safeEnvironment({ R2_SECRET_ACCESS_KEY: "x".repeat(40) })),
    ).toThrow("SK102_R2_CREDENTIAL_FORBIDDEN");
  });

  it("requires a distinct Clerk development instance fingerprint and test-only keys", () => {
    expect(() =>
      assertSk102ClerkTarget(
        safeEnvironment({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${"a".repeat(32)}` }),
      ),
    ).toThrow("SK102_CLERK_CONFIG_INVALID");
    expect(() =>
      assertSk102ClerkTarget(
        safeEnvironment({
          SK102_CLERK_APPROVED_TARGET_FINGERPRINT: FORBIDDEN_CLERK_TARGET,
          SK102_CLERK_FORBIDDEN_TARGET_FINGERPRINTS: FORBIDDEN_CLERK_TARGET,
        }),
      ),
    ).toThrow("SK102_CLERK_TARGET_FORBIDDEN");
    expect(() =>
      assertSk102ClerkTarget(safeEnvironment({ CLERK_SECRET_KEY: `sk_test_${"mixed".repeat(8)}` })),
    ).toThrow("SK102_CLERK_TARGET_FORBIDDEN");
    expect(() =>
      assertSk102ClerkTarget(
        safeEnvironment({ CLERK_WEBHOOK_SECRET: `whsec_${"mixed".repeat(8)}` }),
      ),
    ).toThrow("SK102_CLERK_TARGET_FORBIDDEN");
    for (const name of [
      "CLERK_API_URL",
      "CLERK_TESTING_TOKEN",
      "CLERK_FAPI",
      "CLERK_TESTING_DEBUG",
      "NEXT_PUBLIC_CLERK_PROXY_URL",
      "NEXT_PUBLIC_CLERK_JS_URL",
      "NEXT_PUBLIC_CLERK_DOMAIN",
      "VITE_CLERK_PUBLISHABLE_KEY",
    ]) {
      expect(() => assertSk102ClerkTarget(safeEnvironment({ [name]: "present" })), name).toThrow(
        "SK102_CLERK_AMBIENT_ENV_FORBIDDEN",
      );
    }
  });

  it("allows only Clerk test-address recipients in the internal capture sink", () => {
    const environment: Sk102Environment = safeEnvironment();
    expect(
      assertSk102EmailRecipients(
        ["producer+clerk_test_sk102@example.com", "artist+clerk_test@example.com"],
        environment,
      ),
    ).toMatchObject({ emailMode: "r2_capture" });
    expect(() => assertSk102EmailRecipients("customer@example.com", environment)).toThrow(
      "SK102_EMAIL_RECIPIENT_FORBIDDEN",
    );
    expect(() => assertSk102EmailRecipients("artist+clerk_test@example.org", environment)).toThrow(
      "SK102_EMAIL_RECIPIENT_FORBIDDEN",
    );
    expect(() =>
      approvedSk102Runtime(
        safeEnvironment({ SK102_EMAIL_FROM: "Skitza <notifications@skitza.app>" }),
      ),
    ).toThrow("SK102_EMAIL_FROM_INVALID");
  });

  it("uses stable safe error codes that never echo credentials or endpoints", () => {
    const secret = "do-not-print-this-secret";
    const unsafe = safeEnvironment({
      DATABASE_URL: `postgresql://user:${secret}@protected.example.invalid/sk102_e2e?sslmode=require`,
    });
    let message = "";
    try {
      approvedSk102Runtime(unsafe);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("SK102_DATABASE_ENDPOINT_FORBIDDEN");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("protected.example.invalid");
  });
});
