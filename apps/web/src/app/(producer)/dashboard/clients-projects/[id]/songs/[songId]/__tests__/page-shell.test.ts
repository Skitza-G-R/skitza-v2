import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf-8");

describe("legacy songs/[songId] route", () => {
  it("authenticates before resolving the legacy URL", () => {
    expect(SRC).toContain("@clerk/nextjs/server");
    expect(SRC).toMatch(/redirect\(\s*["']\/sign-in["']\s*\)/);
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("verifies that the song belongs to the producer-scoped project", () => {
    expect(SRC).toContain("project.detail({ id })");
    expect(SRC).toMatch(/data\.tracks\.some\([\s\S]{0,100}songId/);
    expect(SRC).toMatch(/if\s*\(\s*!songBelongsToProject\s*\)[\s\S]*?notFound\(\)/);
  });

  it("redirects into canonical Project Space and forwards only upload=1", () => {
    expect(SRC).toContain("projectSongWorkspaceHref");
    expect(SRC).toContain('upload: query.upload === "1"');
    expect(SRC).toMatch(/redirect\(\s*projectSongWorkspaceHref/);
  });

  it("does not render the removed standalone Song Space layer", () => {
    expect(SRC).not.toContain("SongSpace");
    expect(SRC).not.toContain("<main");
    expect(SRC).not.toContain("purchaseLedger");
    expect(SRC).not.toContain("booking.list");
  });
});
