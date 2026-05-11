import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "delete-confirm-modal.tsx"), "utf8");

describe("DeleteConfirmModal shell", () => {
  it("uses Radix Dialog Portal for portaling to body", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).toMatch(/Portal/);
  });

  it("uses the 420px max-width from the design brief", () => {
    expect(SRC).toMatch(/420|max-w-\[420|max-w-md/);
  });

  it("renders a red Trash2 icon block", () => {
    expect(SRC).toMatch(/Trash2/);
    expect(SRC).toMatch(/--fg-danger|--danger/);
  });

  it("renders the dynamic title with the product name", () => {
    expect(SRC).toMatch(/Delete.*\$\{|Delete\s+["'`]/);
  });

  it("has both Cancel and Delete buttons", () => {
    expect(SRC).toContain("Cancel");
    expect(SRC).toMatch(/Delete product|>Delete</);
  });

  it("uses backdrop-blur on the scrim", () => {
    expect(SRC).toMatch(/backdrop-blur/);
  });

  it("never uses window.confirm", () => {
    expect(SRC).not.toMatch(/window\.confirm/);
  });
});
