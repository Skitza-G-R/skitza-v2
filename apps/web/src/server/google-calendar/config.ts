const ENABLED_VALUE = "true";
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export const GOOGLE_CALENDAR_CALLBACK_PATH = "/api/integrations/google-calendar/callback";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

const KEY_VERSION_PATTERN = /^[1-9][0-9]*$/u;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type GoogleCalendarEnvironment = Readonly<
  Partial<
    Record<
      | "NODE_ENV"
      | "VERCEL_ENV"
      | "GOOGLE_CALENDAR_ENABLED"
      | "GOOGLE_CALENDAR_CLIENT_ID"
      | "GOOGLE_CALENDAR_CLIENT_SECRET"
      | "GOOGLE_CALENDAR_REDIRECT_URI"
      | "GOOGLE_CALENDAR_STATE_SECRET"
      | "GOOGLE_CALENDAR_ENCRYPTION_KEYS"
      | "GOOGLE_CALENDAR_ACTIVE_KEY_VERSION"
      | "GOOGLE_CALENDAR_ID_FINGERPRINT_SECRET",
      string | undefined
    >
  >
>;

export type GoogleCalendarEncryptionKeyring = Readonly<{
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}>;

export type GoogleCalendarServerConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: Buffer;
  encryption: GoogleCalendarEncryptionKeyring;
  calendarIdFingerprintSecret: Buffer;
}>;

export class GoogleCalendarConfigurationError extends Error {
  constructor() {
    super("Google Calendar is not configured");
    this.name = "GoogleCalendarConfigurationError";
  }
}

export class GoogleCalendarCapabilityUnavailableError extends Error {
  constructor() {
    super("Google Calendar is unavailable");
    this.name = "GoogleCalendarCapabilityUnavailableError";
  }
}

function environmentValue(
  environment: GoogleCalendarEnvironment,
  name: keyof GoogleCalendarEnvironment,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new GoogleCalendarConfigurationError();
  return value;
}

function decodeKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
    throw new GoogleCalendarConfigurationError();
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new GoogleCalendarConfigurationError();
  }
  return key;
}

function parseRedirectUri(raw: string): string {
  let redirect: URL;
  try {
    redirect = new URL(raw);
  } catch {
    throw new GoogleCalendarConfigurationError();
  }
  const localHttp = redirect.protocol === "http:" && LOCAL_HOSTS.has(redirect.hostname);
  if (
    (redirect.protocol !== "https:" && !localHttp) ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname !== GOOGLE_CALENDAR_CALLBACK_PATH
  ) {
    throw new GoogleCalendarConfigurationError();
  }
  return redirect.toString();
}

function parseEncryptionKeyring(environment: GoogleCalendarEnvironment) {
  const activeVersionValue = environmentValue(environment, "GOOGLE_CALENDAR_ACTIVE_KEY_VERSION");
  if (!KEY_VERSION_PATTERN.test(activeVersionValue)) {
    throw new GoogleCalendarConfigurationError();
  }
  const activeVersion = Number(activeVersionValue);
  if (!Number.isSafeInteger(activeVersion) || activeVersion > POSTGRES_INTEGER_MAX) {
    throw new GoogleCalendarConfigurationError();
  }

  let value: unknown;
  try {
    value = JSON.parse(environmentValue(environment, "GOOGLE_CALENDAR_ENCRYPTION_KEYS"));
  } catch {
    throw new GoogleCalendarConfigurationError();
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GoogleCalendarConfigurationError();
  }
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 8) {
    throw new GoogleCalendarConfigurationError();
  }
  const keys = new Map<number, Buffer>();
  for (const [version, encoded] of entries) {
    if (!KEY_VERSION_PATTERN.test(version) || typeof encoded !== "string") {
      throw new GoogleCalendarConfigurationError();
    }
    const numericVersion = Number(version);
    if (!Number.isSafeInteger(numericVersion) || numericVersion > POSTGRES_INTEGER_MAX) {
      throw new GoogleCalendarConfigurationError();
    }
    keys.set(numericVersion, decodeKey(encoded));
  }
  if (!keys.has(activeVersion)) throw new GoogleCalendarConfigurationError();
  return { activeVersion, keys } satisfies GoogleCalendarEncryptionKeyring;
}

/**
 * A server-only, fail-closed rollout gate. Vercel Production is denied even if
 * the enable flag is accidentally present. Local development and Vercel
 * Preview still require the explicit server-side flag.
 */
export function isGoogleCalendarCapabilityAvailable(
  environment: GoogleCalendarEnvironment = process.env,
): boolean {
  if (environment.GOOGLE_CALENDAR_ENABLED?.trim() !== ENABLED_VALUE) return false;
  if (environment.VERCEL_ENV === "production") return false;
  if (environment.VERCEL_ENV === "preview" || environment.VERCEL_ENV === "development") {
    return true;
  }
  if (environment.VERCEL_ENV) return false;
  return environment.NODE_ENV === "development";
}

export function assertGoogleCalendarCapabilityAvailable(
  environment: GoogleCalendarEnvironment = process.env,
): void {
  if (!isGoogleCalendarCapabilityAvailable(environment)) {
    throw new GoogleCalendarCapabilityUnavailableError();
  }
}

export function loadGoogleCalendarServerConfig(
  environment: GoogleCalendarEnvironment = process.env,
): GoogleCalendarServerConfig {
  assertGoogleCalendarCapabilityAvailable(environment);
  const stateSecret = decodeKey(environmentValue(environment, "GOOGLE_CALENDAR_STATE_SECRET"));
  const encryption = parseEncryptionKeyring(environment);
  const calendarIdFingerprintSecret = decodeKey(
    environmentValue(environment, "GOOGLE_CALENDAR_ID_FINGERPRINT_SECRET"),
  );
  if (
    stateSecret.equals(calendarIdFingerprintSecret) ||
    [...encryption.keys.values()].some(
      (key) => key.equals(stateSecret) || key.equals(calendarIdFingerprintSecret),
    )
  ) {
    throw new GoogleCalendarConfigurationError();
  }
  return {
    clientId: environmentValue(environment, "GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: environmentValue(environment, "GOOGLE_CALENDAR_CLIENT_SECRET"),
    redirectUri: parseRedirectUri(environmentValue(environment, "GOOGLE_CALENDAR_REDIRECT_URI")),
    stateSecret,
    encryption,
    calendarIdFingerprintSecret,
  };
}

export function isGoogleCalendarServerConfigured(
  environment: GoogleCalendarEnvironment = process.env,
): boolean {
  try {
    loadGoogleCalendarServerConfig(environment);
    return true;
  } catch {
    return false;
  }
}
