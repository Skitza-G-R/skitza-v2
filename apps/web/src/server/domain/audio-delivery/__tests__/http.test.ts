import { describe, expect, it } from "vitest";

import {
  AudioRangeNotSatisfiableError,
  audioDownloadContentDisposition,
  normalizeAudioContentType,
  parseSingleByteRange,
  privateAudioRangeNotSatisfiableHeaders,
  privateAudioResponseHeaders,
  privateAudioSecurityHeaders,
  safeAudioDownloadFileName,
} from "../http";

describe("single audio byte ranges", () => {
  it("parses bounded, open-ended, and suffix ranges", () => {
    expect(parseSingleByteRange(null, 1_000)).toBeNull();
    expect(parseSingleByteRange("bytes=10-19", 1_000)).toEqual({
      start: 10,
      end: 19,
      length: 10,
    });
    expect(parseSingleByteRange("bytes=900-", 1_000)).toEqual({
      start: 900,
      end: 999,
      length: 100,
    });
    expect(parseSingleByteRange("bytes=-25", 1_000)).toEqual({
      start: 975,
      end: 999,
      length: 25,
    });
  });

  it("caps an oversized end and lets an oversized suffix select the whole object", () => {
    expect(parseSingleByteRange("bytes=990-5000", 1_000)).toEqual({
      start: 990,
      end: 999,
      length: 10,
    });
    expect(parseSingleByteRange("bytes=-5000", 1_000)).toEqual({
      start: 0,
      end: 999,
      length: 1_000,
    });
  });

  it.each([
    "",
    "items=0-10",
    "bytes=",
    "bytes=-",
    "bytes=-0",
    "bytes=1000-",
    "bytes=20-10",
    "bytes=0-1,4-5",
    "bytes=+1-2",
    `bytes=0-${"9".repeat(201)}`,
  ])("rejects an invalid or multipart range: %s", (header) => {
    expect(() => parseSingleByteRange(header, 1_000)).toThrow(AudioRangeNotSatisfiableError);
  });

  it("fails closed when the recorded object size is not a safe positive integer", () => {
    for (const sizeBytes of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseSingleByteRange(null, sizeBytes)).toThrow(AudioRangeNotSatisfiableError);
    }
  });
});

describe("private audio response headers", () => {
  it("sets private no-store and nosniff headers for unavailable responses", () => {
    const headers = privateAudioSecurityHeaders();

    expect(headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("builds a full inline streaming response without trusting unsafe content types", () => {
    const headers = privateAudioResponseHeaders({
      contentType: "audio/MPEG",
      sizeBytes: 1_000,
    });

    expect(headers.get("Accept-Ranges")).toBe("bytes");
    expect(headers.get("Content-Length")).toBe("1000");
    expect(headers.get("Content-Type")).toBe("audio/mpeg");
    expect(headers.get("Content-Disposition")).toBe("inline");
    expect(
      privateAudioResponseHeaders({
        contentType: "audio/mpeg\r\nX-Leak: yes",
        sizeBytes: 1_000,
      }).get("Content-Type"),
    ).toBe("application/octet-stream");
  });

  it("builds exact partial-response and 416 headers", () => {
    const range = parseSingleByteRange("bytes=100-199", 1_000);
    const partial = privateAudioResponseHeaders({
      contentType: "audio/wav",
      sizeBytes: 1_000,
      range,
    });
    const rejected = privateAudioRangeNotSatisfiableHeaders(1_000);

    expect(partial.get("Content-Length")).toBe("100");
    expect(partial.get("Content-Range")).toBe("bytes 100-199/1000");
    expect(rejected.get("Content-Range")).toBe("bytes */1000");
    expect(rejected.get("Cache-Control")).toContain("no-store");
    expect(rejected.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("uses the sanitized attachment name for a download response", () => {
    const headers = privateAudioResponseHeaders({
      contentType: "audio/flac",
      sizeBytes: 1_000,
      downloadFileName: `final\r\nX-Leak: yes.flac`,
    });

    expect(headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(headers.get("Content-Disposition")).not.toMatch(/[\r\n]/);
  });

  it("rejects a forged range that does not match the recorded object size", () => {
    expect(() =>
      privateAudioResponseHeaders({
        contentType: "audio/wav",
        sizeBytes: 1_000,
        range: { start: 900, end: 1_000, length: 101 },
      }),
    ).toThrow(AudioRangeNotSatisfiableError);
  });
});

describe("safe audio download filenames", () => {
  it("removes path separators, controls, bidi controls, quotes, and header delimiters", () => {
    const unsafe = `../../mix\r\nX-Evil: yes;"\\\u202emaster.wav`;
    const safe = safeAudioDownloadFileName(unsafe);
    const disposition = audioDownloadContentDisposition(unsafe);

    expect(safe).not.toMatch(/[\r\n/\\:;"\u202e]/);
    expect(disposition).toMatch(/^attachment; filename=/);
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).not.toMatch(/[\r\n\u202e]/);
  });

  it("keeps a bounded Unicode name in filename* with a safe ASCII fallback", () => {
    const fileName = `${"מיקס סופי ".repeat(30)}.wav`;
    const safe = safeAudioDownloadFileName(fileName);
    const disposition = audioDownloadContentDisposition(fileName);

    expect(Array.from(safe).length).toBeLessThanOrEqual(180);
    expect(disposition).toContain("%D7%9E%D7%99%D7%A7%D7%A1");
    expect(disposition).not.toContain("מיקס");
  });

  it("uses a stable fallback for an empty or reserved-only name", () => {
    expect(safeAudioDownloadFileName(" ... ")).toBe("audio-download");
    expect(normalizeAudioContentType("text/html")).toBe("application/octet-stream");
  });
});
