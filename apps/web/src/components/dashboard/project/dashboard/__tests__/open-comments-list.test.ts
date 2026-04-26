import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildCommentJumpHref } from "../dashboard-helpers";

// OpenCommentsList shows the top 2-3 unresolved comment threads. The
// procedure already filters + slices to 3; the component's job is the
// presentation: track title · timestamp anchor · preview · click jumps
// to Music tab at that comment.

describe("buildCommentJumpHref — Music tab deep-link", () => {
  it("includes tab=music, versionId, and commentId", () => {
    const href = buildCommentJumpHref({
      projectId: "p-1",
      versionId: "v-1",
      commentId: "c-1",
    });
    const url = new URL(`http://_${href}`);
    expect(url.pathname).toBe("/dashboard/projects/p-1");
    expect(url.searchParams.get("tab")).toBe("music");
    expect(url.searchParams.get("versionId")).toBe("v-1");
    expect(url.searchParams.get("commentId")).toBe("c-1");
  });

  it("encodes the projectId path segment (uuids are safe but pin the format)", () => {
    const href = buildCommentJumpHref({
      projectId: "550e8400-e29b-41d4-a716-446655440000",
      versionId: "v-1",
      commentId: "c-1",
    });
    expect(href).toContain("/dashboard/projects/550e8400-e29b-41d4-a716-446655440000");
  });
});

const SRC = readFileSync(
  new URL("../open-comments-list.tsx", import.meta.url),
  "utf8",
);

describe("OpenCommentsList source invariants", () => {
  it("uses next/link <Link> for the jump (server-component navigation)", () => {
    expect(SRC).toMatch(/from\s+["']next\/link["']/);
  });

  it("uses buildCommentJumpHref for the deep-link URL", () => {
    expect(SRC).toMatch(/buildCommentJumpHref/);
  });

  it("imports formatTimestamp for the mm:ss anchor", () => {
    expect(SRC).toMatch(/formatTimestamp/);
  });

  it("imports truncateBody for the body preview", () => {
    expect(SRC).toMatch(/truncateBody/);
  });

  it("returns null when the comments array is empty (silent empty)", () => {
    // Render-nothing-when-empty per story spec.
    expect(SRC).toMatch(/length\s*===\s*0|length\s*<\s*1|!comments\.length/);
    expect(SRC).toMatch(/return\s+null/);
  });

  it("does NOT use raw hex colours", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
