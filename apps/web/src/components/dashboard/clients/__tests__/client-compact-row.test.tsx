import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for ClientCompactRow — the compact horizontal
// client row used in the Clients tab's table mode.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "client-compact-row.tsx"),
  "utf-8",
);

describe("ClientCompactRow — compact horizontal row for clients table mode", () => {
  it("exports a ClientCompactRow component", () => {
    expect(SRC).toMatch(/export function ClientCompactRow/);
  });

  it("uses an 8-column grid matching ClientsTableHeader", () => {
    expect(SRC).toContain(
      "24px 44px minmax(0,1.5fr) 80px 110px 110px 110px 36px",
    );
  });

  it("is draggable for the parent reorder controller", () => {
    expect(SRC).toMatch(/draggable=("|\{)["']?true["']?("|\})/);
  });

  it("reuses ClientCardData type (same shape — different layout)", () => {
    expect(SRC).toContain("ClientCardData");
    expect(SRC).toContain("./client-card");
  });

  it("renders projects / lifetime / owed numbers in mono bold (matches design)", () => {
    expect(SRC).toMatch(/font-mono[\s\S]*?font-bold[\s\S]*?\{projects\}/);
    expect(SRC).toMatch(/font-mono[\s\S]*?font-bold[\s\S]*?formatMoney\(lifetime/);
  });

  it("mounts LinkPill for the status column", () => {
    expect(SRC).toContain("LinkPill");
    expect(SRC).toContain("./link-pill");
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
