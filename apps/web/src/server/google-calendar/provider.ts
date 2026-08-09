import { GOOGLE_CALENDAR_SCOPES, type GoogleCalendarServerConfig } from "./config";
import {
  GoogleCalendarBusyIntervalError,
  normalizeGoogleCalendarBusyIntervals,
  type GoogleCalendarBusyInterval,
} from "./freebusy";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_LIST_ENDPOINT = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const FREE_BUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TOKEN_BYTES = 4 * 1024;
const MAX_CALENDAR_PAGES = 100;
const MAX_CALENDARS = 10_000;

export const GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS = 50;

export type GoogleCalendarAccessRole =
  | "freeBusyReader"
  | "reader"
  | "writerWithoutPrivateAccess"
  | "writer"
  | "owner";

export type GoogleCalendarProviderIdentity = Readonly<{
  googleSubject: string;
  googleAccountEmail: string;
}>;

export type GoogleCalendarProviderTokens = Readonly<{
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date;
  grantedScopes: readonly string[];
}>;

export type GoogleCalendarAuthorizationResult = Readonly<{
  identity: GoogleCalendarProviderIdentity;
  tokens: GoogleCalendarProviderTokens;
}>;

export type GoogleCalendarProviderCalendar = Readonly<{
  providerCalendarId: string;
  displayName: string;
  timezone: string | null;
  accessRole: GoogleCalendarAccessRole;
  isPrimary: boolean;
}>;

export type GoogleCalendarProviderFreeBusyResult = Readonly<{
  busyIntervals: readonly GoogleCalendarBusyInterval[];
  failedCalendarCount: number;
}>;

export type GoogleCalendarProviderErrorCode =
  | "authorization_failed"
  | "identity_unverified"
  | "refresh_invalid_grant"
  | "access_unauthorized"
  | "provider_unavailable"
  | "provider_invalid_response";

export class GoogleCalendarProviderError extends Error {
  readonly code: GoogleCalendarProviderErrorCode;

  constructor(code: GoogleCalendarProviderErrorCode) {
    super("Google Calendar request failed");
    this.name = "GoogleCalendarProviderError";
    this.code = code;
  }
}

export interface GoogleCalendarProvider {
  exchangeAuthorizationCode(
    input: Readonly<{
      code: string;
      codeVerifier: string;
    }>,
  ): Promise<GoogleCalendarAuthorizationResult>;
  refreshAccessToken(
    refreshToken: string,
  ): Promise<Omit<GoogleCalendarProviderTokens, "refreshToken">>;
  listCalendars(accessToken: string): Promise<readonly GoogleCalendarProviderCalendar[]>;
  queryFreeBusy(
    accessToken: string,
    input: Readonly<{
      calendarIds: readonly string[];
      timeMin: Date;
      timeMax: Date;
    }>,
  ): Promise<GoogleCalendarProviderFreeBusyResult>;
  revokeToken(token: string): Promise<void>;
}

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAccessRole(value: unknown): value is GoogleCalendarAccessRole {
  return (
    value === "freeBusyReader" ||
    value === "reader" ||
    value === "writerWithoutPrivateAccess" ||
    value === "writer" ||
    value === "owner"
  );
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    !email ||
    email.length > 320 ||
    /\s/u.test(email) ||
    email.indexOf("@") < 1 ||
    email.endsWith("@")
  ) {
    return null;
  }
  return email;
}

function validatedToken(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return Buffer.byteLength(value, "utf8") <= MAX_TOKEN_BYTES ? value : null;
}

function parseScopes(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/\s+/u).filter(Boolean))].sort();
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new GoogleCalendarProviderError("provider_invalid_response");
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error();
    return parsed;
  } catch (error) {
    if (error instanceof GoogleCalendarProviderError) throw error;
    throw new GoogleCalendarProviderError("provider_invalid_response");
  }
}

function fetchFailure(error: unknown): never {
  if (error instanceof GoogleCalendarProviderError) throw error;
  throw new GoogleCalendarProviderError("provider_unavailable");
}

export function hasRequiredGoogleCalendarScopes(scopes: readonly string[]): boolean {
  const granted = new Set(scopes);
  return GOOGLE_CALENDAR_SCOPES.every((scope) => granted.has(scope));
}

export function createGoogleCalendarProvider(
  input: Readonly<{
    config: GoogleCalendarServerConfig;
    fetch?: FetchLike;
    timeoutMs?: number;
  }>,
): GoogleCalendarProvider {
  const request = input.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new GoogleCalendarProviderError("provider_unavailable");
  }

  async function providerFetch(url: string | URL, init: RequestInit): Promise<Response> {
    try {
      return await request(url, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return fetchFailure(error);
    }
  }

  async function readIdentity(accessToken: string): Promise<GoogleCalendarProviderIdentity> {
    const response = await providerFetch(USERINFO_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new GoogleCalendarProviderError("identity_unverified");
    }
    const value = await readJson(response);
    const subject = typeof value.sub === "string" ? value.sub.trim() : "";
    const email = normalizedEmail(value.email);
    if (
      !subject ||
      subject.length > 255 ||
      subject.includes("\0") ||
      !email ||
      value.email_verified !== true
    ) {
      throw new GoogleCalendarProviderError("identity_unverified");
    }
    return { googleSubject: subject, googleAccountEmail: email };
  }

  return {
    async exchangeAuthorizationCode({ code, codeVerifier }) {
      if (!code || !codeVerifier) {
        throw new GoogleCalendarProviderError("authorization_failed");
      }
      const body = new URLSearchParams({
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: input.config.redirectUri,
      });
      const response = await providerFetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!response.ok) {
        throw new GoogleCalendarProviderError("authorization_failed");
      }
      const value = await readJson(response);
      const accessToken = validatedToken(value.access_token);
      const refreshToken =
        value.refresh_token === undefined ? null : validatedToken(value.refresh_token);
      const expiresIn = value.expires_in;
      const grantedScopes = parseScopes(value.scope);
      if (
        !accessToken ||
        (value.refresh_token !== undefined && !refreshToken) ||
        typeof expiresIn !== "number" ||
        !Number.isFinite(expiresIn) ||
        expiresIn < 1 ||
        expiresIn > 86_400 ||
        !hasRequiredGoogleCalendarScopes(grantedScopes)
      ) {
        throw new GoogleCalendarProviderError("authorization_failed");
      }
      const identity = await readIdentity(accessToken);
      return {
        identity,
        tokens: {
          accessToken,
          refreshToken,
          accessTokenExpiresAt: new Date(Date.now() + Math.floor(expiresIn) * 1_000),
          grantedScopes,
        },
      };
    },

    async refreshAccessToken(refreshToken) {
      if (!validatedToken(refreshToken)) {
        throw new GoogleCalendarProviderError("refresh_invalid_grant");
      }
      const body = new URLSearchParams({
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const response = await providerFetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!response.ok) {
        let invalidGrant = false;
        try {
          const value = await readJson(response);
          invalidGrant = value.error === "invalid_grant";
        } catch {
          // The public result stays sanitized even if Google returns malformed JSON.
        }
        throw new GoogleCalendarProviderError(
          invalidGrant ? "refresh_invalid_grant" : "provider_unavailable",
        );
      }
      const value = await readJson(response);
      const accessToken = validatedToken(value.access_token);
      const expiresIn = value.expires_in;
      const grantedScopes = parseScopes(value.scope);
      if (
        !accessToken ||
        typeof expiresIn !== "number" ||
        !Number.isFinite(expiresIn) ||
        expiresIn < 1 ||
        expiresIn > 86_400
      ) {
        throw new GoogleCalendarProviderError("provider_invalid_response");
      }
      return {
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + Math.floor(expiresIn) * 1_000),
        grantedScopes,
      };
    },

    async listCalendars(accessToken) {
      if (!validatedToken(accessToken)) {
        throw new GoogleCalendarProviderError("provider_unavailable");
      }
      const calendars: GoogleCalendarProviderCalendar[] = [];
      const seenIds = new Set<string>();
      const seenPageTokens = new Set<string>();
      let primaryCount = 0;
      let pageToken: string | null = null;

      for (let page = 0; page < MAX_CALENDAR_PAGES; page += 1) {
        const url = new URL(CALENDAR_LIST_ENDPOINT);
        url.searchParams.set("minAccessRole", "freeBusyReader");
        url.searchParams.set("maxResults", "250");
        url.searchParams.set(
          "fields",
          "nextPageToken,items(id,summary,summaryOverride,timeZone,accessRole,primary)",
        );
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = await providerFetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (!response.ok) {
          if (response.status === 401) {
            throw new GoogleCalendarProviderError("access_unauthorized");
          }
          if (response.status === 403) {
            let insufficientPermissions = false;
            try {
              const errorResponse = await readJson(response);
              const error = isRecord(errorResponse.error) ? errorResponse.error : null;
              const reasons = error && Array.isArray(error.errors) ? error.errors : [];
              insufficientPermissions = reasons.some(
                (item) => isRecord(item) && item.reason === "insufficientPermissions",
              );
            } catch {
              // Malformed provider errors remain a temporary provider failure.
            }
            if (insufficientPermissions) {
              throw new GoogleCalendarProviderError("access_unauthorized");
            }
          }
          throw new GoogleCalendarProviderError("provider_unavailable");
        }
        const value = await readJson(response);
        if (!Array.isArray(value.items)) {
          throw new GoogleCalendarProviderError("provider_invalid_response");
        }
        for (const item of value.items) {
          if (!isRecord(item)) {
            throw new GoogleCalendarProviderError("provider_invalid_response");
          }
          const providerCalendarId = typeof item.id === "string" ? item.id.trim() : "";
          const override =
            typeof item.summaryOverride === "string" ? item.summaryOverride.trim() : "";
          const summary = typeof item.summary === "string" ? item.summary.trim() : "";
          const displayName = override || summary;
          const timezone =
            typeof item.timeZone === "string" && item.timeZone.trim() ? item.timeZone.trim() : null;
          if (
            !providerCalendarId ||
            Buffer.byteLength(providerCalendarId, "utf8") > MAX_TOKEN_BYTES ||
            !displayName ||
            displayName.length > 1_024 ||
            (timezone !== null && timezone.length > 255) ||
            !isAccessRole(item.accessRole) ||
            (item.primary !== undefined && typeof item.primary !== "boolean")
          ) {
            throw new GoogleCalendarProviderError("provider_invalid_response");
          }
          if (seenIds.has(providerCalendarId)) continue;
          seenIds.add(providerCalendarId);
          if (item.primary === true) primaryCount += 1;
          if (primaryCount > 1) {
            throw new GoogleCalendarProviderError("provider_invalid_response");
          }
          calendars.push({
            providerCalendarId,
            displayName,
            timezone,
            accessRole: item.accessRole,
            isPrimary: item.primary === true,
          });
          if (calendars.length > MAX_CALENDARS) {
            throw new GoogleCalendarProviderError("provider_invalid_response");
          }
        }
        if (value.nextPageToken === undefined) return calendars;
        if (
          typeof value.nextPageToken !== "string" ||
          !value.nextPageToken ||
          value.nextPageToken.length > 2_048 ||
          seenPageTokens.has(value.nextPageToken)
        ) {
          throw new GoogleCalendarProviderError("provider_invalid_response");
        }
        seenPageTokens.add(value.nextPageToken);
        pageToken = value.nextPageToken;
      }
      throw new GoogleCalendarProviderError("provider_invalid_response");
    },

    async queryFreeBusy(accessToken, { calendarIds, timeMin, timeMax }) {
      const min = timeMin.getTime();
      const max = timeMax.getTime();
      const uniqueIds = new Set(calendarIds);
      if (
        !validatedToken(accessToken) ||
        calendarIds.length < 1 ||
        calendarIds.length > GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS ||
        uniqueIds.size !== calendarIds.length ||
        calendarIds.some(
          (id) =>
            typeof id !== "string" ||
            !id ||
            id !== id.trim() ||
            Buffer.byteLength(id, "utf8") > MAX_TOKEN_BYTES,
        ) ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min >= max
      ) {
        throw new GoogleCalendarProviderError("provider_invalid_response");
      }

      const response = await providerFetch(FREE_BUSY_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timeZone: "UTC",
          calendarExpansionMax: GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS,
          items: calendarIds.map((id) => ({ id })),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new GoogleCalendarProviderError("access_unauthorized");
        }
        if (response.status === 403) {
          let insufficientPermissions = false;
          try {
            const errorResponse = await readJson(response);
            const error = isRecord(errorResponse.error) ? errorResponse.error : null;
            const reasons = error && Array.isArray(error.errors) ? error.errors : [];
            insufficientPermissions = reasons.some(
              (item) => isRecord(item) && item.reason === "insufficientPermissions",
            );
          } catch {
            // Malformed provider errors remain a temporary provider failure.
          }
          if (insufficientPermissions) {
            throw new GoogleCalendarProviderError("access_unauthorized");
          }
        }
        throw new GoogleCalendarProviderError("provider_unavailable");
      }

      const value = await readJson(response);
      if (!isRecord(value.calendars)) {
        throw new GoogleCalendarProviderError("provider_invalid_response");
      }
      const rawIntervals: unknown[] = [];
      let failedCalendarCount = 0;
      for (const calendarId of calendarIds) {
        const calendar = Object.hasOwn(value.calendars, calendarId)
          ? value.calendars[calendarId]
          : undefined;
        if (!isRecord(calendar)) {
          failedCalendarCount += 1;
          continue;
        }
        if (calendar.errors !== undefined && !Array.isArray(calendar.errors)) {
          throw new GoogleCalendarProviderError("provider_invalid_response");
        }
        if (Array.isArray(calendar.errors) && calendar.errors.length > 0) {
          failedCalendarCount += 1;
          continue;
        }
        if (!Array.isArray(calendar.busy)) {
          failedCalendarCount += 1;
          continue;
        }
        const busy: readonly unknown[] = calendar.busy;
        for (const interval of busy) rawIntervals.push(interval);
      }
      try {
        return {
          busyIntervals: normalizeGoogleCalendarBusyIntervals({
            intervals: rawIntervals,
            timeMin,
            timeMax,
          }),
          failedCalendarCount,
        };
      } catch (error) {
        if (!(error instanceof GoogleCalendarBusyIntervalError)) throw error;
        throw new GoogleCalendarProviderError("provider_invalid_response");
      }
    },

    async revokeToken(token) {
      if (!validatedToken(token)) return;
      try {
        await providerFetch(REVOKE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
      } catch {
        // Revocation is intentionally best-effort; local disconnect still wins.
      }
    },
  };
}
