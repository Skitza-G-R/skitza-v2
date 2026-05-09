import { describe, expect, it } from "vitest";

import {
  KIND_COLORS,
  inferSessionKind,
  type SessionKind,
} from "../session-kind";

// The Producer Calendar spec § 4.2 colors session blocks by `kind`
// (tracking / mix / master / intro / songwriting / meeting). The DB
// `bookings` table doesn't carry a kind field — we infer it from the
// product / package name. This test pins the inference contract so a
// rename never silently flips a producer's colour-coding.

describe("inferSessionKind", () => {
  it.each<[string, SessionKind]>([
    ["Mixing — full song", "mix"],
    ["MIX (stems)", "mix"],
    ["Stereo mix", "mix"],
    ["Mastering — single", "master"],
    ["MASTER (Atmos)", "master"],
    ["Album review", "master"],
    ["Tracking — vocals", "tracking"],
    ["Vocal record (3 hrs)", "tracking"],
    ["Recording session", "tracking"],
    ["Intro call", "intro"],
    ["Consultation 30min", "intro"],
    ["Songwriting — co-write", "songwriting"],
    ["Co-writing session", "songwriting"],
    ["Stem delivery", "meeting"],
    ["Project meeting", "meeting"],
    ["Sync call", "meeting"],
  ])("maps %p to %p", (packageName, expected) => {
    expect(inferSessionKind(packageName)).toBe(expected);
  });

  it("handles null/empty/unknown inputs by falling back to meeting", () => {
    expect(inferSessionKind(null)).toBe("meeting");
    expect(inferSessionKind("")).toBe("meeting");
    expect(inferSessionKind("   ")).toBe("meeting");
    expect(inferSessionKind("Beat lease")).toBe("meeting");
  });

  it("is case-insensitive and tolerates surrounding punctuation", () => {
    expect(inferSessionKind("MIX")).toBe("mix");
    expect(inferSessionKind("(mix)")).toBe("mix");
    expect(inferSessionKind("MASTERING-FULL")).toBe("master");
  });

  it("prefers the most specific match when multiple terms appear", () => {
    // "Mix + master" should pick mix because mix appears first AND is
    // the producer's primary engagement (the master is a deliverable).
    // This is a deliberate UX choice: pick whichever the producer's
    // craft is centered on.
    expect(inferSessionKind("Mix + master")).toBe("mix");
    // Explicit master wins when "mix" doesn't appear at all.
    expect(inferSessionKind("Master + delivery")).toBe("master");
  });
});

describe("KIND_COLORS", () => {
  it("declares a token name for every SessionKind", () => {
    const expected: SessionKind[] = [
      "tracking",
      "mix",
      "master",
      "intro",
      "songwriting",
      "meeting",
    ];
    for (const kind of expected) {
      expect(KIND_COLORS[kind]).toMatch(/^--kind-[a-z-]+$/);
    }
  });

  it("references the matching CSS custom property name (no rgb wrapper)", () => {
    expect(KIND_COLORS.tracking).toBe("--kind-tracking");
    expect(KIND_COLORS.mix).toBe("--kind-mix");
    expect(KIND_COLORS.master).toBe("--kind-master");
    expect(KIND_COLORS.intro).toBe("--kind-intro");
    expect(KIND_COLORS.songwriting).toBe("--kind-songwriting");
    expect(KIND_COLORS.meeting).toBe("--kind-meeting");
  });
});
