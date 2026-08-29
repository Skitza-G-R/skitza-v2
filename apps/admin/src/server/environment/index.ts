// SK-288 — admin talks to one database.
//
// The Live/Test split is gone from the URL and from configuration: it
// demanded a duplicate database, Clerk account and Resend key per
// environment, and the Test Resend key was a documented placeholder, so a
// Test invite send failed by design. Test was not a sandbox.
//
// The database still keeps its `admin_data_environment` column, its
// live/test check constraints and its unique indexes on (environment, …).
// Nothing here migrates any of that — admin simply always means 'live'.

export const ADMIN_LIVE_DATABASE_URL_ENV = "ADMIN_LIVE_DATABASE_URL";

export type AdminEnvironmentId = "live";
export type AdminEnvironmentMap = Readonly<Record<string, string | undefined>>;

export type AdminEnvironmentPublicContext = Readonly<{
  id: AdminEnvironmentId;
  label: "Live";
  tone: "danger";
}>;

export type ResolvedAdminEnvironment = Readonly<{
  databaseUrl: string;
  publicContext: AdminEnvironmentPublicContext;
}>;

export type AdminEnvironmentConfigurationErrorCode =
  | "ADMIN_ENVIRONMENT_BINDING_MISSING"
  | "ADMIN_ENVIRONMENT_BINDING_INVALID";

const ERROR_MESSAGES: Readonly<Record<AdminEnvironmentConfigurationErrorCode, string>> = {
  ADMIN_ENVIRONMENT_BINDING_INVALID: "An admin environment binding is invalid.",
  ADMIN_ENVIRONMENT_BINDING_MISSING: "Required admin environment configuration is missing.",
};

export class AdminEnvironmentConfigurationError extends Error {
  readonly code: AdminEnvironmentConfigurationErrorCode;

  constructor(code: AdminEnvironmentConfigurationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "AdminEnvironmentConfigurationError";
    this.code = code;
  }
}

const LIVE_PUBLIC_CONTEXT = Object.freeze({
  id: "live",
  label: "Live",
  tone: "danger",
}) satisfies AdminEnvironmentPublicContext;

function stop(code: AdminEnvironmentConfigurationErrorCode): never {
  throw new AdminEnvironmentConfigurationError(code);
}

function requiredBinding(environment: AdminEnvironmentMap, name: string): string {
  const value = environment[name]?.trim();
  if (!value) stop("ADMIN_ENVIRONMENT_BINDING_MISSING");
  return value;
}

function assertPostgresUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return stop("ADMIN_ENVIRONMENT_BINDING_INVALID");
  }

  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    !parsed.hostname ||
    parsed.pathname === "/"
  ) {
    return stop("ADMIN_ENVIRONMENT_BINDING_INVALID");
  }

  return databaseUrl;
}

export function getAdminEnvironmentPublicContext(): AdminEnvironmentPublicContext {
  return LIVE_PUBLIC_CONTEXT;
}

/**
 * Resolves the one admin data environment from explicit, server-provided
 * configuration. Callers inject the environment map so this module never
 * infers product data context from DATABASE_URL, VERCEL_ENV, or process state.
 */
export function resolveAdminEnvironment(
  environment: AdminEnvironmentMap,
): ResolvedAdminEnvironment {
  return {
    databaseUrl: assertPostgresUrl(requiredBinding(environment, ADMIN_LIVE_DATABASE_URL_ENV)),
    publicContext: LIVE_PUBLIC_CONTEXT,
  };
}
