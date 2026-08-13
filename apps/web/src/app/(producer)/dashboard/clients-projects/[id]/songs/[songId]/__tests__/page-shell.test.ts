import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf-8");

describe("legacy songs/[songId] route", () => {
  it("authenticates before resolving the legacy URL", () => {
    expect(SRC).toContain("~/server/auth/clerk-identity");
    expect(SRC).toMatch(/redirect\(\s*["']\/sign-in["']\s*\)/);
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("verifies that the song belongs to the producer-scoped project", () => {
    expect(SRC).toContain("project.detail({ id })");
    expect(SRC).toMatch(/data\.tracks\.find\([\s\S]{0,100}songId/);
    expect(SRC).toMatch(/if\s*\(\s*!track\s*\)[\s\S]*?notFound\(\)/);
  });

  it("redirects versioned songs to the existing Music player page", () => {
    expect(SRC).toContain("const detailVersion = playable ?? historical");
    expect(SRC).toContain(
      "/dashboard/music/${encodeURIComponent(detailVersion.id)}?from=${encodeURIComponent(id)}",
    );
  });

  it("keeps upload as a one-shot Project Space modal and falls back cleanly without a version", () => {
    expect(SRC).toContain('if (query.upload === "1")');
    expect(SRC).toContain("projectSongUploadHref(id, songId)");
    expect(SRC).toContain("/dashboard/clients-projects/${encodeURIComponent(id)}");
  });

  it("does not render the removed standalone Song Space layer", () => {
    expect(SRC).not.toContain("SongSpace");
    expect(SRC).not.toContain("ProjectSongWorkspace");
    expect(SRC).not.toContain("<main");
    expect(SRC).not.toContain("purchaseLedger");
    expect(SRC).not.toContain("booking.list");
  });
});
