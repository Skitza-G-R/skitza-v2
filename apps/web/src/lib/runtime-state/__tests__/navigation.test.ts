import { describe, expect, it } from "vitest";

import { clearAccountPrivateRuntimeState } from "../account-exit";
import {
  popRuntimeBack,
  readRuntimeNavigationIndex,
  readRuntimeNavigationSnapshot,
  readRuntimeResumeHref,
  recordRuntimeNavigation,
  runtimeFiltersForHref,
  type RuntimeIdentity,
} from "../navigation";
import { RUNTIME_ROUTE_LIMIT } from "../runtime-state";
import { RUNTIME_VIEW_MAX_AGE_MS } from "../runtime-state";

import { MemoryStorage } from "./memory-storage";

const PRODUCER: RuntimeIdentity = {
  userId: "producer-user",
  role: "producer",
  contextId: "producer-id",
};

describe("runtime navigation restoration", () => {
  it("restores the exact safe route, filters, and scroll position", () => {
    const storage = new MemoryStorage();
    const href = "/dashboard/clients-projects?filter=active&search=Yael&token=secret";

    expect(recordRuntimeNavigation(storage, PRODUCER, href, 728, 100)).toBe(true);
    const canonicalHref = "/dashboard/clients-projects?filter=active&search=Yael";
    expect(readRuntimeResumeHref(storage, PRODUCER, 100)).toBe(canonicalHref);
    expect(readRuntimeNavigationSnapshot(storage, PRODUCER, canonicalHref, 100)).toEqual({
      href: canonicalHref,
      scrollTop: 728,
      filters: [
        { key: "filter", value: "active" },
        { key: "search", value: "Yael" },
      ],
    });
  });

  it("restores only Store filter and search state with its scroll position", () => {
    const storage = new MemoryStorage();
    const href =
      "/dashboard/store?search=Mix&filter=hidden&token=secret&product=private";

    expect(recordRuntimeNavigation(storage, PRODUCER, href, 615, 100)).toBe(
      true,
    );
    const canonicalHref = "/dashboard/store?filter=hidden&search=Mix";
    expect(readRuntimeResumeHref(storage, PRODUCER, 100)).toBe(canonicalHref);
    expect(
      readRuntimeNavigationSnapshot(storage, PRODUCER, canonicalHref, 100),
    ).toEqual({
      href: canonicalHref,
      scrollTop: 615,
      filters: [
        { key: "filter", value: "hidden" },
        { key: "search", value: "Mix" },
      ],
    });
  });

  it("isolates and clears Store restoration by Clerk account", () => {
    const storage = new MemoryStorage();
    const otherProducer = { ...PRODUCER, userId: "other-producer" };
    recordRuntimeNavigation(
      storage,
      PRODUCER,
      "/dashboard/store?filter=hidden&search=Mix",
      10,
      1,
    );
    recordRuntimeNavigation(
      storage,
      otherProducer,
      "/dashboard/store?filter=live&search=Master",
      20,
      1,
    );

    expect(clearAccountPrivateRuntimeState(PRODUCER.userId, storage)).toBe(2);
    expect(readRuntimeResumeHref(storage, PRODUCER, 1)).toBeNull();
    expect(readRuntimeResumeHref(storage, otherProducer, 1)).toBe(
      "/dashboard/store?filter=live&search=Master",
    );
  });

  it("keeps an exact bounded back stack", () => {
    const storage = new MemoryStorage();
    recordRuntimeNavigation(storage, PRODUCER, "/dashboard", 10, 1);
    recordRuntimeNavigation(storage, PRODUCER, "/dashboard/clients-projects?filter=active", 20, 2);
    recordRuntimeNavigation(storage, PRODUCER, "/dashboard/music", 30, 3);

    expect(popRuntimeBack(storage, PRODUCER, 4)).toBe("/dashboard/clients-projects?filter=active");
    expect(popRuntimeBack(storage, PRODUCER, 5)).toBe("/dashboard");
    expect(popRuntimeBack(storage, PRODUCER, 6)).toBeNull();
  });

  it("keeps only the 20 most recently viewed route snapshots", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < RUNTIME_ROUTE_LIMIT + 2; index += 1) {
      recordRuntimeNavigation(
        storage,
        PRODUCER,
        `/dashboard/clients-projects/project-${String(index)}`,
        index,
        index + 1,
      );
    }

    const index = readRuntimeNavigationIndex(storage, PRODUCER, RUNTIME_ROUTE_LIMIT + 2);
    expect(index?.recentRoutes).toHaveLength(RUNTIME_ROUTE_LIMIT);
    expect(index?.recentRoutes[0]).toBe(
      `/dashboard/clients-projects/project-${String(RUNTIME_ROUTE_LIMIT + 1)}`,
    );
    expect(
      readRuntimeNavigationSnapshot(
        storage,
        PRODUCER,
        "/dashboard/clients-projects/project-0",
        RUNTIME_ROUTE_LIMIT + 2,
      ),
    ).toBeNull();
  });

  it("prunes expired route keys before starting a new LRU window", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < RUNTIME_ROUTE_LIMIT; index += 1) {
      recordRuntimeNavigation(
        storage,
        PRODUCER,
        `/dashboard/clients-projects/old-${String(index)}`,
        index,
        1,
      );
    }
    expect(storage.length).toBe(RUNTIME_ROUTE_LIMIT + 1);

    recordRuntimeNavigation(
      storage,
      PRODUCER,
      "/dashboard/clients-projects/current",
      1,
      RUNTIME_VIEW_MAX_AGE_MS + 2,
    );
    expect(storage.length).toBe(2);
  });

  it("isolates resume and scroll state by account and studio", () => {
    const storage = new MemoryStorage();
    const artistOne: RuntimeIdentity = {
      userId: "artist-user",
      role: "artist",
      contextId: "studio-one",
    };
    const artistTwo = { ...artistOne, contextId: "studio-two" };
    const otherAccount = { ...artistOne, userId: "other-artist" };
    recordRuntimeNavigation(
      storage,
      artistOne,
      "/artist/music/song/version-a?studio=studio-one",
      345,
      1,
    );

    expect(readRuntimeResumeHref(storage, artistOne, 1)).toBe(
      "/artist/music/song/version-a?studio=studio-one",
    );
    expect(readRuntimeResumeHref(storage, artistTwo, 1)).toBeNull();
    expect(readRuntimeResumeHref(storage, otherAccount, 1)).toBeNull();
  });

  it("retains duplicate safe studio context and drops unrelated home filters", () => {
    expect(
      runtimeFiltersForHref("/artist?view=list&studio=two&studio=one&signedUrl=secret", "artist"),
    ).toEqual([
      { key: "studio", value: "two" },
      { key: "studio", value: "one" },
    ]);
  });
});
