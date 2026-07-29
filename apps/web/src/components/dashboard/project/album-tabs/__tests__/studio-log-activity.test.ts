import { describe, expect, it } from "vitest";

import { buildProjectActivityEntries } from "../studio-log-activity";

describe("buildProjectActivityEntries", () => {
  it("selects recent comments by creation time instead of incoming waveform order", () => {
    const comments = [
      { id: "oldest", createdAt: new Date("2026-01-01T10:00:00.000Z") },
      { id: "newest", createdAt: new Date("2026-01-07T10:00:00.000Z") },
      { id: "second", createdAt: new Date("2026-01-06T10:00:00.000Z") },
      { id: "third", createdAt: new Date("2026-01-05T10:00:00.000Z") },
      { id: "fourth", createdAt: new Date("2026-01-04T10:00:00.000Z") },
      { id: "fifth", createdAt: new Date("2026-01-03T10:00:00.000Z") },
      { id: "sixth", createdAt: new Date("2026-01-02T10:00:00.000Z") },
    ].map((comment) => ({
      ...comment,
      authorName: comment.id,
    }));

    const entries = buildProjectActivityEntries({
      projectId: "project-1",
      projectCreatedAt: new Date("2025-12-01T10:00:00.000Z"),
      versions: [],
      comments,
    });

    expect(entries.filter((entry) => entry.kind === "comment").map((entry) => entry.id)).toEqual([
      "comment-newest",
      "comment-second",
      "comment-third",
      "comment-fourth",
      "comment-fifth",
    ]);
  });

  it("selects recent versions explicitly even when their input order changes", () => {
    const entries = buildProjectActivityEntries({
      projectId: "project-1",
      projectCreatedAt: new Date("2025-12-01T10:00:00.000Z"),
      versions: [
        {
          id: "older",
          label: "V1",
          uploadedAt: new Date("2026-01-01T10:00:00.000Z"),
        },
        {
          id: "newer",
          label: "V2",
          uploadedAt: new Date("2026-01-02T10:00:00.000Z"),
        },
      ],
      comments: [],
    });

    expect(entries.filter((entry) => entry.kind === "version").map((entry) => entry.id)).toEqual([
      "version-newer",
      "version-older",
    ]);
  });
});
