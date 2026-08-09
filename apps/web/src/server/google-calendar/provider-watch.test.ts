import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarServerConfig } from "./config";
import {
  GOOGLE_CALENDAR_WATCH_MAX_TTL_SECONDS,
  GoogleCalendarProviderError,
  createGoogleCalendarProvider,
} from "./provider";

const SECRET = randomBytes(32);
const CONFIG = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://preview.test/api/integrations/google-calendar/callback",
  stateSecret: SECRET,
  encryption: { activeVersion: 1, keys: new Map([[1, SECRET]]) },
  calendarIdFingerprintSecret: SECRET,
} satisfies GoogleCalendarServerConfig;
const CHANNEL_ID = "d8c5a3e7-94ad-4873-9068-dcf09259ab90";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Google Calendar watch REST provider", () => {
  it("creates an HTTPS event watch with a bounded TTL and returns only trust identifiers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        kind: "api#channel",
        id: CHANNEL_ID,
        resourceId: "opaque-resource-id",
        resourceUri: "private provider resource URI",
        token: "must-not-leave-provider-boundary",
        expiration: "1786320000000",
      }),
    );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    await expect(
      provider.watchEvents("access-token", {
        calendarId: "producer@example.com",
        channelId: CHANNEL_ID,
        address: "https://preview.test/api/webhooks/google-calendar",
        token: "random-channel-token",
      }),
    ).resolves.toEqual({
      channelId: CHANNEL_ID,
      resourceId: "opaque-resource-id",
      expiresAt: new Date("2026-08-10T00:00:00.000Z"),
    });

    const [rawUrl, request] = fetchMock.mock.calls[0] ?? [];
    if (typeof rawUrl !== "string" && !(rawUrl instanceof URL)) throw new Error("Missing URL");
    expect(new URL(rawUrl).pathname).toBe(
      `/calendar/v3/calendars/${encodeURIComponent("producer@example.com")}/events/watch`,
    );
    expect(request).toMatchObject({ method: "POST" });
    if (typeof request?.body !== "string") throw new Error("Missing body");
    expect(JSON.parse(request.body)).toEqual({
      id: CHANNEL_ID,
      type: "web_hook",
      address: "https://preview.test/api/webhooks/google-calendar",
      token: "random-channel-token",
      params: { ttl: String(GOOGLE_CALENDAR_WATCH_MAX_TTL_SECONDS) },
    });
  });

  it("stops a channel idempotently without exposing resource data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });
    const input = { channelId: CHANNEL_ID, resourceId: "opaque-resource-id" } as const;

    await expect(provider.stopChannel("access-token", input)).resolves.toBeUndefined();
    await expect(provider.stopChannel("access-token", input)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.googleapis.com/calendar/v3/channels/stop",
    );
    const firstRequest = fetchMock.mock.calls[0]?.[1];
    if (typeof firstRequest?.body !== "string") throw new Error("Missing stop body");
    expect(JSON.parse(firstRequest.body)).toEqual({
      id: CHANNEL_ID,
      resourceId: "opaque-resource-id",
    });
  });

  it("rejects insecure addresses, malformed identifiers, and excessive TTL before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });
    const base = {
      calendarId: "destination-id",
      channelId: CHANNEL_ID,
      address: "https://preview.test/api/webhooks/google-calendar",
      token: "random-channel-token",
    } as const;

    await expect(
      provider.watchEvents("access-token", { ...base, address: "http://preview.test/webhook" }),
    ).rejects.toEqual(new GoogleCalendarProviderError("provider_invalid_response"));
    await expect(
      provider.watchEvents("access-token", { ...base, channelId: "not-a-uuid" }),
    ).rejects.toEqual(new GoogleCalendarProviderError("provider_invalid_response"));
    await expect(
      provider.watchEvents("access-token", {
        ...base,
        ttlSeconds: GOOGLE_CALENDAR_WATCH_MAX_TTL_SECONDS + 1,
      }),
    ).rejects.toEqual(new GoogleCalendarProviderError("provider_invalid_response"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sanitizes watch failures and malformed provider trust data", async () => {
    const base = {
      calendarId: "destination-id",
      channelId: CHANNEL_ID,
      address: "https://preview.test/api/webhooks/google-calendar",
      token: "random-channel-token",
    } as const;
    const unavailable = createGoogleCalendarProvider({
      config: CONFIG,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ private: "provider body" }, 503)),
    });
    await expect(unavailable.watchEvents("access-token", base)).rejects.toMatchObject({
      code: "provider_unavailable",
      message: "Google Calendar request failed",
    });

    const malformed = createGoogleCalendarProvider({
      config: CONFIG,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json({ id: CHANNEL_ID, resourceId: "opaque-resource-id", expiration: "not-a-time" }),
        ),
    });
    await expect(malformed.watchEvents("access-token", base)).rejects.toEqual(
      new GoogleCalendarProviderError("provider_invalid_response"),
    );
  });
});
