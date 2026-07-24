import { describe, expect, it } from "vitest";

import {
  clearProducerDisplayNameDraft,
  clearRuntimeTextDraft,
  clearRuntimeTextDraftForEmptyUserEdit,
  createRuntimeDraftFlush,
  flushRuntimeDraftForScope,
  flushRuntimeDraftOnScopeTransition,
  invalidateRuntimeDraftFlushes,
  readProducerDisplayNameDraft,
  readRuntimeTextDraft,
  registerRuntimeDraftFlushLifecycle,
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

  it.each([
    {
      slot: "producer.song-comment-draft" as const,
      userId: "producer-user",
      contextId: "producer-id",
      route: "/dashboard/music/version-a",
      clearedBody: "",
    },
    {
      slot: "artist.song-comment-draft" as const,
      userId: "artist-user",
      contextId: "studio-id",
      route: "/artist/music/song/version-a?studio=studio-id",
      clearedBody: "   ",
    },
  ])("keeps the $slot empty after a recovered draft is explicitly cleared", (identity) => {
    const storage = new MemoryStorage();
    const input = {
      ...identity,
      resourceId: "version-a",
      body: "Recovered note",
    };
    writeRuntimeTextDraft(storage, input, 20);
    expect(readRuntimeTextDraft(storage, input, 20)?.body).toBe("Recovered note");

    expect(
      clearRuntimeTextDraftForEmptyUserEdit(storage, {
        ...identity,
        body: identity.clearedBody,
      }),
    ).toBe(true);

    expect(readRuntimeTextDraft(storage, input, 20)).toBeNull();
  });

  it("does not remove a recovered text draft for a non-empty user edit", () => {
    const storage = new MemoryStorage();
    const input = {
      slot: "producer.song-comment-draft" as const,
      userId: "producer-user",
      contextId: "producer-id",
      route: "/dashboard/music/version-a",
      resourceId: "version-a",
      body: "Recovered note",
    };
    writeRuntimeTextDraft(storage, input, 20);

    expect(
      clearRuntimeTextDraftForEmptyUserEdit(storage, {
        ...input,
        body: "Still editing",
      }),
    ).toBe(false);
    expect(readRuntimeTextDraft(storage, input, 20)?.body).toBe("Recovered note");
  });

  it("flushes only the current draft scope and rejects invalidated account work", () => {
    let writes = 0;
    const current = createRuntimeDraftFlush("user-a:producer-a:route-a", () => {
      writes += 1;
      return true;
    });
    expect(flushRuntimeDraftForScope(current, "user-a:producer-a:route-a")).toBe(true);
    expect(writes).toBe(1);

    const staleScope = createRuntimeDraftFlush("user-a:producer-a:route-a", () => {
      writes += 1;
      return true;
    });
    expect(flushRuntimeDraftForScope(staleScope, "user-a:producer-a:route-b")).toBe(false);

    const staleAccount = createRuntimeDraftFlush("user-a:producer-a:route-a", () => {
      writes += 1;
      return true;
    });
    invalidateRuntimeDraftFlushes();
    expect(flushRuntimeDraftForScope(staleAccount, "user-a:producer-a:route-a")).toBe(false);
    expect(writes).toBe(1);
  });

  it("flushes the previous dirty scope before a reused view adopts the next scope", () => {
    let writes = 0;
    const pending = createRuntimeDraftFlush("user-a:producer-a:route-a", () => {
      writes += 1;
      return true;
    });

    expect(
      flushRuntimeDraftOnScopeTransition(
        pending,
        "user-a:producer-a:route-a",
        "user-a:producer-a:route-b",
      ),
    ).toBe(true);
    expect(writes).toBe(1);

    const invalidated = createRuntimeDraftFlush("user-a:producer-a:route-b", () => {
      writes += 1;
      return true;
    });
    invalidateRuntimeDraftFlushes();
    expect(
      flushRuntimeDraftOnScopeTransition(
        invalidated,
        "user-a:producer-a:route-b",
        "user-b:producer-b:route-c",
      ),
    ).toBe(false);
    expect(writes).toBe(1);
  });

  it("flushes synchronously on pagehide and lifecycle cleanup", () => {
    const listeners = new Set<() => void>();
    const target = {
      addEventListener(_type: "pagehide", listener: () => void) {
        listeners.add(listener);
      },
      removeEventListener(_type: "pagehide", listener: () => void) {
        listeners.delete(listener);
      },
    };
    let flushes = 0;
    const cleanup = registerRuntimeDraftFlushLifecycle(target, () => {
      flushes += 1;
    });

    for (const listener of listeners) listener();
    expect(flushes).toBe(1);

    cleanup();
    expect(flushes).toBe(2);
    expect(listeners.size).toBe(0);
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
