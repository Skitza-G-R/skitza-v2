import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GoogleCalendarConfigurationError,
  googleCalendarWebhookAddress,
  isGoogleCalendarCapabilityAvailable,
  loadGoogleCalendarServerConfig,
  type GoogleCalendarEnvironment,
} from "./config";

function validEnvironment(
  overrides: Partial<GoogleCalendarEnvironment> = {},
): GoogleCalendarEnvironment {
  const stateKey = randomBytes(32).toString("base64");
  const encryptionKey = randomBytes(32).toString("base64");
  const fingerprintKey = randomBytes(32).toString("base64");
  return {
    NODE_ENV: "development",
    GOOGLE_CALENDAR_ENABLED: "true",
    GOOGLE_CALENDAR_CLIENT_ID: "client-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
    GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/api/integrations/google-calendar/callback",
    GOOGLE_CALENDAR_STATE_SECRET: stateKey,
    GOOGLE_CALENDAR_ENCRYPTION_KEYS: JSON.stringify({ 7: encryptionKey }),
    GOOGLE_CALENDAR_ACTIVE_KEY_VERSION: "7",
    GOOGLE_CALENDAR_ID_FINGERPRINT_SECRET: fingerprintKey,
    ...overrides,
  };
}

describe("Google Calendar server configuration", () => {
  it("hard-denies Vercel Production even when the flag is enabled", () => {
    expect(
      isGoogleCalendarCapabilityAvailable(validEnvironment({ VERCEL_ENV: "production" })),
    ).toBe(false);
  });

  it("requires the explicit flag in local development and Vercel Preview", () => {
    expect(isGoogleCalendarCapabilityAvailable(validEnvironment())).toBe(true);
    expect(isGoogleCalendarCapabilityAvailable(validEnvironment({ VERCEL_ENV: "preview" }))).toBe(
      true,
    );
    expect(
      isGoogleCalendarCapabilityAvailable(validEnvironment({ GOOGLE_CALENDAR_ENABLED: "false" })),
    ).toBe(false);
  });

  it("loads only canonical 32-byte keys with PostgreSQL integer versions", () => {
    const config = loadGoogleCalendarServerConfig(validEnvironment());
    expect(config.encryption.activeVersion).toBe(7);
    expect(config.encryption.keys.get(7)).toHaveLength(32);

    expect(() =>
      loadGoogleCalendarServerConfig(
        validEnvironment({ GOOGLE_CALENDAR_ACTIVE_KEY_VERSION: "2147483648" }),
      ),
    ).toThrow(GoogleCalendarConfigurationError);
  });

  it("rejects key reuse between state, encryption, and ID fingerprints", () => {
    const stateKey = randomBytes(32).toString("base64");
    expect(() =>
      loadGoogleCalendarServerConfig(
        validEnvironment({
          GOOGLE_CALENDAR_STATE_SECRET: stateKey,
          GOOGLE_CALENDAR_ID_FINGERPRINT_SECRET: stateKey,
        }),
      ),
    ).toThrow(GoogleCalendarConfigurationError);
  });

  it("accepts HTTPS callbacks and only localhost HTTP on the exact callback path", () => {
    expect(
      loadGoogleCalendarServerConfig(
        validEnvironment({
          GOOGLE_CALENDAR_REDIRECT_URI:
            "https://preview.skitza.app/api/integrations/google-calendar/callback",
        }),
      ).redirectUri,
    ).toBe("https://preview.skitza.app/api/integrations/google-calendar/callback");
    expect(() =>
      loadGoogleCalendarServerConfig(
        validEnvironment({
          GOOGLE_CALENDAR_REDIRECT_URI:
            "http://preview.skitza.app/api/integrations/google-calendar/callback",
        }),
      ),
    ).toThrow(GoogleCalendarConfigurationError);
  });

  it("derives the fixed same-origin webhook without adding configuration", () => {
    const config = loadGoogleCalendarServerConfig(
      validEnvironment({
        GOOGLE_CALENDAR_REDIRECT_URI:
          "https://preview.skitza.app/api/integrations/google-calendar/callback",
      }),
    );
    expect(googleCalendarWebhookAddress(config)).toBe(
      "https://preview.skitza.app/api/webhooks/google-calendar",
    );
  });
});
