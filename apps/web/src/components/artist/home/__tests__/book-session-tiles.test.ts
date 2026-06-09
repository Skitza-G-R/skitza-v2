import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../book-session-tiles.tsx"),
  "utf-8",
);

describe("BookSessionTiles", () => {
  it("renders Book a session heading", () => {
    expect(SRC).toMatch(/Book\s*a\s*session/);
  });

  it("uses producerId in the tile href", () => {
    expect(SRC).toMatch(/\/artist\/book\?producerId=/);
  });

  it("renders Browse all →", () => {
    expect(SRC).toMatch(/Browse\s*all/);
  });

  it("uses ProducerArt for the tile thumbnail", () => {
    expect(SRC).toMatch(/import\s*\{\s*ProducerArt\s*\}/);
  });

  it("renders an empty state with Find a studio CTA", () => {
    expect(SRC).toMatch(/Find\s*a\s*studio/);
  });
});
