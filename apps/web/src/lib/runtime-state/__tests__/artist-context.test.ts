import { describe, expect, it } from "vitest";

import { clearAccountPrivateRuntimeState } from "../account-exit";
import {
  canReadArtistRuntimeStudioContext,
  resolveArtistRuntimeStudioContext,
  writeArtistRuntimeStudioContext,
} from "../artist-context";
import {
  readRuntimeResumeHref,
  recordRuntimeNavigation,
  type RuntimeIdentity,
} from "../navigation";

import { MemoryStorage } from "./memory-storage";

const STUDIOS = ["studio-a", "studio-b"] as const;

class ReadTrackingStorage extends MemoryStorage {
  reads = 0;

  override getItem(key: string): string | null {
    this.reads += 1;
    return super.getItem(key);
  }
}

function artistIdentity(userId: string, contextId: string): RuntimeIdentity {
  return {
    userId,
    role: "artist",
    contextId,
  };
}

describe("artist runtime studio context", () => {
  it("uses the last valid studio before reading its isolated resume index", () => {
    const storage = new MemoryStorage();
    const studioB = artistIdentity("artist-user", "studio-b");
    recordRuntimeNavigation(
      storage,
      studioB,
      "/artist/music/song/version-b?studio=studio-b",
      320,
      1,
    );
    expect(
      writeArtistRuntimeStudioContext(
        storage,
        "artist-user",
        STUDIOS,
        "studio-b",
        1,
      ),
    ).toBe(true);

    const contextId = resolveArtistRuntimeStudioContext(
      storage,
      "artist-user",
      STUDIOS,
      null,
      1,
    );

    expect(contextId).toBe("studio-b");
    if (!contextId) throw new Error("Expected a current artist studio");
    expect(
      readRuntimeResumeHref(storage, artistIdentity("artist-user", contextId), 1),
    ).toBe("/artist/music/song/version-b?studio=studio-b");
  });

  it("falls back to the first current studio for a removed or invalid pointer", () => {
    const storage = new MemoryStorage();
    writeArtistRuntimeStudioContext(
      storage,
      "artist-user",
      STUDIOS,
      "studio-b",
      1,
    );

    expect(
      resolveArtistRuntimeStudioContext(
        storage,
        "artist-user",
        ["studio-a"],
        null,
        1,
      ),
    ).toBe("studio-a");
    expect(
      writeArtistRuntimeStudioContext(
        storage,
        "artist-user",
        ["studio-a"],
        "removed-studio",
        2,
      ),
    ).toBe(false);
  });

  it("isolates and clears the pointer by Clerk account", () => {
    const storage = new MemoryStorage();
    writeArtistRuntimeStudioContext(
      storage,
      "artist-a",
      STUDIOS,
      "studio-b",
      1,
    );
    writeArtistRuntimeStudioContext(
      storage,
      "artist-b",
      STUDIOS,
      "studio-b",
      1,
    );

    expect(
      resolveArtistRuntimeStudioContext(storage, "artist-a", STUDIOS, null, 1),
    ).toBe("studio-b");
    expect(
      resolveArtistRuntimeStudioContext(storage, "artist-b", STUDIOS, null, 1),
    ).toBe("studio-b");

    expect(clearAccountPrivateRuntimeState("artist-a", storage)).toBe(1);
    expect(storage.length).toBe(1);
    expect(
      resolveArtistRuntimeStudioContext(storage, "artist-a", STUDIOS, null, 1),
    ).toBe("studio-a");
    expect(
      resolveArtistRuntimeStudioContext(storage, "artist-b", STUDIOS, null, 1),
    ).toBe("studio-b");
  });

  it("does not read a pointer before Clerk confirms the server account", () => {
    const storage = new ReadTrackingStorage();
    writeArtistRuntimeStudioContext(
      storage,
      "artist-a",
      STUDIOS,
      "studio-b",
      1,
    );

    for (const [clerkLoaded, clerkUserId] of [
      [false, undefined],
      [true, "artist-b"],
    ] as const) {
      const readableStorage = canReadArtistRuntimeStudioContext(
        clerkLoaded,
        clerkUserId,
        "artist-a",
      )
        ? storage
        : null;
      expect(
        resolveArtistRuntimeStudioContext(
          readableStorage,
          "artist-a",
          STUDIOS,
          null,
          1,
        ),
      ).toBe("studio-a");
    }
    expect(storage.reads).toBe(0);

    expect(
      canReadArtistRuntimeStudioContext(true, "artist-a", "artist-a"),
    ).toBe(true);
    expect(
      resolveArtistRuntimeStudioContext(
        storage,
        "artist-a",
        STUDIOS,
        null,
        1,
      ),
    ).toBe("studio-b");
    expect(storage.reads).toBe(1);
  });

  it("keeps each studio's navigation index isolated", () => {
    const storage = new MemoryStorage();
    const studioA = artistIdentity("artist-user", "studio-a");
    const studioB = artistIdentity("artist-user", "studio-b");
    recordRuntimeNavigation(
      storage,
      studioA,
      "/artist/music?studio=studio-a",
      100,
      1,
    );
    recordRuntimeNavigation(
      storage,
      studioB,
      "/artist/music?studio=studio-b",
      200,
      2,
    );

    expect(readRuntimeResumeHref(storage, studioA, 2)).toBe(
      "/artist/music?studio=studio-a",
    );
    expect(readRuntimeResumeHref(storage, studioB, 2)).toBe(
      "/artist/music?studio=studio-b",
    );
  });

  it("keeps an explicit valid studio selection ahead of the pointer", () => {
    const storage = new MemoryStorage();
    writeArtistRuntimeStudioContext(
      storage,
      "artist-user",
      STUDIOS,
      "studio-b",
      1,
    );

    expect(
      resolveArtistRuntimeStudioContext(
        storage,
        "artist-user",
        STUDIOS,
        "studio-a",
        1,
      ),
    ).toBe("studio-a");
  });
});
