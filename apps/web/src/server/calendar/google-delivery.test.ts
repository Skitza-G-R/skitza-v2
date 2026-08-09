import { describe, expect, it, vi } from "vitest";

import {
  GoogleCalendarProviderError,
  type GoogleCalendarEventRecord,
  type GoogleCalendarProvider,
} from "~/server/google-calendar";
import {
  type GoogleCalendarDeliveryJob,
  type GoogleCalendarDeliveryRepository,
  type GoogleCalendarPreparedJob,
  type GoogleCalendarWorkerAccess,
  processGoogleCalendarSyncJobs,
} from "./google-delivery";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const BOOKING_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000003";
const LINK_ID = "00000000-0000-4000-8000-000000000004";
const EVENT_ID = "sk00000000000040008000000000000004";

function confirmedPayload(revision = 2) {
  return {
    schemaVersion: 2,
    action: "upsert",
    eventKind: "confirmed",
    notificationMode: "all",
    sequence: revision,
    startsAtUtc: "2026-08-10T09:00:00.000Z",
    endsAtUtc: "2026-08-10T10:30:00.000Z",
    summary: "Mix review",
    artistSafeUrl: "https://skitza.app/artist/sessions/session_123",
    attendee: { name: "Artist", email: "artist@example.com" },
    privateProperties: {
      skitzaLink: LINK_ID,
      skitzaRevision: String(revision),
      skitzaSchema: "1",
    },
  } as const;
}

function job(overrides: Partial<GoogleCalendarDeliveryJob> = {}): GoogleCalendarDeliveryJob {
  return {
    id: JOB_ID,
    bookingId: BOOKING_ID,
    producerId: PRODUCER_ID,
    deliveryChannel: "google",
    bookingCalendarLinkId: LINK_ID,
    operation: "upsert_google_event",
    desiredRevision: 2,
    payloadSnapshot: confirmedPayload(),
    attemptCount: 1,
    createdAt: new Date("2026-08-09T11:59:00.000Z"),
    updatedAt: NOW,
    ...overrides,
  };
}

function prepared(
  claimed = job(),
  overrides: Partial<GoogleCalendarPreparedJob["link"]> = {},
  lastGoogleEventKind: GoogleCalendarPreparedJob["lastGoogleEventKind"] = null,
): GoogleCalendarPreparedJob {
  return {
    job: claimed,
    link: {
      id: LINK_ID,
      producerId: PRODUCER_ID,
      connectionId: "00000000-0000-4000-8000-000000000005",
      accountVersion: 1,
      destinationSelectionId: "00000000-0000-4000-8000-000000000006",
      destinationCalendarIdCiphertext: "ciphertext",
      destinationCalendarIdIv: "abcdefghijklmnop",
      destinationCalendarIdAuthTag: "abcdefghijklmnopqrstuv",
      destinationCalendarIdKeyVersion: 1,
      providerEventId: EVENT_ID,
      providerEventEtag: null,
      providerState: "uncreated",
      desiredRevision: claimed.desiredRevision,
      lastGoogleRevision: 0,
      invitationRevision:
        claimed.payloadSnapshot.notificationMode === "all" ? claimed.desiredRevision : 0,
      invitationChannel: claimed.payloadSnapshot.notificationMode === "all" ? "google" : null,
      invitationReservedAt: claimed.payloadSnapshot.notificationMode === "all" ? NOW : null,
      invitationAttemptedAt: null,
      invitationDeliveredAt: null,
      ...overrides,
    },
    lastGoogleEventKind,
  };
}

function record(revision: number, overrides: Partial<GoogleCalendarEventRecord> = {}) {
  return {
    eventId: EVENT_ID,
    etag: `"etag-${String(revision)}"`,
    status: "confirmed",
    linkage: { opaqueLink: LINK_ID, revision, schemaVersion: 1 },
    ...overrides,
  } satisfies GoogleCalendarEventRecord;
}

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

function repositoryFor(
  claimed: GoogleCalendarDeliveryJob,
  preparedOutcome:
    | Readonly<{ outcome: "ready"; value: GoogleCalendarPreparedJob }>
    | Readonly<{ outcome: "superseded" | "invalid" | "lease_lost" }> = {
    outcome: "ready",
    value: prepared(claimed),
  },
) {
  const repository = {
    claimDueGoogleJobs: vi.fn<GoogleCalendarDeliveryRepository["claimDueGoogleJobs"]>(() =>
      Promise.resolve([claimed]),
    ),
    prepareGoogleJob: vi.fn<GoogleCalendarDeliveryRepository["prepareGoogleJob"]>(() =>
      Promise.resolve(
        preparedOutcome.outcome === "ready"
          ? preparedOutcome
          : preparedOutcome.outcome === "superseded"
            ? { outcome: "superseded" as const }
            : preparedOutcome.outcome === "invalid"
              ? { outcome: "invalid" as const }
              : { outcome: "lease_lost" as const },
      ),
    ),
    completeSupersededGoogleJob: vi
      .fn<GoogleCalendarDeliveryRepository["completeSupersededGoogleJob"]>()
      .mockResolvedValue(true),
    completeGoogleJob: vi
      .fn<GoogleCalendarDeliveryRepository["completeGoogleJob"]>()
      .mockResolvedValue(true),
    markGoogleNotificationAttempt: vi
      .fn<GoogleCalendarDeliveryRepository["markGoogleNotificationAttempt"]>()
      .mockResolvedValue(true),
    enqueueIcsFallback: vi
      .fn<GoogleCalendarDeliveryRepository["enqueueIcsFallback"]>()
      .mockResolvedValue({
        outcome: "enqueued",
        jobId: "00000000-0000-4000-8000-000000000009",
      }),
    retryGoogleJob: vi
      .fn<GoogleCalendarDeliveryRepository["retryGoogleJob"]>()
      .mockResolvedValue(true),
    terminalGoogleJob: vi
      .fn<GoogleCalendarDeliveryRepository["terminalGoogleJob"]>()
      .mockResolvedValue(true),
  } satisfies GoogleCalendarDeliveryRepository;
  return repository;
}

function readyAccess(): GoogleCalendarWorkerAccess {
  return vi.fn(() =>
    Promise.resolve({
      status: "ready" as const,
      accessToken: "access-token",
      calendarId: "destination-calendar",
      markReconnectRequired: vi.fn(() => Promise.resolve()),
    }),
  );
}

describe("Google Calendar outbox delivery", () => {
  it("creates a confirmed event with the artist and one Google invitation", async () => {
    const claimed = job();
    const repository = repositoryFor(claimed);
    const google = provider();
    google.getEvent.mockRejectedValue(new GoogleCalendarProviderError("event_not_found"));
    google.insertEvent.mockResolvedValue(record(2));

    await expect(
      processGoogleCalendarSyncJobs(
        { repository, provider: google, access: readyAccess() },
        { now: NOW, leaseToken: "lease" },
      ),
    ).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      terminal: 0,
      leaseLost: 0,
      fallbackEnqueued: 0,
      fallbackJobIds: [],
    });
    expect(google.insertEvent).toHaveBeenCalledTimes(1);
    const [accessToken, insertInput] = google.insertEvent.mock.calls[0] as [
      string,
      {
        calendarId: string;
        event: { eventId: string; kind: string; attendeeMode: string };
        sendUpdates: string;
      },
    ];
    expect(accessToken).toBe("access-token");
    expect(insertInput).toMatchObject({
      calendarId: "destination-calendar",
      event: {
        eventId: EVENT_ID,
        kind: "confirmed",
        attendeeMode: "set_artist",
      },
      sendUpdates: "all",
    });
    expect(repository.markGoogleNotificationAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: LINK_ID, desiredRevision: 2 }),
    );
    expect(repository.markGoogleNotificationAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      google.insertEvent.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(repository.completeGoogleJob).toHaveBeenCalledWith(
      expect.objectContaining({
        desiredRevision: 2,
        notificationDelivered: true,
        providerState: "active",
      }),
    );
  });

  it("creates a silent private hold without an artist or fallback", async () => {
    const holdJob = job({
      desiredRevision: 1,
      payloadSnapshot: {
        schemaVersion: 2,
        action: "upsert",
        eventKind: "opaque_hold",
        notificationMode: "none",
        sequence: 1,
        startsAtUtc: "2026-08-10T09:00:00.000Z",
        endsAtUtc: "2026-08-10T10:30:00.000Z",
        summary: "Reserved",
        artistSafeUrl: null,
        attendee: null,
        privateProperties: {
          skitzaLink: LINK_ID,
          skitzaRevision: "1",
          skitzaSchema: "1",
        },
      },
    });
    const repository = repositoryFor(holdJob, {
      outcome: "ready",
      value: prepared(holdJob),
    });
    const google = provider();
    google.getEvent.mockRejectedValue(new GoogleCalendarProviderError("event_not_found"));
    google.insertEvent.mockResolvedValue(record(1));

    await processGoogleCalendarSyncJobs(
      { repository, provider: google, access: readyAccess() },
      { now: NOW, leaseToken: "lease" },
    );

    const request = google.insertEvent.mock.calls[0]?.[1];
    expect(request?.sendUpdates).toBe("none");
    expect(request?.event.body.attendees).toEqual([]);
    expect(request?.event.body).not.toHaveProperty("description");
    expect(repository.enqueueIcsFallback).not.toHaveBeenCalled();
  });

  it("preserves Google-only guests on a later title or time patch", async () => {
    const claimed = job();
    const value = prepared(
      claimed,
      { providerState: "active", providerEventEtag: '"etag-1"', lastGoogleRevision: 1 },
      "confirmed",
    );
    const repository = repositoryFor(claimed, { outcome: "ready", value });
    const google = provider();
    google.getEvent.mockResolvedValue(record(1));
    google.patchEvent.mockResolvedValue(record(2));

    await processGoogleCalendarSyncJobs(
      { repository, provider: google, access: readyAccess() },
      { now: NOW, leaseToken: "lease" },
    );

    const request = google.patchEvent.mock.calls[0]?.[1];
    expect(request?.event.attendeeMode).toBe("preserve");
    expect(request?.event.body).not.toHaveProperty("attendees");
    expect(request?.sendUpdates).toBe("all");
  });

  it("updates an existing ICS invitation before silently syncing its Google event", async () => {
    const claimed = job();
    const repository = repositoryFor(claimed, {
      outcome: "ready",
      value: prepared(
        claimed,
        {
          providerState: "active",
          providerEventEtag: '"etag-1"',
          lastGoogleRevision: 1,
          invitationChannel: "ics",
          invitationRevision: 2,
          invitationReservedAt: NOW,
          invitationDeliveredAt: null,
        },
        "confirmed",
      ),
    });
    const google = provider();
    google.getEvent.mockResolvedValue(record(1));
    google.patchEvent.mockResolvedValue(record(2));

    const result = await processGoogleCalendarSyncJobs(
      { repository, provider: google, access: readyAccess() },
      { now: NOW, leaseToken: "lease" },
    );

    expect(result).toMatchObject({ completed: 1, fallbackEnqueued: 1 });
    expect(repository.enqueueIcsFallback).toHaveBeenCalledTimes(1);
    expect(result.fallbackJobIds).toEqual(["00000000-0000-4000-8000-000000000009"]);
    expect(google.patchEvent).toHaveBeenCalledWith(
      "access-token",
      expect.objectContaining({ sendUpdates: "none" }),
    );
  });

  it("reconciles an ambiguous write without sending the same revision again", async () => {
    const claimed = job();
    const repository = repositoryFor(claimed, {
      outcome: "ready",
      value: prepared(
        claimed,
        { providerState: "active", providerEventEtag: '"etag-1"', lastGoogleRevision: 1 },
        "confirmed",
      ),
    });
    const google = provider();
    google.getEvent.mockResolvedValueOnce(record(1)).mockResolvedValueOnce(record(2));
    google.patchEvent.mockRejectedValue(new GoogleCalendarProviderError("provider_unavailable"));

    const result = await processGoogleCalendarSyncJobs(
      { repository, provider: google, access: readyAccess() },
      { now: NOW, leaseToken: "lease" },
    );

    expect(result.completed).toBe(1);
    expect(google.patchEvent).toHaveBeenCalledTimes(1);
    expect(repository.enqueueIcsFallback).not.toHaveBeenCalled();
    expect(repository.completeGoogleJob).toHaveBeenCalledWith(
      expect.objectContaining({ notificationDelivered: true }),
    );
  });

  it("enqueues the fallback on the first disconnected attempt and keeps Google retryable", async () => {
    const claimed = job();
    const repository = repositoryFor(claimed);
    const google = provider();
    const access = vi.fn<GoogleCalendarWorkerAccess>().mockResolvedValue({
      status: "disconnected",
    });

    const result = await processGoogleCalendarSyncJobs(
      { repository, provider: google, access },
      { now: NOW, leaseToken: "lease" },
    );

    expect(result).toMatchObject({ fallbackEnqueued: 1, retried: 1, completed: 0 });
    expect(repository.enqueueIcsFallback).toHaveBeenCalledTimes(1);
    expect(repository.retryGoogleJob).toHaveBeenCalledTimes(1);
    expect(google.getEvent).not.toHaveBeenCalled();
  });

  it("finishes an already-absent delete after enqueuing one CANCEL fallback", async () => {
    const deleteJob = job({
      operation: "delete_google_event",
      payloadSnapshot: {
        schemaVersion: 2,
        action: "delete",
        notificationMode: "all",
        sequence: 2,
        privateProperties: {
          skitzaLink: LINK_ID,
          skitzaRevision: "2",
          skitzaSchema: "1",
        },
      },
    });
    const repository = repositoryFor(deleteJob, {
      outcome: "ready",
      value: prepared(deleteJob, {
        providerState: "active",
        providerEventEtag: '"etag-1"',
        lastGoogleRevision: 1,
      }),
    });
    const google = provider();
    google.getEvent.mockRejectedValue(new GoogleCalendarProviderError("event_not_found"));

    const result = await processGoogleCalendarSyncJobs(
      { repository, provider: google, access: readyAccess() },
      { now: NOW, leaseToken: "lease" },
    );

    expect(result).toMatchObject({ completed: 1, fallbackEnqueued: 1, retried: 0 });
    expect(repository.completeGoogleJob).toHaveBeenCalledWith(
      expect.objectContaining({ providerState: "deleted", notificationDelivered: false }),
    );
    expect(repository.retryGoogleJob).not.toHaveBeenCalled();
  });

  it("reconciles an absent delete after a marked attempt without a duplicate CANCEL", async () => {
    const deleteJob = job({
      operation: "delete_google_event",
      payloadSnapshot: {
        schemaVersion: 2,
        action: "delete",
        notificationMode: "all",
        sequence: 2,
        privateProperties: {
          skitzaLink: LINK_ID,
          skitzaRevision: "2",
          skitzaSchema: "1",
        },
      },
    });
    const repository = repositoryFor(deleteJob, {
      outcome: "ready",
      value: prepared(deleteJob, {
        providerState: "active",
        providerEventEtag: '"etag-1"',
        lastGoogleRevision: 1,
        invitationAttemptedAt: new Date("2026-08-09T11:59:30.000Z"),
      }),
    });
    const google = provider();
    google.getEvent.mockRejectedValue(new GoogleCalendarProviderError("event_not_found"));

    const result = await processGoogleCalendarSyncJobs(
      { repository, provider: google, access: readyAccess() },
      { now: NOW, leaseToken: "lease" },
    );

    expect(result).toMatchObject({ completed: 1, fallbackEnqueued: 0, retried: 0 });
    expect(repository.enqueueIcsFallback).not.toHaveBeenCalled();
    expect(google.deleteEvent).not.toHaveBeenCalled();
    expect(repository.completeGoogleJob).toHaveBeenCalledWith(
      expect.objectContaining({ providerState: "deleted", notificationDelivered: true }),
    );
  });

  it("skips a superseded revision without touching Google", async () => {
    const claimed = job();
    const repository = repositoryFor(claimed, { outcome: "superseded" });
    const google = provider();

    const result = await processGoogleCalendarSyncJobs(
      { repository, provider: google, access: readyAccess() },
      { now: NOW, leaseToken: "lease" },
    );

    expect(result.completed).toBe(1);
    expect(repository.completeSupersededGoogleJob).toHaveBeenCalledTimes(1);
    expect(google.getEvent).not.toHaveBeenCalled();
  });

  it("falls back and terminals an event ID collision without exposing the other event", async () => {
    const claimed = job();
    const repository = repositoryFor(claimed);
    const google = provider();
    google.getEvent.mockResolvedValue(
      record(2, {
        linkage: { opaqueLink: "different_opaque_link", revision: 2, schemaVersion: 1 },
      }),
    );

    const result = await processGoogleCalendarSyncJobs(
      { repository, provider: google, access: readyAccess() },
      { now: NOW, leaseToken: "lease" },
    );

    expect(result).toMatchObject({ terminal: 1, fallbackEnqueued: 1 });
    expect(repository.terminalGoogleJob).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Invalid Google Calendar provider event state" }),
    );
  });
});
