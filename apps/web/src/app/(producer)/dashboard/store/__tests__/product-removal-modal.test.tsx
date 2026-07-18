import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "product-removal-modal.tsx"), "utf8");

describe("ProductRemovalModal shell", () => {
  it("uses the server-owned archive/delete action for exact copy", () => {
    expect(SRC).toMatch(/ProductRemovalAction\s*=\s*["']archive["']\s*\|\s*["']delete["']/);
    expect(SRC).toMatch(/This removes the product from your Store/);
    expect(SRC).toMatch(/Deleting it is permanent/);
  });

  it("keeps Archive and Delete labels consistent through title and button", () => {
    expect(SRC).toMatch(/const verb = isArchive \? ["']Archive["'] : ["']Delete["']/);
    expect(SRC).toMatch(/\{verb\} product/);
  });

  it("uses Radix Dialog and never window.confirm", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).not.toMatch(/window\.confirm/);
  });

  it("wraps long product names inside the confirmation title", () => {
    expect(SRC).toMatch(/DialogPrimitive\.Title[\s\S]{0,200}break-words/);
    expect(SRC).toMatch(/\[overflow-wrap:anywhere\]/);
  });
});
