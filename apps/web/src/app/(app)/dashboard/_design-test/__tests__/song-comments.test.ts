import { describe, expect, it } from "vitest";

import {
  buildCommentMarkers,
  rawCommentToVisible,
  type RawComment,
  type VisibleComment,
} from "../song-comments";

describe("buildCommentMarkers", () => {
  it("returns empty array for empty input", () => {
    expect(buildCommentMarkers([], 240)).toEqual([]);
  });

  it("places a comment at 50% for a 120s timestamp on a 240s track", () => {
    const markers = buildCommentMarkers([{ id: "c1", at: 120 }], 240);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.id).toBe("c1");
    expect(markers[0]?.leftPct).toBeCloseTo(50);
  });

  it("clamps timestamps past durationSec to 100%", () => {
    const markers = buildCommentMarkers([{ id: "c1", at: 600 }], 240);
    expect(markers[0]?.leftPct).toBe(100);
  });

  it("clamps negative timestamps to 0%", () => {
    const markers = buildCommentMarkers([{ id: "c1", at: -10 }], 240);
    expect(markers[0]?.leftPct).toBe(0);
  });

  it("returns 0% for all when durationSec is 0 (avoids divide-by-zero)", () => {
    const markers = buildCommentMarkers(
      [
        { id: "c1", at: 30 },
        { id: "c2", at: 60 },
      ],
      0,
    );
    expect(markers[0]?.leftPct).toBe(0);
    expect(markers[1]?.leftPct).toBe(0);
  });

  it("keeps the same id and order as input", () => {
    const input = [
      { id: "first", at: 20 },
      { id: "second", at: 80 },
    ];
    const markers = buildCommentMarkers(input, 100);
    expect(markers.map((m) => m.id)).toEqual(["first", "second"]);
    expect(markers[0]?.leftPct).toBe(20);
    expect(markers[1]?.leftPct).toBe(80);
  });
});

describe("rawCommentToVisible", () => {
  it("maps a producer comment to mine=true", () => {
    const raw: RawComment = {
      id: "c1",
      versionId: "v1",
      timestampMs: 65000,
      body: "Sounds good",
      fromProducer: true,
      authorEmail: null,
      createdAt: new Date("2026-05-01T10:00:00Z"),
    };
    const visible: VisibleComment = rawCommentToVisible(raw, {
      producerName: "Gili Asraf",
      now: new Date("2026-05-01T11:00:00Z"),
    });
    expect(visible.mine).toBe(true);
    expect(visible.who).toBe("Gili Asraf");
    expect(visible.initials).toBe("GA");
    expect(visible.at).toBe(65);
    expect(visible.text).toBe("Sounds good");
  });

  it("maps an artist comment to mine=false with initials from email", () => {
    const raw: RawComment = {
      id: "c2",
      versionId: "v1",
      timestampMs: 30000,
      body: "Can we punch the snare more?",
      fromProducer: false,
      authorEmail: "lior@example.com",
      createdAt: new Date("2026-05-01T11:30:00Z"),
    };
    const visible = rawCommentToVisible(raw, {
      producerName: "Gili Asraf",
      now: new Date("2026-05-01T11:45:00Z"),
    });
    expect(visible.mine).toBe(false);
    expect(visible.who).toBe("lior");
    expect(visible.initials).toBe("LI");
    expect(visible.at).toBe(30);
  });

  it("handles missing email by falling back to 'Artist'", () => {
    const raw: RawComment = {
      id: "c3",
      versionId: "v1",
      timestampMs: 10000,
      body: "ok",
      fromProducer: false,
      authorEmail: null,
      createdAt: new Date("2026-05-01T11:30:00Z"),
    };
    const visible = rawCommentToVisible(raw, {
      producerName: "Gili",
      now: new Date("2026-05-01T11:45:00Z"),
    });
    expect(visible.who).toBe("Artist");
    expect(visible.initials).toBe("AR");
  });

  it("formats 'when' as relative time", () => {
    const raw: RawComment = {
      id: "c4",
      versionId: "v1",
      timestampMs: 5000,
      body: "hi",
      fromProducer: true,
      authorEmail: null,
      createdAt: new Date("2026-05-01T10:00:00Z"),
    };
    const visible = rawCommentToVisible(raw, {
      producerName: "Gili",
      now: new Date("2026-05-01T10:30:00Z"),
    });
    expect(visible.when).toMatch(/30m ago/);
  });
});
