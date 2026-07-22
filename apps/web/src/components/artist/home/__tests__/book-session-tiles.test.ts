import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(__dirname, "../book-session-tiles.tsx"), "utf-8");

describe("BookSessionTiles", () => {
  it("renders Book a session heading", () => {
    expect(SRC).toMatch(/Book\s*a\s*session/);
  });

  it("uses the canonical studio query in each tile href", () => {
    expect(SRC).toContain("withArtistStudio");
    expect(SRC).not.toMatch(/\/artist\/book\?producerId=/);
    expect(SRC).toMatch(/withArtistStudio\(["']\/artist\/book["'],\s*s\.producerId\)/);
  });

  it("preserves the active studio in Browse all", () => {
    expect(SRC).toMatch(/Browse\s*all/);
    expect(SRC).toMatch(/withArtistStudio\(["']\/artist\/book["'],\s*activeStudioId\)/);
  });

  it("uses ProducerArt for the tile thumbnail", () => {
    expect(SRC).toMatch(/import\s*\{\s*ProducerArt\s*\}/);
  });

  it("renders an empty state with Find a studio CTA", () => {
    expect(SRC).toMatch(/Find\s*a\s*studio/);
  });
});
