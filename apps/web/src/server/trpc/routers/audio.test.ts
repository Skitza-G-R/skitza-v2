import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateUploadInput } from "./audio";

describe("audio upload validation", () => {
  it("rejects files over 500MB", () => {
    expect(() => {
      validateUploadInput({ filename: "x.wav", sizeBytes: 501 * 1024 * 1024, contentType: "audio/wav" });
    }).toThrow(/500 ?MB/i);
  });
  it("rejects non-audio content types", () => {
    expect(() => {
      validateUploadInput({ filename: "x.jpg", sizeBytes: 1000, contentType: "image/jpeg" });
    }).toThrow(/audio/i);
  });
  it("accepts wav/mp3/flac/m4a/aiff", () => {
    for (const ct of ["audio/wav", "audio/mpeg", "audio/flac", "audio/x-m4a", "audio/aiff"]) {
      expect(() => {
        validateUploadInput({ filename: "x", sizeBytes: 1000, contentType: ct });
      }).not.toThrow();
    }
  });
});

// C1 — the artist "new version uploaded" email used to fire in
// project.addVersion. That mutation runs at the START of the upload
// chain (with audioUrl=null patched later by completeMultipart), so
// emailing there pointed the artist at a missing file. Source-grep
// invariants below pin the email to completeMultipart instead.
const here = dirname(fileURLToPath(import.meta.url));
const AUDIO_SRC = readFileSync(join(here, "audio.ts"), "utf-8");
const PROJECT_SRC = readFileSync(join(here, "project.ts"), "utf-8");

describe("C1 — track-version-uploaded email lives in completeMultipart", () => {
  it("audio router imports sendTrackVersionUploadedEmail", () => {
    expect(AUDIO_SRC).toContain("sendTrackVersionUploadedEmail");
  });

  it("audio router imports `after` from next/server", () => {
    expect(AUDIO_SRC).toMatch(/from\s+["']next\/server["']/);
    expect(AUDIO_SRC).toMatch(/\bafter\b/);
  });

  it("audio router calls sendTrackVersionUploadedEmail (it's the new owner)", () => {
    expect(AUDIO_SRC).toMatch(/sendTrackVersionUploadedEmail\(/);
  });

  it("project router no longer sends sendTrackVersionUploadedEmail in addVersion", () => {
    // Confirm the import was dropped or, if still present, the call site
    // inside addVersion no longer fires. Cheapest invariant: ensure the
    // function isn't called anywhere in project.ts. addVersion was the
    // only caller in project.ts; if anything else needs it later, this
    // test will fire and prompt a real review.
    expect(PROJECT_SRC).not.toMatch(/sendTrackVersionUploadedEmail\(/);
  });
});

// Waveform peaks pre-compute (this task). audio.completeMultipart must
// fetch the just-uploaded bytes back from R2, decode them server-side
// via computePeaksFromBytes, and persist the array on the trackVersions
// row in the same UPDATE that sets audioUrl. The L3 song page reads
// the column on first render — without this server compute step the
// browser would still do the full decodeAudioData round-trip on every
// viewer's machine.
describe("waveform peaks pre-compute lives in audio.completeMultipart", () => {
  it("audio router imports the server peaks helper", () => {
    expect(AUDIO_SRC).toMatch(
      /from\s+["']~\/server\/audio\/peaks["']/,
    );
    expect(AUDIO_SRC).toContain("computePeaksFromBytes");
  });

  it("audio router fetches the just-uploaded object back via GetObject (S3, not CDN)", () => {
    // GetObject bypasses the public CDN's potential 404 cache during
    // the eventual-consistency window right after CompleteMultipart.
    expect(AUDIO_SRC).toContain("GetObjectCommand");
  });

  it("completeMultipart writes `peaks` on the trackVersions row", () => {
    // The single UPDATE call sets audioUrl + audioR2Key + sizeBytes +
    // peaks together so the song page sees a consistent snapshot.
    expect(AUDIO_SRC).toMatch(/peaks\s*[,:]/);
    expect(AUDIO_SRC).toMatch(/\.update\(\s*trackVersions\s*\)[\s\S]*?peaks/);
  });

  it("computeUploadPeaks bounds the decode with a timeout (no hung uploads)", () => {
    // A malformed container can hang audio-decode indefinitely. The
    // race with a setTimeout keeps the producer's upload response
    // bounded — failure mode is peaks=null + client-side fallback.
    expect(AUDIO_SRC).toContain("PEAKS_COMPUTE_TIMEOUT_MS");
    expect(AUDIO_SRC).toMatch(/Promise\.race\(/);
  });
});
