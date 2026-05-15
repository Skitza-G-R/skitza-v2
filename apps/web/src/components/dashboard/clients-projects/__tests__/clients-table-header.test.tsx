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

  it("uses the 8-column grid matching ClientCompactRow", () => {
    expect(SRC).toContain(
      "24px 44px minmax(0,1.5fr) 80px 110px 110px 110px 36px",
    );
  });

  it("declares Client / Projects / Lifetime / Owed / Status column labels", () => {
    expect(SRC).toContain("Client");
    expect(SRC).toContain("Projects");
    expect(SRC).toContain("Lifetime");
    expect(SRC).toContain("Owed");
    expect(SRC).toContain("Status");
  });

  it("makes Client sortable by 'name' and Owed sortable by 'balance'", () => {
    expect(SRC).toMatch(/label:\s*["']Client["'][\s\S]*?sortKey:\s*["']name["']/);
    expect(SRC).toMatch(/label:\s*["']Owed["'][\s\S]*?sortKey:\s*["']balance["']/);
  });

  it("forbids forbidden CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
