export const ACCOUNT_CLOSURE_OPERATOR_ENV = {
  actorClerkUserId: "SKITZA_ACCOUNT_CLOSURE_ACTOR_CLERK_USER_ID",
  clerkInstanceId: "SKITZA_ACCOUNT_CLOSURE_CURRENT_CLERK_INSTANCE_ID",
  databaseUrl: "SKITZA_ACCOUNT_CLOSURE_DATABASE_URL",
  liveConfirmation: "SKITZA_ACCOUNT_CLOSURE_LIVE_CONFIRMATION",
  targetClass: "SKITZA_ACCOUNT_CLOSURE_TARGET_CLASS",
} as const;

export const ACCOUNT_CLOSURE_LIVE_CONFIRMATION = "approved-live-account-closure-sk229" as const;

// Verified canonical skitza-v3 main endpoint on 2026-08-13. The pooled URL
// adds only the standard "-pooler" suffix. Rotate this pin only with fresh
// read-only Neon identity evidence and the matching SK104 fingerprint update.
export const ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT = "ep-tiny-hill-alh6mlzz" as const;

export const ACCOUNT_CLOSURE_FORBIDDEN_AMBIENT_DATABASE_ENV = [
  "DATABASE_URL",
  "DATABASE_URL_NEON",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGSERVICE",
  "PGPASSFILE",
] as const;

export const ACCOUNT_CLOSURE_OPERATOR_ERROR_CODES = [
  "ACCOUNT_CLOSURE_AMBIENT_DATABASE_ENV_FORBIDDEN",
  "ACCOUNT_CLOSURE_COMMAND_INVALID",
  "ACCOUNT_CLOSURE_ENV_INVALID",
  "ACCOUNT_CLOSURE_ENV_MISSING",
  "ACCOUNT_CLOSURE_INPUT_TOO_LARGE",
  "ACCOUNT_CLOSURE_TARGET_INVALID",
  "ACCOUNT_CLOSURE_UNEXPECTED_FAILURE",
] as const;

export type AccountClosureOperatorErrorCode = (typeof ACCOUNT_CLOSURE_OPERATOR_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<AccountClosureOperatorErrorCode, string>> = {
  ACCOUNT_CLOSURE_AMBIENT_DATABASE_ENV_FORBIDDEN:
    "Generic database environment is present; account closure stopped.",
  ACCOUNT_CLOSURE_COMMAND_INVALID: "The account-closure command is invalid.",
  ACCOUNT_CLOSURE_ENV_INVALID: "The account-closure operator configuration is invalid.",
  ACCOUNT_CLOSURE_ENV_MISSING: "Required account-closure operator configuration is missing.",
  ACCOUNT_CLOSURE_INPUT_TOO_LARGE: "The account-closure command is too large.",
  ACCOUNT_CLOSURE_TARGET_INVALID: "The account-closure database target is invalid.",
  ACCOUNT_CLOSURE_UNEXPECTED_FAILURE: "The account-closure command failed safely.",
};

export class AccountClosureOperatorSafetyError extends Error {
  constructor(readonly code: AccountClosureOperatorErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "AccountClosureOperatorSafetyError";
  }
}

export type AccountClosureTargetClass = "test" | "live";

export type AccountClosureOperatorEnvironment = Readonly<{
  actorClerkUserId: string;
  clerkInstanceId: string;
  databaseUrl: string;
  targetClass: AccountClosureTargetClass;
}>;

type EnvironmentMap = Readonly<Record<string, string | undefined>>;

function stop(code: AccountClosureOperatorErrorCode): never {
  throw new AccountClosureOperatorSafetyError(code);
}

function required(environment: EnvironmentMap, name: string): string {
  const value = environment[name]?.trim();
  if (!value) stop("ACCOUNT_CLOSURE_ENV_MISSING");
  return value;
}

function assertActorClerkUserId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)) {
    stop("ACCOUNT_CLOSURE_ENV_INVALID");
  }
}

function parseDatabaseUrl(value: string, targetClass: AccountClosureTargetClass): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    stop("ACCOUNT_CLOSURE_ENV_INVALID");
  }

  let databaseName: string;
  let username: string;
  let password: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    stop("ACCOUNT_CLOSURE_ENV_INVALID");
  }

  const allowedSearchNames = new Set(["channel_binding", "sslmode"]);
  const searchNames = [...url.searchParams.keys()];
  const sslMode = url.searchParams.get("sslmode");
  const channelBinding = url.searchParams.get("channel_binding");
  const validPostgresUrl =
    (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
    url.hostname.length > 0 &&
    /^[A-Za-z0-9_-]{1,63}$/.test(databaseName) &&
    username.length > 0 &&
    password.length > 0 &&
    ![username, password].some((part) => /[\0\r\n]/.test(part)) &&
    (url.port === "" ||
      (/^\d{1,5}$/.test(url.port) && Number(url.port) >= 1 && Number(url.port) <= 65_535)) &&
    url.hash === "" &&
    searchNames.every((name) => allowedSearchNames.has(name)) &&
    [...allowedSearchNames].every((name) => url.searchParams.getAll(name).length <= 1) &&
    (channelBinding === null || channelBinding === "require");

  if (!validPostgresUrl) stop("ACCOUNT_CLOSURE_ENV_INVALID");

  if (targetClass === "live") {
    const firstHostLabel = url.hostname.split(".")[0] ?? "";
    if (
      !url.hostname.endsWith(".neon.tech") ||
      (firstHostLabel !== ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT &&
        firstHostLabel !== `${ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT}-pooler`) ||
      (sslMode !== "require" && sslMode !== "verify-full")
    ) {
      stop("ACCOUNT_CLOSURE_ENV_INVALID");
    }
  }
}

export function readAccountClosureOperatorEnvironment(
  environment: EnvironmentMap,
): AccountClosureOperatorEnvironment {
  if (
    ACCOUNT_CLOSURE_FORBIDDEN_AMBIENT_DATABASE_ENV.some((name) => environment[name] !== undefined)
  ) {
    stop("ACCOUNT_CLOSURE_AMBIENT_DATABASE_ENV_FORBIDDEN");
  }

  const targetClass = required(environment, ACCOUNT_CLOSURE_OPERATOR_ENV.targetClass);
  if (targetClass !== "test" && targetClass !== "live") {
    stop("ACCOUNT_CLOSURE_ENV_INVALID");
  }

  const liveConfirmation = environment[ACCOUNT_CLOSURE_OPERATOR_ENV.liveConfirmation]?.trim();
  if (
    (targetClass === "live" && liveConfirmation !== ACCOUNT_CLOSURE_LIVE_CONFIRMATION) ||
    (targetClass === "test" && liveConfirmation !== undefined)
  ) {
    stop("ACCOUNT_CLOSURE_ENV_INVALID");
  }

  const actorClerkUserId = required(environment, ACCOUNT_CLOSURE_OPERATOR_ENV.actorClerkUserId);
  assertActorClerkUserId(actorClerkUserId);

  const clerkInstanceId = required(environment, ACCOUNT_CLOSURE_OPERATOR_ENV.clerkInstanceId);
  assertActorClerkUserId(clerkInstanceId);

  const databaseUrl = required(environment, ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl);
  parseDatabaseUrl(databaseUrl, targetClass);

  return { actorClerkUserId, clerkInstanceId, databaseUrl, targetClass };
}
