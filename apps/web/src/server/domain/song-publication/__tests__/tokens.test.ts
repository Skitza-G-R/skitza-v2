import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildSongPublicPath,
  createSongPublicToken,
  hashSongPublicToken,
  SongPublicTokenError,
  verifySongPublicToken,
} from "../tokens";

const SECRET = "sk98-public-song-secret-long-enough";
const LINK_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_DOMAIN = "skitza:song-publication:link:v1";

function signNoncanonical(encodedPayload: string): string {
  const signingKey = createHmac("sha256", SECRET)
    .update(`${TOKEN_DOMAIN}:signing-key`)
    .digest();
  return createHmac("sha256", signingKey)
    .update(`${TOKEN_DOMAIN}\0${encodedPayload}`, "utf8")
    .digest("base64url");
}

describe("song public link tokens", () => {
  it("is deterministic, long-lived, and bound to the link generation", () => {
    const first = createSongPublicToken(SECRET, { linkId: LINK_ID, tokenVersion: 1 });
    const retry = createSongPublicToken(SECRET, { linkId: LINK_ID, tokenVersion: 1 });
    const reset = createSongPublicToken(SECRET, { linkId: LINK_ID, tokenVersion: 2 });

    expect(retry).toBe(first);
    expect(reset).not.toBe(first);
    expect(verifySongPublicToken(SECRET, first)).toEqual({
      version: 1,
      purpose: "song_public_link",
      linkId: LINK_ID,
      tokenVersion: 1,
    });
    expect(buildSongPublicPath(first)).toBe(`/listen/${first}`);
    expect(hashSongPublicToken(first)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects tampering and a different signing secret with one generic error", () => {
    const token = createSongPublicToken(SECRET, { linkId: LINK_ID, tokenVersion: 1 });
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    for (const attempt of [
      () => verifySongPublicToken(SECRET, tampered),
      () => verifySongPublicToken("another-public-song-secret-long-enough", token),
      () => verifySongPublicToken(SECRET, "not-a-token"),
    ]) {
      expect(attempt).toThrow(
        expect.objectContaining({
          name: "SongPublicTokenError",
          message: "Public song was not found",
        }),
      );
    }
  });

  it("rejects a correctly signed but non-canonical payload", () => {
    const noncanonicalJson = JSON.stringify({
      purpose: "song_public_link",
      version: 1,
      tokenVersion: 1,
      linkId: LINK_ID,
    });
    const encoded = Buffer.from(noncanonicalJson, "utf8").toString("base64url");
    const token = `${encoded}.${signNoncanonical(encoded)}`;

    expect(() => verifySongPublicToken(SECRET, token)).toThrow(SongPublicTokenError);
  });

  it.each([
    { linkId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", tokenVersion: 1 },
    { linkId: LINK_ID, tokenVersion: 0 },
    { linkId: LINK_ID, tokenVersion: -1 },
    { linkId: LINK_ID, tokenVersion: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects non-canonical payload input %#", (input) => {
    expect(() => createSongPublicToken(SECRET, input)).toThrow(SongPublicTokenError);
  });

  it("does not accept a weak or absent configured secret", () => {
    expect(() => createSongPublicToken("short", { linkId: LINK_ID, tokenVersion: 1 })).toThrow(
      "Public song links require the configured server auth secret",
    );
  });
});
