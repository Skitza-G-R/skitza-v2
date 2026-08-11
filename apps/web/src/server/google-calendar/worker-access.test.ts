import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarPreparedLink } from "../calendar/google-delivery";
import type { GoogleCalendarServerConfig } from "./config";
import { encryptGoogleCalendarValue } from "./crypto";
import { GoogleCalendarProviderError, type GoogleCalendarProvider } from "./provider";
import type { GoogleCalendarConnectionRecord, GoogleCalendarRepository } from "./repository";
import { createGoogleCalendarWorkerAccess } from "./worker-access";

const SECRET = randomBytes(32);
const CONFIG = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://preview.test/api/integrations/google-calendar/callback",
  stateSecret: SECRET,
  encryption: { activeVersion: 1, keys: new Map([[1, SECRET]]) },
  calendarIdFingerprintSecret: SECRET,
} satisfies GoogleCalendarServerConfig;
const NOW = new Date("2026-08-09T12:00:00.000Z");
const PRODUCER_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const SELECTION_ID = "00000000-0000-4000-8000-000000000003";
const GOOGLE_SUBJECT = "google-subject";
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
];

function provider() {
  return {
    exchangeAuthorizationCode: vi.fn<GoogleCalendarProvider["exchangeAuthorizationCode"]>(),
    refreshAccessToken: vi.fn<GoogleCalendarProvider["refreshAccessToken"]>(),
    listCalendars: vi.fn<GoogleCalendarProvider["listCalendars"]>(),
    queryFreeBusy: vi.fn<GoogleCalendarProvider["queryFreeBusy"]>(),
    insertEvent: vi.fn<GoogleCalendarProvider["insertEvent"]>(),
    getEvent: vi.fn<GoogleCalendarProvider["getEvent"]>(),
    getLinkedEvent: vi.fn<GoogleCalendarProvider["getLinkedEvent"]>(),
    patchEvent: vi.fn<GoogleCalendarProvider["patchEvent"]>(),
    deleteEvent: vi.fn<GoogleCalendarProvider["deleteEvent"]>(),
    watchEvents: vi.fn<GoogleCalendarProvider["watchEvents"]>(),
    stopChannel: vi.fn<GoogleCalendarProvider["stopChannel"]>(),
    revokeToken: vi.fn<GoogleCalendarProvider["revokeToken"]>(),
  } satisfies GoogleCalendarProvider;
}

function connection(overrides: Partial<GoogleCalendarConnectionRecord> = {}) {
  const context = {
    producerId: PRODUCER_ID,
    connectionId: CONNECTION_ID,
    googleSubject: GOOGLE_SUBJECT,
    accountVersion: 1,
  } as const;
  return {
    id: CONNECTION_ID,
    producerId: PRODUCER_ID,
    googleSubject: GOOGLE_SUBJECT,
    googleAccountEmail: "producer@example.com",
    accountVersion: 1,
    status: "connected",
    grantedScopes: SCOPES,
    accessToken: encryptGoogleCalendarValue(
      "fresh-access-token",
      { ...context, purpose: "access_token" },
      CONFIG.encryption,
    ),
    accessTokenExpiresAt: new Date("2026-08-09T13:00:00.000Z"),
    refreshToken: encryptGoogleCalendarValue(
      "refresh-token",
      { ...context, purpose: "refresh_token" },
      CONFIG.encryption,
    ),
    lastAuthorizedAt: NOW,
    reconnectRequiredAt: null,
    disconnectedAt: null,
    lastErrorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } satisfies GoogleCalendarConnectionRecord;
}

function link(): GoogleCalendarPreparedLink {
  const protectedCalendar = encryptGoogleCalendarValue(
    "private-destination-calendar",
    {
      producerId: PRODUCER_ID,
      connectionId: CONNECTION_ID,
      selectionId: SELECTION_ID,
      accountVersion: 1,
      purpose: "provider_calendar_id",
    },
    CONFIG.encryption,
  );
  return {
    id: "00000000-0000-4000-8000-000000000004",
    producerId: PRODUCER_ID,
    connectionId: CONNECTION_ID,
    accountVersion: 1,
    destinationSelectionId: SELECTION_ID,
    destinationCalendarIdCiphertext: protectedCalendar.ciphertext,
    destinationCalendarIdIv: protectedCalendar.iv,
    destinationCalendarIdAuthTag: protectedCalendar.authTag,
    destinationCalendarIdKeyVersion: protectedCalendar.keyVersion,
    providerEventId: "sk00000000000040008000000000000004",
    providerEventEtag: null,
    providerState: "uncreated",
    syncState: "pending",
    desiredRevision: 1,
    lastGoogleRevision: 0,
    invitationRevision: 0,
    invitationChannel: null,
    invitationReservedAt: null,
    invitationAttemptedAt: null,
    invitationDeliveredAt: null,
  };
}

function repositoryWith(current: GoogleCalendarConnectionRecord) {
  return {
    getConnection: vi.fn<GoogleCalendarRepository["getConnection"]>().mockResolvedValue(current),
    createOAuthState: vi.fn<GoogleCalendarRepository["createOAuthState"]>(),
    consumeOAuthState: vi.fn<GoogleCalendarRepository["consumeOAuthState"]>(),
    commitAuthorization: vi.fn<GoogleCalendarRepository["commitAuthorization"]>(),
    storeRefreshedAccessToken: vi
      .fn<GoogleCalendarRepository["storeRefreshedAccessToken"]>()
      .mockResolvedValue(true),
    markReconnectRequired: vi
      .fn<GoogleCalendarRepository["markReconnectRequired"]>()
      .mockResolvedValue(undefined),
    replaceCalendarCandidates: vi.fn<GoogleCalendarRepository["replaceCalendarCandidates"]>(),
    listCalendarCandidates: vi.fn<GoogleCalendarRepository["listCalendarCandidates"]>(),
    getConnectionSyncSummary: vi.fn<GoogleCalendarRepository["getConnectionSyncSummary"]>(),
    listCalendarWatches: vi.fn<GoogleCalendarRepository["listCalendarWatches"]>(),
    listRequiredCalendarWatchTargets:
      vi.fn<GoogleCalendarRepository["listRequiredCalendarWatchTargets"]>(),
    reserveCalendarWatch: vi.fn<GoogleCalendarRepository["reserveCalendarWatch"]>(),
    activateCalendarWatch: vi.fn<GoogleCalendarRepository["activateCalendarWatch"]>(),
    endCalendarWatch: vi.fn<GoogleCalendarRepository["endCalendarWatch"]>(),
    listCalendarWatchesDueForRenewal:
      vi.fn<GoogleCalendarRepository["listCalendarWatchesDueForRenewal"]>(),
    listCalendarWatchRepairProducerIds:
      vi.fn<GoogleCalendarRepository["listCalendarWatchRepairProducerIds"]>(),
    saveCalendarSelection: vi.fn<GoogleCalendarRepository["saveCalendarSelection"]>(),
    enqueueFutureConfirmedEvents: vi.fn<GoogleCalendarRepository["enqueueFutureConfirmedEvents"]>(),
    disconnect: vi.fn<GoogleCalendarRepository["disconnect"]>(),
  } satisfies GoogleCalendarRepository;
}

describe("Google Calendar worker credentials", () => {
  it("opens only the snapshotted destination and a fresh access token", async () => {
    const google = provider();
    const repository = repositoryWith(connection());
    const access = createGoogleCalendarWorkerAccess({
      repository,
      provider: google,
      config: CONFIG,
      now: () => NOW,
    });

    const result = await access(link());

    expect(result).toMatchObject({
      status: "ready",
      accessToken: "fresh-access-token",
      calendarId: "private-destination-calendar",
    });
    expect(google.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes outside repository transactions and stores the protected token", async () => {
    const google = provider();
    google.refreshAccessToken.mockResolvedValue({
      accessToken: "new-access-token",
      accessTokenExpiresAt: new Date("2026-08-09T14:00:00.000Z"),
      grantedScopes: SCOPES,
    });
    const repository = repositoryWith(
      connection({ accessTokenExpiresAt: new Date("2026-08-09T12:00:10.000Z") }),
    );
    const access = createGoogleCalendarWorkerAccess({
      repository,
      provider: google,
      config: CONFIG,
      now: () => NOW,
    });

    await expect(access(link())).resolves.toMatchObject({
      status: "ready",
      accessToken: "new-access-token",
    });
    expect(google.refreshAccessToken).toHaveBeenCalledWith("refresh-token");
    const stored = repository.storeRefreshedAccessToken.mock.calls[0]?.[0];
    expect(stored?.accessToken.ciphertext).not.toContain("new-access-token");
  });

  it("marks revoked refresh credentials for reconnect without exposing provider data", async () => {
    const google = provider();
    google.refreshAccessToken.mockRejectedValue(
      new GoogleCalendarProviderError("refresh_invalid_grant"),
    );
    const repository = repositoryWith(
      connection({ accessToken: null, accessTokenExpiresAt: null }),
    );
    const access = createGoogleCalendarWorkerAccess({
      repository,
      provider: google,
      config: CONFIG,
      now: () => NOW,
    });

    await expect(access(link())).resolves.toEqual({ status: "reconnect_required" });
    expect(repository.markReconnectRequired).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "refresh_invalid_grant" }),
    );
  });
});
