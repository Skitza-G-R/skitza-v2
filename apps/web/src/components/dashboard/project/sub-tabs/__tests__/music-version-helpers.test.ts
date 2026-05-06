import { describe, it, expect } from "vitest";

import { pickInitialVersions } from "../music-version-helpers";

const tracks = [{ id: "t1" }, { id: "t2" }];
// Newest-first per track, mirroring the server's desc(uploadedAt) order.
const versions = [
  { id: "v1b", trackId: "t1" },
  { id: "v1a", trackId: "t1" },
  { id: "v2b", trackId: "t2" },
  { id: "v2a", trackId: "t2" },
];

describe("pickInitialVersions", () => {
  it("no initialVersionId → latest version per track", () => {
    expect(pickInitialVersions(tracks, versions)).toEqual({
      t1: "v1b",
      t2: "v2b",
    });
  });

  it("initialVersionId matches → that track pins it; other tracks stay on latest", () => {
    expect(pickInitialVersions(tracks, versions, "v1a")).toEqual({
      t1: "v1a",
      t2: "v2b",
    });
  });

  it("initialVersionId pins latest of t2 explicitly → still latest of t2", () => {
    expect(pickInitialVersions(tracks, versions, "v2a")).toEqual({
      t1: "v1b",
      t2: "v2a",
    });
  });

  it("stale initialVersionId (no match) → falls back to latest for every track", () => {
    expect(pickInitialVersions(tracks, versions, "deleted-id")).toEqual({
      t1: "v1b",
      t2: "v2b",
    });
  });

  it("track has no versions → entry is null", () => {
    const orphan = [{ id: "t1" }, { id: "t3" }];
    expect(pickInitialVersions(orphan, versions)).toEqual({
      t1: "v1b",
      t3: null,
    });
  });

  it("empty tracks → empty record", () => {
    expect(pickInitialVersions([], versions)).toEqual({});
  });
});
