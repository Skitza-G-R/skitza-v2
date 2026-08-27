import { randomUUID } from "node:crypto";

import { googleCalendarWebhookAddress, type GoogleCalendarServerConfig } from "./config";
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
  isGoogleCalendarOAuthBrowserBinding,
  verifyGoogleCalendarOAuthState,
  type GoogleCalendarOAuthIntent,
} from "./oauth";
import {
  GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS,
  GOOGLE_CALENDAR_WATCH_MAX_TTL_SECONDS,
  GoogleCalendarProviderError,
  hasRequiredGoogleCalendarScopes,
  type GoogleCalendarAccessRole,
  type GoogleCalendarProvider,
} from "./provider";
import type { GoogleCalendarBusyInterval } from "./freebusy";
import type {
  GoogleCalendarCandidateRecord,
  GoogleCalendarConnectionRecord,
  GoogleCalendarConnectionSyncSummary,
  GoogleCalendarConnectionStatus,
  GoogleCalendarRepository,
  GoogleCalendarStoredWatchRecord,
  GoogleCalendarWatchTarget,
} from "./repository";
import {
  GOOGLE_CALENDAR_WATCH_RENEW_BEFORE_MS,
  createGoogleCalendarWatchCredentials,
} from "./watch";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;
const STALE_WATCH_RESERVATION_MS = 15 * 60_000;
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
      syncSummary: GoogleCalendarConnectionSyncSummary;
    }>;

export type GoogleCalendarWatchEnsureResult = "active" | "created" | "unavailable";

export type GoogleCalendarWatchRenewalResult = Readonly<{
  scanned: number;
  renewed: number;
  active: number;
  failed: number;
}>;

export type GoogleCalendarWatchMaintenanceResult = Readonly<{
  scanned: number;
  created: number;
  renewed: number;
  active: number;
  failed: number;
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
  // SK-280: a producer with no Google connection has nothing to protect.
  // Reporting "skitza_only" made every booking surface nag about reduced
  // protection and forced an extra review click on studios that never
  // connected Google. Degraded-but-connected states stay "skitza_only".
  return {
    protection: health === "not_connected" ? "google_aware" : "skitza_only",
    health,
    intervals: [],
  };
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

  function watchTargetCalendarId(target: GoogleCalendarWatchTarget): string {
    return decryptGoogleCalendarValue(
      target.destinationCalendarId,
      {
        producerId: target.producerId,
        connectionId: target.connectionId,
        selectionId: target.destinationSelectionId,
        accountVersion: target.accountVersion,
        purpose: "provider_calendar_id",
      },
      input.config.encryption,
    );
  }

  async function stopChannelBestEffort(
    accessToken: string,
    watch: GoogleCalendarStoredWatchRecord,
  ): Promise<boolean> {
    if (!watch.providerResourceId) return false;
    try {
      await input.provider.stopChannel(accessToken, {
        channelId: watch.providerChannelId,
        resourceId: watch.providerResourceId,
      });
      return true;
    } catch {
      return false;
    }
  }

  async function createOrRenewDestinationWatch(
    connection: GoogleCalendarConnectionRecord,
    target: GoogleCalendarWatchTarget,
    accessToken: string,
    predecessor: GoogleCalendarStoredWatchRecord | null,
  ): Promise<GoogleCalendarWatchEnsureResult> {
    const reservedAt = now();
    const credentials = createGoogleCalendarWatchCredentials();
    const watchId = randomUUID();
    let reserved: GoogleCalendarStoredWatchRecord | null;
    try {
      reserved = await input.repository.reserveCalendarWatch({
        id: watchId,
        producerId: connection.producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
        destinationSelectionId: target.destinationSelectionId,
        destinationCalendarId: target.destinationCalendarId,
        destinationCalendarIdFingerprint: target.destinationCalendarIdFingerprint,
        renewalOfWatchId: predecessor?.id ?? null,
        providerChannelId: credentials.channelId,
        channelTokenDigest: credentials.channelTokenDigest,
        reservedAt,
      });
    } catch {
      return "unavailable";
    }
    if (!reserved) return "unavailable";

    let providerWatch: Awaited<ReturnType<GoogleCalendarProvider["watchEvents"]>> | null = null;
    try {
      providerWatch = await input.provider.watchEvents(accessToken, {
        calendarId: watchTargetCalendarId(target),
        channelId: credentials.channelId,
        address: googleCalendarWebhookAddress(input.config),
        token: credentials.channelToken,
        ttlSeconds: GOOGLE_CALENDAR_WATCH_MAX_TTL_SECONDS,
      });
      const activatedAt = now();
      const activated = await input.repository.activateCalendarWatch({
        producerId: connection.producerId,
        watchId,
        providerResourceId: providerWatch.resourceId,
        expiresAt: providerWatch.expiresAt,
        activatedAt,
      });
      if (!activated) {
        await Promise.allSettled([
          input.provider.stopChannel(accessToken, {
            channelId: providerWatch.channelId,
            resourceId: providerWatch.resourceId,
          }),
          input.repository.endCalendarWatch({
            producerId: connection.producerId,
            watchId,
            state: "retired",
            errorCode: predecessor ? "watch_renew_failed" : "watch_create_failed",
            endedAt: activatedAt,
          }),
        ]);
        return "unavailable";
      }
      if (predecessor) {
        await stopChannelBestEffort(accessToken, predecessor);
      }
      return "created";
    } catch (error) {
      const cleanup: Promise<unknown>[] = [
        input.repository.endCalendarWatch({
          producerId: connection.producerId,
          watchId,
          state: "retired",
          errorCode: predecessor ? "watch_renew_failed" : "watch_create_failed",
          endedAt: now(),
        }),
      ];
      if (providerWatch) {
        cleanup.push(
          input.provider.stopChannel(accessToken, {
            channelId: providerWatch.channelId,
            resourceId: providerWatch.resourceId,
          }),
        );
      }
      await Promise.allSettled(cleanup);
      if (error instanceof GoogleCalendarProviderError && error.code === "access_unauthorized") {
        await Promise.allSettled([
          input.repository.markReconnectRequired({
            producerId: connection.producerId,
            connectionId: connection.id,
            accountVersion: connection.accountVersion,
            errorCode: "access_unauthorized",
            occurredAt: now(),
          }),
        ]);
      }
      return "unavailable";
    }
  }

  type RequiredWatchMaintenanceRun = Readonly<{
    outcome: GoogleCalendarWatchEnsureResult;
    targetOutcomes: ReadonlyMap<string, GoogleCalendarWatchEnsureResult>;
    retiredFingerprints: ReadonlySet<string>;
  }>;

  async function ensureRequiredWatches(
    connection: GoogleCalendarConnectionRecord,
    accessToken?: string,
  ): Promise<RequiredWatchMaintenanceRun> {
    const targetOutcomes = new Map<string, GoogleCalendarWatchEnsureResult>();
    const retiredFingerprints = new Set<string>();
    if (connection.status !== "connected") {
      return { outcome: "unavailable", targetOutcomes, retiredFingerprints };
    }
    const currentTime = now();
    const [targets, watches] = await Promise.all([
      input.repository.listRequiredCalendarWatchTargets({
        producerId: connection.producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
        now: currentTime,
      }),
      input.repository.listCalendarWatches({
        producerId: connection.producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
      }),
    ]);
    const requiredFingerprints = new Set(
      targets.map((target) => target.destinationCalendarIdFingerprint),
    );
    let token = accessToken;
    async function accessTokenForMaintenance(): Promise<string> {
      token ??= await activeAccessToken(connection);
      return token;
    }

    for (const target of targets) {
      const fingerprint = target.destinationCalendarIdFingerprint;
      const sameDestination = watches.filter(
        (watch) => watch.destinationCalendarIdFingerprint === fingerprint,
      );
      const renewing = sameDestination.find((watch) => watch.state === "renewing");
      if (renewing) {
        if (currentTime.getTime() - renewing.createdAt.getTime() < STALE_WATCH_RESERVATION_MS) {
          targetOutcomes.set(fingerprint, "active");
          continue;
        }
        await input.repository.endCalendarWatch({
          producerId: renewing.producerId,
          watchId: renewing.id,
          state: "retired",
          errorCode: renewing.renewalOfWatchId ? "watch_renew_failed" : "watch_create_failed",
          endedAt: currentTime,
        });
      }
      const active = sameDestination.find((watch) => watch.state === "active") ?? null;
      if (
        active?.expiresAt &&
        active.expiresAt.getTime() > currentTime.getTime() + GOOGLE_CALENDAR_WATCH_RENEW_BEFORE_MS
      ) {
        targetOutcomes.set(fingerprint, "active");
        continue;
      }
      let maintenanceToken: string;
      try {
        maintenanceToken = await accessTokenForMaintenance();
      } catch {
        targetOutcomes.set(fingerprint, "unavailable");
        continue;
      }
      const result = await createOrRenewDestinationWatch(
        connection,
        target,
        maintenanceToken,
        active,
      );
      if (
        result === "unavailable" &&
        active?.expiresAt &&
        active.expiresAt.getTime() <= currentTime.getTime()
      ) {
        await input.repository.endCalendarWatch({
          producerId: active.producerId,
          watchId: active.id,
          state: "expired",
          errorCode: "watch_renew_failed",
          endedAt: now(),
        });
      }
      targetOutcomes.set(fingerprint, result);
    }

    let retirementFailed = false;
    const staleFingerprints = [
      ...new Set(
        watches
          .filter((watch) => !requiredFingerprints.has(watch.destinationCalendarIdFingerprint))
          .map((watch) => watch.destinationCalendarIdFingerprint),
      ),
    ];
    for (const fingerprint of staleFingerprints) {
      let fingerprintRetired = true;
      for (const watch of watches.filter(
        (candidate) => candidate.destinationCalendarIdFingerprint === fingerprint,
      )) {
        let stopped = watch.providerResourceId === null;
        if (!stopped) {
          try {
            stopped = await stopChannelBestEffort(await accessTokenForMaintenance(), watch);
          } catch {
            stopped = false;
          }
        }
        const ended = await input.repository.endCalendarWatch({
          producerId: watch.producerId,
          watchId: watch.id,
          state: "retired",
          errorCode: stopped ? null : "watch_stop_failed",
          endedAt: now(),
        });
        fingerprintRetired &&= ended;
      }
      if (fingerprintRetired) {
        retiredFingerprints.add(fingerprint);
      } else {
        retirementFailed = true;
      }
    }

    const outcomes = [...targetOutcomes.values()];
    const outcome =
      targets.length === 0 ||
      retirementFailed ||
      outcomes.some((candidate) => candidate === "unavailable")
        ? "unavailable"
        : outcomes.some((candidate) => candidate === "created")
          ? "created"
          : "active";
    return { outcome, targetOutcomes, retiredFingerprints };
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
        browserBinding: string;
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
        browserBinding: options.browserBinding,
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
        producerId?: string;
        stateToken: string;
        browserBinding: string;
        code?: string;
        providerError?: string;
      }>,
    ): Promise<GoogleCalendarOAuthCompletion> {
      if (
        !options.stateToken ||
        options.stateToken.length > 1_024 ||
        !isGoogleCalendarOAuthBrowserBinding(options.browserBinding) ||
        (options.code !== undefined &&
          (!options.code || Buffer.byteLength(options.code, "utf8") > 4_096)) ||
        (options.providerError !== undefined &&
          (!options.providerError || options.providerError.length > 128))
      ) {
        throw new GoogleCalendarServiceError("state_invalid");
      }
      const consumedAt = now();
      const tokenDigest = digestGoogleCalendarOAuthStateToken(options.stateToken);
      const pendingState = await input.repository.getOAuthState({ tokenDigest, now: consumedAt });
      if (
        !pendingState ||
        (options.producerId !== undefined && options.producerId !== pendingState.producerId)
      ) {
        throw new GoogleCalendarServiceError("state_invalid");
      }
      try {
        verifyGoogleCalendarOAuthState({
          token: options.stateToken,
          tokenDigest: pendingState.tokenDigest,
          binding: pendingState,
          browserBinding: options.browserBinding,
          stateSecret: input.config.stateSecret,
          now: consumedAt,
        });
      } catch {
        throw new GoogleCalendarServiceError("state_invalid");
      }
      const state = await input.repository.consumeOAuthState({
        producerId: pendingState.producerId,
        tokenDigest,
        consumedAt,
      });
      if (!state) throw new GoogleCalendarServiceError("state_invalid");
      const producerId = state.producerId;
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
        producerId,
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

      const current = await input.repository.getConnection(producerId);
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
        producerId,
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
        producerId,
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
        (await input.repository.getConnection(producerId)) ?? committed.connection;
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
      const syncSummary = await input.repository.getConnectionSyncSummary({
        producerId,
        connectionId: connection.id,
        accountVersion: connection.accountVersion,
      });
      if (connection.status === "disconnected") {
        return {
          status: "disconnected",
          connectionId: connection.id,
          accountEmail: connection.googleAccountEmail,
          calendars: [],
          syncSummary,
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
          syncSummary,
        };
      }
      return {
        status: snapshotConnection.status,
        connectionId: snapshotConnection.id,
        accountEmail: snapshotConnection.googleAccountEmail,
        calendars: calendars.map(publicCandidate),
        syncSummary,
      };
    },

    async listCalendars(producerId: string): Promise<readonly GoogleCalendarPublicCandidate[]> {
      const connection = await loadUsableConnection(producerId);
      const accessToken = await activeAccessToken(connection);
      const candidates = await replaceCandidates(connection, accessToken);
      return candidates.map(publicCandidate);
    },

    async ensureWatch(producerId: string): Promise<GoogleCalendarWatchEnsureResult> {
      try {
        const connection = await input.repository.getConnection(producerId);
        if (!connection || connection.status !== "connected") return "unavailable";
        return (await ensureRequiredWatches(connection)).outcome;
      } catch {
        return "unavailable";
      }
    },

    async renewWatches(
      options: Readonly<{ limit?: number }> = {},
    ): Promise<GoogleCalendarWatchRenewalResult> {
      const limit = options.limit ?? 25;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
        throw new GoogleCalendarServiceError("provider_unavailable");
      }
      const due = await input.repository.listCalendarWatchesDueForRenewal({
        renewBefore: new Date(now().getTime() + GOOGLE_CALENDAR_WATCH_RENEW_BEFORE_MS),
        limit,
      });
      const runs = new Map<string, RequiredWatchMaintenanceRun>();
      await Promise.all(
        [...new Set(due.map((watch) => watch.producerId))].map(async (producerId) => {
          try {
            const connection = await input.repository.getConnection(producerId);
            if (
              !connection ||
              connection.status !== "connected" ||
              due.some(
                (watch) =>
                  watch.producerId === producerId &&
                  (connection.id !== watch.connectionId ||
                    connection.accountVersion !== watch.accountVersion),
              )
            ) {
              return;
            }
            runs.set(producerId, await ensureRequiredWatches(connection));
          } catch {
            // Missing runs are mapped to a safe unavailable result below.
          }
        }),
      );
      const outcomes = due.map((watch): GoogleCalendarWatchEnsureResult => {
        const run = runs.get(watch.producerId);
        return (
          run?.targetOutcomes.get(watch.destinationCalendarIdFingerprint) ??
          (run?.retiredFingerprints.has(watch.destinationCalendarIdFingerprint)
            ? "active"
            : "unavailable")
        );
      });
      return {
        scanned: outcomes.length,
        renewed: outcomes.filter((outcome) => outcome === "created").length,
        active: outcomes.filter((outcome) => outcome === "active").length,
        failed: outcomes.filter((outcome) => outcome === "unavailable").length,
      };
    },

    async maintainWatches(
      options: Readonly<{ limit?: number }> = {},
    ): Promise<GoogleCalendarWatchMaintenanceResult> {
      const limit = options.limit ?? 25;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
        throw new GoogleCalendarServiceError("provider_unavailable");
      }
      const maintenanceNow = now();
      const [due, repairProducerIds] = await Promise.all([
        input.repository.listCalendarWatchesDueForRenewal({
          renewBefore: new Date(maintenanceNow.getTime() + GOOGLE_CALENDAR_WATCH_RENEW_BEFORE_MS),
          limit,
        }),
        input.repository.listCalendarWatchRepairProducerIds({ now: maintenanceNow, limit }),
      ]);
      const dueProducerIds = new Set(due.map((watch) => watch.producerId));
      const producerIds = [...new Set([...dueProducerIds, ...repairProducerIds])].slice(0, limit);
      const outcomes = await Promise.all(
        producerIds.map(async (producerId) => {
          let outcome: GoogleCalendarWatchEnsureResult = "unavailable";
          try {
            const connection = await input.repository.getConnection(producerId);
            if (connection?.status === "connected") {
              outcome = (await ensureRequiredWatches(connection)).outcome;
            }
          } catch {
            outcome = "unavailable";
          }
          return { producerId, outcome };
        }),
      );
      return {
        scanned: outcomes.length,
        created: outcomes.filter(
          ({ producerId, outcome }) => outcome === "created" && !dueProducerIds.has(producerId),
        ).length,
        renewed: outcomes.filter(
          ({ producerId, outcome }) => outcome === "created" && dueProducerIds.has(producerId),
        ).length,
        active: outcomes.filter(({ outcome }) => outcome === "active").length,
        failed: outcomes.filter(({ outcome }) => outcome === "unavailable").length,
      };
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
        // SK-280: Google freeBusy rejects >50 calendars; accepting more here
        // silently disabled conflict checking forever while the panel kept
        // showing a healthy "Connected" state. Enforce the provider limit at
        // save time instead of failing open at read time.
        availabilityCalendarIds.length > GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS ||
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
      // Selection is already committed. Both repairs are idempotent and the
      // cron repeats them if this request stops after the commit.
      await Promise.allSettled([
        input.repository.enqueueFutureConfirmedEvents({
          producerId: options.producerId,
          now: now(),
          limit: 100,
        }),
        ensureRequiredWatches({ ...connection, status: "connected" }, accessToken),
      ]);
    },

    async disconnect(producerId: string): Promise<void> {
      const connection = await input.repository.getConnection(producerId);
      if (!connection || connection.status === "disconnected") return;
      const tokens: string[] = [];
      let watchAccessToken: string | null = null;
      let watches: readonly GoogleCalendarStoredWatchRecord[] = [];
      try {
        [watchAccessToken, watches] = await Promise.all([
          activeAccessToken(connection),
          input.repository.listCalendarWatches({
            producerId,
            connectionId: connection.id,
            accountVersion: connection.accountVersion,
          }),
        ]);
      } catch {
        try {
          watches = await input.repository.listCalendarWatches({
            producerId,
            connectionId: connection.id,
            accountVersion: connection.accountVersion,
          });
        } catch {
          watches = [];
        }
      }
      if (watchAccessToken) {
        tokens.push(watchAccessToken);
        await Promise.allSettled(
          watches.map((watch) => stopChannelBestEffort(watchAccessToken, watch)),
        );
      }
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
