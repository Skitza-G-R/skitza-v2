import { describe, expect, it } from "vitest";

import {
  pickStatusCopy,
  nextVersionLabel,
  categorizeFiles,
  type VersionStatus,
  type ViewerRole,
} from "../music-helpers";

// Story 05 — pure helpers used across the Music tab UI tree.
//
// These are the "logic" pieces that can't sit inside the React layer
// without making the components hard to test (the repo doesn't ship
// jsdom + RTL — see CLAUDE.md). Pinning each branch here lets the
// .tsx files stay thin presentational shells.

describe("pickStatusCopy — bilateral pill copy table", () => {
  // Producer view — internal language.
  it("draft → 'Draft' (producer view)", () => {
    expect(pickStatusCopy("draft", "producer")).toEqual({
      label: "Draft",
      tone: "neutral",
    });
  });

  it("revisit → 'Revisit' (producer view)", () => {
    expect(pickStatusCopy("revisit", "producer")).toEqual({
      label: "Revisit",
      tone: "warn",
    });
  });

  it("final → 'Final' (producer view)", () => {
    expect(pickStatusCopy("final", "producer")).toEqual({
      label: "Final",
      tone: "positive",
    });
  });

  // Artist view — softer / outcome-oriented language.
  it("draft → 'In progress' (artist view)", () => {
    expect(pickStatusCopy("draft", "artist")).toEqual({
      label: "In progress",
      tone: "neutral",
    });
  });

  it("revisit → 'Needs work' (artist view)", () => {
    expect(pickStatusCopy("revisit", "artist")).toEqual({
      label: "Needs work",
      tone: "warn",
    });
  });

  it("final → 'Approved' (artist view)", () => {
    expect(pickStatusCopy("final", "artist")).toEqual({
      label: "Approved",
      tone: "positive",
    });
  });

  it("tone is identical across viewer roles for the same enum", () => {
    // The colour token is bound to the DB enum, never the viewer's
    // role copy — so producer + artist always see the same pill colour
    // for the same underlying status.
    const statuses: VersionStatus[] = ["draft", "revisit", "final"];
    const viewers: ViewerRole[] = ["producer", "artist"];
    for (const s of statuses) {
      const tones = viewers.map((v) => pickStatusCopy(s, v).tone);
      expect(new Set(tones).size).toBe(1);
    }
  });
});

describe("nextVersionLabel — N+1 default for drop-on-row gesture", () => {
  it("empty array → V1", () => {
    expect(nextVersionLabel([])).toBe("V1");
  });

  it("['V1'] → V2", () => {
    expect(nextVersionLabel(["V1"])).toBe("V2");
  });

  it("['V1', 'V2'] → V3", () => {
    expect(nextVersionLabel(["V1", "V2"])).toBe("V3");
  });

  it("ignores non-numeric labels and counts the array length", () => {
    // Producers occasionally rename a version ("rough mix", "stems")
    // — fall back to count + 1 so we never pick a colliding label.
    expect(nextVersionLabel(["V1", "stems", "rough mix"])).toBe("V4");
  });

  it("handles ten-plus versions", () => {
    const labels = Array.from({ length: 11 }, (_, i) => `V${String(i + 1)}`);
    expect(nextVersionLabel(labels)).toBe("V12");
  });
});

describe("categorizeFiles — split dropped files into audio + rejected", () => {
  // Helper to build a fake File with a given name. We can't construct
  // a real File in the node test env (no Blob constructor in older
  // node, but vitest exposes one); we use a minimal shape that matches
  // what categorizeFiles inspects (just the .name field).
  function fakeFile(name: string): File {
    return { name } as File;
  }

  it("accepts .wav / .mp3 / .flac / .m4a / .aif / .aiff", () => {
    const files = [
      fakeFile("a.wav"),
      fakeFile("b.mp3"),
      fakeFile("c.flac"),
      fakeFile("d.m4a"),
      fakeFile("e.aif"),
      fakeFile("f.aiff"),
    ];
    const out = categorizeFiles(files);
    expect(out.audio).toHaveLength(6);
    expect(out.rejected).toHaveLength(0);
  });

  it("accepts uppercase extensions", () => {
    const out = categorizeFiles([fakeFile("song.WAV"), fakeFile("song.MP3")]);
    expect(out.audio).toHaveLength(2);
    expect(out.rejected).toHaveLength(0);
  });

  it("rejects non-audio files", () => {
    const out = categorizeFiles([
      fakeFile("notes.pdf"),
      fakeFile("photo.jpg"),
      fakeFile("song.wav"),
    ]);
    expect(out.audio).toHaveLength(1);
    expect(out.rejected).toHaveLength(2);
  });

  it("rejects files with no extension", () => {
    const out = categorizeFiles([fakeFile("no_ext")]);
    expect(out.audio).toHaveLength(0);
    expect(out.rejected).toHaveLength(1);
  });

  it("preserves input order within each bucket", () => {
    const a = fakeFile("a.wav");
    const b = fakeFile("b.txt");
    const c = fakeFile("c.mp3");
    const out = categorizeFiles([a, b, c]);
    expect(out.audio).toEqual([a, c]);
    expect(out.rejected).toEqual([b]);
  });

  it("returns empty buckets for empty input", () => {
    expect(categorizeFiles([])).toEqual({ audio: [], rejected: [] });
  });
});
