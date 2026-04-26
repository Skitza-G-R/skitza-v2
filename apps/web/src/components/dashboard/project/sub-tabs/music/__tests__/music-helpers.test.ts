import { describe, expect, it } from "vitest";

import {
  pickStatusCopy,
  nextVersionLabel,
  categorizeFiles,
  formatRangeAnchor,
  pixelsToMs,
  msToPixels,
  classifyDrag,
  partitionComments,
  type CommentForPartition,
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

// ─── S06 helpers ──────────────────────────────────────────────────────
// Range-comment math + cross-version partition.

describe("formatRangeAnchor — point vs range time format", () => {
  it("renders a point comment as 'M:SS'", () => {
    // 0:30 — single timestamp (endTimestampMs is null).
    expect(formatRangeAnchor(30_000, null)).toBe("0:30");
  });

  it("renders a range comment as 'M:SS – M:SS' (en-dash)", () => {
    // 0:30 – 1:15 — drag span across the verse.
    expect(formatRangeAnchor(30_000, 75_000)).toBe("0:30 – 1:15");
  });

  it("zero-pads seconds < 10", () => {
    expect(formatRangeAnchor(5_000, null)).toBe("0:05");
    expect(formatRangeAnchor(5_000, 9_000)).toBe("0:05 – 0:09");
  });

  it("rolls over minutes correctly", () => {
    // 60_000ms = 1:00, 125_000ms = 2:05.
    expect(formatRangeAnchor(60_000, null)).toBe("1:00");
    expect(formatRangeAnchor(60_000, 125_000)).toBe("1:00 – 2:05");
  });

  it("clamps negative input to 0:00", () => {
    expect(formatRangeAnchor(-1, null)).toBe("0:00");
  });
});

describe("pixelsToMs / msToPixels — drag math", () => {
  it("pixelsToMs maps a fraction of container width to ms", () => {
    // 100px out of 400px container, 200_000ms total → 50_000ms (0:50).
    expect(pixelsToMs(100, 400, 200_000)).toBe(50_000);
  });

  it("msToPixels is the inverse of pixelsToMs", () => {
    expect(msToPixels(50_000, 400, 200_000)).toBe(100);
  });

  it("clamps pixelsToMs to [0, durationMs]", () => {
    // Below 0 → 0; above container → durationMs.
    expect(pixelsToMs(-50, 400, 200_000)).toBe(0);
    expect(pixelsToMs(500, 400, 200_000)).toBe(200_000);
  });

  it("returns 0 when containerWidth is 0 (avoid divide-by-zero)", () => {
    expect(pixelsToMs(100, 0, 200_000)).toBe(0);
    expect(msToPixels(50_000, 0, 200_000)).toBe(0);
  });
});

describe("classifyDrag — point vs range threshold (200ms default)", () => {
  it("classifies < 200ms drag as point at startMs", () => {
    // 30000 → 30100 = 100ms span, below 200ms threshold.
    expect(classifyDrag(30_000, 30_100)).toEqual({
      kind: "point",
      timestampMs: 30_000,
    });
  });

  it("classifies >= 200ms drag as range with min/max start/end", () => {
    expect(classifyDrag(30_000, 75_000)).toEqual({
      kind: "range",
      timestampMs: 30_000,
      endTimestampMs: 75_000,
    });
  });

  it("normalises a backward drag (end before start) to point at startMs", () => {
    // Single-click at 30000 → mouseup at 29900: 100ms backward, still
    // below threshold → point at the START of the drag (the user's
    // mousedown anchor).
    expect(classifyDrag(30_000, 29_900)).toEqual({
      kind: "point",
      timestampMs: 30_000,
    });
  });

  it("normalises a backward range drag (end < start) to range with min/max", () => {
    // Drag right-to-left over 500ms → still a range, just timestampMs
    // is the smaller value.
    expect(classifyDrag(30_000, 29_400)).toEqual({
      kind: "range",
      timestampMs: 29_400,
      endTimestampMs: 30_000,
    });
  });

  it("respects a custom threshold", () => {
    // With 100ms threshold, 150ms drag is now a range.
    expect(classifyDrag(30_000, 30_150, 100)).toEqual({
      kind: "range",
      timestampMs: 30_000,
      endTimestampMs: 30_150,
    });
  });

  it("treats exactly threshold as range (>=, not >)", () => {
    expect(classifyDrag(30_000, 30_200)).toEqual({
      kind: "range",
      timestampMs: 30_000,
      endTimestampMs: 30_200,
    });
  });
});

describe("partitionComments — active vs other-version vs resolved", () => {
  // Type aliased from the helper for readability — same shape as the
  // music tab's TrackPayload.unresolvedComments rows.
  function comment(
    overrides: Partial<CommentForPartition>,
  ): CommentForPartition {
    return {
      id: "c-default",
      versionId: "v1",
      versionLabel: "V1",
      authorName: "Maya",
      body: "feedback",
      timestampMs: 30_000,
      endTimestampMs: null,
      fromProducer: false,
      createdAt: new Date("2026-04-15T10:00:00Z"),
      resolvedAt: null,
      ...overrides,
    };
  }

  it("splits into onActive (matches activeVersionId) and fromOtherVersions", () => {
    const c1 = comment({ id: "c1", versionId: "v2" }); // active
    const c2 = comment({ id: "c2", versionId: "v1" }); // other
    const out = partitionComments([c1, c2], "v2");
    expect(out.onActive.map((c) => c.id)).toEqual(["c1"]);
    expect(out.fromOtherVersions.map((c) => c.id)).toEqual(["c2"]);
  });

  it("excludes resolved comments from BOTH onActive and fromOtherVersions", () => {
    const resolvedActive = comment({
      id: "c-active-resolved",
      versionId: "v2",
      resolvedAt: new Date("2026-04-20T12:00:00Z"),
    });
    const resolvedOther = comment({
      id: "c-other-resolved",
      versionId: "v1",
      resolvedAt: new Date("2026-04-20T12:00:00Z"),
    });
    const out = partitionComments([resolvedActive, resolvedOther], "v2");
    expect(out.onActive).toHaveLength(0);
    expect(out.fromOtherVersions).toHaveLength(0);
    expect(out.resolved.map((c) => c.id).sort()).toEqual([
      "c-active-resolved",
      "c-other-resolved",
    ]);
  });

  it("preserves input order within each bucket (caller pre-sorts)", () => {
    const a = comment({ id: "a", versionId: "v2" });
    const b = comment({ id: "b", versionId: "v1" });
    const c = comment({ id: "c", versionId: "v2" });
    const out = partitionComments([a, b, c], "v2");
    expect(out.onActive.map((x) => x.id)).toEqual(["a", "c"]);
    expect(out.fromOtherVersions.map((x) => x.id)).toEqual(["b"]);
  });

  it("returns empty buckets for empty input", () => {
    expect(partitionComments([], "v2")).toEqual({
      onActive: [],
      fromOtherVersions: [],
      resolved: [],
    });
  });
});
