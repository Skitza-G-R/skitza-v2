import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const loading = readFileSync(join(here, "..", "projects-list-loading.tsx"), "utf-8");
const page = readFileSync(join(here, "..", "page.tsx"), "utf-8");
const failure = readFileSync(join(here, "..", "projects-list-failure.tsx"), "utf-8");

describe("Projects list route states", () => {
  it("uses project table-row skeletons without empty-list copy", () => {
    expect(loading).toContain('data-loading-slot="project-table-row"');
    expect(loading).toContain('data-loading-slot="project-mobile-row"');
    expect(loading).toContain('aria-label="Loading projects"');
    expect(loading).not.toContain("No current projects");
    expect(loading).not.toContain("Unavailable");
    expect(page).toContain("<Suspense fallback={<ProjectsListLoading />}");
  });

  it("uses the exact truthful failure and Retry action", () => {
    expect(failure).toContain("Couldn&apos;t load projects");
    expect(failure).toContain("Retry");
    expect(failure).toContain("router.refresh()");
    expect(failure).not.toContain("Unavailable");
  });
});
