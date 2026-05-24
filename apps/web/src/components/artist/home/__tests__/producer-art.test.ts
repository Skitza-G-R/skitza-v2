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

  it("computes hue deterministically from the producer name", () => {
    expect(SRC).toMatch(/function\s+hueFromName/);
  });

  it("renders the OKLCH linear-gradient and the radial sheen overlay", () => {
    expect(SRC).toMatch(/oklch\(/);
    expect(SRC).toMatch(/radial-gradient\(/);
  });

  it("renders initials computed from the producer name", () => {
    expect(SRC).toMatch(/function\s+initialsFromName/);
  });
});
