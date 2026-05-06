import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  JoinMetaStrip,
  formatGenres,
  formatResponseHours,
} from "../join-meta-strip";

// Tests for the public meta strip on /join/<slug>. Focus areas:
//   * formatters render the producer's curated copy correctly
//   * a stat block hides when its value is null/empty (vs. showing
//     a placeholder, which would read worse than a missing stat)
//   * the strip itself returns null when nothing survives the filter,
//     so the parent doesn't render an orphan border

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
    // Defensive — if someone direct-edits the DB, the page shouldn't
    // blank out. We accept the unexpected value rather than dropping
    // the stat silently.
    expect(formatResponseHours(72)).toBe("Within 72h");
  });
});

describe("JoinMetaStrip — render", () => {
  it("renders all 4 stats when every field has a value", () => {
    const html = renderToStaticMarkup(
      <JoinMetaStrip
        meta={{
          genres: ["indie", "alt-pop"],
          releasedSummary: "3 LPs · 12 singles",
          streamsSummary: "On Spotify, Apple, YouTube",
          responseHours: 48,
        }}
      />,
    );
    expect(html).toContain("Genres");
    expect(html).toContain("Released");
    expect(html).toContain("Streams");
    expect(html).toContain("Response");
    expect(html).toContain("Indie · Alt-Pop");
    expect(html).toContain("3 LPs · 12 singles");
    expect(html).toContain("Within 48h");
  });

  it("hides individual blocks when their value is null", () => {
    // Producer filled in genres only; the other 3 stats should drop
    // out of the markup entirely. Hiding the whole row beats showing
    // a placeholder ("--" / "No streams data") because empty stat
    // blocks read like the producer is broken.
    const html = renderToStaticMarkup(
      <JoinMetaStrip
        meta={{
          genres: ["electronic"],
          releasedSummary: null,
          streamsSummary: null,
          responseHours: null,
        }}
      />,
    );
    expect(html).toContain("Genres");
    expect(html).toContain("Electronic");
    expect(html).not.toContain("Released");
    expect(html).not.toContain("Streams");
    // Catch the label specifically — "Response" wouldn't appear in
    // the strip when responseHours is null.
    expect(html).not.toMatch(/>Response</);
  });

  it("hides empty-string summaries as if they were null", () => {
    // Defensive — the DB column is text + nullable, but a well-meaning
    // producer might save an empty-string instead of clearing. The
    // component should treat that the same as null.
    const html = renderToStaticMarkup(
      <JoinMetaStrip
        meta={{
          genres: null,
          releasedSummary: "   ",
          streamsSummary: "",
          responseHours: 24,
        }}
      />,
    );
    expect(html).not.toContain("Released");
    expect(html).not.toContain("Streams");
    expect(html).toContain("Within 24h");
  });

  it("returns nothing when every stat is empty (no orphan border)", () => {
    const html = renderToStaticMarkup(
      <JoinMetaStrip
        meta={{
          genres: null,
          releasedSummary: null,
          streamsSummary: null,
          responseHours: null,
        }}
      />,
    );
    // renderToStaticMarkup of `null` produces an empty string. If the
    // component rendered the bordered <section>, it'd show up here as
    // an empty `<dl>` with the border-y classes — definitely not
    // empty-string. Pin the strict-equality so a regression that
    // accidentally renders the empty band fails loudly.
    expect(html).toBe("");
  });

  it("returns nothing when meta is null/undefined", () => {
    // A producer row with no marketing fields at all (all null)
    // matches the same hide-everything contract.
    expect(renderToStaticMarkup(<JoinMetaStrip meta={null} />)).toBe("");
    expect(renderToStaticMarkup(<JoinMetaStrip />)).toBe("");
  });
});
