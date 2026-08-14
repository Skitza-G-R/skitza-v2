import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { GoogleCalendarServerConfig } from "./config";
import {
  GoogleCalendarCryptoError,
  decryptGoogleCalendarValue,
  deriveGoogleCalendarSelectionId,
  encryptGoogleCalendarValue,
  fingerprintGoogleCalendarId,
} from "./crypto";
import {
  GoogleCalendarOAuthStateError,
  buildGoogleCalendarAuthorizationUrl,
  createGoogleCalendarOAuthState,
  deriveGoogleCalendarPkce,
  verifyGoogleCalendarOAuthState,
} from "./oauth";

const PRODUCER_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const SELECTION_ID = "33333333-3333-4333-8333-333333333333";
const SECRET = randomBytes(32);
const BROWSER_BINDING = "a".repeat(43);
const ENCRYPTION_KEY = randomBytes(32);
const KEYRING = { activeVersion: 3, keys: new Map([[3, ENCRYPTION_KEY]]) };

describe("Google Calendar protected values", () => {
  it("round-trips a token and binds it to account identity, version, and key version", () => {
    const context = {
      producerId: PRODUCER_ID,
      connectionId: CONNECTION_ID,
      googleSubject: "google-subject-a",
      accountVersion: 4,
      purpose: "refresh_token" as const,
    };
    const envelope = encryptGoogleCalendarValue("refresh-secret", context, KEYRING);
    expect(decryptGoogleCalendarValue(envelope, context, KEYRING)).toBe("refresh-secret");
    expect(() =>
      decryptGoogleCalendarValue(
        envelope,
        { ...context, googleSubject: "google-subject-b" },
        KEYRING,
      ),
    ).toThrow(GoogleCalendarCryptoError);
    expect(() =>
      decryptGoogleCalendarValue(envelope, { ...context, accountVersion: 5 }, KEYRING),
    ).toThrow(GoogleCalendarCryptoError);
    expect(() =>
      decryptGoogleCalendarValue({ ...envelope, keyVersion: 4 }, context, {
        activeVersion: 3,
        keys: new Map([
          [3, ENCRYPTION_KEY],
          [4, ENCRYPTION_KEY],
        ]),
      }),
    ).toThrow(GoogleCalendarCryptoError);
  });

  it("binds encrypted calendar IDs to the stable internal selection ID", () => {
    const context = {
      producerId: PRODUCER_ID,
      connectionId: CONNECTION_ID,
      selectionId: SELECTION_ID,
      accountVersion: 2,
      purpose: "provider_calendar_id" as const,
    };
    const envelope = encryptGoogleCalendarValue(
      "private@group.calendar.google.com",
      context,
      KEYRING,
    );
    expect(decryptGoogleCalendarValue(envelope, context, KEYRING)).toBe(
      "private@group.calendar.google.com",
    );
    expect(() =>
      decryptGoogleCalendarValue(
        { ...envelope },
        { ...context, selectionId: "44444444-4444-4444-8444-444444444444" },
        KEYRING,
      ),
    ).toThrow(GoogleCalendarCryptoError);
  });

  it("creates scoped HMAC fingerprints and opaque UUID handles", () => {
    const fingerprint = fingerprintGoogleCalendarId({
      calendarId: "private-id",
      producerId: PRODUCER_ID,
      connectionId: CONNECTION_ID,
      accountVersion: 1,
      secret: SECRET,
    });
    expect(fingerprint).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
    expect(
      fingerprintGoogleCalendarId({
        calendarId: "private-id",
        producerId: PRODUCER_ID,
        connectionId: CONNECTION_ID,
        accountVersion: 2,
        secret: SECRET,
      }),
    ).not.toBe(fingerprint);
    expect(deriveGoogleCalendarSelectionId({ fingerprint, secret: SECRET })).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
  });
});

describe("Google Calendar OAuth state and PKCE", () => {
  const now = new Date("2026-08-09T10:00:00.000Z");

  it("signs a producer-bound state for no more than ten minutes", () => {
    const issued = createGoogleCalendarOAuthState({
      producerId: PRODUCER_ID,
      intent: "reconnect",
      connectionId: CONNECTION_ID,
      expectedAccountVersion: 2,
      browserBinding: BROWSER_BINDING,
      stateSecret: SECRET,
      now,
    });
    expect(issued.binding.expiresAt.getTime() - now.getTime()).toBe(600_000);
    expect(() => {
      verifyGoogleCalendarOAuthState({
        token: issued.token,
        tokenDigest: issued.tokenDigest,
        binding: issued.binding,
        browserBinding: BROWSER_BINDING,
        stateSecret: SECRET,
        now: new Date(now.getTime() + 599_000),
      });
    }).not.toThrow();
    expect(() => {
      verifyGoogleCalendarOAuthState({
        token: issued.token,
        tokenDigest: issued.tokenDigest,
        binding: { ...issued.binding, producerId: "another-producer" },
        browserBinding: BROWSER_BINDING,
        stateSecret: SECRET,
        now,
      });
    }).toThrow(GoogleCalendarOAuthStateError);
    expect(() => {
      verifyGoogleCalendarOAuthState({
        token: issued.token,
        tokenDigest: issued.tokenDigest,
        binding: issued.binding,
        browserBinding: "b".repeat(43),
        stateSecret: SECRET,
        now,
      });
    }).toThrow(GoogleCalendarOAuthStateError);
    expect(() => {
      verifyGoogleCalendarOAuthState({
        token: issued.token,
        tokenDigest: issued.tokenDigest,
        binding: issued.binding,
        browserBinding: BROWSER_BINDING,
        stateSecret: SECRET,
        now: issued.binding.expiresAt,
      });
    }).toThrow(GoogleCalendarOAuthStateError);
  });

  it("derives deterministic S256 PKCE and builds the exact Google request", () => {
    const issued = createGoogleCalendarOAuthState({
      producerId: PRODUCER_ID,
      intent: "connect",
      connectionId: null,
      expectedAccountVersion: null,
      browserBinding: BROWSER_BINDING,
      stateSecret: SECRET,
      now,
    });
    const first = deriveGoogleCalendarPkce(issued.token, PRODUCER_ID, SECRET);
    const second = deriveGoogleCalendarPkce(issued.token, PRODUCER_ID, SECRET);
    expect(first).toEqual(second);
    expect(first.codeVerifier).toHaveLength(43);
    expect(first.codeChallenge).toHaveLength(43);

    const config = {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://preview.test/api/integrations/google-calendar/callback",
      stateSecret: SECRET,
      encryption: KEYRING,
      calendarIdFingerprintSecret: SECRET,
    } satisfies GoogleCalendarServerConfig;
    const url = new URL(
      buildGoogleCalendarAuthorizationUrl({
        config,
        stateToken: issued.token,
        codeChallenge: first.codeChallenge,
      }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });

  it("rejects state lifetimes over ten minutes", () => {
    expect(() =>
      createGoogleCalendarOAuthState({
        producerId: PRODUCER_ID,
        intent: "connect",
        connectionId: null,
        expectedAccountVersion: null,
        browserBinding: BROWSER_BINDING,
        stateSecret: SECRET,
        now,
        lifetimeSeconds: 601,
      }),
    ).toThrow(GoogleCalendarOAuthStateError);
  });
});
