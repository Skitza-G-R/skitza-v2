import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "projects-table-header.tsx"), "utf-8");

describe("ProjectsTableHeader — locked five-column table", () => {
  it("renders semantic table headers for Project, Client, Started, Phase, and Actions", () => {
    expect(SRC).toContain("<tr");
    expect(SRC.match(/<th/g)).toHaveLength(5);
    for (const label of ["Project", "Client", "Started", "Phase", "Actions"]) {
      expect(SRC).toContain(label);
    }
  });

  it("makes Project, Started, and Phase sortable", () => {
    expect(SRC).toContain('onSortChange("project")');
    expect(SRC).toContain('onSortChange(sort === "oldest" ? "newest" : "oldest")');
    expect(SRC).toContain('onSortChange("phase")');
    expect(SRC).toContain("aria-sort");
  });

  it("keeps Client and Actions as plain aligned labels", () => {
    expect(SRC).not.toMatch(/onSortChange\(["']client["']\)/);
    expect(SRC).not.toMatch(/onSortChange\(["']actions["']\)/);
  });

  it("does not expose removed project columns", () => {
    for (const removed of ["Progress", "Balance", "Deadline"]) {
      expect(SRC).not.toContain(removed);
    }
  });
});
