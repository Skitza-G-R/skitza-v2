import { describe, expect, it } from "vitest";

import {
  filterPublicSongBrowserTelemetry,
  isPublicSongListenPath,
  redactPublicSongTelemetry,
  redactPublicSongTelemetryString,
} from "./public-song-telemetry";

const LINK_TOKEN = "eyJsaW5rSWQiOiJsaXZlIn0.public-link-signature";
const AUDIO_CAPABILITY = "eyJ2ZXJzaW9uSWQiOiJ2MSJ9.audio-capability-signature";

describe("public-song telemetry privacy", () => {
  it("redacts listen bearer paths and public-audio query authorities", () => {
    const value =
      `https://skitza.app/listen/${LINK_TOKEN}` +
      `?token=${LINK_TOKEN}&cap=${AUDIO_CAPABILITY}&version=version-1`;

    const redacted = redactPublicSongTelemetryString(value);

    expect(redacted).toBe(
      "https://skitza.app/listen/[redacted]" +
        "?token=[redacted]&cap=[redacted]&version=version-1",
    );
    expect(redacted).not.toContain(LINK_TOKEN);
    expect(redacted).not.toContain(AUDIO_CAPABILITY);
  });

  it("redacts nested URLs, raw query strings, and token-shaped properties without mutation", () => {
    const payload = {
      request: {
        url: `/api/audio/public/song/version-1?token=${LINK_TOKEN}&cap=${AUDIO_CAPABILITY}`,
        query_string: `token=${LINK_TOKEN}&cap=${AUDIO_CAPABILITY}&range=1`,
      },
      contexts: [{ token: LINK_TOKEN }, { CAP: AUDIO_CAPABILITY }],
      safe: "version-1",
    };

    const redacted = redactPublicSongTelemetry(payload);

    expect(JSON.stringify(redacted)).not.toContain(LINK_TOKEN);
    expect(JSON.stringify(redacted)).not.toContain(AUDIO_CAPABILITY);
    expect(redacted).toMatchObject({
      request: {
        query_string: "token=[redacted]&cap=[redacted]&range=1",
      },
      contexts: [{ token: "[redacted]" }, { CAP: "[redacted]" }],
      safe: "version-1",
    });
    expect(payload.contexts[0]?.token).toBe(LINK_TOKEN);
  });

  it("drops browser telemetry on listen pages and keeps lookalike routes", () => {
    const payload = { event: "pageview", url: `/listen/${LINK_TOKEN}` };

    expect(filterPublicSongBrowserTelemetry(payload, `/listen/${LINK_TOKEN}`)).toBeNull();
    expect(filterPublicSongBrowserTelemetry(payload, "/listen")).toBeNull();
    expect(filterPublicSongBrowserTelemetry(payload, "/listener/settings")).toEqual({
      event: "pageview",
      url: "/listen/[redacted]",
    });
  });

  it.each([
    ["/listen", true],
    ["/listen/", true],
    [`/listen/${LINK_TOKEN}`, true],
    ["/listener/token", false],
    ["/dashboard/listen/token", false],
  ])("classifies %s without broad prefix matches", (pathname, expected) => {
    expect(isPublicSongListenPath(pathname)).toBe(expected);
  });
});
