import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-header.tsx"), "utf8");

describe("StoreHeader shell", () => {
  it("renders a compact management eyebrow", () => {
    expect(SRC).toContain("STORE MANAGEMENT");
  });

  it("renders the Store. wordmark with brand-amber dot", () => {
    expect(SRC).toMatch(/Store/);
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("uses Syne for the wordmark", () => {
    expect(SRC).toMatch(/font-display|Syne|font-syne/);
  });

  it("renders the live and hidden counts", () => {
    expect(SRC).toMatch(/live/);
    expect(SRC).toMatch(/hidden/);
  });

  it("keeps the phone title compact while allowing a refined desktop scale", () => {
    expect(SRC).toMatch(/text-\[32px\]/);
    expect(SRC).toMatch(/lg:text-\[(?:56|64)px\]/);
    expect(SRC).not.toMatch(/clamp\(42px,\s*8\.5vw,\s*88px\)/);
  });

  it("exposes the artist preview and copy-link actions", () => {
    expect(SRC).toContain("Preview as artist");
    expect(SRC).toMatch(/Copy link|Copied/);
    expect(SRC).toMatch(/onPreview/);
    expect(SRC).toMatch(/onCopy/);
  });
});
