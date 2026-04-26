import { describe, expect, it } from "vitest";

import { deriveTrackTitle } from "../title-derive";

// Story 05 — pure helper for the drop-first add-track UX. The producer
// drops a file → the server (via projectRoom.createTrackFromUpload) and
// the client (for the optimistic preview row) both derive the title
// from the filename so no title-first form is needed. The server
// already has its own implementation in project-room.ts; this client
// helper mirrors the same rules so the optimistic row's title matches
// what the server will persist after the round-trip.
//
// Rules (PRD §11.6 + story Acceptance):
//   1. Strip extension (.wav | .mp3 | .aif | .aiff | .flac | .m4a)
//   2. Iteratively strip suffixes (case-insensitive):
//        _v\d+ | _master | _mix | _final | _demo | _rough
//   3. Replace `_` and `-` with spaces, collapse whitespace, trim
//   4. Title-case (capitalize first letter of each word, don't
//      lowercase ALL-CAPS like "OK")
//   5. Empty result → "Untitled track"

describe("deriveTrackTitle — filename → human-readable title", () => {
  it("strips a basic .wav extension", () => {
    expect(deriveTrackTitle("midnight_drive.wav")).toBe("Midnight Drive");
  });

  it("strips .mp3 / .flac / .m4a / .aif / .aiff", () => {
    expect(deriveTrackTitle("track.mp3")).toBe("Track");
    expect(deriveTrackTitle("song.flac")).toBe("Song");
    expect(deriveTrackTitle("demo.m4a")).toBe("Demo");
    expect(deriveTrackTitle("clip.aif")).toBe("Clip");
    expect(deriveTrackTitle("clip.aiff")).toBe("Clip");
  });

  it("strips _v\\d+ suffix (case-insensitive)", () => {
    expect(deriveTrackTitle("midnight_drive_v3.wav")).toBe("Midnight Drive");
    expect(deriveTrackTitle("midnight_drive_V12.wav")).toBe("Midnight Drive");
  });

  it("strips _master suffix (case-insensitive)", () => {
    expect(deriveTrackTitle("midnight_drive_master.wav")).toBe("Midnight Drive");
    expect(deriveTrackTitle("midnight_drive_MASTER.wav")).toBe("Midnight Drive");
  });

  it("strips _mix / _final / _demo / _rough suffixes", () => {
    expect(deriveTrackTitle("song_mix.wav")).toBe("Song");
    expect(deriveTrackTitle("song_final.wav")).toBe("Song");
    expect(deriveTrackTitle("song_demo.wav")).toBe("Song");
    expect(deriveTrackTitle("song_rough.wav")).toBe("Song");
  });

  it("strips multiple suffixes iteratively (e.g. _v3_master)", () => {
    expect(deriveTrackTitle("midnight_drive_v3_master.wav")).toBe(
      "Midnight Drive",
    );
    expect(deriveTrackTitle("song_final_v2.wav")).toBe("Song");
    expect(deriveTrackTitle("song_master_mix_final.wav")).toBe("Song");
  });

  it("replaces hyphens with spaces", () => {
    expect(deriveTrackTitle("midnight-drive.wav")).toBe("Midnight Drive");
  });

  it("collapses repeated whitespace", () => {
    expect(deriveTrackTitle("midnight   drive.wav")).toBe("Midnight Drive");
  });

  it("trims leading/trailing whitespace + underscores", () => {
    expect(deriveTrackTitle("  _midnight_drive_.wav")).toBe("Midnight Drive");
  });

  it("title-cases lowercase words but preserves intentional ALL-CAPS", () => {
    // "OK" stays "OK" — we only uppercase the first letter, never
    // lowercase existing capitals (so acronyms / stylized names survive).
    expect(deriveTrackTitle("ok_song.wav")).toBe("Ok Song");
    expect(deriveTrackTitle("OK_song.wav")).toBe("OK Song");
    expect(deriveTrackTitle("NASA_anthem.wav")).toBe("NASA Anthem");
  });

  it("returns 'Untitled track' when filename strips down to empty", () => {
    expect(deriveTrackTitle("_v3.wav")).toBe("Untitled track");
    expect(deriveTrackTitle(".wav")).toBe("Untitled track");
    expect(deriveTrackTitle("_master.wav")).toBe("Untitled track");
    expect(deriveTrackTitle("_v3_master.wav")).toBe("Untitled track");
  });

  it("handles a filename with no extension", () => {
    expect(deriveTrackTitle("midnight_drive")).toBe("Midnight Drive");
  });

  it("handles uppercase extension", () => {
    expect(deriveTrackTitle("midnight_drive.WAV")).toBe("Midnight Drive");
  });

  it("doesn't strip extension-like text mid-name", () => {
    // "track.mp3.wav" → only the trailing .wav stripped, then ".mp3" stays
    // (hyphens and dots inside aren't touched outside extension stripping).
    // Acceptable behavior: "Track.mp3"
    expect(deriveTrackTitle("track.mp3.wav")).toBe("Track.mp3");
  });

  it("doesn't strip suffixes mid-string (only at end)", () => {
    // "master_mix" — the final "_mix" strips, then nothing else matches
    // because after stripping `_mix` we have "master" as a standalone
    // word, not a recognised trailing suffix. Acceptable: "Master".
    expect(deriveTrackTitle("master_mix.wav")).toBe("Master");
  });
});
