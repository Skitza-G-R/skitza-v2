import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "product-editor.tsx"), "utf8");
const PAYLOAD_SRC = readFileSync(
  join(here, "..", "build-package-payload.ts"),
  "utf8",
);

describe("ProductEditor orchestrator", () => {
  it("declares both NEW_STEPS and EDIT_STEPS arrays", () => {
    expect(SRC).toMatch(/NEW_STEPS\s*=\s*\[/);
    expect(SRC).toMatch(/EDIT_STEPS\s*=\s*\[/);
  });

  it("NEW_STEPS includes the new Logistics + Agreement steps", () => {
    // We pin only the meaningful contents, not the literal string,
    // so reordering inside the array can't sneak a regression past.
    expect(SRC).toMatch(/NEW_STEPS[\s\S]*?"type"[\s\S]*?"includes"[\s\S]*?"pricing"[\s\S]*?"logistics"[\s\S]*?"agreement"/);
  });

  it("EDIT_STEPS includes logistics + agreement (no type)", () => {
    expect(SRC).toMatch(/EDIT_STEPS[\s\S]*?"includes"[\s\S]*?"pricing"[\s\S]*?"logistics"[\s\S]*?"agreement"/);
  });

  it("renders all five step components", () => {
    expect(SRC).toMatch(/<TypeStep/);
    expect(SRC).toMatch(/<IncludesStep/);
    expect(SRC).toMatch(/<PricingStep/);
    expect(SRC).toMatch(/<LogisticsStep/);
    expect(SRC).toMatch(/<ContractStep/);
  });

  it("imports decodeDescription for edit-mode round-trip (encode lives in build-package-payload)", () => {
    expect(SRC).toMatch(/decodeDescription/);
    // After the Task 11 extraction, encodeDescription is called by
    // buildPackagePayload at save time — assert there, not here.
    expect(PAYLOAD_SRC).toMatch(/encodeDescription/);
  });

  it("mounts the EditorShell", () => {
    expect(SRC).toMatch(/<EditorShell/);
  });

  it("calls a packages.create or .update server action", () => {
    expect(SRC).toMatch(/createPackage|updatePackage|packages\.create|packages\.update/);
  });

  it("maps preset type 'consult' to schema kind 'custom' on save (logic in build-package-payload)", () => {
    expect(PAYLOAD_SRC).toMatch(/draft\.type\s*===\s*["']consult["']/);
    expect(PAYLOAD_SRC).toMatch(/["']custom["']\s+as\s+PackageKind/);
  });

  it("does NOT use window.confirm anywhere", () => {
    expect(SRC).not.toMatch(/window\.confirm/);
  });

  it("accepts an optional onCreated callback", () => {
    expect(SRC).toMatch(/onCreated\?:\s*\(id:\s*string\)\s*=>\s*void/);
  });

  it("invokes onCreated on the create-mode save success path", () => {
    expect(SRC).toMatch(/onCreated\?\.\(/);
  });
});
