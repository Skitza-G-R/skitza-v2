import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep test for the new /clients-projects list page shell.
// The page was rewritten in Phase 1 Task 16 to render WorkspaceListView
// directly — no more ProjectsList / ClientsListScreen / ClientsPageTabs.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf-8");

describe("clients-projects/page.tsx — SK-202 root list", () => {
  it("imports the new WorkspaceListView", () => {
    expect(SRC).toContain("WorkspaceListView");
    expect(SRC).toContain("~/components/dashboard/clients-projects/workspace-list-view");
  });

  it("renders <WorkspaceListView ... /> at the top level", () => {
    expect(SRC).toMatch(/<WorkspaceListView/);
  });

  it("passes projects + clients + producerSlug to the view without project KPIs or reorder", () => {
    expect(SRC).toMatch(/projects=\{/);
    expect(SRC).toMatch(/clients=\{/);
    expect(SRC).toMatch(/producerSlug=\{/);
    expect(SRC).not.toMatch(/kpis=\{/);
    expect(SRC).not.toContain("onReorderProjects");
    expect(SRC).not.toContain("reorderProjectsAction");
  });

  // Phase 1 G7 — page must pass the producer's product list so the
  // "+ New project" CTA inside WorkspaceListView can drive the modal's
  // product picker without an extra client-side fetch.
  it("passes products to the view (NewProjectModal picker source)", () => {
    expect(SRC).not.toMatch(/products=\{/);
    expect(SRC).not.toContain("booking.products.list");
  });

  it("uses lifecycle status and the fail-closed commercial projection", () => {
    expect(SRC).toContain("lifecycleStatus");
    expect(SRC).toMatch(/commercial\.(?:lifetimeCents|outstandingCents)/);
    expect(SRC).not.toMatch(/paidThisMonthCents|depositPct/);
    for (const label of ["Waiting for payment", "Active", "Paused", "Completed", "Canceled"]) {
      expect(SRC).toContain(label);
    }
    expect(SRC).not.toMatch(/\.stage\b/);
  });

  it("preserves the auth + caller scaffolding", () => {
    expect(SRC).toContain("~/server/auth/clerk-identity");
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("fetches the combined workspace projection once", () => {
    expect(SRC).toContain('clientContacts.listWithProjects({ view: "workspace" })');
    expect(SRC.match(/clientContacts\.listWithProjects/g)).toHaveLength(1);
    expect(SRC).not.toContain('view: "all-projects"');
    expect(SRC).not.toContain('view: "by-client"');
  });

  it("renders the truthful root-list failure when the combined fetch fails", () => {
    expect(SRC).toContain("ProjectsListFailure");
    expect(SRC).toContain("workspace load failed");
    expect(SRC).toMatch(/!loadResult\.ok[\s\S]{0,160}<ProjectsListFailure/);
  });

  it("fetches the producer's slug via producer.me()", () => {
    expect(SRC).toContain("producer.me");
  });

  it("does not restore the removed legacy ProjectsList implementation", () => {
    expect(SRC).not.toMatch(/from\s+["'][^"']*\/projects-list["']/);
    expect(SRC).not.toMatch(/<ProjectsList(?:\s|>)/);
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
