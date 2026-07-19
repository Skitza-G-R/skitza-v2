import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for ClientsTableHeader — locks in the grid +
// sortable column behavior the parent depends on.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "clients-table-header.tsx"), "utf-8");

describe("ClientsTableHeader — automatic client roster columns", () => {
  it("exports a ClientsTableHeader component", () => {
    expect(SRC).toMatch(/export function ClientsTableHeader/);
  });

  it("uses the compact 7-column grid shared with ClientCompactRow", () => {
    expect(SRC).toContain("44px minmax(0,1.4fr) minmax(0,1.5fr) 110px 90px 110px 44px");
    expect(SRC).toContain("export const CLIENTS_TABLE_GRID");
  });

  it("declares only scan-useful roster labels", () => {
    expect(SRC).toContain("Client");
    expect(SRC).toContain("Email");
    expect(SRC).toContain("Link");
    expect(SRC).toContain("Projects");
    expect(SRC).toContain("Joined");
    expect(SRC).not.toContain('label: "Lifetime"');
    expect(SRC).not.toContain('label: "Owed"');
  });

  it("keeps the header visual-only and limits it to xl screens", () => {
    expect(SRC).toMatch(/className="[^"]*hidden[^"]*xl:grid[^"]*"/);
    expect(SRC).not.toMatch(/className="[^"]*hidden[^"]*lg:grid[^"]*"/);
    expect(SRC).toContain('aria-hidden="true"');
  });

  it("forbids forbidden CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
