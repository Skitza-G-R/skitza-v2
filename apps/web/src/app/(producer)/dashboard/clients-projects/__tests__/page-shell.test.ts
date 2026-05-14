import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep test for the new /clients-projects list page shell.
// The page was rewritten in Phase 1 Task 16 to render WorkspaceListView
// directly — no more ProjectsList / ClientsListScreen / ClientsPageTabs.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf-8");

describe("clients-projects/page.tsx — Phase 1 rewrite", () => {
  it("imports the new WorkspaceListView", () => {
    expect(SRC).toContain("WorkspaceListView");
    expect(SRC).toContain(
      "~/components/dashboard/clients-projects/workspace-list-view",
    );
  });

  it("renders <WorkspaceListView ... /> at the top level", () => {
    expect(SRC).toMatch(/<WorkspaceListView/);
  });

  it("passes projects + clients + kpis + producerSlug to the view", () => {
    expect(SRC).toMatch(/projects=\{/);
    expect(SRC).toMatch(/clients=\{/);
    expect(SRC).toMatch(/kpis=\{/);
    expect(SRC).toMatch(/producerSlug=\{/);
  });

  it("preserves the auth + caller scaffolding", () => {
    expect(SRC).toContain("@clerk/nextjs/server");
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("fetches listWithProjects for both views (all-projects + by-client)", () => {
    expect(SRC).toContain("all-projects");
    expect(SRC).toContain("by-client");
    expect(SRC).toContain("clientContacts.listWithProjects");
  });

  it("fetches the producer's slug via producer.me()", () => {
    expect(SRC).toContain("producer.me");
  });

  it("removes the import of the old ProjectsList", () => {
    expect(SRC).not.toContain("projects-list");
    expect(SRC).not.toContain("ProjectsList");
  });

  it("removes the import of the old ClientsListScreen", () => {
    expect(SRC).not.toContain("clients-list-screen");
    expect(SRC).not.toContain("ClientsListScreen");
  });

  it("removes the import of the old ClientsPageTabs", () => {
    expect(SRC).not.toContain("ClientsPageTabs");
    expect(SRC).not.toContain("clients-page-tabs");
  });

  it("does not render the old <header> KPI block (KPIs live in WorkspaceListView now)", () => {
    expect(SRC).not.toContain("Clients &amp; Projects");
  });

  it("forbids non-existent CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
