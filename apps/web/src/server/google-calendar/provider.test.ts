import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarServerConfig } from "./config";
import {
  GoogleCalendarProviderError,
  createGoogleCalendarProvider,
  hasRequiredGoogleCalendarScopes,
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
const GOOGLE_USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const REQUIRED_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;
const CANONICAL_GOOGLE_SCOPES = [
  "openid",
  GOOGLE_USERINFO_EMAIL_SCOPE,
  ...REQUIRED_CALENDAR_SCOPES,
].join(" ");
const SHORT_EMAIL_ALIAS_SCOPES = ["openid", "email", ...REQUIRED_CALENDAR_SCOPES];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Google Calendar REST provider", () => {
  it("accepts Google's canonical email scope without relaxing any Calendar scope", () => {
    const canonicalScopes = CANONICAL_GOOGLE_SCOPES.split(" ");

    expect(hasRequiredGoogleCalendarScopes(canonicalScopes)).toBe(true);
    expect(hasRequiredGoogleCalendarScopes(SHORT_EMAIL_ALIAS_SCOPES)).toBe(true);
    expect(
      hasRequiredGoogleCalendarScopes(
        canonicalScopes.filter((scope) => scope !== GOOGLE_USERINFO_EMAIL_SCOPE),
      ),
    ).toBe(false);
    for (const calendarScope of REQUIRED_CALENDAR_SCOPES) {
      expect(
        hasRequiredGoogleCalendarScopes(canonicalScopes.filter((scope) => scope !== calendarScope)),
      ).toBe(false);
    }
  });

  it("uses trusted UserInfo and never trusts decoded id_token claims", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3_600,
          scope: CANONICAL_GOOGLE_SCOPES,
          id_token: "eyJhbGciOiJub25lIn0.fake-attacker-claims.",
        }),
      )
      .mockResolvedValueOnce(
        json({
          sub: "trusted-google-subject",
          email: " Producer@Example.com ",
          email_verified: true,
        }),
      );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });
    const result = await provider.exchangeAuthorizationCode({
      code: "authorization-code",
      codeVerifier: "a".repeat(43),
    });
    expect(result.identity).toEqual({
      googleSubject: "trusted-google-subject",
      googleAccountEmail: "producer@example.com",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://openidconnect.googleapis.com/v1/userinfo");
  });

  it("rejects unverified identity with a sanitized error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3_600,
          scope: CANONICAL_GOOGLE_SCOPES,
        }),
      )
      .mockResolvedValueOnce(
        json({ sub: "subject", email: "producer@example.com", email_verified: false }),
      );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });
    await expect(
      provider.exchangeAuthorizationCode({ code: "code", codeVerifier: "v".repeat(43) }),
    ).rejects.toMatchObject({
      name: "GoogleCalendarProviderError",
      code: "identity_unverified",
      message: "Google Calendar request failed",
    });
  });

  it("paginates CalendarList with minimal fields and maps all visible roles", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: "primary-private-id",
              summary: "Producer",
              timeZone: "Asia/Jerusalem",
              accessRole: "owner",
              primary: true,
            },
          ],
          nextPageToken: "page-two",
        }),
      )
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: "shared-private-id",
              summary: "Shared",
              summaryOverride: "Studio team",
              accessRole: "freeBusyReader",
            },
          ],
        }),
      );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });
    await expect(provider.listCalendars("access-token")).resolves.toEqual([
      {
        providerCalendarId: "primary-private-id",
        displayName: "Producer",
        timezone: "Asia/Jerusalem",
        accessRole: "owner",
        isPrimary: true,
      },
      {
        providerCalendarId: "shared-private-id",
        displayName: "Studio team",
        timezone: null,
        accessRole: "freeBusyReader",
        isPrimary: false,
      },
    ]);
    const firstRequest = fetchMock.mock.calls[0]?.[0];
    const secondRequest = fetchMock.mock.calls[1]?.[0];
    if (
      (typeof firstRequest !== "string" && !(firstRequest instanceof URL)) ||
      (typeof secondRequest !== "string" && !(secondRequest instanceof URL))
    ) {
      throw new Error("Missing CalendarList request URL");
    }
    const firstUrl = new URL(firstRequest);
    const secondUrl = new URL(secondRequest);
    expect(firstUrl.searchParams.get("minAccessRole")).toBe("freeBusyReader");
    expect(firstUrl.searchParams.get("maxResults")).toBe("250");
    expect(firstUrl.searchParams.get("fields")).toBe(
      "nextPageToken,items(id,summary,summaryOverride,timeZone,accessRole,primary)",
    );
    expect(secondUrl.searchParams.get("pageToken")).toBe("page-two");
  });

  it("classifies revoked refresh credentials without exposing Google's body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ error: "invalid_grant", error_description: "private provider detail" }, 400),
      );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });
    await expect(provider.refreshAccessToken("refresh-token")).rejects.toEqual(
      new GoogleCalendarProviderError("refresh_invalid_grant"),
    );
  });

  it("treats 401 and only insufficient-permission 403 responses as revoked access", async () => {
    for (const [status, body] of [
      [401, { error: "private" }],
      [403, { error: { errors: [{ reason: "insufficientPermissions" }] } }],
    ] as const) {
      const provider = createGoogleCalendarProvider({
        config: CONFIG,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(json(body, status)),
      });
      await expect(provider.listCalendars("access-token")).rejects.toMatchObject({
        code: "access_unauthorized",
      });
    }
    const quotaProvider = createGoogleCalendarProvider({
      config: CONFIG,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ error: { errors: [{ reason: "rateLimitExceeded" }] } }, 403)),
    });
    await expect(quotaProvider.listCalendars("access-token")).rejects.toMatchObject({
      code: "provider_unavailable",
    });
  });

  it("queries only the requested calendars with a minimal UTC FreeBusy payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        calendars: {
          "private-one": {
            busy: [
              {
                start: "2026-10-25T03:30:00+03:00",
                end: "2026-10-25T03:30:00+02:00",
                summary: "must never escape",
              },
            ],
          },
          "private-two": { busy: [] },
        },
        privateTitle: "must never escape",
      }),
    );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    const result = await provider.queryFreeBusy("access-token", {
      calendarIds: ["private-one", "private-two"],
      timeMin: new Date("2026-10-25T00:00:00.000Z"),
      timeMax: new Date("2026-10-25T02:00:00.000Z"),
    });

    expect(result.failedCalendarCount).toBe(0);
    expect(result.busyIntervals).toEqual([
      {
        startsAt: new Date("2026-10-25T00:30:00.000Z"),
        endsAt: new Date("2026-10-25T01:30:00.000Z"),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-one");
    expect(JSON.stringify(result)).not.toContain("must never escape");

    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({
      Authorization: "Bearer access-token",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    if (typeof request?.body !== "string") throw new Error("Missing FreeBusy request body");
    expect(JSON.parse(request.body)).toEqual({
      timeMin: "2026-10-25T00:00:00.000Z",
      timeMax: "2026-10-25T02:00:00.000Z",
      timeZone: "UTC",
      calendarExpansionMax: 50,
      items: [{ id: "private-one" }, { id: "private-two" }],
    });
  });

  it("counts per-calendar FreeBusy errors without returning private details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        calendars: {
          "private-one": {
            errors: [{ domain: "calendar", reason: "notFound", message: "private detail" }],
          },
          "private-two": {
            busy: [{ start: "2026-08-09T10:15:00Z", end: "2026-08-09T10:45:00Z" }],
          },
        },
      }),
    );
    const provider = createGoogleCalendarProvider({ config: CONFIG, fetch: fetchMock });

    const result = await provider.queryFreeBusy("access-token", {
      calendarIds: ["private-one", "private-two"],
      timeMin: new Date("2026-08-09T10:00:00Z"),
      timeMax: new Date("2026-08-09T11:00:00Z"),
    });

    expect(result).toMatchObject({ failedCalendarCount: 1 });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("notFound");
  });
});
