import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for ClientCompactRow — the compact horizontal
// client row used in the Clients tab's table mode.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "client-compact-row.tsx"), "utf-8");
const ACTIONS_SRC = readFileSync(join(here, "..", "client-actions-menu.tsx"), "utf-8");

describe("ClientCompactRow — compact horizontal row for clients table mode", () => {
  it("exports a ClientCompactRow component", () => {
    expect(SRC).toMatch(/export function ClientCompactRow/);
  });

  it("imports the shared CLIENTS_TABLE_GRID from the header (round-4 polish)", () => {
    // 2026-05-16: the row + header grid is exported from the header
    // module so the two components can never drift out of alignment.
    // Pinning the import + the gridTemplateColumns prop forwards the
    // contract.
    expect(SRC).toContain("CLIENTS_TABLE_GRID");
    expect(SRC).toMatch(/gridTemplateColumns:\s*CLIENTS_TABLE_GRID/);
  });

  it("uses the full table grid only at xl and the compact row below xl", () => {
    expect(SRC).toMatch(/className="[^"]*hidden[^"]*xl:grid[^"]*"/);
    expect(SRC).toContain('className="xl:hidden"');
    expect(SRC).not.toMatch(/className="[^"]*hidden[^"]*lg:grid[^"]*"/);
    expect(SRC).not.toContain('className="lg:hidden"');
  });

  it("uses one 44px shared action disclosure instead of two row buttons", () => {
    expect(SRC).toContain("<ClientActionsMenu");
    expect(ACTIONS_SRC).toMatch(/min-h-11\s+min-w-11/);
    expect(ACTIONS_SRC).toContain("Edit details");
    expect(ACTIONS_SRC).toContain('archived ? "Restore client" : "Archive client"');
  });

  it("uses the automatic recent-first roster and is not draggable", () => {
    expect(SRC).not.toMatch(/\bdraggable=/);
    expect(SRC).not.toContain("cursor-grab");
  });

  it("reuses ClientCardData type (same shape — different layout)", () => {
    expect(SRC).toContain("ClientCardData");
    expect(SRC).toContain("./client-card");
  });

  it("shows project context without repeating unavailable commercial totals", () => {
    expect(SRC).toMatch(/font-mono[\s\S]*?font-bold[\s\S]*?\{projects\}/);
    expect(SRC).not.toContain("Unavailable");
    expect(SRC).not.toContain("Totals unavailable");
    expect(SRC).not.toContain("formatMoney");
  });

  it("mounts LinkPill for the status column", () => {
    expect(SRC).toContain("LinkPill");
    expect(SRC).toContain("./link-pill");
  });

  it("forwards Edit and Archive or Restore through the shared disclosure", () => {
    expect(SRC).toMatch(/onEdit\?:\s*\(client:\s*ClientCardData\)/);
    expect(SRC).toMatch(/onArchive\?:\s*\(client:\s*ClientCardData\)/);
    expect(SRC).toMatch(/onEdit=\{[\s\S]{0,100}onEdit[\s\S]{0,100}onEdit\(client\)/);
    expect(SRC).toMatch(/onArchive=\{[\s\S]{0,100}onArchive[\s\S]{0,100}onArchive\(client\)/);
  });

  it("links the client name to /dashboard/clients-projects/clients/<id>", () => {
    expect(SRC).toContain("/dashboard/clients-projects/clients/");
  });

  it("keeps row navigation beneath interactive status and action controls", () => {
    expect(SRC).toMatch(/<Link[\s\S]{0,300}className="[^"]*absolute inset-0 z-0/);
    expect(SRC).toMatch(/pointer-events-none[^\n]*relative z-10[^\n]*font-semibold/);
    expect(SRC).toContain("pointer-events-auto relative z-10 inline-flex shrink-0");
    expect(SRC).toMatch(/relative z-20[^"]*justify-end/);
  });

  it("forbids forbidden CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
