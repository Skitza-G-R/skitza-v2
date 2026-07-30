import { describe, expect, it } from "vitest";

import { projectSongUploadHref } from "../project-song-upload-href";

describe("projectSongUploadHref", () => {
  it("builds the one-shot upload handoff for an allocated song", () => {
    expect(projectSongUploadHref("project one", "song/one")).toBe(
      "/dashboard/clients-projects/project%20one?song=song%2Fone&upload=1",
    );
  });
});
