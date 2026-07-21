import { describe, expect, it } from "vitest";

import { compareClientsByJoined, compareProjectsByJoined } from "../sort-value";

describe("compareProjectsByJoined", () => {
  it("orders projects newest-created first and sinks missing dates", () => {
    const rows = [
      { id: "old", createdAtIso: "2026-01-10T10:00:00.000Z" },
      { id: "missing" },
      { id: "new", createdAtIso: "2026-07-20T10:00:00.000Z" },
    ];

    expect(rows.sort(compareProjectsByJoined).map((row) => row.id)).toEqual([
      "new",
      "old",
      "missing",
    ]);
  });
});

describe("compareClientsByJoined", () => {
  it("orders clients newest-joined first and sinks missing dates", () => {
    const rows = [
      { id: "old", joinedAtIso: "2026-01-10T10:00:00.000Z" },
      { id: "missing" },
      { id: "new", joinedAtIso: "2026-07-20T10:00:00.000Z" },
    ];

    expect(rows.sort(compareClientsByJoined).map((row) => row.id)).toEqual([
      "new",
      "old",
      "missing",
    ]);
  });
});
