import { describe, expect, it } from "vitest";

import {
  ADDRESS_AUDIO_CAPABILITY_TTL_SECONDS,
  createAddressAudioCapability,
  createPortfolioAudioCapability,
  SongPublicAudioCapabilityError,
  verifyAddressAudioCapability,
  verifyPortfolioAudioCapability,
} from "../audio-capability";

const SECRET = "sk98-test-secret-that-is-long-enough";
const NOW = new Date("2026-07-20T10:00:00.000Z");
const input = {
  producerId: "11111111-1111-4111-8111-111111111111",
  trackId: "22222222-2222-4222-8222-222222222222",
  versionId: "33333333-3333-4333-8333-333333333333",
  portfolioPublishedAtEpochMs: NOW.getTime(),
};

const addressInput = {
  pageVersionId: "44444444-4444-4444-8444-444444444444",
  trackId: input.trackId,
  versionId: input.versionId,
};

describe("portfolio audio capabilities", () => {
  it("binds the exact song, newest version, and publication generation", () => {
    const token = createPortfolioAudioCapability(SECRET, input, NOW);
    expect(verifyPortfolioAudioCapability(SECRET, token, NOW)).toEqual({
      version: 1,
      purpose: "portfolio_audio",
      ...input,
      expiresAtEpochSeconds: Math.floor(NOW.getTime() / 1_000) + 14_400,
    });
  });

  it.each(["", "not-a-token", "eyJwdXJwb3NlIjoicG9ydGZvbGlvX2F1ZGlvIn0.invalid"])(
    "fails closed for malformed or tampered input",
    (token) => {
      expect(() => verifyPortfolioAudioCapability(SECRET, token, NOW)).toThrow(
        SongPublicAudioCapabilityError,
      );
    },
  );

  it("expires and cannot be verified with a different server secret", () => {
    const token = createPortfolioAudioCapability(SECRET, input, NOW);
    expect(() =>
      verifyPortfolioAudioCapability("another-server-secret-long-enough", token, NOW),
    ).toThrow(SongPublicAudioCapabilityError);
    expect(() =>
      verifyPortfolioAudioCapability(SECRET, token, new Date("2026-07-20T14:00:00.000Z")),
    ).toThrow(SongPublicAudioCapabilityError);
  });
});

describe("address-shared song audio capabilities", () => {
  it("binds the page credential, track, requested version, and a short expiry", () => {
    const token = createAddressAudioCapability(SECRET, addressInput, NOW);

    expect(verifyAddressAudioCapability(SECRET, token, NOW)).toEqual({
      version: 1,
      purpose: "address_audio",
      ...addressInput,
      expiresAtEpochSeconds:
        Math.floor(NOW.getTime() / 1_000) + ADDRESS_AUDIO_CAPABILITY_TTL_SECONDS,
    });
    expect(ADDRESS_AUDIO_CAPABILITY_TTL_SECONDS).toBeLessThan(60 * 60);
  });

  it("fails closed after expiry, on tampering, and across capability purposes", () => {
    const token = createAddressAudioCapability(SECRET, addressInput, NOW);
    const portfolio = createPortfolioAudioCapability(SECRET, input, NOW);

    expect(() =>
      verifyAddressAudioCapability(
        SECRET,
        token,
        new Date(NOW.getTime() + ADDRESS_AUDIO_CAPABILITY_TTL_SECONDS * 1_000),
      ),
    ).toThrow(SongPublicAudioCapabilityError);
    expect(() => verifyAddressAudioCapability(SECRET, `${token}x`, NOW)).toThrow(
      SongPublicAudioCapabilityError,
    );
    expect(() => verifyAddressAudioCapability(SECRET, portfolio, NOW)).toThrow(
      SongPublicAudioCapabilityError,
    );
    expect(() => verifyPortfolioAudioCapability(SECRET, token, NOW)).toThrow(
      SongPublicAudioCapabilityError,
    );
  });
});
