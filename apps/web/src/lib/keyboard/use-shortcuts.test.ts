import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { G_LEADER_ROUTES, isTypingTarget } from "./use-shortcuts";

const source = readFileSync(
  fileURLToPath(new URL("./use-shortcuts.ts", import.meta.url)),
  "utf8",
);

// Node-environment tests only. The DOM-dependent branches (HTMLElement,
// isContentEditable) get manual QA in the browser — jsdom is not set up
// for this workspace and adding it would shift every other test suite.

describe("isTypingTarget", () => {
  it("returns false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it("returns false for plain objects that aren't HTMLElements", () => {
    expect(isTypingTarget({})).toBe(false);
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(false);
  });
});

describe("G_LEADER_ROUTES", () => {
  // Phase 2 (2026-05-05): remap to match the locked design's
  // ShortcutsHelp + the relabelled sidebar (Overview/Store/Settings).
  // `h` is added (Overview), `f` is dropped (Profile→Store reuses `s`),
  // `s` and `t` swap routes (Setup→Settings letter, Profile→Store letter).
  it("maps exactly the 6 producer pages", () => {
    expect(Object.keys(G_LEADER_ROUTES).sort()).toEqual(["c", "h", "m", "p", "s", "t"]);
  });

  it("points each letter at the canonical producer route", () => {
    expect(G_LEADER_ROUTES.h).toBe("/dashboard");
    expect(G_LEADER_ROUTES.m).toBe("/dashboard/music");
    expect(G_LEADER_ROUTES.p).toBe("/dashboard/clients-projects");
    expect(G_LEADER_ROUTES.c).toBe("/dashboard/calendar");
    expect(G_LEADER_ROUTES.s).toBe("/dashboard/store");
    expect(G_LEADER_ROUTES.t).toBe("/dashboard/settings");
  });
});

describe("global action shortcuts", () => {
  it("keeps one truthful New Project key", () => {
    expect(source).toMatch(/key === "n"[\s\S]*handlers\.createNewProject\(\)/);
    expect(source).not.toMatch(/key === "c"/);
    expect(source).not.toContain("createContextAware");
  });
});
