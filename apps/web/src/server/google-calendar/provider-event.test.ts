import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarServerConfig } from "./config";
import { buildGoogleCalendarEventWrite, deriveGoogleCalendarEventId } from "./event";
import { GoogleCalendarProviderError, createGoogleCalendarProvider } from "./provider";

const SECRET = randomBytes(32);
const CONFIG = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://preview.test/api/integrations/google-calendar/callback",
  stateSecret: SECRET,
  encryption: { activeVersion: 1, keys: new Map([[1, SECRET]]) },
  calendarIdFingerprintSecret: SECRET,
} satisfies GoogleCalendarServerConfig;
const EVENT_ID = deriveGoogleCalendarEventId({
  producerId: "producer-id",
  linkKey: "booking-calendar-link-id",
  secret: SECRET,
});
const PRIVATE_PROPERTIES = {
  skitzaLink: "oYkGv6H3M8wCw7NymqEgHg",
  skitzaRevision: "4",
  skitzaSchema: "1",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function providerRecord(status: "confirmed" | "cancelled" = "confirmed") {
  return {
    id: EVENT_ID,
    etag: '"provider-etag"',
    status,
    extendedProperties: { private: PRIVATE_PROPERTIES },
    summary: "must never leave the provider boundary",
  };
}

const HOLD = buildGoogleCalendarEventWrite({
  eventId: EVENT_ID,
  kind: "hold",
  startsAt: new Date("2026-08-10T08:00:00.000Z"),
  endsAt: new Date("2026-08-10T09:30:00.000Z"),
  revision: 4,
  opaqueLink: PRIVATE_PROPERTIES.skitzaLink,
});

const CONFIRMED = buildGoogleCalendarEventWrite({
  eventId: EVENT_ID,
  kind: "confirmed",
  attendeeMode: "set_participants",
  startsAt: new Date("2026-08-10T08:00:00.000Z"),
  endsAt: new Date("2026-08-10T09:30:00.000Z"),
  revision: 4,
  opaqueLink: PRIVATE_PROPERTIES.skitzaLink,
  summary: "Mix review",
  participants: [
    { email: "producer@example.com", displayName: "Producer" },
    { email: "artist@example.com", displayName: "Artist" },
  ],
  artistSafeSessionUrl: "https://skitza.app/artist/sessions/session_123",
});
const CONFIRMED_EDIT = buildGoogleCalendarEventWrite({
  eventId: EVENT_ID,
  kind: "confirmed",
  attendeeMode: "preserve",
  startsAt: new Date("2026-08-11T08:00:00.000Z"),
  endsAt: new Date("2026-08-11T09:30:00.000Z"),
  revision: 4,
  opaqueLink: PRIVATE_PROPERTIES.skitzaLink,
  summary: "Moved mix review",
  artistSafeSessionUrl: "https://skitza.app/artist/sessions/session_123",
});

describe("Google Calendar event REST provider", () => {
  it("inserts a private hold with a deterministic ID and no notification", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(providerRecord()));
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    const result = await provider.insertEvent("access-token", {
      calendarId: "producer@example.com",
      event: HOLD,
      sendUpdates: "none",
    });

    expect(result).toEqual({
      eventId: EVENT_ID,
      etag: '"provider-etag"',
      status: "confirmed",
      linkage: { opaqueLink: PRIVATE_PROPERTIES.skitzaLink, revision: 4, schemaVersion: 1 },
    });
    expect(JSON.stringify(result)).not.toContain("must never leave");
    const [rawUrl, request] = fetchMock.mock.calls[0] ?? [];
    if (typeof rawUrl !== "string" && !(rawUrl instanceof URL)) throw new Error("Missing URL");
    const url = new URL(rawUrl);
    expect(url.pathname).toBe(
      `/calendar/v3/calendars/${encodeURIComponent("producer@example.com")}/events`,
    );
    expect(url.searchParams.get("sendUpdates")).toBe("none");
    expect(request?.method).toBe("POST");
    if (typeof request?.body !== "string") throw new Error("Missing body");
    const body = JSON.parse(request.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: EVENT_ID,
      summary: "Reserved",
      visibility: "private",
      transparency: "opaque",
      attendees: [],
      extendedProperties: { private: PRIVATE_PROPERTIES },
    });
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("location");
    expect(body).not.toHaveProperty("conferenceData");
  });

  it("patches the same event with one artist and an ETag", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(providerRecord()));
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    await provider.patchEvent("access-token", {
      calendarId: "destination-id",
      event: CONFIRMED,
      sendUpdates: "all",
      etag: '"old-etag"',
    });

    const [rawUrl, request] = fetchMock.mock.calls[0] ?? [];
    if (typeof rawUrl !== "string" && !(rawUrl instanceof URL)) throw new Error("Missing URL");
    const url = new URL(rawUrl);
    expect(url.pathname.endsWith(`/events/${EVENT_ID}`)).toBe(true);
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    expect(request?.method).toBe("PATCH");
    expect(request?.headers).toMatchObject({ "If-Match": '"old-etag"' });
    if (typeof request?.body !== "string") throw new Error("Missing body");
    expect(JSON.parse(request.body)).toMatchObject({
      summary: "Mix review",
      description:
        "Skitza studio session: Mix review\n\nBooking details: https://skitza.app/artist/sessions/session_123",
      attendees: [
        { email: "producer@example.com", displayName: "Producer" },
        { email: "artist@example.com", displayName: "Artist" },
      ],
    });
    expect(JSON.parse(request.body)).not.toHaveProperty("id");
  });

  it("omits attendees from later patches so Google-only guests are preserved", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(providerRecord()));
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    await provider.patchEvent("access-token", {
      calendarId: "destination-id",
      event: CONFIRMED_EDIT,
      sendUpdates: "all",
    });

    const request = fetchMock.mock.calls[0]?.[1];
    if (typeof request?.body !== "string") throw new Error("Missing body");
    expect(JSON.parse(request.body)).not.toHaveProperty("attendees");
  });

  it("serializes existing attendee response statuses during a participant repair", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(providerRecord()));
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });
    const repaired = buildGoogleCalendarEventWrite({
      eventId: EVENT_ID,
      kind: "confirmed",
      attendeeMode: "set_participants",
      startsAt: new Date("2026-08-10T08:00:00.000Z"),
      endsAt: new Date("2026-08-10T09:30:00.000Z"),
      revision: 4,
      opaqueLink: PRIVATE_PROPERTIES.skitzaLink,
      summary: "Mix review",
      participants: [
        {
          email: "artist@example.com",
          displayName: "Artist",
          responseStatus: "declined",
        },
        {
          email: "google-only@example.com",
          displayName: "Google-only guest",
          responseStatus: "tentative",
        },
        { email: "producer@example.com", displayName: "Producer" },
      ],
      artistSafeSessionUrl: "https://skitza.app/artist/sessions/session_123",
    });

    await provider.patchEvent("access-token", {
      calendarId: "destination-id",
      event: repaired,
      sendUpdates: "none",
    });

    const request = fetchMock.mock.calls[0]?.[1];
    if (typeof request?.body !== "string") throw new Error("Missing body");
    expect(JSON.parse(request.body)).toMatchObject({
      attendees: [
        {
          email: "artist@example.com",
          displayName: "Artist",
          responseStatus: "declined",
        },
        {
          email: "google-only@example.com",
          displayName: "Google-only guest",
          responseStatus: "tentative",
        },
        { email: "producer@example.com", displayName: "Producer" },
      ],
    });
  });

  it("never permits a hold to notify an attendee", async () => {
    const provider = createGoogleCalendarProvider({
      config: CONFIG,
      fetch: vi.fn<typeof fetch>(),
    });

    await expect(
      provider.insertEvent("access-token", {
        calendarId: "destination-id",
        event: HOLD,
        sendUpdates: "all",
      }),
    ).rejects.toEqual(new GoogleCalendarProviderError("provider_invalid_response"));
  });

  it("reads only safe linkage and deletes with notification control", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          ...providerRecord(),
          attendees: [
            {
              email: "Artist@Example.com",
              displayName: "Artist",
              responseStatus: "declined",
              comment: "must not leave the provider boundary",
            },
            {
              email: "guest@example.com",
              displayName: "Guest",
              responseStatus: "accepted",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    await expect(
      provider.getEvent("access-token", { calendarId: "destination-id", eventId: EVENT_ID }),
    ).resolves.toMatchObject({
      eventId: EVENT_ID,
      linkage: { revision: 4 },
      attendees: [
        {
          email: "artist@example.com",
          displayName: "Artist",
          responseStatus: "declined",
        },
        {
          email: "guest@example.com",
          displayName: "Guest",
          responseStatus: "accepted",
        },
      ],
    });
    await expect(
      provider.deleteEvent("access-token", {
        calendarId: "destination-id",
        eventId: EVENT_ID,
        sendUpdates: "none",
        etag: '"provider-etag"',
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { "If-Match": '"provider-etag"' },
    });
    const [rawUrl] = fetchMock.mock.calls[0] ?? [];
    if (typeof rawUrl !== "string" && !(rawUrl instanceof URL)) throw new Error("Missing URL");
    expect(new URL(rawUrl).searchParams.get("fields")).toBe(
      "id,etag,status,extendedProperties,attendees(email,displayName,responseStatus)",
    );
  });

  it("conditionally reads only approved linked-event fields and discards Google-only guests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ...providerRecord(),
        updated: "2026-08-10T07:59:00.000Z",
        summary: " Mix review moved ",
        start: { dateTime: "2026-08-10T10:00:00+02:00" },
        end: { dateTime: "2026-08-10T11:30:00+02:00" },
        attendees: [
          { email: "guest-private@example.com", responseStatus: "accepted" },
          { email: "Artist@Example.com", responseStatus: "declined" },
        ],
        description: "private notes must not leave the provider boundary",
        location: "private location",
      }),
    );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    const result = await provider.getLinkedEvent("access-token", {
      calendarId: "destination-id",
      eventId: EVENT_ID,
      artistEmail: "artist@example.com",
      ifNoneMatch: '"old-etag"',
    });

    expect(result).toEqual({
      outcome: "found",
      event: {
        eventId: EVENT_ID,
        etag: '"provider-etag"',
        status: "confirmed",
        linkage: { opaqueLink: PRIVATE_PROPERTIES.skitzaLink, revision: 4, schemaVersion: 1 },
        updatedAt: new Date("2026-08-10T07:59:00.000Z"),
        summary: "Mix review moved",
        timing: {
          kind: "timed",
          startsAt: new Date("2026-08-10T08:00:00.000Z"),
          endsAt: new Date("2026-08-10T09:30:00.000Z"),
        },
        artistRsvp: "declined",
      },
    });
    expect(JSON.stringify(result)).not.toContain("guest-private");
    expect(JSON.stringify(result)).not.toContain("private notes");
    expect(JSON.stringify(result)).not.toContain("private location");
    const [rawUrl, request] = fetchMock.mock.calls[0] ?? [];
    if (typeof rawUrl !== "string" && !(rawUrl instanceof URL)) throw new Error("Missing URL");
    const url = new URL(rawUrl);
    expect(url.searchParams.get("fields")).toBe(
      "id,etag,status,updated,summary,start(dateTime,date),end(dateTime,date),extendedProperties,attendees(email,responseStatus)",
    );
    expect(request?.headers).toMatchObject({ "If-None-Match": '"old-etag"' });
  });

  it("returns explicit conditional and missing outcomes without parsing a body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });
    const input = {
      calendarId: "destination-id",
      eventId: EVENT_ID,
      artistEmail: "artist@example.com",
    } as const;

    await expect(
      provider.getLinkedEvent("access-token", { ...input, ifNoneMatch: '"current"' }),
    ).resolves.toEqual({ outcome: "not_modified" });
    await expect(provider.getLinkedEvent("access-token", input)).resolves.toEqual({
      outcome: "missing",
    });
  });

  it("marks all-day or invalid linked timing as unsupported for safe restoration", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ...providerRecord(),
        updated: "2026-08-10T07:59:00.000Z",
        summary: "Mix review",
        start: { date: "2026-08-10" },
        end: { date: "2026-08-11" },
        attendees: [],
      }),
    );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    await expect(
      provider.getLinkedEvent("access-token", {
        calendarId: "destination-id",
        eventId: EVENT_ID,
        artistEmail: "artist@example.com",
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      event: { timing: { kind: "unsupported" }, artistRsvp: null },
    });
  });

  it("classifies recoverable and reconciliation errors without raw provider data", async () => {
    for (const [status, body, code] of [
      [401, { error: "private" }, "access_unauthorized"],
      [404, { error: "private" }, "event_not_found"],
      [410, { error: "private" }, "event_not_found"],
      [409, { error: "private" }, "event_conflict"],
      [412, { error: "private" }, "event_precondition_failed"],
      [429, { error: "private" }, "provider_rate_limited"],
      [403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "provider_rate_limited"],
    ] as const) {
      const provider = createGoogleCalendarProvider({
        config: CONFIG,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(json(body, status)),
      });
      await expect(
        provider.getEvent("access-token", { calendarId: "destination-id", eventId: EVENT_ID }),
      ).rejects.toMatchObject({
        name: "GoogleCalendarProviderError",
        message: "Google Calendar request failed",
        code,
      });
    }
  });
});
