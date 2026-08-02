import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "library-screen.tsx"), "utf8");
const producerPage = readFileSync(
  join(here, "..", "..", "..", "app", "(producer)", "dashboard", "music", "page.tsx"),
  "utf8",
);
const artistPage = readFileSync(
  join(here, "..", "..", "..", "app", "(artist)", "artist", "music", "page.tsx"),
  "utf8",
);

describe("Song-first Libraries", () => {
  it("uses Project as a filter instead of a Projects/Songs mode switch", () => {
    expect(source).toContain('aria-label="Filter by project"');
    expect(source).not.toContain('aria-label="Library mode"');
    expect(source).not.toContain("<ProjectsGrid");
    expect(source).not.toContain("<ProjectsTable");
  });

  it("labels the producer entry point Upload audio", () => {
    expect(source).toContain("Upload audio");
    expect(source).not.toMatch(/>\s*Add Song\s*<\/Link>/);
  });

  it("does not place purchased empty spaces into either Library", () => {
    expect(producerPage).not.toContain("...project.emptySlots.map");
    expect(artistPage).not.toContain("...project.emptySlots.map");
  });

  it("carries public exposure into Library new-Version uploads", () => {
    expect(producerPage).toContain("publicExposure: song.publicExposure");
    expect(producerPage).toContain('song.purchaseLifecycleStatus === "active"');
    expect(producerPage).toContain("song.archivedAt === null");
  });

  it("uses Song-first empty copy for artists", () => {
    expect(source).toContain('title="No songs yet"');
    expect(source).not.toContain('title="No projects yet"');
  });
});
