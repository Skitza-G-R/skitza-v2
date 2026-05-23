import { describe, expect, it } from "vitest";

import {
  formatGenres,
  formatResponseHours,
} from "../join-meta-strip";

// SK-25: the standalone <JoinMetaStrip> band was removed when /join/<slug>
// compacted to a single-viewport bento. The two formatter helpers it
// owned are still the canonical presentation boundary — those are the
// only thing left to test here. The inline meta chips inside the bento
// consume the formatters directly.

describe("formatGenres", () => {
  it("returns null for null/empty/whitespace-only input", () => {
    expect(formatGenres(null)).toBeNull();
    expect(formatGenres([])).toBeNull();
    expect(formatGenres([" ", ""])).toBeNull();
  });

  it("title-cases each tag and joins with center dots", () => {
    expect(formatGenres(["indie", "alt-pop", "electronic"])).toBe(
      "Indie · Alt-Pop · Electronic",
    );
  });

  it("preserves multi-segment hyphenated tags", () => {
    expect(formatGenres(["alt-pop", "hip-hop"])).toBe("Alt-Pop · Hip-Hop");
  });
});

describe("formatResponseHours", () => {
  it("returns null for null/undefined/non-positive input", () => {
    expect(formatResponseHours(null)).toBeNull();
    expect(formatResponseHours(undefined)).toBeNull();
    expect(formatResponseHours(0)).toBeNull();
    expect(formatResponseHours(-3)).toBeNull();
  });

  it("renders the 3 known presets in their friendly form", () => {
    expect(formatResponseHours(24)).toBe("Within 24h");
    expect(formatResponseHours(48)).toBe("Within 48h");
    expect(formatResponseHours(168)).toBe("Within 1 week");
  });

  it("falls back to a generic 'Within Nh' label for unknown values", () => {
    // Defensive — if someone direct-edits the DB, the chip shouldn't
    // blank out. Accepts the unexpected value rather than dropping it.
    expect(formatResponseHours(72)).toBe("Within 72h");
  });
});
