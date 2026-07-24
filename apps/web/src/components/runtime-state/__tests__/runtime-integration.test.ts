import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  clearRuntimeStateBeforeSignOut,
  runtimeUserToClear,
  shouldConcealRuntimeContent,
} from "../runtime-state-provider";
import { MemoryStorage } from "~/lib/runtime-state/__tests__/memory-storage";
import { createRuntimeDraftFlush, flushRuntimeDraftForScope } from "~/lib/runtime-state/drafts";
import { runtimeScope, writeRuntimeState } from "~/lib/runtime-state/runtime-state";

const COMPONENT_DIR = join(__dirname, "..");
const CACHE_HOOK = readFileSync(join(COMPONENT_DIR, "use-runtime-state.ts"), "utf8");
const PRODUCER_VIEW = readFileSync(
  join(__dirname, "../../dashboard/overview/overview-screen.tsx"),
  "utf8",
);
const ARTIST_RUNTIME = readFileSync(
  join(__dirname, "../../artist/home/artist-home-runtime.tsx"),
  "utf8",
);
const GREETING = readFileSync(join(__dirname, "../../artist/home/greeting-strip.tsx"), "utf8");
const SONG_PAGE = readFileSync(join(__dirname, "../../music/song-page.tsx"), "utf8");

describe("runtime privacy adapters", () => {
  it("conceals the old tree as soon as Clerk reports sign-out or another account", () => {
    expect(shouldConcealRuntimeContent(false, undefined, "server-user")).toBe(false);
    expect(shouldConcealRuntimeContent(false, undefined, "server-user", true)).toBe(true);
    expect(shouldConcealRuntimeContent(true, "server-user", "server-user")).toBe(false);
    expect(shouldConcealRuntimeContent(true, null, "server-user")).toBe(true);
    expect(shouldConcealRuntimeContent(true, "next-user", "server-user")).toBe(true);
    expect(runtimeUserToClear("server-user", null)).toBe("server-user");
    expect(runtimeUserToClear("server-user", "next-user")).toBe("server-user");
    expect(runtimeUserToClear("server-user", "server-user")).toBeNull();
  });

  it("clears private state before invoking Clerk sign-out", async () => {
    const storage = new MemoryStorage();
    const scope = runtimeScope("server-user", "producer", "producer-id", "/dashboard");
    if (!scope) throw new Error("Expected scope");
    writeRuntimeState(storage, scope, "producer.overview.safe-view", {
      displayName: "Private studio",
      activeProjects: 2,
    });
    const signOut = vi.fn(() => {
      expect(storage.length).toBe(0);
      return Promise.resolve("signed-out");
    });

    await expect(clearRuntimeStateBeforeSignOut(storage, "server-user", signOut)).resolves.toBe(
      "signed-out",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("invalidates a dirty draft flush before sign-out can unmount the shell", () => {
    const write = vi.fn(() => true);
    const pending = createRuntimeDraftFlush("server-user:producer:producer-id", write);

    clearRuntimeStateBeforeSignOut(null, "server-user", () => "signed-out");

    expect(flushRuntimeDraftForScope(pending, "server-user:producer:producer-id")).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("cached-first and draft integration contracts", () => {
  it("reads cache in a layout effect before silent server replacement", () => {
    expect(CACHE_HOOK).toContain("privateStateAccessAllowed");
    expect(CACHE_HOOK).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*readRuntimeState[\s\S]*setSource\("cache"\)/,
    );
    expect(CACHE_HOOK).toMatch(
      /useEffect\(\(\) => \{[\s\S]*writeRuntimeState[\s\S]*setSource\("server"\)/,
    );
    expect(CACHE_HOOK.match(/requestAnimationFrame/g)).toHaveLength(2);
    expect(CACHE_HOOK).toContain("if (!online && cacheReadBeforePaint.current) return");
    expect(CACHE_HOOK).not.toMatch(/setSource\("loading"\)/);
  });

  it("uses the safe cache in real producer and artist rendering slices", () => {
    expect(PRODUCER_VIEW).toContain('slot: "producer.overview.safe-view"');
    expect(PRODUCER_VIEW).toContain("cachedView.data?.displayName");
    expect(ARTIST_RUNTIME).toContain('slot: "artist.home.safe-view"');
    expect(GREETING).toContain("runtime?.view.firstName");
    expect(PRODUCER_VIEW).toMatch(/if \(!online\)[\s\S]*Saved studio pulse/);
    expect(ARTIST_RUNTIME).toMatch(/if \(!online\)[\s\S]*Showing saved artist context/);
  });

  it("autosaves both role-specific comment drafts and blocks offline submit", () => {
    expect(SONG_PAGE).toContain('"artist.song-comment-draft"');
    expect(SONG_PAGE).toContain('"producer.song-comment-draft"');
    expect(SONG_PAGE).toContain("commentDraft.preserveDraft(body)");
    expect(SONG_PAGE).toContain("commentDraft.clearDraft()");
    expect(SONG_PAGE).toContain("commentDraft.setBodyFromUser(event.currentTarget.value)");
    expect(CACHE_HOOK).toContain("registerRuntimeDraftFlushLifecycle(window");
    expect(SONG_PAGE).toContain("Reconnect to post this comment");
  });
});
