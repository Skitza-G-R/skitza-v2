import { describe, expect, it } from "vitest";

import { projectSongWorkspaceHref } from "../project-song-workspace-href";

describe("projectSongWorkspaceHref", () => {
  it("selects a song on the canonical Project Space", () => {
    expect(projectSongWorkspaceHref("project one", "song/one")).toBe(
      "/dashboard/clients-projects/project%20one?song=song%2Fone",
    );
  });

  it("preserves the one-shot upload handoff without creating a nested Song Space URL", () => {
    const href = projectSongWorkspaceHref("project-1", "song-1", { upload: true });

    expect(href).toBe("/dashboard/clients-projects/project-1?song=song-1&upload=1");
    expect(href).not.toContain("/songs/");
  });
});
