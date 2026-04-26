import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-text invariants for HeaderStrip.
//
// Per CLAUDE.md test conventions, vitest runs in `node` env — no
// jsdom, no React Testing Library. We pin the contract via:
//   1. Pure-helper unit tests (see dashboard-helpers.test.ts —
//      pickHeaderCta covers the full morph table).
//   2. Source-text grep on the .tsx file to ensure the right wiring
//      is present (artist name, project title, stage chip, single CTA
//      button, ARIA label on icon buttons).

const SRC = readFileSync(
  new URL("../header-strip.tsx", import.meta.url),
  "utf8",
);

describe("HeaderStrip source invariants", () => {
  it("renders the project title (h1 or font-display)", () => {
    expect(SRC).toMatch(/font-display/);
    // The project title comes through props as `title` or `projectTitle`.
    expect(SRC).toMatch(/(?:projectTitle|project\.title|\btitle\b)/);
  });

  it("renders the artist name", () => {
    expect(SRC).toMatch(/artistName/);
  });

  it("imports the stage chip (Badge or stage component)", () => {
    // Either reuses ~/components/ui/badge, OR ~/lib/projects/stages
    // for STAGE_LABEL — both prove the chip is sourced, not invented.
    expect(SRC).toMatch(
      /from\s+["']~\/components\/ui\/badge["']|STAGE_LABEL|from\s+["']~\/lib\/projects\/stages["']/,
    );
  });

  it("imports the pickHeaderCta morph helper", () => {
    expect(SRC).toMatch(/pickHeaderCta/);
  });

  it("renders a <button> for the morphing CTA", () => {
    expect(SRC).toMatch(/<button/);
  });

  it("does NOT use raw hex colour codes (CSS-vars-only repo rule)", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("does NOT import @trpc/react-query (server-fetch pattern only)", () => {
    expect(SRC).not.toMatch(/@trpc\/react-query/);
    expect(SRC).not.toMatch(/useQuery\(/);
  });

  it("uses :focus-visible (NOT :focus) for keyboard rings", () => {
    expect(SRC).toMatch(/focus-visible:/);
  });

  it("CTA button has min-h-[44px] OR sk-tap class for touch target", () => {
    expect(SRC).toMatch(/min-h-\[44px\]|sk-tap/);
  });

  it("leaves a TODO marker for the action wiring (S0X follow-up)", () => {
    // The story explicitly says the CTA is a button-only stub for now;
    // wire-up to the real action mutation is out of scope. Pin the TODO
    // so a reviewer sees the intent.
    expect(SRC).toMatch(/TODO|todo/);
  });
});
