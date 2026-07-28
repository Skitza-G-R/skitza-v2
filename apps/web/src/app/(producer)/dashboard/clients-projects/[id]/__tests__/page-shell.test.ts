import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep test for the new project detail page shell. Phase 2
// rewrote this page to render <AlbumSpace /> instead of the legacy
// ProjectHeader + ProjectRoomHero + ProjectStatStrip + ProjectSubTabs
// + 5 sub-tabs stack.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf-8");

describe("clients-projects/[id]/page.tsx — Phase 2 rewrite to AlbumSpace", () => {
  it("imports AlbumSpace as the new top-level body", () => {
    expect(SRC).toContain("AlbumSpace");
    expect(SRC).toContain("~/components/dashboard/project/album-space");
  });

  it("renders <AlbumSpace ... /> in the body", () => {
    expect(SRC).toMatch(/<AlbumSpace/);
  });

  it("preserves auth + caller scaffolding", () => {
    expect(SRC).toContain("@clerk/nextjs/server");
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("fetches project detail without the removed project-level money projection", () => {
    expect(SRC).toContain("project.detail");
    expect(SRC).not.toContain("project.money");
  });

  it("starts detail and canonical payments together, then scopes Album Space bookings", () => {
    const detailAt = SRC.indexOf("project.detail({ id })");
    const paymentsAt = SRC.indexOf("purchaseLedger.project({ projectId: id })");
    const bookingsAt = SRC.indexOf("booking.list({ projectId: id })");
    const settledStart = SRC.lastIndexOf("Promise.allSettled", detailAt);
    const settledEnd = SRC.indexOf("]);", paymentsAt);
    const redirectAt = SRC.indexOf("redirect(`/dashboard/clients-projects/", settledEnd);

    expect(settledStart).toBeGreaterThan(-1);
    expect(detailAt).toBeGreaterThan(settledStart);
    expect(paymentsAt).toBeGreaterThan(detailAt);
    expect(settledEnd).toBeGreaterThan(paymentsAt);
    expect(redirectAt).toBeGreaterThan(settledEnd);
    expect(bookingsAt).toBeGreaterThan(redirectAt);
  });

  it("uses the stable clientContactId for the breadcrumb without a global client list", () => {
    expect(SRC).not.toContain("clientContacts.listWithProjects");
    expect(SRC).toContain("data.project.clientContactId");
    expect(SRC).not.toContain("breadcrumbClientEmail");
  });

  it("drops the import of the old ProjectHeader", () => {
    expect(SRC).not.toContain("ProjectHeader");
    expect(SRC).not.toContain("project-header");
  });

  it("drops the import of the old ProjectRoomHero", () => {
    expect(SRC).not.toContain("ProjectRoomHero");
    expect(SRC).not.toContain("project-room-hero");
  });

  it("drops the import of the old ProjectStatStrip", () => {
    expect(SRC).not.toContain("ProjectStatStrip");
    expect(SRC).not.toContain("project-stat-strip");
  });

  it("drops the import of the old ProjectSubTabs + resolver", () => {
    expect(SRC).not.toContain("ProjectSubTabs");
    expect(SRC).not.toContain("project-sub-tabs");
    expect(SRC).not.toContain("resolveProjectSubTab");
    expect(SRC).not.toContain("project-sub-tab-shared");
  });

  it("drops the imports of legacy sub-tabs that the new IA replaces", () => {
    // The removed Files control and its legacy sub-tab stay out of the shell.
    expect(SRC).not.toContain('from "~/components/dashboard/project/sub-tabs/files-sub-tab"');
    expect(SRC).not.toContain("MusicSubTab");
    expect(SRC).not.toContain("NotesSubTab");
    expect(SRC).not.toContain("OverviewSubTab");
  });

  it("forbids non-existent CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("filters past bookings for the 'last session' computation", () => {
    expect(SRC).toMatch(/startsAt\s*<\s*now|startsAt\s*<=\s*now|past\s*[Bb]ookings/);
  });

  it("redirects an allocated one-space project to its Song Space", () => {
    expect(SRC).toContain('data.songSpaces.mode === "single"');
    expect(SRC).toContain("data.tracks.length === 1");
    // Allow multi-line redirect call. Check the template literal
    // shape includes the dashboard + songs path with two interpolations.
    expect(SRC).toMatch(
      /redirect\([\s\S]*?`\/dashboard\/clients-projects\/\$\{[^}]+\}\/songs\/\$\{[^}]+\}`[\s\S]*?\)/,
    );
  });

  it("maps artist credit into AlbumSpace rows", () => {
    expect(SRC).toMatch(/artist:\s*t\.artist/);
  });

  it("locks project-room Add Song to the project being viewed", () => {
    expect(SRC).toContain("&lockProject=1");
  });
});
