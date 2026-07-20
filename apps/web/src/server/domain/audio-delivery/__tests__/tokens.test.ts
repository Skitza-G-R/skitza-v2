import { describe, expect, it } from "vitest";

import {
  AudioDeliveryTokenError,
  PUBLIC_AUDIO_STREAM_TOKEN_TTL_SECONDS,
  createPublicAudioStreamToken,
  verifyPublicAudioStreamToken,
} from "../tokens";

const SECRET = "skitza-test-audio-delivery-secret";
const NOW = new Date("2026-07-20T10:00:00.000Z");
const PUBLIC_INPUT = {
  producerId: "10000000-0000-4000-8000-000000000001",
  publicSampleId: "60000000-0000-4000-8000-000000000006",
};

function tokenPayload(token: string): Record<string, unknown> {
  const [payload] = token.split(".");
  if (!payload) throw new Error("missing test token payload");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("public audio stream tokens", () => {
  it("uses a minimal public-sample payload with no viewer, storage, or download grant", () => {
    const token = createPublicAudioStreamToken(SECRET, PUBLIC_INPUT, NOW);
    const verified = verifyPublicAudioStreamToken(SECRET, token, NOW);

    expect(verified).toEqual({
      version: 1,
      purpose: "public_stream",
      ...PUBLIC_INPUT,
      expiresAtEpochSeconds:
        Math.floor(NOW.getTime() / 1_000) + PUBLIC_AUDIO_STREAM_TOKEN_TTL_SECONDS,
    });
    expect(Object.keys(tokenPayload(token)).sort()).toEqual(
      ["version", "purpose", "producerId", "publicSampleId", "expiresAtEpochSeconds"].sort(),
    );
    expect(Object.isFrozen(verified)).toBe(true);
  });

  it("supports an open page but expires at the strict four-hour boundary", () => {
    const token = createPublicAudioStreamToken(SECRET, PUBLIC_INPUT, NOW);

    expect(() =>
      verifyPublicAudioStreamToken(
        SECRET,
        token,
        new Date(NOW.getTime() + PUBLIC_AUDIO_STREAM_TOKEN_TTL_SECONDS * 1_000 - 1),
      ),
    ).not.toThrow();
    expect(() =>
      verifyPublicAudioStreamToken(
        SECRET,
        token,
        new Date(NOW.getTime() + PUBLIC_AUDIO_STREAM_TOKEN_TTL_SECONDS * 1_000),
      ),
    ).toThrow(AudioDeliveryTokenError);
  });

  it("rejects signature tampering, payload tampering, wrong secrets, and malformed encodings", () => {
    const token = createPublicAudioStreamToken(SECRET, PUBLIC_INPUT, NOW);
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new Error("missing test token segment");

    const signatureTampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    const decoded = tokenPayload(token);
    decoded.publicSampleId = "70000000-0000-4000-8000-000000000007";
    const payloadTampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

    expect(() => verifyPublicAudioStreamToken(SECRET, signatureTampered, NOW)).toThrow(
      AudioDeliveryTokenError,
    );
    expect(() => verifyPublicAudioStreamToken(SECRET, payloadTampered, NOW)).toThrow(
      AudioDeliveryTokenError,
    );
    expect(() => verifyPublicAudioStreamToken(`${SECRET}-wrong`, token, NOW)).toThrow(
      AudioDeliveryTokenError,
    );
    expect(() => verifyPublicAudioStreamToken(SECRET, `${token}=`, NOW)).toThrow(
      AudioDeliveryTokenError,
    );
  });

  it("rejects non-canonical identifiers, extra claims, wrong purpose, and missing secrets", () => {
    expect(() =>
      createPublicAudioStreamToken(
        SECRET,
        { ...PUBLIC_INPUT, producerId: "A0000000-0000-4000-8000-000000000001" },
        NOW,
      ),
    ).toThrow(AudioDeliveryTokenError);
    expect(() =>
      createPublicAudioStreamToken(
        SECRET,
        { ...PUBLIC_INPUT, storageKey: "must-never-enter-a-token" } as typeof PUBLIC_INPUT,
        NOW,
      ),
    ).toThrow(AudioDeliveryTokenError);

    const token = createPublicAudioStreamToken(SECRET, PUBLIC_INPUT, NOW);
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new Error("missing test token segment");
    const decoded = tokenPayload(token);
    decoded.purpose = "private_stream";
    expect(() =>
      verifyPublicAudioStreamToken(
        SECRET,
        `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`,
        NOW,
      ),
    ).toThrow(AudioDeliveryTokenError);
    expect(() => createPublicAudioStreamToken("too-short", PUBLIC_INPUT, NOW)).toThrow(
      /configured server auth secret/i,
    );
  });
});
