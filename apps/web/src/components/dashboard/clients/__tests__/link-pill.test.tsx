import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "link-pill.tsx"), "utf-8");

describe("LinkPill", () => {
  it("exports a typed LinkPillState", () => {
    expect(SRC).toMatch(/export type LinkPillState\s*=\s*["']active["']\s*\|\s*["']pending["']\s*\|\s*["']none["']/);
  });

  it('renders "Linked" copy for active', () => {
    expect(SRC).toContain("Linked");
  });

  it('renders "Invited" copy for pending', () => {
    expect(SRC).toContain("Invited");
  });

  it('renders "Invite to app" copy for none', () => {
    expect(SRC).toContain("Invite to app");
  });

  it("calls onInvite for the none state via a button element", () => {
    expect(SRC).toMatch(/<button[^>]*onClick=\{onInvite\}/);
  });

  it("uses the Skitza fg-success token for the active dot", () => {
    expect(SRC).toContain("--fg-success");
  });

  it("uses the brand-primary token for the pending + none dots", () => {
    expect(SRC).toContain("--brand-primary");
  });

  it("forbids non-existent --surface-card token", () => {
    expect(SRC).not.toContain("--surface-card");
  });
});
