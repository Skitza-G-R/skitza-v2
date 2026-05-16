import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for ClientsTableHeader — locks in the grid +
// sortable column behavior the parent depends on.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "clients-table-header.tsx"),
  "utf-8",
);

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
      "24px 44px minmax(0,1.4fr) minmax(0,1.5fr) 110px 90px 110px 100px 110px 36px",
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

  it("makes Client sortable by 'name', Owed by 'balance', Joined by 'joined'", () => {
    expect(SRC).toMatch(/label:\s*["']Client["'][\s\S]*?sortKey:\s*["']name["']/);
    expect(SRC).toMatch(/label:\s*["']Owed["'][\s\S]*?sortKey:\s*["']balance["']/);
    expect(SRC).toMatch(/label:\s*["']Joined["'][\s\S]*?sortKey:\s*["']joined["']/);
  });

  it("forbids forbidden CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
