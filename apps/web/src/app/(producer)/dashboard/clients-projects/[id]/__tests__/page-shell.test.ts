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
    expect(SRC).toContain(
      "~/components/dashboard/project/album-space",
    );
  });

  it("renders <AlbumSpace ... /> in the body", () => {
    expect(SRC).toMatch(/<AlbumSpace/);
  });

  it("preserves auth + caller scaffolding", () => {
    expect(SRC).toContain("@clerk/nextjs/server");
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("fetches project.detail + project.money in parallel via the tRPC caller", () => {
    expect(SRC).toContain("project.detail");
    expect(SRC).toContain("project.money");
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
    // FilesSubTab is now wrapped by FilesTab from the album-tabs folder.
    expect(SRC).not.toContain("from \"~/components/dashboard/project/sub-tabs/files-sub-tab\"");
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

  it("redirects to /songs/[songId] when the project has exactly 1 track (Single-Space rule)", () => {
    // The Single-Space rule: a project with exactly one track is its
    // song — the album route bounces straight to the song route.
    // Assertion is whitespace-tolerant + accepts either tracks[0].id
    // or a small destructure / lookup variant.
    expect(SRC).toMatch(/data\.tracks\.length\s*===\s*1/);
    // Allow multi-line redirect call. Check the template literal
    // shape includes the dashboard + songs path with two interpolations.
    expect(SRC).toMatch(
      /redirect\([\s\S]*?`\/dashboard\/clients-projects\/\$\{[^}]+\}\/songs\/\$\{[^}]+\}`[\s\S]*?\)/,
    );
  });
});
