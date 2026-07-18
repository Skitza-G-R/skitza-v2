import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for ClientCompactRow — the compact horizontal
// client row used in the Clients tab's table mode.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "client-compact-row.tsx"), "utf-8");

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

  it("uses the 36px button radius tier for desktop row actions", () => {
    expect(SRC).toMatch(/min-h-\[36px\][^"\n]*rounded-\[var\(--radius-md\)\]/);
    expect(SRC).not.toMatch(/min-h-\[36px\][^"\n]*rounded-\[var\(--radius-sm\)\]/);
  });

  it("is draggable for the parent reorder controller", () => {
    expect(SRC).toMatch(/draggable=("|\{)["']?true["']?("|\})/);
  });

  it("reuses ClientCardData type (same shape — different layout)", () => {
    expect(SRC).toContain("ClientCardData");
    expect(SRC).toContain("./client-card");
  });

  it("renders projects plus explicit unavailable commercial totals in mono bold", () => {
    expect(SRC).toMatch(/font-mono[\s\S]*?font-bold[\s\S]*?\{projects\}/);
    expect(SRC).toContain("Unavailable");
  });

  it("mounts LinkPill for the status column", () => {
    expect(SRC).toContain("LinkPill");
    expect(SRC).toContain("./link-pill");
  });

  it("renders direct Edit and Archive or Restore actions", () => {
    expect(SRC).toMatch(/onEdit\?:\s*\(client:\s*ClientCardData\)/);
    expect(SRC).toMatch(/onArchive\?:\s*\(client:\s*ClientCardData\)/);
    expect(SRC).toContain("Edit");
    expect(SRC).toContain("Archive");
    expect(SRC).toContain("Restore");
  });

  it("links the client name to /dashboard/clients-projects/clients/<id>", () => {
    expect(SRC).toContain("/dashboard/clients-projects/clients/");
  });

  it("uses opacity-60 (not opacity-0) on the drag handle so it's always visible", () => {
    expect(SRC).toMatch(/cursor-grab[\s\S]*?opacity-60/);
  });

  it("forbids forbidden CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
