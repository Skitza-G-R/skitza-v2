import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep test for the new Client Space page shell. Phase 1 Task
// 17 rewrote this page to drop the 4-tab structure and render the
// single-page ClientSpaceHero + ProjectRow list.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf-8");

describe("clients/[id]/page.tsx — Phase 1 rewrite", () => {
  it("imports ClientSpaceHero", () => {
    expect(SRC).toContain("ClientSpaceHero");
    expect(SRC).toContain(
      "~/components/dashboard/clients/client-space-hero",
    );
  });

  it("imports ProjectRow for the project list below the hero", () => {
    expect(SRC).toContain("ProjectRow");
    expect(SRC).toContain("~/components/dashboard/projects/project-row");
  });

  it("imports deriveGradient for the hero's gradient token", () => {
    expect(SRC).toContain("deriveGradient");
    expect(SRC).toContain("~/lib/clients/derive-gradient");
  });

  it("renders <ClientSpaceHero ... /> at the top of the page", () => {
    expect(SRC).toMatch(/<ClientSpaceHero/);
  });

  it("renders <ProjectRow ... /> rows for each project", () => {
    expect(SRC).toMatch(/<ProjectRow/);
  });

  it("passes producerSlug to ClientSpaceHero", () => {
    expect(SRC).toMatch(/producerSlug=\{/);
  });

  it("preserves the auth + caller scaffolding", () => {
    expect(SRC).toContain("@clerk/nextjs/server");
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("calls clientContacts.detail for the page payload", () => {
    expect(SRC).toContain("clientContacts.detail");
  });

  it("calls producer.me for slug + defaultCurrency", () => {
    expect(SRC).toContain("producer.me");
  });

  it("preserves the pickNextSession helper for the hero's next session", () => {
    expect(SRC).toContain("pickNextSession");
  });

  it("preserves the '+ New project' pre-filled href", () => {
    expect(SRC).toContain("clientEmail=");
    expect(SRC).toContain("clientName=");
  });

  it("removes the import of ClientDetailHeader", () => {
    expect(SRC).not.toContain("ClientDetailHeader");
    expect(SRC).not.toContain("client-detail-header");
  });

  it("removes the import of ClientDetailTabs", () => {
    expect(SRC).not.toContain("ClientDetailTabs");
    expect(SRC).not.toContain("client-detail-tabs");
  });

  it("removes the import of ClientOverviewPanel", () => {
    expect(SRC).not.toContain("ClientOverviewPanel");
    expect(SRC).not.toContain("client-overview-panel");
  });

  it("removes the import of ClientPaymentsPanel", () => {
    expect(SRC).not.toContain("ClientPaymentsPanel");
    expect(SRC).not.toContain("client-payments-panel");
  });

  it("removes the import of ClientProjectsPanel", () => {
    expect(SRC).not.toContain("ClientProjectsPanel");
    expect(SRC).not.toContain("client-projects-panel");
  });

  it("removes the import of ClientNotesPanel", () => {
    expect(SRC).not.toContain("ClientNotesPanel");
    expect(SRC).not.toContain("client-notes-panel");
  });

  it("removes the resolveClientDetailTab import", () => {
    expect(SRC).not.toContain("resolveClientDetailTab");
    expect(SRC).not.toContain("client-detail-tab-key");
  });

  it("forbids non-existent CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
