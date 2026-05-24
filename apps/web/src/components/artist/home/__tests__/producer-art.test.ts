import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../producer-art.tsx"),
  "utf-8",
);

describe("ProducerArt", () => {
  it("exports a named React component", () => {
    expect(SRC).toMatch(/export\s+function\s+ProducerArt/);
  });

  it("uses the shared producer-color helpers (no drift between surfaces)", () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*producerGradient[^}]*\}\s*from\s*["']~\/lib\/_phase4-stubs\/producer-color["']/,
    );
    expect(SRC).toMatch(/producerInitials/);
  });

  it("renders the radial sheen overlay", () => {
    expect(SRC).toMatch(/radial-gradient\(/);
  });
});
