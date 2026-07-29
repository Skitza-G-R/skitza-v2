import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep test for the new Song Space page. Phase 3 adds this
// route — it locates the song inside the project payload, decides
// album vs single mode by purchased visible-space count, and renders <SongSpace />.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf-8");

describe("songs/[songId]/page.tsx — Phase 3 Song Space page", () => {
  it("imports SongSpace as the body component", () => {
    expect(SRC).toContain("SongSpace");
    expect(SRC).toContain("~/components/dashboard/song/song-space");
  });

  it("renders <SongSpace ... /> in the body", () => {
    expect(SRC).toMatch(/<SongSpace/);
  });

  it("preserves auth + caller scaffolding", () => {
    expect(SRC).toContain("@clerk/nextjs/server");
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("redirects to /sign-in when there's no userId", () => {
    expect(SRC).toMatch(/redirect\(\s*["']\/sign-in["']\s*\)/);
  });

  it("awaits the dynamic params { id, songId }", () => {
    expect(SRC).toMatch(/await\s+params/);
    expect(SRC).toContain("songId");
  });

  it("reads the upload query and asks SongSpace to open its eligible upload flow", () => {
    expect(SRC).toMatch(/searchParams\?:\s*Promise<\{[\s\S]*?upload\?:\s*string/);
    expect(SRC).toMatch(/initialUploadOpen=\{[^}]*upload\s*===\s*["']1["']/);
  });

  it("calls project.detail with the project id", () => {
    expect(SRC).toContain("project.detail");
  });

  it("calls booking.list to derive the per-song session log", () => {
    expect(SRC).toContain("booking.list");
  });

  it("calls notFound() when the song id isn't in data.tracks", () => {
    expect(SRC).toMatch(/notFound\(\s*\)/);
  });

  it("computes album-vs-single mode from the purchased song-space projection", () => {
    expect(SRC).toContain('data.songSpaces.mode === "single"');
    expect(SRC).toMatch(/["']album["'][\s\S]{0,40}["']single["']|["']single["'][\s\S]{0,40}["']album["']/);
  });

  it("keeps the compact Project Space reachable from every Song Space breadcrumb", () => {
    expect(SRC).toContain("const projectCrumb =");
    expect(SRC).toContain("href: `/dashboard/clients-projects/${data.project.id}`");
    expect(SRC).toContain(
      "const breadcrumbExtras = [clientCrumb, projectCrumb, { label: song.title }]",
    );
  });

  it("filters bookings to the current song id (per-song sessions)", () => {
    // Per-song sessions filter: b.songId === songId (the schema has
    // bookings.song_id, exposed as songId via select()).
    expect(SRC).toMatch(/songId/);
  });

  it("projects the song's separate Released state into SongSpace", () => {
    expect(SRC).toContain("releasedAtIso: track.releasedAt?.toISOString() ?? null");
  });

  it("renders <main className=\"sk-page-enter ...\">", () => {
    expect(SRC).toMatch(/className=["'][^"']*sk-page-enter/);
  });

  it("forbids non-existent CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
