import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for ClientsTableHeader — locks in the grid +
// sortable column behavior the parent depends on.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "clients-table-header.tsx"), "utf-8");

describe("ClientsTableHeader — sortable column headers for table mode", () => {
  it("exports a ClientsTableHeader component", () => {
    expect(SRC).toMatch(/export function ClientsTableHeader/);
  });

  it("uses the 10-column grid matching ClientCompactRow (round-4 table polish)", () => {
    // 2026-05-16 mockup-match: header was extended to carry separate
    // Email + Link + Joined columns (was just Status). The grid is
    // now 10 cells wide and the constant is exported so the row can
    // reuse the same template.
    expect(SRC).toContain(
      "24px 44px minmax(0,1.4fr) minmax(0,1.5fr) 110px 90px 110px 100px 110px 144px",
    );
    expect(SRC).toContain("export const CLIENTS_TABLE_GRID");
  });

  it("declares Client / Email / Link / Projects / Lifetime / Owed / Joined column labels", () => {
    // Mockup-match: every data column from the HTML carries its
    // own header. Status was renamed to Link to match the column
    // role (the LinkPill — linked / invited / invite to app).
    expect(SRC).toContain("Client");
    expect(SRC).toContain("Email");
    expect(SRC).toContain("Link");
    expect(SRC).toContain("Projects");
    expect(SRC).toContain("Lifetime");
    expect(SRC).toContain("Owed");
    expect(SRC).toContain("Joined");
  });

  it("reserves a visible Actions column for Edit and Archive or Restore", () => {
    expect(SRC).toMatch(/label:\s*["']Actions["']/);
  });

  it("sorts only truthful client columns while money is currency-separated", () => {
    expect(SRC).toMatch(/label:\s*["']Client["'][\s\S]*?sortKey:\s*["']name["']/);
    expect(SRC).toMatch(/\{ label: ["']Projects["'], sortKey: ["']progress["']/);
    expect(SRC).toMatch(/label:\s*["']Joined["'][\s\S]*?sortKey:\s*["']joined["']/);
    expect(SRC).toMatch(/\{ label: ["']Lifetime["'], align: ["']right["'] \}/);
    expect(SRC).toMatch(/\{ label: ["']Owed["'], align: ["']right["'] \}/);
  });

  it("keeps the wide table grid for xl screens and exposes sort direction accessibly", () => {
    expect(SRC).toMatch(/className="[^"]*hidden[^"]*xl:grid[^"]*"/);
    expect(SRC).not.toMatch(/className="[^"]*hidden[^"]*lg:grid[^"]*"/);
    expect(SRC).toContain("sorted ${direction}");
    expect(SRC).not.toContain("aria-sort");
    expect(SRC).toContain('"descending"');
  });

  it("forbids forbidden CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
