import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarServerConfig } from "./config";
import { decryptGoogleCalendarValue } from "./crypto";
import { GoogleCalendarProviderError, type GoogleCalendarProvider } from "./provider";
import type {
  GoogleCalendarCandidateRecord,
  GoogleCalendarConnectionRecord,
  GoogleCalendarRepository,
  GoogleCalendarStoredOAuthState,
} from "./repository";
import { GoogleCalendarServiceError, createGoogleCalendarService } from "./service";

const PRODUCER_ID = "11111111-1111-4111-8111-111111111111";
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

  async getConnection(producerId: string) {
    await Promise.resolve();
    return this.connection?.producerId === producerId ? this.connection : null;
  }

  async createOAuthState(state: Omit<GoogleCalendarStoredOAuthState, "consumedAt">) {
    await Promise.resolve();
    this.states.set(state.tokenDigest, { ...state, consumedAt: null });
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
    listCalendars: vi.fn(() => Promise.resolve(calendar())),
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

describe("Google Calendar service lifecycle", () => {
  it("connects with one-time state, encrypted credentials, and opaque calendar IDs", async () => {
    const repository = new MemoryGoogleCalendarRepository();
    const provider = createProvider();
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    const start = await service.beginOAuth({ producerId: PRODUCER_ID, intent: "connect" });
    const result = await service.completeOAuth({
      producerId: PRODUCER_ID,
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
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    const connected = await connect(service);
    const calendarId = connected.calendars[0]?.id;
    if (!calendarId) throw new Error("Missing test calendar");
    await service.saveSelection({
      producerId: PRODUCER_ID,
      destinationCalendarId: calendarId,
      availabilityCalendarIds: [calendarId],
    });
    expect(repository.connection?.status).toBe("connected");
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
    const service = createGoogleCalendarService({ repository, provider, config: CONFIG });
    await connect(service);
    const connection = repository.connection;
    if (!connection?.refreshToken) throw new Error("Missing test connection");
    repository.connection = {
      ...connection,
      refreshToken: { ...connection.refreshToken, authTag: "broken" },
    };
    provider.revokeToken.mockRejectedValueOnce(new Error("private provider failure"));
    await service.disconnect(PRODUCER_ID);
    expect(provider.revokeToken).toHaveBeenCalledWith("access-google-subject-a");
    expect(storedConnection(repository).status).toBe("disconnected");
    expect(storedConnection(repository).accessToken).toBeNull();
    expect(storedConnection(repository).refreshToken).toBeNull();
  });
});
