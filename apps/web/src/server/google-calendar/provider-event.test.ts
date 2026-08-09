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
  attendeeMode: "set_artist",
  startsAt: new Date("2026-08-10T08:00:00.000Z"),
  endsAt: new Date("2026-08-10T09:30:00.000Z"),
  revision: 4,
  opaqueLink: PRIVATE_PROPERTIES.skitzaLink,
  summary: "Mix review",
  artist: { email: "artist@example.com", displayName: "Artist" },
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
      description: "https://skitza.app/artist/sessions/session_123",
      attendees: [{ email: "artist@example.com", displayName: "Artist" }],
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
      .mockResolvedValueOnce(json(providerRecord()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    await expect(
      provider.getEvent("access-token", { calendarId: "destination-id", eventId: EVENT_ID }),
    ).resolves.toMatchObject({ eventId: EVENT_ID, linkage: { revision: 4 } });
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
