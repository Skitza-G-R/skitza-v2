import { describe, expect, it } from "vitest";

import {
  matchesMusicFilter,
  type MusicProjectRow,
} from "../music/music-library-filter";

const NOW = new Date("2026-05-06T12:00:00Z");

const fresh: MusicProjectRow = {
  projectId: "proj-fresh",
  title: "Album One",
  producerId: "p1",
  producerName: "Gili Asraf",
  producerSlug: "gili",
  latestTrackTitle: "v3 of Single",
  latestTrackUploadedAt: new Date("2026-05-01T10:00:00Z"), // 5 days
  trackCount: 3,
};

const stale: MusicProjectRow = {
  projectId: "proj-stale",
  title: "Old Sessions",
  producerId: "p1",
  producerName: "Gili Asraf",
  producerSlug: "gili",
  latestTrackTitle: "v1 of Demo",
  latestTrackUploadedAt: new Date("2026-04-01T10:00:00Z"), // ~35 days
  trackCount: 2,
};

const empty: MusicProjectRow = {
  projectId: "proj-empty",
  title: "Empty Project",
  producerId: "p2",
  producerName: "Maya Levin",
  producerSlug: "maya",
  latestTrackTitle: null,
  latestTrackUploadedAt: null,
  trackCount: 0,
};

describe("matchesMusicFilter", () => {
  it("default ('all', 'all') admits every project", () => {
    expect(matchesMusicFilter(fresh, "all", "all", NOW)).toBe(true);
    expect(matchesMusicFilter(stale, "all", "all", NOW)).toBe(true);
    expect(matchesMusicFilter(empty, "all", "all", NOW)).toBe(true);
  });

  it("with_tracks excludes projects with no uploads", () => {
    expect(matchesMusicFilter(fresh, "all", "with_tracks", NOW)).toBe(true);
    expect(matchesMusicFilter(stale, "all", "with_tracks", NOW)).toBe(true);
    expect(matchesMusicFilter(empty, "all", "with_tracks", NOW)).toBe(false);
  });

  it("recent restricts to last 14 days and excludes never-uploaded", () => {
    expect(matchesMusicFilter(fresh, "all", "recent", NOW)).toBe(true);
    expect(matchesMusicFilter(stale, "all", "recent", NOW)).toBe(false);
    expect(matchesMusicFilter(empty, "all", "recent", NOW)).toBe(false);
  });

  it("producerFilter scopes by producerId", () => {
    expect(matchesMusicFilter(fresh, "p1", "all", NOW)).toBe(true);
    expect(matchesMusicFilter(fresh, "p2", "all", NOW)).toBe(false);
    expect(matchesMusicFilter(empty, "p2", "all", NOW)).toBe(true);
  });

  it("composes filter + producerFilter", () => {
    // fresh is producer p1; producer filter p2 rules it out even
    // though it would otherwise pass the recent gate.
    expect(matchesMusicFilter(fresh, "p2", "recent", NOW)).toBe(false);
  });
});
