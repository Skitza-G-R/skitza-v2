import { describe, expect, it } from "vitest";

import { browserSafeStoredAudioUrl } from "../urls";

describe("browser-safe audio URLs", () => {
  it("masks every permanent or external audio URL without relying on storage config", () => {
    expect(
      browserSafeStoredAudioUrl("https://audio.example.test/bucket/private/song.wav?old=1"),
    ).toBeNull();
    expect(browserSafeStoredAudioUrl("https://media.example.test/sample.wav")).toBeNull();
  });

  it("preserves only exact protected same-origin route shapes", () => {
    expect(
      browserSafeStoredAudioUrl("/api/audio/stream/10000000-0000-4000-8000-000000000001"),
    ).toBe("/api/audio/stream/10000000-0000-4000-8000-000000000001");
    expect(
      browserSafeStoredAudioUrl("/api/audio/public/portfolio/20000000-0000-4000-8000-000000000002"),
    ).toBe("/api/audio/public/portfolio/20000000-0000-4000-8000-000000000002");
    expect(browserSafeStoredAudioUrl("/api/audio/stream/not-a-uuid")).toBeNull();
    expect(
      browserSafeStoredAudioUrl(
        "/api/audio/stream/10000000-0000-4000-8000-000000000001?download=1",
      ),
    ).toBeNull();
    expect(
      browserSafeStoredAudioUrl(
        "https://skitza.test/api/audio/stream/10000000-0000-4000-8000-000000000001",
      ),
    ).toBeNull();
  });
});
