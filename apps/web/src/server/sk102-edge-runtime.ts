const SK102_EDGE_ORIGIN = "http://127.0.0.1:3102";
const SK102_EDGE_FORBIDDEN_ENV = [
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
const SK102_EDGE_ALLOWED_CLERK_ENV = new Set([
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "SKITZA_E2E_PRODUCER_CLERK_USER_ID",
  "SKITZA_E2E_ARTIST_CLERK_USER_ID",
]);
const SK102_EDGE_FORBIDDEN_NETWORK_ENV = new Set([
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

/** Edge-safe subset of the full Node guard; it deliberately avoids node:crypto. */
export function assertSk102EdgeRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const mode = environment.SK102_E2E_MODE?.trim();
  if (!mode) {
    if (
      Object.entries(environment).some(
        ([name, candidate]) => name.startsWith("SK102_") && Boolean(candidate?.trim()),
      )
    ) {
      throw new Error("SK102_MODE_REQUIRED");
    }
    return;
  }
  if (
    mode !== "isolated_nonproduction" ||
    environment.SK102_DISPOSABLE_CONFIRMATION?.trim() !== "isolated-disposable"
  ) {
    throw new Error("SK102_EDGE_RUNTIME_INVALID");
  }
  if (environment.VERCEL_ENV?.trim() === "production") {
    throw new Error("SK102_PRODUCTION_DEPLOYMENT_FORBIDDEN");
  }
  if (environment.NEXT_TELEMETRY_DISABLED?.trim() !== "1") {
    throw new Error("SK102_TELEMETRY_INVALID");
  }
  if (
    Object.entries(environment).some(
      ([name, candidate]) =>
        SK102_EDGE_FORBIDDEN_NETWORK_ENV.has(name) && Boolean(candidate?.trim()),
    )
  ) {
    throw new Error("SK102_NETWORK_ENV_FORBIDDEN");
  }
  if (
    environment.SK102_BROWSER_ORIGIN?.trim() !== SK102_EDGE_ORIGIN ||
    environment.SITE_URL?.trim() !== SK102_EDGE_ORIGIN
  ) {
    throw new Error("SK102_SITE_URL_INVALID");
  }
  if (!/^sk102-[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(environment.SK102_SLOT?.trim() ?? "")) {
    throw new Error("SK102_SLOT_INVALID");
  }
  if (environment.SK102_PAYMENT_MODE?.trim() !== "off_app_test") {
    throw new Error("SK102_PAYMENT_MODE_INVALID");
  }
  if (
    Object.entries(environment).some(
      ([name, candidate]) =>
        Boolean(candidate?.trim()) &&
        /(?:^|_)CLERK(?:_|$)/u.test(name) &&
        !SK102_EDGE_ALLOWED_CLERK_ENV.has(name) &&
        !name.startsWith("SK102_CLERK_"),
    )
  ) {
    throw new Error("SK102_CLERK_AMBIENT_ENV_FORBIDDEN");
  }
  const clerkKey = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const alternateClerkKey = environment.CLERK_PUBLISHABLE_KEY?.trim();
  if (
    !clerkKey?.startsWith("pk_test_") ||
    clerkKey.length < 24 ||
    (alternateClerkKey !== undefined && alternateClerkKey !== clerkKey)
  ) {
    throw new Error("SK102_CLERK_CONFIG_INVALID");
  }
  if (
    SK102_EDGE_FORBIDDEN_ENV.some((name) => Boolean(environment[name]?.trim())) ||
    Object.entries(environment).some(
      ([name, candidate]) =>
        Boolean(candidate?.trim()) && /(?:^|_)(?:STRIPE|TRANZILA|PAYPAL|ADYEN)(?:_|$)/.test(name),
    )
  ) {
    throw new Error("SK102_EXTERNAL_SERVICE_ENV_FORBIDDEN");
  }
}
