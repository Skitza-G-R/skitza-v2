import { describe, expect, it } from "vitest";

import {
  RUNTIME_VIEW_MAX_AGE_MS,
  buildRuntimeStorageKey,
  clearRuntimeStateForUser,
  findOnlyRuntimeStateUserId,
  pruneRuntimeSafeViews,
  readRuntimeLaunchTarget,
  readRuntimeScreenSafeView,
  runtimeScope,
  writeRuntimeLaunchPointer,
  writeRuntimeScreenSafeView,
  type RuntimeScreenSafeView,
} from "../runtime-state";

import { MemoryStorage } from "./memory-storage";

const PRODUCER = {
  userId: "producer-user",
  role: "producer" as const,
  contextId: "producer-studio",
};
const ARTIST = {
  userId: "artist-user",
  role: "artist" as const,
  contextId: "artist-studio",
};

function screen(
  kind: RuntimeScreenSafeView["kind"] = "producer-workspace",
): RuntimeScreenSafeView {
  return {
    kind,
    title: "Clients & projects",
    subtitle: "Your latest studio work",
    metrics: [
      { label: "Clients", value: "12" },
      { label: "Projects", value: "8" },
    ],
    sections: [
      {
        label: "Recently active",
        items: [
          {
            key: "project-a",
            title: "First project",
            detail: "Updated today",
            badge: "Active",
          },
        ],
      },
    ],
  };
}

describe("runtime screen safe views", () => {
  it("persists only the canonical pathname and restores the same view across query states", () => {
    const storage = new MemoryStorage();
    const payload = screen();

    expect(
      writeRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects?tab=clients&search=Ari",
        payload,
        1,
      ),
    ).toBe(true);
    expect(storage.length).toBe(1);
    expect(
      readRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects?tab=projects&filter=active",
        1,
      ),
    ).toEqual(payload);
  });

  it.each([
    ["producer-overview", PRODUCER, "/dashboard"],
    ["producer-workspace", PRODUCER, "/dashboard/clients-projects"],
    ["producer-music", PRODUCER, "/dashboard/music"],
    ["artist-home", ARTIST, "/artist?studio=artist-studio"],
    ["artist-music", ARTIST, "/artist/music?studio=artist-studio"],
    ["artist-store", ARTIST, "/artist/store?studio=artist-studio"],
  ] as const)("accepts %s only on its matching role and pathname", (kind, identity, href) => {
    const storage = new MemoryStorage();
    const payload = screen(kind);

    expect(writeRuntimeScreenSafeView(storage, identity, href, payload, 1)).toBe(true);
    expect(readRuntimeScreenSafeView(storage, identity, href, 1)).toEqual(payload);
    expect(
      writeRuntimeScreenSafeView(
        storage,
        identity,
        identity.role === "producer" ? "/dashboard/settings" : "/artist/settings",
        payload,
        1,
      ),
    ).toBe(false);
  });

  it("isolates safe views by Clerk account, role, studio, and route", () => {
    const storage = new MemoryStorage();
    expect(
      writeRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects",
        screen(),
        1,
      ),
    ).toBe(true);

    for (const identity of [
      { ...PRODUCER, userId: "other-user" },
      { ...PRODUCER, contextId: "other-studio" },
      { userId: PRODUCER.userId, role: "artist" as const, contextId: PRODUCER.contextId },
    ]) {
      expect(
        readRuntimeScreenSafeView(
          storage,
          identity,
          identity.role === "producer"
            ? "/dashboard/clients-projects"
            : "/artist/music?studio=producer-studio",
          1,
        ),
      ).toBeNull();
    }
    expect(
      readRuntimeScreenSafeView(storage, PRODUCER, "/dashboard/music", 1),
    ).toBeNull();
  });

  it("rejects an explicit artist studio query that disagrees with the scoped identity", () => {
    const storage = new MemoryStorage();
    const payload = screen("artist-music");

    expect(
      writeRuntimeScreenSafeView(
        storage,
        ARTIST,
        "/artist/music?studio=other-studio",
        payload,
        1,
      ),
    ).toBe(false);
    expect(
      writeRuntimeScreenSafeView(
        storage,
        ARTIST,
        "/artist/music?studio=artist-studio",
        payload,
        1,
      ),
    ).toBe(true);
    expect(
      readRuntimeScreenSafeView(
        storage,
        ARTIST,
        "/artist/music?studio=other-studio",
        1,
      ),
    ).toBeNull();
    expect(
      readRuntimeScreenSafeView(
        storage,
        ARTIST,
        "/artist/music?studio=artist-studio",
        1,
      ),
    ).toEqual(payload);
    expect(
      writeRuntimeScreenSafeView(
        storage,
        ARTIST,
        "/artist/music",
        payload,
        1,
      ),
    ).toBe(false);
    expect(
      readRuntimeScreenSafeView(storage, ARTIST, "/artist/music", 1),
    ).toBeNull();
  });

  it("rejects extra fields, wrong kinds, oversized arrays, and oversized strings", () => {
    const storage = new MemoryStorage();
    const route = "/dashboard/clients-projects";

    expect(
      writeRuntimeScreenSafeView(storage, PRODUCER, route, {
        ...screen(),
        signedUrl: "https://signed.example/audio",
      } as never),
    ).toBe(false);
    expect(
      writeRuntimeScreenSafeView(storage, PRODUCER, route, {
        ...screen(),
        kind: "producer-music",
      }),
    ).toBe(false);
    expect(
      writeRuntimeScreenSafeView(storage, PRODUCER, route, {
        ...screen(),
        metrics: Array.from({ length: 5 }, (_, index) => ({
          label: `Metric ${String(index)}`,
          value: String(index),
        })),
      }),
    ).toBe(false);
    expect(
      writeRuntimeScreenSafeView(storage, PRODUCER, route, {
        ...screen(),
        sections: [
          {
            label: "Too many",
            items: Array.from({ length: 41 }, (_, index) => ({
              key: String(index),
              title: "Item",
              detail: null,
              badge: null,
            })),
          },
        ],
      }),
    ).toBe(false);
    expect(
      writeRuntimeScreenSafeView(storage, PRODUCER, route, {
        ...screen(),
        title: "x".repeat(201),
      }),
    ).toBe(false);
    expect(storage.length).toBe(0);
  });

  it("caps the complete model at 80 items and expires it after seven days", () => {
    const storage = new MemoryStorage();
    const item = (index: number) => ({
      key: String(index),
      title: "Item",
      detail: null,
      badge: null,
    });
    const eightyItems = {
      ...screen(),
      sections: [
        { label: "One", items: Array.from({ length: 40 }, (_, index) => item(index)) },
        {
          label: "Two",
          items: Array.from({ length: 40 }, (_, index) => item(index + 40)),
        },
      ],
    };
    expect(
      writeRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects",
        eightyItems,
        1,
      ),
    ).toBe(true);
    expect(
      readRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects",
        1 + RUNTIME_VIEW_MAX_AGE_MS,
      ),
    ).toEqual(eightyItems);
    expect(
      readRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects",
        2 + RUNTIME_VIEW_MAX_AGE_MS,
      ),
    ).toBeNull();

    expect(
      writeRuntimeScreenSafeView(storage, PRODUCER, "/dashboard/clients-projects", {
        ...eightyItems,
        sections: [
          ...eightyItems.sections,
          { label: "Three", items: [item(81)] },
        ],
      }),
    ).toBe(false);
  });

  it("removes a forged envelope with a payload kind that does not match the route", () => {
    const storage = new MemoryStorage();
    const scope = runtimeScope(
      PRODUCER.userId,
      PRODUCER.role,
      PRODUCER.contextId,
      "/dashboard/clients-projects",
    );
    if (!scope) throw new Error("Expected a valid scope");
    const key = buildRuntimeStorageKey(scope, "runtime.screen.safe-view");
    storage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        scope,
        slot: "runtime.screen.safe-view",
        updatedAt: 1,
        payload: screen("producer-music"),
      }),
    );

    expect(
      readRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects",
        1,
      ),
    ).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it("participates in bounded safe-view pruning for its exact identity", () => {
    const storage = new MemoryStorage();
    expect(
      writeRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard",
        screen("producer-overview"),
        1,
      ),
    ).toBe(true);
    expect(
      writeRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects",
        screen("producer-workspace"),
        2,
      ),
    ).toBe(true);

    expect(pruneRuntimeSafeViews(storage, PRODUCER, 1)).toBe(1);
    expect(
      readRuntimeScreenSafeView(storage, PRODUCER, "/dashboard", 2),
    ).toBeNull();
    expect(
      readRuntimeScreenSafeView(
        storage,
        PRODUCER,
        "/dashboard/clients-projects",
        2,
      ),
    ).not.toBeNull();
  });
});

describe("runtime launch pointer", () => {
  it("stores one role-root pointer and gives producer launch precedence", () => {
    const storage = new MemoryStorage();
    const dualRoleProducer = { ...PRODUCER, userId: "dual-role-user" };
    const dualRoleArtist = { ...ARTIST, userId: "dual-role-user" };
    expect(
      writeRuntimeLaunchPointer(
        storage,
        dualRoleArtist,
        "/artist/music?studio=artist-studio&mode=songs",
        1,
      ),
    ).toBe(true);
    expect(
      writeRuntimeLaunchPointer(
        storage,
        dualRoleProducer,
        "/dashboard/clients-projects?tab=clients",
        2,
      ),
    ).toBe(true);

    expect(readRuntimeLaunchTarget(storage, dualRoleProducer.userId, 2)).toEqual({
      role: "producer",
      contextId: "producer-studio",
      href: "/dashboard/clients-projects?tab=clients",
    });
    expect(
      writeRuntimeLaunchPointer(
        storage,
        ARTIST,
        "/artist/music?studio=artist-studio&mode=songs",
        1,
      ),
    ).toBe(true);
    expect(readRuntimeLaunchTarget(storage, ARTIST.userId, 2)).toEqual({
      role: "artist",
      contextId: "artist-studio",
      href: "/artist/music?mode=songs&studio=artist-studio",
    });

    expect(
      writeRuntimeLaunchPointer(storage, ARTIST, "/artist/store", 3),
    ).toBe(false);
    expect(readRuntimeLaunchTarget(storage, ARTIST.userId, 3)).toEqual({
      role: "artist",
      contextId: "artist-studio",
      href: "/artist/music?mode=songs&studio=artist-studio",
    });

    expect(
      writeRuntimeLaunchPointer(
        storage,
        dualRoleProducer,
        "/dashboard/calendar?tab=sessions",
        4,
      ),
    ).toBe(false);
    expect(readRuntimeLaunchTarget(storage, dualRoleProducer.userId, 4)).toEqual({
      role: "producer",
      contextId: "producer-studio",
      href: "/dashboard/clients-projects?tab=clients",
    });
  });

  it("rejects cross-role, cross-studio, transactional, and extra-field pointers", () => {
    const storage = new MemoryStorage();
    expect(
      writeRuntimeLaunchPointer(
        storage,
        ARTIST,
        "/artist/music?studio=other-studio",
      ),
    ).toBe(false);
    expect(
      writeRuntimeLaunchPointer(storage, ARTIST, "/dashboard/music"),
    ).toBe(false);
    expect(
      writeRuntimeLaunchPointer(
        storage,
        ARTIST,
        "/artist/payments?studio=artist-studio",
      ),
    ).toBe(false);

    const scope = runtimeScope(
      ARTIST.userId,
      ARTIST.role,
      "runtime-launch",
      "/artist",
    );
    if (!scope) throw new Error("Expected a valid launch scope");
    const key = buildRuntimeStorageKey(scope, "runtime.launch.pointer");
    storage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        scope,
        slot: "runtime.launch.pointer",
        updatedAt: 1,
        payload: {
          contextId: ARTIST.contextId,
          href: "/artist?studio=artist-studio",
          token: "forbidden",
        },
      }),
    );
    expect(readRuntimeLaunchTarget(storage, ARTIST.userId, 1)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it("expires after seven days and is removed by account clear", () => {
    const storage = new MemoryStorage();
    expect(writeRuntimeLaunchPointer(storage, PRODUCER, "/dashboard/music", 1)).toBe(
      true,
    );
    expect(
      readRuntimeLaunchTarget(
        storage,
        PRODUCER.userId,
        1 + RUNTIME_VIEW_MAX_AGE_MS,
      ),
    ).not.toBeNull();
    expect(
      readRuntimeLaunchTarget(
        storage,
        PRODUCER.userId,
        2 + RUNTIME_VIEW_MAX_AGE_MS,
      ),
    ).toBeNull();

    writeRuntimeLaunchPointer(storage, PRODUCER, "/dashboard", 10);
    expect(clearRuntimeStateForUser(storage, PRODUCER.userId)).toBe(1);
    expect(readRuntimeLaunchTarget(storage, PRODUCER.userId, 10)).toBeNull();
  });
});

describe("offline runtime user discovery", () => {
  it("returns exactly one encoded runtime-state owner", () => {
    const storage = new MemoryStorage();
    expect(
      writeRuntimeLaunchPointer(
        storage,
        { ...PRODUCER, userId: "clerk/user one" },
        "/dashboard",
      ),
    ).toBe(true);
    expect(findOnlyRuntimeStateUserId(storage)).toBe("clerk/user one");
  });

  it("returns null for no owner, multiple owners, or malformed owner keys", () => {
    const storage = new MemoryStorage();
    expect(findOnlyRuntimeStateUserId(storage)).toBeNull();

    writeRuntimeLaunchPointer(storage, PRODUCER, "/dashboard");
    writeRuntimeLaunchPointer(
      storage,
      { ...ARTIST, userId: "second-user" },
      "/artist?studio=artist-studio",
    );
    expect(findOnlyRuntimeStateUserId(storage)).toBeNull();

    const malformed = new MemoryStorage();
    malformed.setItem("skitza:runtime:user=%E0%A4%A:schema=1:anything", "{}");
    expect(findOnlyRuntimeStateUserId(malformed)).toBeNull();
  });
});
