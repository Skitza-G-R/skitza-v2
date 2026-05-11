import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "product-editor.tsx"), "utf8");

describe("ProductEditor orchestrator", () => {
  it("declares both NEW_STEPS and EDIT_STEPS arrays", () => {
    expect(SRC).toMatch(/NEW_STEPS\s*=\s*\[/);
    expect(SRC).toMatch(/EDIT_STEPS\s*=\s*\[/);
  });

  it("renders all four step components", () => {
    expect(SRC).toMatch(/<TypeStep/);
    expect(SRC).toMatch(/<IncludesStep/);
    expect(SRC).toMatch(/<PricingStep/);
    expect(SRC).toMatch(/<ContractStep/);
  });

  it("mounts the EditorShell", () => {
    expect(SRC).toMatch(/<EditorShell/);
  });

  it("calls a packages.create or .update server action", () => {
    expect(SRC).toMatch(/createPackage|updatePackage|packages\.create|packages\.update/);
  });

  it("maps preset type 'consult' to schema kind 'custom' on save", () => {
    expect(SRC).toMatch(/kind:\s*draft\.type\s*===\s*["']consult["']/);
  });

  it("does NOT use window.confirm anywhere", () => {
    expect(SRC).not.toMatch(/window\.confirm/);
  });
});
