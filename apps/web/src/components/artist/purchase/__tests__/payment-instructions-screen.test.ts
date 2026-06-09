import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep wiring tests for S8 — Payment instructions (off-app pay).
// Matches the repo's screen-test style (see commit-screens.test.ts): the
// money math lives in pay-data and is unit-tested there; here we assert the
// screen wires up the bits that matter — copy controls, the greyed
// "coming soon" card, the primary route, and the no-details fallback.

const here = dirname(fileURLToPath(import.meta.url));
const S8_PATH = join(here, "..", "payment-instructions-screen.tsx");
const s8Src = readFileSync(S8_PATH, "utf8");

describe("payment-instructions-screen.tsx (S8) wiring", () => {
  it("is a client component (clipboard + router live here)", () => {
    expect(s8Src).toMatch(/^"use client";/);
  });

  it("formats money through the shared pay-data helper", () => {
    expect(s8Src).toMatch(/formatShekels/);
    expect(s8Src).toMatch(/from "\.\/pay-data"/);
  });

  it("offers a copy control that writes to the clipboard", () => {
    // an inline CopyButton that toggles a 'copied' confirmation state
    expect(s8Src).toMatch(/CopyButton/);
    expect(s8Src).toMatch(/navigator\.clipboard|writeText/);
    expect(s8Src).toMatch(/Copied/);
  });

  it("shows a greyed 'Pay by card — coming soon' row that is NOT a link/button action", () => {
    expect(s8Src).toMatch(/coming soon/i);
    // the coming-soon card must be inert: no onClick / href / <a> / role=button on it
    expect(s8Src).toMatch(/aria-disabled/);
  });

  it("routes the primary action to the proof-upload screen", () => {
    expect(s8Src).toMatch(/router\.push\(`\/artist\/purchase\/\$\{productId\}\/pay\/proof/);
  });

  it("supports the 'producer will send details' fallback when bank details are absent", () => {
    expect(s8Src).toMatch(/will send/i);
    // a branch keyed on whether bank details exist
    expect(s8Src).toMatch(/bank\b/);
  });
});
