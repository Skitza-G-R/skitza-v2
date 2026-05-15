import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for ProjectsTableHeader — locks in the grid +
// sortable column behavior the parent depends on.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "projects-table-header.tsx"),
  "utf-8",
);

describe("ProjectsTableHeader — sortable column headers for table mode", () => {
  it("exports a ProjectsTableHeader component", () => {
    expect(SRC).toMatch(/export function ProjectsTableHeader/);
  });

  it("mirrors ProjectRow's exact 8-column grid", () => {
    expect(SRC).toContain(
      "24px 44px minmax(0,1.6fr) minmax(0,1fr) 120px 100px 110px 36px",
    );
  });

  it("declares Project / Client / Progress / Balance / Deadline column labels", () => {
    expect(SRC).toContain("Project");
    expect(SRC).toContain("Client");
    expect(SRC).toContain("Progress");
    expect(SRC).toContain("Balance");
    expect(SRC).toContain("Deadline");
  });

  it("makes Project / Progress / Balance / Deadline sortable (sortKey set)", () => {
    expect(SRC).toMatch(/label:\s*["']Project["'][\s\S]*?sortKey:\s*["']name["']/);
    expect(SRC).toMatch(/label:\s*["']Progress["'][\s\S]*?sortKey:\s*["']progress["']/);
    expect(SRC).toMatch(/label:\s*["']Balance["'][\s\S]*?sortKey:\s*["']balance["']/);
    expect(SRC).toMatch(/label:\s*["']Deadline["'][\s\S]*?sortKey:\s*["']deadline["']/);
  });

  it("calls onSortChange when a sortable header is clicked", () => {
    expect(SRC).toMatch(/onSortChange\(/);
  });

  it("uses ArrowUpDown icon to indicate sortable columns", () => {
    expect(SRC).toContain("ArrowUpDown");
  });

  it("forbids forbidden CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
