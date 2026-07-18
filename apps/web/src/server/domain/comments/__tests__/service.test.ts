import { describe, expect, it } from "vitest";

import { assertWritableCommentTarget, type WritableCommentTarget } from "../service";

const target = (overrides: Partial<WritableCommentTarget> = {}): WritableCommentTarget => ({
  versionId: "version-1",
  versionTrackId: "track-1",
  trackId: "track-1",
  trackProjectId: "project-1",
  trackArchivedAt: null,
  projectId: "project-1",
  projectLifecycleStatus: "active",
  ...overrides,
});

const expected = {
  versionId: "version-1",
  trackId: "track-1",
  projectId: "project-1",
};

describe("assertWritableCommentTarget", () => {
  it.each(["active", "paused"] as const)("allows comments while a project is %s", (status) => {
    expect(() => {
      assertWritableCommentTarget(target({ projectLifecycleStatus: status }), expected);
    }).not.toThrow();
  });

  it.each(["waiting_for_payment", "completed", "canceled"] as const)(
    "rejects comments while a project is %s",
    (status) => {
      expect(() => {
        assertWritableCommentTarget(target({ projectLifecycleStatus: status }), expected);
      }).toThrow(expect.objectContaining({ code: "INACTIVE" }));
    },
  );

  it("rejects comments on an archived track", () => {
    expect(() => {
      assertWritableCommentTarget(target({ trackArchivedAt: new Date() }), expected);
    }).toThrow(expect.objectContaining({ code: "INACTIVE" }));
  });

  it.each([
    ["missing target", null],
    ["stale version-to-track link", target({ versionTrackId: "track-2" })],
    ["stale track-to-project link", target({ trackProjectId: "project-2" })],
    ["unexpected version", target({ versionId: "version-2" })],
  ] as const)("rejects a %s", (_label, actual) => {
    expect(() => {
      assertWritableCommentTarget(actual, expected);
    }).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});
