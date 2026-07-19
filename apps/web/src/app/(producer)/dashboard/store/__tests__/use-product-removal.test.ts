import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "use-product-removal.ts"), "utf8");

describe("useProductRemoval contract", () => {
  it("returns the actual lifecycle outcome instead of guessing from the browser", () => {
    expect(SRC).toMatch(/ProductRemovalOutcome/);
    expect(SRC).toMatch(/return \{ action: ["']archive["'], undoable: true \}/);
  });

  it("uses the removal/restore actions and truthful outcome-specific toasts", () => {
    expect(SRC).toMatch(/archivePackage/);
    expect(SRC).toMatch(/restorePackage/);
    expect(SRC).toMatch(/archived/);
    expect(SRC).toMatch(/restored as hidden/);
    expect(SRC).toMatch(/label:\s*["']Undo["']/);
    expect(SRC).toMatch(/removal\.data\.outcome === ["']deleted["']/);
    expect(SRC).toMatch(/action: ["']delete["'], undoable: false/);
  });

  it("trusts the transaction-time server outcome rather than the list hint", () => {
    expect(SRC).not.toMatch(/target\.action ===/);
    expect(SRC).toMatch(/returned outcome is[\s\S]*authoritative/i);
  });
});
