import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarServerConfig } from "./config";
import { decryptGoogleCalendarValue } from "./crypto";
import { GoogleCalendarProviderError, type GoogleCalendarProvider } from "./provider";
import type {
  GoogleCalendarCandidateRecord,
  GoogleCalendarConnectionRecord,
  GoogleCalendarRepository,
  GoogleCalendarStoredWatchRecord,
  GoogleCalendarStoredOAuthState,
  GoogleCalendarWatchTarget,
} from "./repository";
import {
  GoogleCalendarServiceError,
  createGoogleCalendarService as createGoogleCalendarServiceImpl,
} from "./service";

const PRODUCER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PRODUCER_ID = "22222222-2222-4222-8222-222222222222";
const BROWSER_BINDING = "a".repeat(43);
const FORWARDED_BROWSER_BINDING = "b".repeat(43);
const ALL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;
const STATE_SECRET = randomBytes(32);
const ENCRYPTION_KEY = randomBytes(32);
const FINGERPRINT_SECRET = randomBytes(32);
const CONFIG = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://preview.test/api/integrations/google-calendar/callback",
  stateSecret: STATE_SECRET,
  encryption: { activeVersion: 1, keys: new Map([[1, ENCRYPTION_KEY]]) },
  calendarIdFingerprintSecret: FINGERPRINT_SECRET,
} satisfies GoogleCalendarServerConfig;

function createGoogleCalendarService(input: Parameters<typeof createGoogleCalendarServiceImpl>[0]) {
  const service = createGoogleCalendarServiceImpl({
    now: () => new Date("2026-08-09T10:00:00.000Z"),
    ...input,
  });
  type BeginInput = Parameters<typeof service.beginOAuth>[0];
  type CompleteInput = Parameters<typeof service.completeOAuth>[0];
  return {
    ...service,
    beginOAuth(
      options: Omit<BeginInput, "browserBinding"> & Partial<Pick<BeginInput, "browserBinding">>,
    ) {
      return service.beginOAuth({ browserBinding: BROWSER_BINDING, ...options });
    },
    completeOAuth(
      options: Omit<CompleteInput, "browserBinding"> &
        Partial<Pick<CompleteInput, "browserBinding">>,
    ) {
      return service.completeOAuth({ browserBinding: BROWSER_BINDING, ...options });
    },
  };
}

function isReady(rows: readonly GoogleCalendarCandidateRecord[]): boolean {
  return (
    rows.filter(
      (row) => row.isDestination && (row.accessRole === "writer" || row.accessRole === "owner"),
    ).length === 1 && rows.some((row) => row.blocksAvailability)
  );
}

class MemoryGoogleCalendarRepository implements GoogleCalendarRepository {
  connection: GoogleCalendarConnectionRecord | null = null;
  states = new Map<string, GoogleCalendarStoredOAuthState>();
  candidates: GoogleCalendarCandidateRecord[] = [];
  watches: GoogleCalendarStoredWatchRecord[] = [];
  linkedWatchTargets: GoogleCalendarWatchTarget[] = [];
  syncSummary = { syncing: 0, notSynced: 0, missing: 0, conflicts: 0, issues: [] };
  initialSyncCalls: Parameters<GoogleCalendarRepository["enqueueFutureConfirmedEvents"]>[0][] = [];

  async getConnection(producerId: string) {
    await Promise.resolve();
    return this.connection?.producerId === producerId ? this.connection : null;
  }

  async createOAuthState(state: Omit<GoogleCalendarStoredOAuthState, "consumedAt">) {
    await Promise.resolve();
    this.states.set(state.tokenDigest, { ...state, consumedAt: null });
  }

  async getOAuthState(input: { tokenDigest: string; now: Date }) {
    await Promise.resolve();
    const state = this.states.get(input.tokenDigest);
    if (!state || state.consumedAt !== null || state.expiresAt.getTime() <= input.now.getTime()) {
      return null;
    }
    return state;
  }

  async consumeOAuthState(input: { producerId: string; tokenDigest: string; consumedAt: Date }) {
    await Promise.resolve();
    const state = this.states.get(input.tokenDigest);
    if (
      !state ||
      state.producerId !== input.producerId ||
      state.consumedAt !== null ||
      state.expiresAt.getTime() <= input.consumedAt.getTime()
    ) {
      return null;
    }
    const consumed = { ...state, consumedAt: input.consumedAt };
    this.states.set(input.tokenDigest, consumed);
    return consumed;
  }

  async commitAuthorization(
    command: Parameters<GoogleCalendarRepository["commitAuthorization"]>[0],
  ) {
    await Promise.resolve();
    const existing = this.connection;
    if (!existing) {
      if (command.intent !== "connect" || !command.refreshToken) {
        return { outcome: command.refreshToken ? "stale" : "missing_refresh" } as const;
      }
      this.connection = {
        id: command.targetConnectionId,
        producerId: command.producerId,
        googleSubject: command.identity.googleSubject,
        googleAccountEmail: command.identity.googleAccountEmail,
        accountVersion: 1,
        status: "needs_selection",
        grantedScopes: command.grantedScopes,
        accessToken: command.accessToken,
        accessTokenExpiresAt: command.accessTokenExpiresAt,
        refreshToken: command.refreshToken,
        lastAuthorizedAt: command.authorizedAt,
        reconnectRequiredAt: null,
        disconnectedAt: null,
        lastErrorCode: null,
        createdAt: command.authorizedAt,
        updatedAt: command.authorizedAt,
      };
      return { outcome: "stored", connection: this.connection } as const;
    }
    if (
      existing.id !== command.expectedConnectionId ||
      existing.accountVersion !== command.expectedAccountVersion ||
      existing.id !== command.targetConnectionId ||
      (existing.status === "disconnected" &&
        (existing.disconnectedAt === null ||
          command.oauthStateCreatedAt.getTime() <= existing.disconnectedAt.getTime()))
    ) {
      return { outcome: "stale" } as const;
    }
    const changesSubject = existing.googleSubject !== command.identity.googleSubject;
    if (changesSubject && command.intent !== "switch_account") {
      return { outcome: "wrong_account" } as const;
    }
    if (
      command.targetAccountVersion !==
      (changesSubject ? existing.accountVersion + 1 : existing.accountVersion)
    ) {
      return { outcome: "stale" } as const;
    }
    const refreshToken = command.refreshToken ?? existing.refreshToken;
    if (!refreshToken || (changesSubject && !command.refreshToken)) {
      return { outcome: "missing_refresh" } as const;
    }
    if (changesSubject || existing.status === "disconnected") this.candidates = [];
    this.connection = {
      ...existing,
      googleSubject: command.identity.googleSubject,
      googleAccountEmail: command.identity.googleAccountEmail,
      accountVersion: command.targetAccountVersion,
      status: isReady(this.candidates) ? "connected" : "needs_selection",
      grantedScopes: command.grantedScopes,
      accessToken: command.accessToken,
      accessTokenExpiresAt: command.accessTokenExpiresAt,
      refreshToken,
      lastAuthorizedAt: command.authorizedAt,
      reconnectRequiredAt: null,
      disconnectedAt: null,
      lastErrorCode: null,
      updatedAt: command.authorizedAt,
    };
    return { outcome: "stored", connection: this.connection } as const;
  }

  async storeRefreshedAccessToken(
    command: Parameters<GoogleCalendarRepository["storeRefreshedAccessToken"]>[0],
  ) {
    await Promise.resolve();
    const connection = this.connection;
    if (
      !connection ||
      connection.id !== command.connectionId ||
      connection.producerId !== command.producerId ||
      connection.googleSubject !== command.googleSubject ||
      connection.accountVersion !== command.accountVersion ||
      connection.status === "reconnect_required" ||
      connection.status === "disconnected"
    ) {
      return false;
    }
    this.connection = {
      ...connection,
      accessToken: command.accessToken,
      accessTokenExpiresAt: command.accessTokenExpiresAt,
      grantedScopes: command.grantedScopes ?? connection.grantedScopes,
      updatedAt: command.refreshedAt,
    };
    return true;
  }

  async markReconnectRequired(
    command: Parameters<GoogleCalendarRepository["markReconnectRequired"]>[0],
  ) {
    await Promise.resolve();
    const connection = this.connection;
    if (
      !connection ||
      connection.id !== command.connectionId ||
      connection.accountVersion !== command.accountVersion ||
      connection.status === "disconnected"
    ) {
      return;
    }
    this.connection = {
      ...connection,
      status: "reconnect_required",
      reconnectRequiredAt: command.occurredAt,
      disconnectedAt: null,
      lastErrorCode: command.errorCode,
      updatedAt: command.occurredAt,
    };
  }

  async replaceCalendarCandidates(
    command: Parameters<GoogleCalendarRepository["replaceCalendarCandidates"]>[0],
  ) {
    await Promise.resolve();
    const connection = this.connection;
    if (
      !connection ||
      connection.id !== command.connectionId ||
      connection.accountVersion !== command.accountVersion ||
      connection.status === "disconnected" ||
      connection.status === "reconnect_required"
    ) {
      return null;
    }
    const existing = new Map(this.candidates.map((row) => [row.id, row]));
    this.candidates = command.candidates.map((candidate) => {
      const old = existing.get(candidate.id);
      return {
        ...candidate,
        isDestination:
          old?.isDestination === true &&
          (candidate.accessRole === "writer" || candidate.accessRole === "owner"),
        blocksAvailability: old?.blocksAvailability ?? false,
      };
    });
    if (connection.status === "connected" && !isReady(this.candidates)) {
      this.connection = {
        ...connection,
        status: "needs_selection",
        updatedAt: command.refreshedAt,
      };
    }
    return this.candidates;
  }

  async listCalendarCandidates(
    command: Parameters<GoogleCalendarRepository["listCalendarCandidates"]>[0],
  ) {
    await Promise.resolve();
    return this.candidates.filter(
      (row) =>
        row.connectionId === command.connectionId &&
        row.producerId === command.producerId &&
        row.accountVersion === command.accountVersion,
    );
  }

  async getConnectionSyncSummary() {
    await Promise.resolve();
    return this.syncSummary;
  }

  async listCalendarWatches(
    command: Parameters<GoogleCalendarRepository["listCalendarWatches"]>[0],
  ) {
    await Promise.resolve();
    return this.watches.filter(
      (watch) =>
        watch.producerId === command.producerId &&
        watch.connectionId === command.connectionId &&
        watch.accountVersion === command.accountVersion &&
        (watch.state === "renewing" || watch.state === "active"),
    );
  }

  async listRequiredCalendarWatchTargets(
    command: Parameters<GoogleCalendarRepository["listRequiredCalendarWatchTargets"]>[0],
  ) {
    await Promise.resolve();
    const current = this.candidates
      .filter(
        (candidate) =>
          candidate.producerId === command.producerId &&
          candidate.connectionId === command.connectionId &&
          candidate.accountVersion === command.accountVersion &&
          candidate.isDestination,
      )
      .map(
        (candidate): GoogleCalendarWatchTarget => ({
          producerId: candidate.producerId,
          connectionId: candidate.connectionId,
          accountVersion: candidate.accountVersion,
          destinationSelectionId: candidate.id,
          destinationCalendarId: candidate.providerCalendarId,
          destinationCalendarIdFingerprint: candidate.providerCalendarIdFingerprint,
        }),
      );
    const fingerprints = new Set<string>();
    return [...current, ...this.linkedWatchTargets]
      .filter(
        (target) =>
          target.producerId === command.producerId &&
          target.connectionId === command.connectionId &&
          target.accountVersion === command.accountVersion,
      )
      .filter((target) => {
        if (fingerprints.has(target.destinationCalendarIdFingerprint)) return false;
        fingerprints.add(target.destinationCalendarIdFingerprint);
        return true;
      });
  }

  async reserveCalendarWatch(
    command: Parameters<GoogleCalendarRepository["reserveCalendarWatch"]>[0],
  ) {
    await Promise.resolve();
    if (
      this.watches.some(
        (watch) =>
          watch.state === "renewing" &&
          watch.connectionId === command.connectionId &&
          watch.accountVersion === command.accountVersion &&
          watch.destinationCalendarIdFingerprint === command.destinationCalendarIdFingerprint,
      )
    ) {
      return null;
    }
    const watch: GoogleCalendarStoredWatchRecord = {
      id: command.id,
      producerId: command.producerId,
      connectionId: command.connectionId,
      accountVersion: command.accountVersion,
      destinationSelectionId: command.destinationSelectionId,
      destinationCalendarId: command.destinationCalendarId,
      destinationCalendarIdFingerprint: command.destinationCalendarIdFingerprint,
      renewalOfWatchId: command.renewalOfWatchId,
      providerChannelId: command.providerChannelId,
      providerResourceId: null,
      channelTokenDigest: command.channelTokenDigest,
      state: "renewing",
      expiresAt: null,
      activatedAt: null,
      endedAt: null,
      createdAt: command.reservedAt,
    };
    this.watches.push(watch);
    return watch;
  }

  async activateCalendarWatch(
    command: Parameters<GoogleCalendarRepository["activateCalendarWatch"]>[0],
  ) {
    await Promise.resolve();
    const index = this.watches.findIndex(
      (watch) => watch.id === command.watchId && watch.producerId === command.producerId,
    );
    const reserved = this.watches[index];
    if (!reserved || reserved.state !== "renewing") return false;
    this.watches = this.watches.map((watch) =>
      watch.id === reserved.renewalOfWatchId
        ? { ...watch, state: "retired", endedAt: command.activatedAt }
        : watch,
    );
    this.watches[index] = {
      ...reserved,
      providerResourceId: command.providerResourceId,
      state: "active",
      expiresAt: command.expiresAt,
      activatedAt: command.activatedAt,
    };
    return true;
  }

  async endCalendarWatch(command: Parameters<GoogleCalendarRepository["endCalendarWatch"]>[0]) {
    await Promise.resolve();
    const index = this.watches.findIndex(
      (watch) =>
        watch.id === command.watchId &&
        watch.producerId === command.producerId &&
        (watch.state === "renewing" || watch.state === "active"),
    );
    const watch = this.watches[index];
    if (!watch) return false;
    this.watches[index] = { ...watch, state: command.state, endedAt: command.endedAt };
    return true;
  }

  async listCalendarWatchesDueForRenewal(
    command: Parameters<GoogleCalendarRepository["listCalendarWatchesDueForRenewal"]>[0],
  ) {
    await Promise.resolve();
    return this.watches
      .filter(
        (watch) =>
          this.connection?.status === "connected" &&
          watch.producerId === this.connection.producerId &&
          watch.connectionId === this.connection.id &&
          watch.accountVersion === this.connection.accountVersion &&
          watch.state === "active" &&
          watch.expiresAt !== null &&
          watch.expiresAt.getTime() <= command.renewBefore.getTime(),
      )
      .slice(0, command.limit);
  }

  async listCalendarWatchRepairProducerIds(
    command: Parameters<GoogleCalendarRepository["listCalendarWatchRepairProducerIds"]>[0],
  ) {
    await Promise.resolve();
    const connection = this.connection;
    if (!connection || connection.status !== "connected") return [];
    const targets = await this.listRequiredCalendarWatchTargets({
      producerId: connection.producerId,
      connectionId: connection.id,
      accountVersion: connection.accountVersion,
      now: command.now,
    });
    const required = new Set(targets.map((target) => target.destinationCalendarIdFingerprint));
    const live = this.watches.filter(
      (watch) =>
        watch.producerId === connection.producerId &&
        watch.connectionId === connection.id &&
        watch.accountVersion === connection.accountVersion &&
        (watch.state === "renewing" || watch.state === "active"),
    );
    const needsRepair =
      targets.some(
        (target) =>
          !live.some(
            (watch) =>
              watch.destinationCalendarIdFingerprint === target.destinationCalendarIdFingerprint,
          ),
      ) || live.some((watch) => !required.has(watch.destinationCalendarIdFingerprint));
    return needsRepair ? [connection.producerId].slice(0, command.limit) : [];
  }

  async saveCalendarSelection(
    command: Parameters<GoogleCalendarRepository["saveCalendarSelection"]>[0],
  ) {
    await Promise.resolve();
    const connection = this.connection;
    if (
      !connection ||
      connection.id !== command.connectionId ||
      connection.accountVersion !== command.accountVersion ||
      connection.status === "disconnected" ||
      connection.status === "reconnect_required"
    ) {
      return "stale" as const;
    }
    const destination = this.candidates.find((row) => row.id === command.destinationCalendarId);
    const ids = new Set(this.candidates.map((row) => row.id));
    if (
      !destination ||
      (destination.accessRole !== "writer" && destination.accessRole !== "owner") ||
      command.availabilityCalendarIds.length < 1 ||
      command.availabilityCalendarIds.some((id) => !ids.has(id))
    ) {
      return "invalid_selection" as const;
    }
    const busy = new Set(command.availabilityCalendarIds);
    this.candidates = this.candidates.map((row) => ({
      ...row,
      isDestination: row.id === command.destinationCalendarId,
      blocksAvailability: busy.has(row.id),
    }));
    this.connection = {
      ...connection,
      status: "connected",
      updatedAt: command.savedAt,
    };
    return "saved" as const;
  }

  async enqueueFutureConfirmedEvents(
    input: Parameters<GoogleCalendarRepository["enqueueFutureConfirmedEvents"]>[0],
  ) {
    await Promise.resolve();
    this.initialSyncCalls.push(input);
    return { scanned: 0, linksCreated: 0, jobsEnqueued: 0, jobIds: [] } as const;
  }

  async disconnect(command: Parameters<GoogleCalendarRepository["disconnect"]>[0]) {
    await Promise.resolve();
    const connection = this.connection;
    if (!connection) return false;
    if (connection.status === "disconnected") return true;
    if (
      connection.id !== command.connectionId ||
      connection.accountVersion !== command.accountVersion
    ) {
      return false;
    }
    this.candidates = [];
    this.watches = this.watches.map((watch) =>
      watch.connectionId === connection.id &&
      watch.accountVersion === connection.accountVersion &&
      (watch.state === "renewing" || watch.state === "active")
        ? { ...watch, state: "retired", endedAt: command.disconnectedAt }
        : watch,
    );
    this.connection = {
      ...connection,
      status: "disconnected",
      accessToken: null,
      accessTokenExpiresAt: null,
      refreshToken: null,
      reconnectRequiredAt: null,
      disconnectedAt: command.disconnectedAt,
      lastErrorCode: null,
      updatedAt: command.disconnectedAt,
    };
    for (const [digest, state] of this.states) {
      if (state.connectionId === connection.id && state.consumedAt === null) {
        this.states.delete(digest);
      }
    }
    return true;
  }
}

function authorization(
  subject = "google-subject-a",
  refreshToken: string | null = "refresh-token-a",
) {
  return {
    identity: {
      googleSubject: subject,
      googleAccountEmail: `${subject}@example.com`,
    },
    tokens: {
      accessToken: `access-${subject}`,
      refreshToken,
      accessTokenExpiresAt: new Date("2026-08-09T11:00:00.000Z"),
      grantedScopes: ALL_SCOPES,
    },
  } as const;
}

function calendar(accessRole: "owner" | "reader" = "owner") {
  return [
    {
      providerCalendarId: "private-primary-calendar-id",
      displayName: "Studio calendar",
      timezone: "Asia/Jerusalem",
      accessRole,
      isPrimary: true,
    },
  ] as const;
}

function calendarsForDestinationSwitch() {
  return [
    ...calendar(),
    {
      providerCalendarId: "private-second-calendar-id",
      displayName: "Second studio calendar",
      timezone: "Asia/Jerusalem",
      accessRole: "owner",
      isPrimary: false,
    },
  ] as const;
}

function createProvider() {
  return {
    exchangeAuthorizationCode: vi.fn(() => Promise.resolve(authorization())),
    refreshAccessToken: vi.fn(() =>
      Promise.resolve({
        accessToken: "refreshed-access",
        accessTokenExpiresAt: new Date("2026-08-09T12:00:00.000Z"),
        grantedScopes: ALL_SCOPES,
      }),
    ),
    listCalendars: vi.fn<GoogleCalendarProvider["listCalendars"]>(() =>
      Promise.resolve(calendar()),
    ),
    queryFreeBusy: vi.fn<GoogleCalendarProvider["queryFreeBusy"]>(() =>
      Promise.resolve({
        busyIntervals: [],
        failedCalendarCount: 0,
      }),
    ),
    insertEvent: vi.fn<GoogleCalendarProvider["insertEvent"]>(),
    getEvent: vi.fn<GoogleCalendarProvider["getEvent"]>(),
    getLinkedEvent: vi.fn<GoogleCalendarProvider["getLinkedEvent"]>(),
    patchEvent: vi.fn<GoogleCalendarProvider["patchEvent"]>(),
    deleteEvent: vi.fn<GoogleCalendarProvider["deleteEvent"]>(),
    watchEvents: vi.fn<GoogleCalendarProvider["watchEvents"]>((_accessToken, input) =>
      Promise.resolve({
        channelId: input.channelId,
        resourceId: "opaque-resource-id",
        expiresAt: new Date("2026-08-16T10:00:00.000Z"),
      }),
    ),
    stopChannel: vi.fn<GoogleCalendarProvider["stopChannel"]>(),
    revokeToken: vi.fn(() => Promise.resolve()),
  } satisfies GoogleCalendarProvider;
}

function stateFrom(start: { authorizationUrl: string }): string {
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  if (!state) throw new Error("Missing test OAuth state");
  return state;
}

async function connect(service: ReturnType<typeof createGoogleCalendarService>) {
  const start = await service.beginOAuth({ producerId: PRODUCER_ID, intent: "connect" });
  return service.completeOAuth({
    producerId: PRODUCER_ID,
    stateToken: stateFrom(start),
    code: "code",
  });
}

function expectServiceError(error: unknown, code: string): boolean {
  return error instanceof GoogleCalendarServiceError && error.code === code;
}

function storedConnection(
  repository: MemoryGoogleCalendarRepository,
): GoogleCalendarConnectionRecord {
  const connection = repository.connection;
  if (!connection) throw new Error("Missing test connection");
  return connection;
}

function watchTarget(candidate: GoogleCalendarCandidateRecord): GoogleCalendarWatchTarget {
  return {
    producerId: candidate.producerId,
    connectionId: candidate.connectionId,
    accountVersion: candidate.accountVersion,
    destinationSelectionId: candidate.id,
    destinationCalendarId: candidate.providerCalendarId,
    destinationCalendarIdFingerprint: candidate.providerCalendarIdFingerprint,
  };
}

describe("Google Calendar service lifecycle", () => {
  it("rejects a forwarded authorization URL without consuming the initiating browser state", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    const start = await service.beginOAuth({
      producerId: PRODUCER_ID,
      intent: "connect",
      browserBinding: BROWSER_BINDING,
    });
    expect(start.authorizationUrl).not.toContain(BROWSER_BINDING);
    const stateToken = stateFrom(start);

    await expect(
      service.completeOAuth({
        stateToken,
        code: "authorization-code",
        browserBinding: FORWARDED_BROWSER_BINDING,
      }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "state_invalid"));
    expect(provider.exchangeAuthorizationCode).not.toHaveBeenCalled();

    await expect(
      service.completeOAuth({
        stateToken,
        code: "authorization-code",
        browserBinding: BROWSER_BINDING,
      }),
    ).resolves.toMatchObject({ status: "needs_selection" });
  });

  it("connects from a sessionless callback with one-time state and encrypted credentials", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    const start = await service.beginOAuth({ producerId: PRODUCER_ID, intent: "connect" });
    const result = await service.completeOAuth({
      stateToken: stateFrom(start),
      code: "authorization-code",
    });
    expect(result.status).toBe("needs_selection");
    expect(result.calendars[0]?.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.stringify(result)).not.toContain("private-primary-calendar-id");
    expect(repository.connection?.refreshToken?.ciphertext).not.toBe("refresh-token-a");
    const connection = repository.connection;
    if (!connection?.refreshToken) throw new Error("Missing protected refresh token");
    expect(
      decryptGoogleCalendarValue(
        connection.refreshToken,
        {
          producerId: PRODUCER_ID,
          connectionId: connection.id,
          googleSubject: connection.googleSubject,
          accountVersion: connection.accountVersion,
          purpose: "refresh_token",
        },
        CONFIG.encryption,
      ),
    ).toBe("refresh-token-a");
    await expect(
      service.completeOAuth({
        producerId: PRODUCER_ID,
        stateToken: stateFrom(start),
        code: "authorization-code",
      }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "state_invalid"));
  });

  it("keeps authenticated completion producer-scoped without consuming another producer's state", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    const start = await service.beginOAuth({ producerId: PRODUCER_ID, intent: "connect" });
    const stateToken = stateFrom(start);

    await expect(
      service.completeOAuth({
        producerId: OTHER_PRODUCER_ID,
        stateToken,
        code: "authorization-code",
      }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "state_invalid"));

    await expect(
      service.completeOAuth({ stateToken, code: "authorization-code" }),
    ).resolves.toMatchObject({ status: "needs_selection" });
  });

  it("revokes exchanged credentials when the atomic commit finds a closed Producer", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    const start = await service.beginOAuth({ producerId: PRODUCER_ID, intent: "connect" });
    const commit = vi
      .spyOn(repository, "commitAuthorization")
      .mockResolvedValueOnce({ outcome: "stale" });

    await expect(
      service.completeOAuth({ stateToken: stateFrom(start), code: "authorization-code" }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "stale_connection"));

    expect(commit).toHaveBeenCalledOnce();
    expect(repository.connection).toBeNull();
    expect(provider.revokeToken).toHaveBeenCalledWith("refresh-token-a");
    expect(provider.revokeToken).toHaveBeenCalledWith("access-google-subject-a");
  });

  it("rejects an expired sessionless callback before provider exchange", async () => {
    let clock = new Date("2026-08-09T10:00:00.000Z");
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date(clock),
    });
    const start = await service.beginOAuth({ producerId: PRODUCER_ID, intent: "connect" });
    clock = new Date(clock.getTime() + 11 * 60 * 1_000);

    await expect(
      service.completeOAuth({ stateToken: stateFrom(start), code: "authorization-code" }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "state_invalid"));
    expect(provider.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("revokes a different account and leaves the old connection untouched", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    await connect(service);
    const before = repository.connection;
    const start = await service.beginOAuth({ producerId: PRODUCER_ID, intent: "reconnect" });
    provider.exchangeAuthorizationCode.mockResolvedValueOnce(
      authorization("google-subject-b", "refresh-token-b"),
    );
    await expect(
      service.completeOAuth({
        producerId: PRODUCER_ID,
        stateToken: stateFrom(start),
        code: "code",
      }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "wrong_account"));
    expect(repository.connection).toBe(before);
    expect(provider.revokeToken).toHaveBeenCalledWith("refresh-token-b");
    expect(provider.revokeToken).toHaveBeenCalledWith("access-google-subject-b");
  });

  it("rejects a callback started before disconnect and accepts a later same-account Connect", async () => {
    let clock = new Date("2026-08-09T10:00:00.000Z");
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date(clock),
    });
    await connect(service);
    const staleStart = await service.beginOAuth({
      producerId: PRODUCER_ID,
      intent: "reconnect",
    });
    clock = new Date(clock.getTime() + 1_000);
    await service.disconnect(PRODUCER_ID);
    await expect(
      service.completeOAuth({
        producerId: PRODUCER_ID,
        stateToken: stateFrom(staleStart),
        code: "code",
      }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "state_invalid"));

    clock = new Date(clock.getTime() + 1_000);
    const reconnectStart = await service.beginOAuth({
      producerId: PRODUCER_ID,
      intent: "connect",
    });
    const pending = [...repository.states.values()].find((state) => state.consumedAt === null);
    expect(pending?.intent).toBe("reconnect");
    await service.completeOAuth({
      producerId: PRODUCER_ID,
      stateToken: stateFrom(reconnectStart),
      code: "code",
    });
    expect(repository.connection?.status).toBe("needs_selection");
    expect(repository.connection?.accountVersion).toBe(1);
  });

  it("rejects a callback already in flight when disconnect happens during Google exchange", async () => {
    let clock = new Date("2026-08-09T10:00:00.000Z");
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date(clock),
    });
    await connect(service);
    const start = await service.beginOAuth({
      producerId: PRODUCER_ID,
      intent: "reconnect",
    });
    const exchangeGate: {
      resolve: (value: ReturnType<typeof authorization>) => void;
    } = {
      resolve: () => {
        throw new Error("Test exchange was not waiting");
      },
    };
    provider.exchangeAuthorizationCode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          exchangeGate.resolve = resolve;
        }),
    );
    const completion = service.completeOAuth({
      producerId: PRODUCER_ID,
      stateToken: stateFrom(start),
      code: "code",
    });
    await vi.waitFor(() => {
      expect(provider.exchangeAuthorizationCode).toHaveBeenCalledTimes(2);
    });
    clock = new Date(clock.getTime() + 1_000);
    await service.disconnect(PRODUCER_ID);
    exchangeGate.resolve(authorization());
    await expect(completion).rejects.toSatisfy((error: unknown) =>
      expectServiceError(error, "stale_connection"),
    );
    expect(repository.connection?.status).toBe("disconnected");
  });

  it("allows only a confirmed switch to replace a retained disconnected account", async () => {
    let clock = new Date("2026-08-09T10:00:00.000Z");
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date(clock),
    });
    await connect(service);
    clock = new Date(clock.getTime() + 1_000);
    await service.disconnect(PRODUCER_ID);
    await expect(service.status(PRODUCER_ID)).resolves.toMatchObject({
      status: "disconnected",
      accountEmail: "google-subject-a@example.com",
      calendars: [],
    });
    await expect(
      service.beginOAuth({
        producerId: PRODUCER_ID,
        intent: "switch_account",
      }),
    ).rejects.toSatisfy((error: unknown) =>
      expectServiceError(error, "switch_confirmation_required"),
    );
    clock = new Date(clock.getTime() + 1_000);
    const start = await service.beginOAuth({
      producerId: PRODUCER_ID,
      intent: "switch_account",
      switchConfirmed: true,
    });
    provider.exchangeAuthorizationCode.mockResolvedValueOnce(
      authorization("google-subject-b", "refresh-token-b"),
    );
    await service.completeOAuth({
      producerId: PRODUCER_ID,
      stateToken: stateFrom(start),
      code: "code",
    });
    expect(repository.connection?.googleSubject).toBe("google-subject-b");
    expect(repository.connection?.accountVersion).toBe(2);
  });

  it("does not reuse a refresh token already rejected with invalid_grant", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    await connect(service);
    const connection = repository.connection;
    if (!connection) throw new Error("Missing test connection");
    repository.connection = {
      ...connection,
      status: "reconnect_required",
      reconnectRequiredAt: new Date(),
      lastErrorCode: "refresh_invalid_grant",
    };
    const start = await service.beginOAuth({ producerId: PRODUCER_ID, intent: "reconnect" });
    provider.exchangeAuthorizationCode.mockResolvedValueOnce(
      authorization("google-subject-a", null),
    );
    await expect(
      service.completeOAuth({
        producerId: PRODUCER_ID,
        stateToken: stateFrom(start),
        code: "code",
      }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "refresh_token_missing"));
    expect(storedConnection(repository).status).toBe("reconnect_required");
  });

  it("marks invalid refresh credentials for reconnect", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    await connect(service);
    const connection = repository.connection;
    if (!connection) throw new Error("Missing test connection");
    repository.connection = {
      ...connection,
      accessTokenExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
    };
    provider.refreshAccessToken.mockRejectedValueOnce(
      new GoogleCalendarProviderError("refresh_invalid_grant"),
    );
    await expect(service.listCalendars(PRODUCER_ID)).rejects.toSatisfy((error: unknown) =>
      expectServiceError(error, "reconnect_required"),
    );
    expect(storedConnection(repository).status).toBe("reconnect_required");
    expect(storedConnection(repository).lastErrorCode).toBe("refresh_invalid_grant");
  });

  it("refreshes CalendarList before save and rejects a destination that lost write access", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });
    const connected = await connect(service);
    const calendarId = connected.calendars[0]?.id;
    if (!calendarId) throw new Error("Missing test calendar");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: calendarId,
      availabilityCalendarIds: [calendarId],
    });
    expect(repository.connection?.status).toBe("connected");
    expect(repository.initialSyncCalls).toEqual([
      expect.objectContaining({ producerId: PRODUCER_ID, limit: 100 }),
    ]);
    expect(provider.watchEvents).toHaveBeenCalledWith(
      "access-google-subject-a",
      expect.objectContaining({
        calendarId: "private-primary-calendar-id",
        address: "https://preview.test/api/webhooks/google-calendar",
      }),
    );
    expect(repository.watches.filter((watch) => watch.state === "active")).toHaveLength(1);
    provider.listCalendars.mockResolvedValueOnce(calendar("reader"));
    await expect(
      service.saveSelection({
        producerId: PRODUCER_ID,
        destinationCalendarId: calendarId,
        availabilityCalendarIds: [calendarId],
      }),
    ).rejects.toSatisfy((error: unknown) => expectServiceError(error, "invalid_selection"));
    expect(repository.connection?.status).toBe("needs_selection");
  });

  it("renews an expiring watch before stopping its predecessor", async () => {
    let clock = new Date("2026-08-09T10:00:00.000Z");
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date(clock),
    });
    const connected = await connect(service);
    const calendarId = connected.calendars[0]?.id;
    if (!calendarId) throw new Error("Missing test calendar");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: calendarId,
      availabilityCalendarIds: [calendarId],
    });
    const predecessor = repository.watches.find((watch) => watch.state === "active");
    if (!predecessor?.providerResourceId) throw new Error("Missing active watch");

    clock = new Date("2026-08-15T10:00:00.000Z");
    provider.watchEvents.mockImplementationOnce((_accessToken, input) =>
      Promise.resolve({
        channelId: input.channelId,
        resourceId: "renewed-resource-id",
        expiresAt: new Date("2026-08-22T10:00:00.000Z"),
      }),
    );
    await expect(service.renewWatches()).resolves.toEqual({
      scanned: 1,
      renewed: 1,
      active: 0,
      failed: 0,
    });
    expect(provider.stopChannel).toHaveBeenCalledWith("refreshed-access", {
      channelId: predecessor.providerChannelId,
      resourceId: predecessor.providerResourceId,
    });
    expect(repository.watches.filter((watch) => watch.state === "active")).toHaveLength(1);
    expect(repository.watches.find((watch) => watch.id === predecessor.id)?.state).toBe("retired");
  });

  it("keeps and renews the prior destination while a future linked event still needs it", async () => {
    let clock = new Date("2026-08-09T10:00:00.000Z");
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    provider.listCalendars.mockResolvedValue(calendarsForDestinationSwitch());
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date(clock),
    });
    const connected = await connect(service);
    const firstId = connected.calendars[0]?.id;
    const secondId = connected.calendars[1]?.id;
    if (!firstId || !secondId) throw new Error("Missing destination-switch calendars");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: firstId,
      availabilityCalendarIds: [firstId],
    });
    const firstTargetCandidate = repository.candidates.find(
      (candidate) => candidate.id === firstId,
    );
    const predecessor = repository.watches.find((watch) => watch.state === "active");
    if (!firstTargetCandidate || !predecessor?.providerResourceId) {
      throw new Error("Missing first destination watch");
    }
    repository.linkedWatchTargets = [watchTarget(firstTargetCandidate)];

    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: secondId,
      availabilityCalendarIds: [secondId],
    });
    expect(repository.watches.filter((watch) => watch.state === "active")).toHaveLength(2);
    expect(provider.stopChannel).not.toHaveBeenCalled();

    const firstFingerprint = firstTargetCandidate.providerCalendarIdFingerprint;
    clock = new Date("2026-08-15T10:00:00.000Z");
    repository.watches = repository.watches.map((watch) =>
      watch.destinationCalendarIdFingerprint === firstFingerprint && watch.state === "active"
        ? { ...watch, expiresAt: new Date("2026-08-16T10:00:00.000Z") }
        : watch.state === "active"
          ? { ...watch, expiresAt: new Date("2026-08-30T10:00:00.000Z") }
          : watch,
    );
    provider.watchEvents.mockClear();
    provider.stopChannel.mockClear();
    provider.watchEvents.mockImplementationOnce((_accessToken, request) =>
      Promise.resolve({
        channelId: request.channelId,
        resourceId: "renewed-prior-destination-resource",
        expiresAt: new Date("2026-08-22T10:00:00.000Z"),
      }),
    );

    await expect(service.renewWatches()).resolves.toEqual({
      scanned: 1,
      renewed: 1,
      active: 0,
      failed: 0,
    });
    expect(provider.watchEvents).toHaveBeenCalledWith(
      "refreshed-access",
      expect.objectContaining({ calendarId: "private-primary-calendar-id" }),
    );
    expect(provider.stopChannel).toHaveBeenCalledWith("refreshed-access", {
      channelId: predecessor.providerChannelId,
      resourceId: predecessor.providerResourceId,
    });
    expect(
      repository.watches.filter(
        (watch) =>
          watch.state === "active" && watch.destinationCalendarIdFingerprint === firstFingerprint,
      ),
    ).toHaveLength(1);
  });

  it("retires the prior destination after its last future linked event is gone", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    provider.listCalendars.mockResolvedValue(calendarsForDestinationSwitch());
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });
    const connected = await connect(service);
    const firstId = connected.calendars[0]?.id;
    const secondId = connected.calendars[1]?.id;
    if (!firstId || !secondId) throw new Error("Missing destination-switch calendars");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: firstId,
      availabilityCalendarIds: [firstId],
    });
    const predecessor = repository.watches.find((watch) => watch.state === "active");
    if (!predecessor?.providerResourceId) throw new Error("Missing first destination watch");

    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: secondId,
      availabilityCalendarIds: [secondId],
    });

    expect(provider.stopChannel).toHaveBeenCalledWith("access-google-subject-a", {
      channelId: predecessor.providerChannelId,
      resourceId: predecessor.providerResourceId,
    });
    expect(repository.watches.find((watch) => watch.id === predecessor.id)?.state).toBe("retired");
    expect(repository.watches.filter((watch) => watch.state === "active")).toHaveLength(1);
  });

  it("rejects linked watch targets from another producer or account version", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    provider.listCalendars.mockResolvedValue(calendarsForDestinationSwitch());
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    const connected = await connect(service);
    const firstId = connected.calendars[0]?.id;
    const secondId = connected.calendars[1]?.id;
    if (!firstId || !secondId) throw new Error("Missing destination-switch calendars");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: firstId,
      availabilityCalendarIds: [firstId],
    });
    const firstTargetCandidate = repository.candidates.find(
      (candidate) => candidate.id === firstId,
    );
    const predecessor = repository.watches.find((watch) => watch.state === "active");
    if (!firstTargetCandidate || !predecessor) throw new Error("Missing first destination watch");
    const target = watchTarget(firstTargetCandidate);
    repository.linkedWatchTargets = [
      { ...target, producerId: "22222222-2222-4222-8222-222222222222" },
      { ...target, accountVersion: target.accountVersion + 1 },
    ];

    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: secondId,
      availabilityCalendarIds: [secondId],
    });

    expect(repository.watches.find((watch) => watch.id === predecessor.id)?.state).toBe("retired");
    expect(repository.watches.filter((watch) => watch.state === "active")).toHaveLength(1);
  });

  it("repairs a connected destination when post-selection watch creation was missed", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    const connected = await connect(service);
    const calendarId = connected.calendars[0]?.id;
    if (!calendarId) throw new Error("Missing test calendar");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: calendarId,
      availabilityCalendarIds: [calendarId],
    });
    repository.watches = repository.watches.map((watch) => ({
      ...watch,
      state: "retired",
      endedAt: new Date(),
    }));

    await expect(service.maintainWatches()).resolves.toEqual({
      scanned: 1,
      created: 1,
      renewed: 0,
      active: 0,
      failed: 0,
    });
    expect(repository.watches.filter((watch) => watch.state === "active")).toHaveLength(1);
  });

  it("returns only safe aggregate sync health", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    repository.syncSummary = {
      syncing: 2,
      notSynced: 1,
      missing: 3,
      conflicts: 4,
      issues: [],
    };
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    await connect(service);
    const snapshot = await service.status(PRODUCER_ID);
    expect(snapshot).toEqual(
      expect.objectContaining({
        syncSummary: { syncing: 2, notSynced: 1, missing: 3, conflicts: 4, issues: [] },
      }),
    );
    expect(JSON.stringify(snapshot)).not.toContain("providerEventId");
  });

  it("retries CalendarList from status when selection setup has no candidates", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    await connect(service);
    repository.candidates = [];
    const snapshot = await service.status(PRODUCER_ID);
    expect(snapshot.status).toBe("needs_selection");
    if (snapshot.status === "not_connected") throw new Error("Missing test snapshot");
    expect(snapshot.calendars).toHaveLength(1);
    expect(provider.listCalendars).toHaveBeenCalledTimes(2);
  });

  it("revokes any independently readable token and always completes local disconnect", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });
    const connected = await connect(service);
    const calendarId = connected.calendars[0]?.id;
    if (!calendarId) throw new Error("Missing test calendar");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: calendarId,
      availabilityCalendarIds: [calendarId],
    });
    const connection = repository.connection;
    if (!connection?.refreshToken) throw new Error("Missing test connection");
    repository.connection = {
      ...connection,
      refreshToken: { ...connection.refreshToken, authTag: "broken" },
    };
    provider.stopChannel.mockRejectedValueOnce(new Error("private provider failure"));
    provider.revokeToken.mockRejectedValueOnce(new Error("private provider failure"));
    await service.disconnect(PRODUCER_ID);
    expect(provider.stopChannel).toHaveBeenCalled();
    expect(provider.revokeToken).toHaveBeenCalledWith("access-google-subject-a");
    expect(storedConnection(repository).status).toBe("disconnected");
    expect(storedConnection(repository).accessToken).toBeNull();
    expect(storedConnection(repository).refreshToken).toBeNull();
  });
});

describe("Google Calendar FreeBusy service", () => {
  it("queries only selected busy calendars and returns fresh half-open UTC intervals", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    provider.listCalendars.mockResolvedValue([
      ...calendar(),
      {
        providerCalendarId: "private-busy-calendar-id",
        displayName: "Personal calendar",
        timezone: "America/New_York",
        accessRole: "reader",
        isPrimary: false,
      },
    ]);
    provider.queryFreeBusy.mockResolvedValue({
      busyIntervals: [
        {
          startsAt: new Date("2026-11-01T05:30:00.000Z"),
          endsAt: new Date("2026-11-01T06:30:00.000Z"),
        },
      ],
      failedCalendarCount: 0,
    });
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });
    const connected = await connect(service);
    const destinationId = connected.calendars[0]?.id;
    const busyId = connected.calendars[1]?.id;
    if (!destinationId || !busyId) throw new Error("Missing test calendars");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: destinationId,
      availabilityCalendarIds: [busyId],
    });

    const result = await service.busyIntervals({
      producerId: PRODUCER_ID,
      timeMin: new Date("2026-11-01T04:00:00.000Z"),
      timeMax: new Date("2026-11-01T08:00:00.000Z"),
    });

    expect(provider.queryFreeBusy).toHaveBeenCalledWith("access-google-subject-a", {
      calendarIds: ["private-busy-calendar-id"],
      timeMin: new Date("2026-11-01T04:00:00.000Z"),
      timeMax: new Date("2026-11-01T08:00:00.000Z"),
    });
    expect(result).toEqual({
      protection: "google_aware",
      health: "healthy",
      intervals: [
        {
          startsAt: new Date("2026-11-01T05:30:00.000Z"),
          endsAt: new Date("2026-11-01T06:30:00.000Z"),
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private-busy-calendar-id");
  });

  it("fails open for per-calendar errors and temporary provider failures", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });
    const connected = await connect(service);
    const selectedId = connected.calendars[0]?.id;
    if (!selectedId) throw new Error("Missing test calendar");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: selectedId,
      availabilityCalendarIds: [selectedId],
    });
    const window = {
      producerId: PRODUCER_ID,
      timeMin: new Date("2026-08-10T10:00:00.000Z"),
      timeMax: new Date("2026-08-10T11:00:00.000Z"),
    };

    provider.queryFreeBusy.mockResolvedValueOnce({
      busyIntervals: [
        {
          startsAt: new Date("2026-08-10T10:15:00.000Z"),
          endsAt: new Date("2026-08-10T10:45:00.000Z"),
        },
      ],
      failedCalendarCount: 1,
    });
    await expect(service.busyIntervals(window)).resolves.toEqual({
      protection: "skitza_only",
      health: "unavailable",
      intervals: [],
    });

    provider.queryFreeBusy.mockRejectedValueOnce(
      new GoogleCalendarProviderError("provider_unavailable"),
    );
    await expect(service.busyIntervals(window)).resolves.toEqual({
      protection: "skitza_only",
      health: "unavailable",
      intervals: [],
    });
  });

  it("marks revoked access for reconnect while always returning a fail-open result", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });
    const connected = await connect(service);
    const selectedId = connected.calendars[0]?.id;
    if (!selectedId) throw new Error("Missing test calendar");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: selectedId,
      availabilityCalendarIds: [selectedId],
    });
    provider.queryFreeBusy.mockRejectedValueOnce(
      new GoogleCalendarProviderError("access_unauthorized"),
    );

    await expect(
      service.busyIntervals({
        producerId: PRODUCER_ID,
        timeMin: new Date("2026-08-10T10:00:00.000Z"),
        timeMax: new Date("2026-08-10T11:00:00.000Z"),
      }),
    ).resolves.toEqual({
      protection: "skitza_only",
      health: "reconnect_required",
      intervals: [],
    });
    expect(storedConnection(repository).status).toBe("reconnect_required");
    expect(storedConnection(repository).lastErrorCode).toBe("access_unauthorized");
  });

  it("discards a response when the selected calendars change during the network request", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({
      repository,
      provider,
      config: CONFIG,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });
    const connected = await connect(service);
    const selectedId = connected.calendars[0]?.id;
    if (!selectedId) throw new Error("Missing test calendar");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: selectedId,
      availabilityCalendarIds: [selectedId],
    });
    provider.queryFreeBusy.mockImplementationOnce(async () => {
      await Promise.resolve();
      repository.candidates = repository.candidates.map((candidate) => ({
        ...candidate,
        blocksAvailability: false,
      }));
      return {
        busyIntervals: [
          {
            startsAt: new Date("2026-08-10T10:15:00.000Z"),
            endsAt: new Date("2026-08-10T10:45:00.000Z"),
          },
        ],
        failedCalendarCount: 0,
      };
    });

    await expect(
      service.busyIntervals({
        producerId: PRODUCER_ID,
        timeMin: new Date("2026-08-10T10:00:00.000Z"),
        timeMax: new Date("2026-08-10T11:00:00.000Z"),
      }),
    ).resolves.toEqual({
      protection: "skitza_only",
      health: "unavailable",
      intervals: [],
    });
  });
});
