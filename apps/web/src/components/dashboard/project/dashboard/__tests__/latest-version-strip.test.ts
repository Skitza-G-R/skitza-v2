import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildVersionJumpHref } from "../dashboard-helpers";

const SRC = readFileSync(
  new URL("../latest-version-strip.tsx", import.meta.url),
  "utf8",
);

describe("buildVersionJumpHref — Music tab deep-link", () => {
  it("includes tab=music + versionId", () => {
    const href = buildVersionJumpHref({
      projectId: "p-1",
      versionId: "v-1",
    });
    const url = new URL(`http://_${href}`);
    expect(url.pathname).toBe("/dashboard/projects/p-1");
    expect(url.searchParams.get("tab")).toBe("music");
    expect(url.searchParams.get("versionId")).toBe("v-1");
  });
});

describe("LatestVersionStrip source invariants", () => {
  it("re-uses PersistentPlayer infra (playerPlay or PLAYER_EVENTS)", () => {
    // Per story: must reuse existing PersistentPlayer rather than fork.
    expect(SRC).toMatch(/playerPlay|PLAYER_EVENTS|persistent-player/);
  });

  it("does NOT introduce new <audio> elements (player handles playback)", () => {
    expect(SRC).not.toMatch(/<audio/);
  });

  it("uses next/link for the title-click jump", () => {
    expect(SRC).toMatch(/from\s+["']next\/link["']/);
  });

  it("does NOT render anything when latestVersion is null", () => {
    // The entire module hides when there are no versions — silence >
    // "no tracks yet" per story spec.
    expect(SRC).toMatch(/!latestVersion|latestVersion\s*===\s*null|return\s+null/);
  });

  it("imports formatRelativeTime for 'sent 2 days ago' label", () => {
    expect(SRC).toMatch(/formatRelativeTime/);
  });

  it("does NOT use raw hex colours", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("client component (PersistentPlayer interaction)", () => {
    expect(SRC).toMatch(/use client/);
  });
});
