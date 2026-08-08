import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const songPage = readFileSync(new URL("../song-page.tsx", import.meta.url), "utf8");
const producerPage = readFileSync(
  new URL("../../../app/(producer)/dashboard/music/[versionId]/page.tsx", import.meta.url),
  "utf8",
);
const actions = readFileSync(
  new URL("../../../app/(producer)/dashboard/music/actions.ts", import.meta.url),
  "utf8",
);

describe("SK-196 Song page permanent deletion", () => {
  it("puts Delete Song in the main Song menu", () => {
    expect(songPage).toContain('onOpenManagement("delete-song")');
    expect(songPage).toContain("Delete song");
    expect(songPage).toContain("every Version and audio file");
  });

  it("puts an accessible three-dot deletion action on every Version", () => {
    expect(songPage).toContain("aria-label={`More actions for ${version.label}`}");
    expect(songPage).toContain('versions.length === 1 ? "delete-song" : "delete-version"');
    expect(songPage).toContain("This is the only Version. Delete the Song instead.");
  });

  it("removes a successful Version from local history and redirects every routed deletion", () => {
    expect(songPage).toContain("setOptimisticallyDeletedVersionIds");
    expect(songPage).toContain("<SongDeletionRedirect href={songDeletionRedirectHref}");
    expect(songPage).toContain("router.push(href)");
    expect(songPage).toContain("newestPlayableSongPageVersion(remaining)");
    expect(songPage).toContain("encodeURIComponent(nextVersion.id)");
    expect(songPage).toContain("encodeURIComponent(data.track.projectId)");
  });

  it("wires both server actions only on the producer page", () => {
    expect(producerPage).toContain("deleteVersion: deleteMusicVersion");
    expect(producerPage).toContain("deleteSong: deleteMusicSong");
    expect(actions).toContain("project.permanentlyDeleteSongVersion");
    expect(actions).toContain("project.permanentlyDeleteSong");
  });
});
