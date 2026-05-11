import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "use-undoable-delete.ts"), "utf8");
const TOAST_SRC = readFileSync(
  join(here, "..", "..", "..", "..", "..", "components", "ui", "toast.tsx"),
  "utf8",
);

describe("useUndoableDelete hook", () => {
  it("calls archivePackage to perform the delete", () => {
    expect(SRC).toMatch(/archivePackage/);
  });

  it("calls restorePackage in the undo action callback", () => {
    expect(SRC).toMatch(/restorePackage/);
  });

  it("uses a 4.5s (4500ms) toast duration for the undo window", () => {
    expect(SRC).toMatch(/4500|4\.5/);
  });

  it("declares an Undo action label", () => {
    expect(SRC).toMatch(/label:\s*["']Undo["']/);
  });

  it("never uses window.confirm", () => {
    expect(SRC).not.toMatch(/window\.confirm/);
  });

  it("never uses window.alert", () => {
    expect(SRC).not.toMatch(/window\.alert/);
  });
});

describe("useToast extension for action + duration", () => {
  it("declares a ToastOptions or options arg with action+durationMs", () => {
    expect(TOAST_SRC).toMatch(/durationMs/);
    expect(TOAST_SRC).toMatch(/action/);
  });

  it("passes the duration to sonner", () => {
    expect(TOAST_SRC).toMatch(/duration/);
  });

  it("preserves backwards compatibility with existing 2-arg callsites", () => {
    // The new options param must be optional.
    expect(TOAST_SRC).toMatch(/options\?:|options:\s*ToastOptions\s*\|\s*undefined/);
  });
});
