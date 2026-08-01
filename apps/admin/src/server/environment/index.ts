export const ADMIN_DATABASE_ENV_NAMES = {
  live: "ADMIN_LIVE_DATABASE_URL",
  test: "ADMIN_TEST_DATABASE_URL",
} as const;

export type AdminEnvironmentId = keyof typeof ADMIN_DATABASE_ENV_NAMES;
export type AdminEnvironmentMap = Readonly<
  Record<string, string | undefined>
>;

export type AdminEnvironmentPublicContext = Readonly<{
  id: AdminEnvironmentId;
  label: "Live" | "Test";
  tone: "danger" | "info";
}>;

export type ResolvedAdminEnvironment = Readonly<{
  databaseUrl: string;
  publicContext: AdminEnvironmentPublicContext;
}>;

export type AdminEnvironmentConfigurationErrorCode =
  | "ADMIN_ENVIRONMENT_INVALID"
  | "ADMIN_ENVIRONMENT_BINDING_MISSING"
  | "ADMIN_ENVIRONMENT_BINDING_INVALID"
  | "ADMIN_ENVIRONMENT_BINDINGS_COLLIDE";

const ERROR_MESSAGES: Readonly<
  Record<AdminEnvironmentConfigurationErrorCode, string>
> = {
  ADMIN_ENVIRONMENT_INVALID: "The admin environment selection is invalid.",
  ADMIN_ENVIRONMENT_BINDING_MISSING:
    "Required admin environment configuration is missing.",
  ADMIN_ENVIRONMENT_BINDING_INVALID:
    "An admin environment binding is invalid.",
  ADMIN_ENVIRONMENT_BINDINGS_COLLIDE:
    "Live and Test admin environments must use separate configuration.",
};

export class AdminEnvironmentConfigurationError extends Error {
  readonly code: AdminEnvironmentConfigurationErrorCode;

  constructor(code: AdminEnvironmentConfigurationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "AdminEnvironmentConfigurationError";
    this.code = code;
  }
}

const PUBLIC_CONTEXTS = {
  live: Object.freeze({
    id: "live",
    label: "Live",
    tone: "danger",
  }),
  test: Object.freeze({
    id: "test",
    label: "Test",
    tone: "info",
  }),
} as const satisfies Readonly<
  Record<AdminEnvironmentId, AdminEnvironmentPublicContext>
>;

function stop(code: AdminEnvironmentConfigurationErrorCode): never {
  throw new AdminEnvironmentConfigurationError(code);
}

function requiredBinding(
  environment: AdminEnvironmentMap,
  name: (typeof ADMIN_DATABASE_ENV_NAMES)[AdminEnvironmentId],
): string {
  const value = environment[name]?.trim();
  if (!value) stop("ADMIN_ENVIRONMENT_BINDING_MISSING");
  return value;
}

function canonicalDatabaseTarget(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return stop("ADMIN_ENVIRONMENT_BINDING_INVALID");
  }

  if (
    (parsed.protocol !== "postgres:" &&
      parsed.protocol !== "postgresql:") ||
    !parsed.hostname ||
    parsed.pathname === "/"
  ) {
    return stop("ADMIN_ENVIRONMENT_BINDING_INVALID");
  }

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.endsWith(".neon.tech")) {
    const labels = hostname.split(".");
    const endpoint = labels[0];
    if (endpoint?.endsWith("-pooler")) {
      labels[0] = endpoint.slice(0, -"-pooler".length);
      hostname = labels.join(".");
    }
  }

  // Credentials, connection options, and Neon's pooled/direct hostname
  // aliases must not make one database look like two isolated targets.
  return `${hostname}:${parsed.port || "5432"}${parsed.pathname}`;
}

export function parseAdminEnvironmentId(
  value: string | undefined,
): AdminEnvironmentId {
  if (value === "live" || value === "test") return value;
  return stop("ADMIN_ENVIRONMENT_INVALID");
}

export function getAdminEnvironmentPublicContext(
  id: AdminEnvironmentId,
): AdminEnvironmentPublicContext {
  return PUBLIC_CONTEXTS[id];
}

/**
 * Resolves one selected data environment from explicit, server-provided
 * configuration. Callers inject the environment map so this module never
 * infers product data context from DATABASE_URL, VERCEL_ENV, or process state.
 */
export function resolveAdminEnvironment(
  environment: AdminEnvironmentMap,
  selectedEnvironment: string | undefined,
): ResolvedAdminEnvironment {
  const id = parseAdminEnvironmentId(selectedEnvironment);
  const liveDatabaseUrl = requiredBinding(
    environment,
    ADMIN_DATABASE_ENV_NAMES.live,
  );
  const testDatabaseUrl = requiredBinding(
    environment,
    ADMIN_DATABASE_ENV_NAMES.test,
  );

  if (
    canonicalDatabaseTarget(liveDatabaseUrl) ===
    canonicalDatabaseTarget(testDatabaseUrl)
  ) {
    stop("ADMIN_ENVIRONMENT_BINDINGS_COLLIDE");
  }

  return {
    databaseUrl: id === "live" ? liveDatabaseUrl : testDatabaseUrl,
    publicContext: getAdminEnvironmentPublicContext(id),
  };
}
