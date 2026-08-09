import { randomUUID } from "node:crypto";

import type { GoogleCalendarServerConfig } from "./config";
import {
  decryptGoogleCalendarValue,
  deriveGoogleCalendarSelectionId,
  encryptGoogleCalendarValue,
  fingerprintGoogleCalendarId,
} from "./crypto";
import {
  buildGoogleCalendarAuthorizationUrl,
  createGoogleCalendarOAuthState,
  deriveGoogleCalendarPkce,
  digestGoogleCalendarOAuthStateToken,
  verifyGoogleCalendarOAuthState,
  type GoogleCalendarOAuthIntent,
} from "./oauth";
import {
  GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS,
  GoogleCalendarProviderError,
  hasRequiredGoogleCalendarScopes,
  type GoogleCalendarAccessRole,
  type GoogleCalendarProvider,
} from "./provider";
import type { GoogleCalendarBusyInterval } from "./freebusy";
import type {
  GoogleCalendarCandidateRecord,
  GoogleCalendarConnectionRecord,
  GoogleCalendarConnectionStatus,
  GoogleCalendarRepository,
} from "./repository";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type GoogleCalendarServiceErrorCode =
  | "not_connected"
  | "already_connected"
  | "switch_confirmation_required"
  | "authorization_cancelled"
  | "authorization_failed"
  | "state_invalid"
  | "wrong_account"
  | "refresh_token_missing"
  | "reconnect_required"
  | "invalid_selection"
  | "stale_connection"
  | "provider_unavailable";

const SAFE_ERROR_MESSAGES: Readonly<Record<GoogleCalendarServiceErrorCode, string>> = {
  not_connected: "Google Calendar is not connected",
  already_connected: "Google Calendar is already connected",
  switch_confirmation_required: "Confirm the Google account switch first",
  authorization_cancelled: "Google Calendar authorization was cancelled",
  authorization_failed: "Google Calendar authorization failed",
  state_invalid: "Google Calendar authorization could not be verified",
  wrong_account: "Choose the Google account already connected to Skitza",
  refresh_token_missing: "Google did not provide lasting calendar access",
  reconnect_required: "Google Calendar needs to be reconnected",
  invalid_selection: "Choose one editable destination and at least one busy calendar",
  stale_connection: "The Google Calendar connection changed. Try again",
  provider_unavailable: "Google Calendar is temporarily unavailable",
};

export class GoogleCalendarServiceError extends Error {
  readonly code: GoogleCalendarServiceErrorCode;

  constructor(code: GoogleCalendarServiceErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "GoogleCalendarServiceError";
    this.code = code;
  }
}

export type GoogleCalendarPublicCandidate = Readonly<{
  id: string;
  displayName: string;
  timezone: string | null;
  accessRole: GoogleCalendarAccessRole;
  isPrimary: boolean;
  isDestination: boolean;
  blocksAvailability: boolean;
}>;

export type GoogleCalendarConnectionSnapshot =
  | Readonly<{ status: "not_connected" }>
  | Readonly<{
      status: GoogleCalendarConnectionStatus;
      connectionId: string;
      accountEmail: string;
      calendars: readonly GoogleCalendarPublicCandidate[];
    }>;

export type GoogleCalendarOAuthStart = Readonly<{
  authorizationUrl: string;
  expiresAt: Date;
}>;

export type GoogleCalendarOAuthCompletion = Readonly<{
  connectionId: string;
  accountEmail: string;
  status: "needs_selection" | "connected";
  calendars: readonly GoogleCalendarPublicCandidate[];
}>;

export type GoogleCalendarBusyHealth =
  | "healthy"
  | "not_connected"
  | "reconnect_required"
  | "unavailable";

export type GoogleCalendarBusyResult = Readonly<{
  protection: "google_aware" | "skitza_only";
  health: GoogleCalendarBusyHealth;
  intervals: readonly GoogleCalendarBusyInterval[];
}>;

function failOpenBusyResult(
  health: Exclude<GoogleCalendarBusyHealth, "healthy">,
): GoogleCalendarBusyResult {
  return { protection: "skitza_only", health, intervals: [] };
}

function publicCandidate(candidate: GoogleCalendarCandidateRecord): GoogleCalendarPublicCandidate {
  return {
    id: candidate.id,
    displayName: candidate.displayName,
    timezone: candidate.timezone,
    accessRole: candidate.accessRole,
    isPrimary: candidate.isPrimary,
    isDestination: candidate.isDestination,
    blocksAvailability: candidate.blocksAvailability,
  };
}

function credentialContext(
  connection: Pick<
    GoogleCalendarConnectionRecord,
    "producerId" | "id" | "googleSubject" | "accountVersion"
  >,
  purpose: "access_token" | "refresh_token",
) {
  return {
    producerId: connection.producerId,
    connectionId: connection.id,
    googleSubject: connection.googleSubject,
    accountVersion: connection.accountVersion,
    purpose,
  } as const;
}

function isUsableConnection(
  connection: GoogleCalendarConnectionRecord | null,
): connection is GoogleCalendarConnectionRecord {
  return connection !== null && connection.status !== "disconnected";
}

function mapProviderFailure(error: unknown): GoogleCalendarServiceError {
  if (error instanceof GoogleCalendarServiceError) return error;
  if (error instanceof GoogleCalendarProviderError) {
    if (error.code === "authorization_failed" || error.code === "identity_unverified") {
      return new GoogleCalendarServiceError("authorization_failed");
    }
    if (error.code === "refresh_invalid_grant" || error.code === "access_unauthorized") {
      return new GoogleCalendarServiceError("reconnect_required");
    }
  }
  return new GoogleCalendarServiceError("provider_unavailable");
}

async function bestEffortRevokeNewAuthorization(
  provider: GoogleCalendarProvider,
  accessToken: string,
  refreshToken: string | null,
): Promise<void> {
  await Promise.allSettled(
    [...new Set([refreshToken, accessToken].filter((token): token is string => !!token))].map(
      (token) => provider.revokeToken(token),
    ),
  );
}

export function createGoogleCalendarService(
  input: Readonly<{
    repository: GoogleCalendarRepository;
    provider: GoogleCalendarProvider;
    config: GoogleCalendarServerConfig;
    now?: () => Date;
  }>,
) {
  const now = input.now ?? (() => new Date());

  async function loadUsableConnection(producerId: string): Promise<GoogleCalendarConnectionRecord> {
    const connection = await input.repository.getConnection(producerId);
    if (!isUsableConnection(connection)) {
      throw new GoogleCalendarServiceError("not_connected");
    }
    return connection;
  }

  async function markReconnect(
    connection: GoogleCalendarConnectionRecord,
    errorCode: "refresh_invalid_grant" | "access_unauthorized",
  ): Promise<never> {
    await input.repository.markReconnectRequired({
      producerId: connection.producerId,
      connectionId: connection.id,
      accountVersion: connection.accountVersion,
      errorCode,
      occurredAt: now(),
    });
    throw new GoogleCalendarServiceError("reconnect_required");
  }

  async function activeAccessToken(connection: GoogleCalendarConnectionRecord): Promise<string> {
    if (connection.status === "reconnect_required") {
      throw new GoogleCalendarServiceError("reconnect_required");
    }
    const currentTime = now();
    if (
      connection.accessToken &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() >
        currentTime.getTime() + ACCESS_TOKEN_REFRESH_SKEW_MS
    ) {
      return decryptGoogleCalendarValue(
        connection.accessToken,
        credentialContext(connection, "access_token"),
        input.config.encryption,
      );
    }
    if (!connection.refreshToken) return markReconnect(connection, "refresh_invalid_grant");
    const refreshToken = decryptGoogleCalendarValue(
      connection.refreshToken,
      credentialContext(connection, "refresh_token"),
      input.config.encryption,
    );
    let refreshed: Awaited<ReturnType<GoogleCalendarProvider["refreshAccessToken"]>>;
    try {
      refreshed = await input.provider.refreshAccessToken(refreshToken);
    } catch (error) {
      if (error instanceof GoogleCalendarProviderError && error.code === "refresh_invalid_grant") {
        return markReconnect(connection, "refresh_invalid_grant");
      }
      throw mapProviderFailure(error);
    }
    const grantedScopes =
      refreshed.grantedScopes.length > 0 ? refreshed.grantedScopes : connection.grantedScopes;
    if (!hasRequiredGoogleCalendarScopes(grantedScopes)) {
      return markReconnect(connection, "access_unauthorized");
    }
    const protectedAccessToken = encryptGoogleCalendarValue(
      refreshed.accessToken,
      credentialContext(connection, "access_token"),
      input.config.encryption,
    );
    const stored = await input.repository.storeRefreshedAccessToken({
      producerId: connection.producerId,
      connectionId: connection.id,
      googleSubject: connection.googleSubject,
      accountVersion: connection.accountVersion,
      accessToken: protectedAccessToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      grantedScopes: refreshed.grantedScopes.length > 0 ? refreshed.grantedScopes : null,
      refreshedAt: now(),
    });
    if (!stored) throw new GoogleCalendarServiceError("stale_connection");
    return refreshed.accessToken;
  }

  type ProviderCalendars = Awaited<ReturnType<GoogleCalendarProvider["listCalendars"]>>;

  async function fetchCalendars(
    connection: GoogleCalendarConnectionRecord,
    accessToken: string,
  ): Promise<ProviderCalendars> {
    try {
      return await input.provider.listCalendars(accessToken);
    } catch (error) {
      if (error instanceof GoogleCalendarProviderError && error.code === "access_unauthorized") {
        return markReconnect(connection, "access_unauthorized");
      }
      throw mapProviderFailure(error);
    }
  }

  async function storeCandidates(
    connection: GoogleCalendarConnectionRecord,
    calendars: ProviderCalendars,
  ): Promise<readonly GoogleCalendarCandidateRecord[]> {
    const candidates = calendars.map((calendar) => {
      const fingerprint = fingerprintGoogleCalendarId({
        calendarId: calendar.providerCalendarId,
        producerId: connection.producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
        secret: input.config.calendarIdFingerprintSecret,
      });
      const selectionId = deriveGoogleCalendarSelectionId({
        fingerprint,
        secret: input.config.calendarIdFingerprintSecret,
      });
      return {
        id: selectionId,
        connectionId: connection.id,
        producerId: connection.producerId,
        accountVersion: connection.accountVersion,
        providerCalendarId: encryptGoogleCalendarValue(
          calendar.providerCalendarId,
          {
            producerId: connection.producerId,
            connectionId: connection.id,
            selectionId,
            accountVersion: connection.accountVersion,
            purpose: "provider_calendar_id",
          },
          input.config.encryption,
        ),
        providerCalendarIdFingerprint: fingerprint,
        displayName: calendar.displayName,
        timezone: calendar.timezone,
        accessRole: calendar.accessRole,
        isPrimary: calendar.isPrimary,
      };
    });
    const stored = await input.repository.replaceCalendarCandidates({
      producerId: connection.producerId,
      connectionId: connection.id,
      accountVersion: connection.accountVersion,
      candidates,
      refreshedAt: now(),
    });
    if (!stored) throw new GoogleCalendarServiceError("stale_connection");
    return stored;
  }

  async function replaceCandidates(
    connection: GoogleCalendarConnectionRecord,
    accessToken: string,
  ): Promise<readonly GoogleCalendarCandidateRecord[]> {
    return storeCandidates(connection, await fetchCalendars(connection, accessToken));
  }

  async function readBusyIntervals(
    options: Readonly<{
      producerId: string;
      timeMin: Date;
      timeMax: Date;
    }>,
  ): Promise<GoogleCalendarBusyResult> {
    const timeMin = new Date(options.timeMin.getTime());
    const timeMax = new Date(options.timeMax.getTime());
    if (
      !Number.isFinite(timeMin.getTime()) ||
      !Number.isFinite(timeMax.getTime()) ||
      timeMin.getTime() >= timeMax.getTime()
    ) {
      return failOpenBusyResult("unavailable");
    }

    try {
      const connection = await input.repository.getConnection(options.producerId);
      if (!connection || connection.status === "disconnected") {
        return failOpenBusyResult("not_connected");
      }
      if (connection.status === "reconnect_required") {
        return failOpenBusyResult("reconnect_required");
      }
      if (connection.status !== "connected") {
        return failOpenBusyResult("not_connected");
      }

      const candidates = await input.repository.listCalendarCandidates({
        producerId: options.producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
      });
      const selected = candidates.filter((candidate) => candidate.blocksAvailability);
      if (selected.length < 1 || selected.length > GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS) {
        return failOpenBusyResult("unavailable");
      }
      const selectedIds = selected.map((candidate) => candidate.id).sort();
      const calendarIds = selected.map((candidate) =>
        decryptGoogleCalendarValue(
          candidate.providerCalendarId,
          {
            producerId: connection.producerId,
            connectionId: connection.id,
            selectionId: candidate.id,
            accountVersion: connection.accountVersion,
            purpose: "provider_calendar_id",
          },
          input.config.encryption,
        ),
      );
      const accessToken = await activeAccessToken(connection);
      let queried: Awaited<ReturnType<GoogleCalendarProvider["queryFreeBusy"]>>;
      try {
        // All repository reads above have completed before this network call.
        // Booking callers can therefore run this before opening their lock.
        queried = await input.provider.queryFreeBusy(accessToken, {
          calendarIds,
          timeMin,
          timeMax,
        });
      } catch (error) {
        if (error instanceof GoogleCalendarProviderError && error.code === "access_unauthorized") {
          await markReconnect(connection, "access_unauthorized");
        }
        throw error;
      }
      if (queried.failedCalendarCount > 0) {
        return failOpenBusyResult("unavailable");
      }

      const current = await input.repository.getConnection(options.producerId);
      if (!current || current.status === "disconnected") {
        return failOpenBusyResult("not_connected");
      }
      if (current.status === "reconnect_required") {
        return failOpenBusyResult("reconnect_required");
      }
      if (
        current.status !== "connected" ||
        current.id !== connection.id ||
        current.accountVersion !== connection.accountVersion
      ) {
        return failOpenBusyResult("unavailable");
      }
      const currentSelectedIds = (
        await input.repository.listCalendarCandidates({
          producerId: options.producerId,
          connectionId: current.id,
          accountVersion: current.accountVersion,
        })
      )
        .filter((candidate) => candidate.blocksAvailability)
        .map((candidate) => candidate.id)
        .sort();
      if (
        currentSelectedIds.length !== selectedIds.length ||
        currentSelectedIds.some((id, index) => id !== selectedIds[index])
      ) {
        return failOpenBusyResult("unavailable");
      }
      return {
        protection: "google_aware",
        health: "healthy",
        intervals: queried.busyIntervals,
      };
    } catch (error) {
      if (error instanceof GoogleCalendarServiceError) {
        if (error.code === "reconnect_required") {
          return failOpenBusyResult("reconnect_required");
        }
        if (error.code === "not_connected") {
          return failOpenBusyResult("not_connected");
        }
      }
      return failOpenBusyResult("unavailable");
    }
  }

  return {
    busyIntervals: readBusyIntervals,

    async beginOAuth(
      options: Readonly<{
        producerId: string;
        intent: GoogleCalendarOAuthIntent;
        switchConfirmed?: boolean;
      }>,
    ): Promise<GoogleCalendarOAuthStart> {
      const connection = await input.repository.getConnection(options.producerId);
      if (options.intent === "connect" && isUsableConnection(connection)) {
        throw new GoogleCalendarServiceError("already_connected");
      }
      if (options.intent === "reconnect" && !isUsableConnection(connection)) {
        throw new GoogleCalendarServiceError("not_connected");
      }
      if (options.intent === "switch_account" && connection === null) {
        throw new GoogleCalendarServiceError("not_connected");
      }
      if (options.intent === "switch_account" && options.switchConfirmed !== true) {
        throw new GoogleCalendarServiceError("switch_confirmation_required");
      }
      // A locally disconnected row keeps its stable account identity. A new
      // "connect" click is therefore a same-account reconnect, not an account
      // switch that could bypass the confirmation step.
      const normalizedIntent =
        options.intent === "connect" && connection?.status === "disconnected"
          ? "reconnect"
          : options.intent;
      const existing = connection;
      if (normalizedIntent !== "connect" && !existing) {
        throw new GoogleCalendarServiceError("not_connected");
      }
      const connectionId = normalizedIntent === "connect" ? null : existing?.id;
      const expectedAccountVersion =
        normalizedIntent === "connect" ? null : existing?.accountVersion;
      if (connectionId === undefined || expectedAccountVersion === undefined) {
        throw new GoogleCalendarServiceError("not_connected");
      }
      const issuedAt = now();
      const issued = createGoogleCalendarOAuthState({
        producerId: options.producerId,
        intent: normalizedIntent,
        connectionId,
        expectedAccountVersion,
        stateSecret: input.config.stateSecret,
        now: issuedAt,
      });
      await input.repository.createOAuthState({
        ...issued.binding,
        tokenDigest: issued.tokenDigest,
        createdAt: issuedAt,
      });
      return {
        authorizationUrl: buildGoogleCalendarAuthorizationUrl({
          config: input.config,
          stateToken: issued.token,
          codeChallenge: issued.codeChallenge,
        }),
        expiresAt: issued.binding.expiresAt,
      };
    },

    async completeOAuth(
      options: Readonly<{
        producerId: string;
        stateToken: string;
        code?: string;
        providerError?: string;
      }>,
    ): Promise<GoogleCalendarOAuthCompletion> {
      if (
        !options.stateToken ||
        options.stateToken.length > 1_024 ||
        (options.code !== undefined &&
          (!options.code || Buffer.byteLength(options.code, "utf8") > 4_096)) ||
        (options.providerError !== undefined &&
          (!options.providerError || options.providerError.length > 128))
      ) {
        throw new GoogleCalendarServiceError("state_invalid");
      }
      const consumedAt = now();
      const state = await input.repository.consumeOAuthState({
        producerId: options.producerId,
        tokenDigest: digestGoogleCalendarOAuthStateToken(options.stateToken),
        consumedAt,
      });
      if (!state) throw new GoogleCalendarServiceError("state_invalid");
      try {
        verifyGoogleCalendarOAuthState({
          token: options.stateToken,
          tokenDigest: state.tokenDigest,
          binding: state,
          stateSecret: input.config.stateSecret,
          now: consumedAt,
        });
      } catch {
        throw new GoogleCalendarServiceError("state_invalid");
      }
      if (options.providerError) {
        throw new GoogleCalendarServiceError(
          options.providerError === "access_denied"
            ? "authorization_cancelled"
            : "authorization_failed",
        );
      }
      if (!options.code) throw new GoogleCalendarServiceError("authorization_failed");
      const { codeVerifier } = deriveGoogleCalendarPkce(
        options.stateToken,
        options.producerId,
        input.config.stateSecret,
      );
      let authorization: Awaited<ReturnType<GoogleCalendarProvider["exchangeAuthorizationCode"]>>;
      try {
        authorization = await input.provider.exchangeAuthorizationCode({
          code: options.code,
          codeVerifier,
        });
      } catch (error) {
        throw mapProviderFailure(error);
      }

      const current = await input.repository.getConnection(options.producerId);
      const disconnectedStateIsCurrent =
        current?.status !== "disconnected" ||
        (current.disconnectedAt !== null &&
          state.createdAt.getTime() > current.disconnectedAt.getTime());
      const expectedCurrent =
        state.intent === "connect"
          ? current === null
          : current !== null &&
            current.id === state.connectionId &&
            current.accountVersion === state.expectedAccountVersion &&
            disconnectedStateIsCurrent;
      if (!expectedCurrent) {
        await bestEffortRevokeNewAuthorization(
          input.provider,
          authorization.tokens.accessToken,
          authorization.tokens.refreshToken,
        );
        throw new GoogleCalendarServiceError("stale_connection");
      }
      if (
        state.intent !== "switch_account" &&
        current !== null &&
        current.googleSubject !== authorization.identity.googleSubject
      ) {
        await bestEffortRevokeNewAuthorization(
          input.provider,
          authorization.tokens.accessToken,
          authorization.tokens.refreshToken,
        );
        throw new GoogleCalendarServiceError("wrong_account");
      }

      const targetConnectionId = current?.id ?? randomUUID();
      const changesSubject =
        current !== null && current.googleSubject !== authorization.identity.googleSubject;
      const targetAccountVersion =
        state.intent === "switch_account" && changesSubject
          ? current.accountVersion + 1
          : (current?.accountVersion ?? 1);
      const targetIdentity = {
        producerId: options.producerId,
        id: targetConnectionId,
        googleSubject: authorization.identity.googleSubject,
        accountVersion: targetAccountVersion,
      };
      const canReuseRefresh =
        (state.intent === "reconnect" || state.intent === "switch_account") &&
        current !== null &&
        targetAccountVersion === current.accountVersion &&
        current.googleSubject === authorization.identity.googleSubject &&
        current.lastErrorCode !== "refresh_invalid_grant" &&
        current.refreshToken !== null;
      if (!authorization.tokens.refreshToken && !canReuseRefresh) {
        await bestEffortRevokeNewAuthorization(
          input.provider,
          authorization.tokens.accessToken,
          null,
        );
        throw new GoogleCalendarServiceError("refresh_token_missing");
      }
      let authorizedCalendars: ProviderCalendars;
      try {
        authorizedCalendars = await input.provider.listCalendars(authorization.tokens.accessToken);
      } catch (error) {
        await bestEffortRevokeNewAuthorization(
          input.provider,
          authorization.tokens.accessToken,
          authorization.tokens.refreshToken,
        );
        throw error instanceof GoogleCalendarProviderError && error.code === "access_unauthorized"
          ? new GoogleCalendarServiceError("authorization_failed")
          : mapProviderFailure(error);
      }
      const accessToken = encryptGoogleCalendarValue(
        authorization.tokens.accessToken,
        credentialContext(targetIdentity, "access_token"),
        input.config.encryption,
      );
      const refreshToken = authorization.tokens.refreshToken
        ? encryptGoogleCalendarValue(
            authorization.tokens.refreshToken,
            credentialContext(targetIdentity, "refresh_token"),
            input.config.encryption,
          )
        : null;
      const committed = await input.repository.commitAuthorization({
        producerId: options.producerId,
        intent: state.intent,
        expectedConnectionId: state.connectionId,
        expectedAccountVersion: state.expectedAccountVersion,
        oauthStateCreatedAt: state.createdAt,
        targetConnectionId,
        targetAccountVersion,
        identity: authorization.identity,
        grantedScopes: authorization.tokens.grantedScopes,
        accessToken,
        accessTokenExpiresAt: authorization.tokens.accessTokenExpiresAt,
        refreshToken,
        authorizedAt: now(),
      });
      if (committed.outcome !== "stored") {
        await bestEffortRevokeNewAuthorization(
          input.provider,
          authorization.tokens.accessToken,
          authorization.tokens.refreshToken,
        );
        throw new GoogleCalendarServiceError(
          committed.outcome === "wrong_account"
            ? "wrong_account"
            : committed.outcome === "missing_refresh"
              ? "refresh_token_missing"
              : "stale_connection",
        );
      }
      const candidates = await storeCandidates(committed.connection, authorizedCalendars);
      const finalConnection =
        (await input.repository.getConnection(options.producerId)) ?? committed.connection;
      return {
        connectionId: committed.connection.id,
        accountEmail: committed.connection.googleAccountEmail,
        status: finalConnection.status === "connected" ? "connected" : "needs_selection",
        calendars: candidates.map(publicCandidate),
      };
    },

    async status(producerId: string): Promise<GoogleCalendarConnectionSnapshot> {
      const connection = await input.repository.getConnection(producerId);
      if (!connection) return { status: "not_connected" };
      if (connection.status === "disconnected") {
        return {
          status: "disconnected",
          connectionId: connection.id,
          accountEmail: connection.googleAccountEmail,
          calendars: [],
        };
      }
      let snapshotConnection = connection;
      let calendars = await input.repository.listCalendarCandidates({
        producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
      });
      if (connection.status === "needs_selection" && calendars.length === 0) {
        try {
          calendars = await replaceCandidates(connection, await activeAccessToken(connection));
        } catch {
          // Page loads retry this recoverable CalendarList gap without exposing
          // provider details or hiding the durable connection snapshot.
          snapshotConnection = (await input.repository.getConnection(producerId)) ?? connection;
        }
      }
      if (snapshotConnection.status === "disconnected") {
        return {
          status: "disconnected",
          connectionId: snapshotConnection.id,
          accountEmail: snapshotConnection.googleAccountEmail,
          calendars: [],
        };
      }
      return {
        status: snapshotConnection.status,
        connectionId: snapshotConnection.id,
        accountEmail: snapshotConnection.googleAccountEmail,
        calendars: calendars.map(publicCandidate),
      };
    },

    async listCalendars(producerId: string): Promise<readonly GoogleCalendarPublicCandidate[]> {
      const connection = await loadUsableConnection(producerId);
      const accessToken = await activeAccessToken(connection);
      const candidates = await replaceCandidates(connection, accessToken);
      return candidates.map(publicCandidate);
    },

    async saveSelection(
      options: Readonly<{
        producerId: string;
        destinationCalendarId: string;
        availabilityCalendarIds: readonly string[];
      }>,
    ): Promise<void> {
      const connection = await loadUsableConnection(options.producerId);
      const accessToken = await activeAccessToken(connection);
      await replaceCandidates(connection, accessToken);
      const availabilityCalendarIds = [...new Set(options.availabilityCalendarIds)];
      if (
        connection.status === "reconnect_required" ||
        !UUID_PATTERN.test(options.destinationCalendarId) ||
        availabilityCalendarIds.length < 1 ||
        availabilityCalendarIds.length > 10_000 ||
        availabilityCalendarIds.some((id) => !UUID_PATTERN.test(id))
      ) {
        throw new GoogleCalendarServiceError(
          connection.status === "reconnect_required" ? "reconnect_required" : "invalid_selection",
        );
      }
      const result = await input.repository.saveCalendarSelection({
        producerId: options.producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
        destinationCalendarId: options.destinationCalendarId,
        availabilityCalendarIds,
        savedAt: now(),
      });
      if (result !== "saved") {
        throw new GoogleCalendarServiceError(
          result === "stale" ? "stale_connection" : "invalid_selection",
        );
      }
      try {
        // Selection is already committed. This no-network repair is
        // idempotent, and the cron repeats it if this request stops here.
        await input.repository.enqueueFutureConfirmedEvents({
          producerId: options.producerId,
          now: now(),
          limit: 100,
        });
      } catch {
        // The durable cron repair closes this post-commit gap.
      }
    },

    async disconnect(producerId: string): Promise<void> {
      const connection = await input.repository.getConnection(producerId);
      if (!connection || connection.status === "disconnected") return;
      const tokens: string[] = [];
      if (connection.refreshToken) {
        try {
          tokens.push(
            decryptGoogleCalendarValue(
              connection.refreshToken,
              credentialContext(connection, "refresh_token"),
              input.config.encryption,
            ),
          );
        } catch {
          // Try the access token independently if this old envelope is corrupt.
        }
      }
      if (connection.accessToken) {
        try {
          tokens.push(
            decryptGoogleCalendarValue(
              connection.accessToken,
              credentialContext(connection, "access_token"),
              input.config.encryption,
            ),
          );
        } catch {
          // Local disconnect still wins when a protected token cannot be opened.
        }
      }
      await Promise.allSettled(
        [...new Set(tokens)].map((token) => input.provider.revokeToken(token)),
      );
      const disconnected = await input.repository.disconnect({
        producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
        disconnectedAt: now(),
      });
      if (!disconnected) throw new GoogleCalendarServiceError("stale_connection");
    },
  };
}

export type GoogleCalendarService = ReturnType<typeof createGoogleCalendarService>;
