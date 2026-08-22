import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "workspace-list-view.tsx"), "utf-8");

describe("WorkspaceListView — SK-202 project-first shell", () => {
  it("opens Projects by default and keeps Clients secondary", () => {
    expect(SRC).toContain('params.get("tab") === "clients" ? "clients" : "projects"');
    expect(SRC).toContain('const WORKSPACE_TABS = ["projects", "clients"] as const');
    const projectsButton = SRC.indexOf('updateTab("projects")');
    const clientsButton = SRC.indexOf('updateTab("clients")');
    expect(projectsButton).toBeGreaterThan(-1);
    expect(clientsButton).toBeGreaterThan(projectsButton);
  });

  it("defaults the Projects surface to Current and oldest-first", () => {
    expect(SRC).toContain('projectView: filter === "archived" ? "archived" : "current"');
    expect(SRC).toContain('projectSort: isProjectSort(rawSort) ? rawSort : "oldest"');
  });

  it("renders the dedicated compact Projects list", () => {
    expect(SRC).toContain("ProducerProjectsList");
    expect(SRC).toContain('from "./producer-projects-list"');
    expect(SRC).toMatch(/<ProducerProjectsList[\s\S]*?projects=\{projects\}/);
  });

  it("removes the legacy project KPI, filter, layout, and reorder wiring", () => {
    expect(SRC).not.toContain("StatTile");
    expect(SRC).not.toContain("WorkspaceKPIs");
    expect(SRC).not.toContain("project-kpi-strips");
    expect(SRC).not.toContain("PROJECT_FILTERS");
    expect(SRC).not.toContain('aria-label="Layout"');
    expect(SRC).not.toContain("onReorderProjects");
    expect(SRC).not.toContain("handleProjectDrag");
    expect(SRC).not.toContain("persistLatestProjectOrder");
  });

  it("keeps bounded URL-synced tab, view, sort, and search state", () => {
    expect(SRC).toContain("parseWorkspaceUrlState");
    expect(SRC).toContain("window.history.replaceState");
    expect(SRC).toMatch(/params\.get\("search"\)[\s\S]{0,80}\.slice\(0, 120\)/);
    expect(SRC).not.toMatch(/localStorage|sessionStorage/);
  });

  it("keeps the existing tab swipe behavior in project-first order", () => {
    expect(SRC).toContain('import { useTabSwipe } from "~/components/native/use-tab-swipe"');
    expect(SRC).toMatch(
      /useTabSwipe\(\{\s*items:\s*WORKSPACE_TABS,\s*value:\s*tab,\s*onChange:\s*updateTab,\s*\}\)/,
    );
    expect(SRC).toContain("data-tab-swipe-surface");
  });

  it("uses the public Skitza link as the one primary entry action", () => {
    expect(SRC).toContain("buildJoinUrl(producerSlug)");
    expect(SRC).toContain("await copyPublicLink(skitzaLink, writeText)");
    expect(SRC).toContain("Copy my Skitza link");
    expect(SRC).toContain("Try copy again");
    expect(SRC).toContain("Link unavailable");
    expect(SRC).toContain('aria-live="polite"');
    expect(SRC).toContain('role="alert"');
  });

  it("keeps Bring in active work as the quieter second action", () => {
    const primaryAction = SRC.indexOf("Copy my Skitza link");
    const importAction = SRC.indexOf("Bring in active work");

    expect(primaryAction).toBeGreaterThan(-1);
    expect(importAction).toBeGreaterThan(primaryAction);
    expect(SRC).toContain('href="/dashboard/clients-projects/bring-active-work"');
    expect(SRC).toMatch(/Bring in active work[\s\S]{0,120}<\/Link>/);
    expect(SRC).toContain("sm:grid-cols-[auto_auto]");
  });

  it("removes manual client and project creation from the header and empty states", () => {
    expect(SRC).not.toContain("NewClientModal");
    expect(SRC).not.toContain("NewProjectModal");
    expect(SRC).not.toContain("New client");
    expect(SRC).not.toContain("New project");
    expect(SRC).toContain("Share your Skitza link to welcome your first client.");
  });

  it("keeps the Clients roster, search, archive filters, and actions reachable", () => {
    expect(SRC).toContain("MobileClientRow");
    expect(SRC).toContain("ClientCompactRow");
    expect(SRC).toContain("ClientsTableHeader");
    expect(SRC).toContain('aria-label="Client view"');
    expect(SRC).toContain('placeholder="Find client"');
    expect(SRC).toContain("ClientArchiveConfirmModal");
  });

  it("uses only valid RGB token syntax for project-shell colors", () => {
    expect(SRC).toContain("rgb(var(--brand-primary))");
    expect(SRC).toContain("rgb(var(--border-subtle))");
    for (const forbidden of [
      "--surface-card",
      "--text-muted",
      "--text-strong",
      "--surface-hover",
      "--brand-primary-on",
    ]) {
      expect(SRC).not.toContain(forbidden);
    }
  });
});
