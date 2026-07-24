import { describe, expect, it } from "vitest";

import {
  clearProducerDisplayNameDraft,
  clearRuntimeTextDraft,
  readProducerDisplayNameDraft,
  readRuntimeTextDraft,
  writeProducerDisplayNameDraft,
  writeRuntimeTextDraft,
} from "../drafts";
import { RUNTIME_DRAFT_MAX_AGE_MS } from "../runtime-state";

import { MemoryStorage } from "./memory-storage";

describe("runtime draft recovery", () => {
  it("restores and explicitly discards only the allowlisted producer field", () => {
    const storage = new MemoryStorage();
    expect(
      writeProducerDisplayNameDraft(
        storage,
        "producer-user",
        "producer-id",
        "Recovered studio name",
        10,
      ),
    ).toBe(true);
    expect(readProducerDisplayNameDraft(storage, "producer-user", "producer-id", 10)).toEqual({
      displayName: "Recovered studio name",
    });

    clearProducerDisplayNameDraft(storage, "producer-user", "producer-id");
    expect(readProducerDisplayNameDraft(storage, "producer-user", "producer-id", 10)).toBeNull();
  });

  it.each([
    {
      slot: "producer.song-comment-draft" as const,
      userId: "producer-user",
      contextId: "producer-id",
      route: "/dashboard/music/version-a",
    },
    {
      slot: "artist.song-comment-draft" as const,
      userId: "artist-user",
      contextId: "studio-id",
      route: "/artist/music/song/version-a?studio=studio-id",
    },
  ])("recovers and clears the $slot text draft", (identity) => {
    const storage = new MemoryStorage();
    const input = {
      ...identity,
      resourceId: "version-a",
      body: "Keep this note through a reopen",
    };

    expect(writeRuntimeTextDraft(storage, input, 20)).toBe(true);
    expect(readRuntimeTextDraft(storage, input, 20)).toEqual({
      resourceId: "version-a",
      body: "Keep this note through a reopen",
    });

    clearRuntimeTextDraft(storage, identity);
    expect(readRuntimeTextDraft(storage, input, 20)).toBeNull();
  });

  it("cannot recover another account, studio, role, or song's draft", () => {
    const storage = new MemoryStorage();
    const owner = {
      slot: "artist.song-comment-draft" as const,
      userId: "artist-user",
      contextId: "studio-one",
      route: "/artist/music/song/version-a?studio=studio-one",
      resourceId: "version-a",
      body: "Private note",
    };
    writeRuntimeTextDraft(storage, owner, 1);

    expect(readRuntimeTextDraft(storage, { ...owner, userId: "other-user" }, 1)).toBeNull();
    expect(
      readRuntimeTextDraft(
        storage,
        {
          ...owner,
          contextId: "studio-two",
          route: "/artist/music/song/version-a?studio=studio-two",
        },
        1,
      ),
    ).toBeNull();
    expect(
      readRuntimeTextDraft(
        storage,
        {
          ...owner,
          slot: "producer.song-comment-draft",
          contextId: "producer-id",
          route: "/dashboard/music/version-a",
        },
        1,
      ),
    ).toBeNull();
    expect(readRuntimeTextDraft(storage, { ...owner, resourceId: "version-b" }, 1)).toBeNull();
  });

  it("expires a recovered text draft after 30 days", () => {
    const storage = new MemoryStorage();
    const input = {
      slot: "artist.song-comment-draft" as const,
      userId: "artist-user",
      contextId: "studio-id",
      route: "/artist/music/song/version-a",
      resourceId: "version-a",
      body: "Old note",
    };
    writeRuntimeTextDraft(storage, input, 1);

    expect(readRuntimeTextDraft(storage, input, 1 + RUNTIME_DRAFT_MAX_AGE_MS)).not.toBeNull();
    expect(readRuntimeTextDraft(storage, input, 2 + RUNTIME_DRAFT_MAX_AGE_MS)).toBeNull();
  });
});
