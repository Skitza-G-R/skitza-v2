import { describe, expect, it, vi } from "vitest";

import {
  canSyncProjectProps,
  moveProjectRelativeToVisibleRows,
  persistLatestProjectOrder,
  serializeProjectOrderPersistence,
} from "../project-reorder-persistence";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("persistLatestProjectOrder", () => {
  it("serializes an older success before sending the newest order", async () => {
    const first = deferred<{ ok: true }>();
    const second = deferred<{ ok: true }>();
    const writes: string[][] = [];

    const firstWrite = serializeProjectOrderPersistence(Promise.resolve(), () =>
      persistLatestProjectOrder({
        orderedIds: ["b", "a", "c"],
        previousOrder: ["a", "b", "c"],
        generation: 1,
        getLatestGeneration: () => 2,
        persist: (ids) => {
          writes.push(ids);
          return first.promise;
        },
        rollback: vi.fn(),
        onError: vi.fn(),
      }),
    );
    const secondWrite = serializeProjectOrderPersistence(firstWrite, () =>
      persistLatestProjectOrder({
        orderedIds: ["b", "c", "a"],
        previousOrder: ["b", "a", "c"],
        generation: 2,
        getLatestGeneration: () => 2,
        persist: (ids) => {
          writes.push(ids);
          return second.promise;
        },
        rollback: vi.fn(),
        onError: vi.fn(),
      }),
    );

    await vi.waitFor(() => {
      expect(writes).toEqual([["b", "a", "c"]]);
    });

    first.resolve({ ok: true });
    await firstWrite;
    await vi.waitFor(() => {
      expect(writes).toEqual([
        ["b", "a", "c"],
        ["b", "c", "a"],
      ]);
    });

    second.resolve({ ok: true });
    await secondWrite;
  });

  it("ignores a late failure from an older drag after a newer drag succeeds", async () => {
    const first = deferred<{ ok: false; error: string }>();
    const second = deferred<{ ok: true }>();
    let latestGeneration = 1;
    const rollback = vi.fn();
    const onError = vi.fn();

    const firstRequest = persistLatestProjectOrder({
      orderedIds: ["b", "a", "c"],
      previousOrder: ["a", "b", "c"],
      generation: 1,
      getLatestGeneration: () => latestGeneration,
      persist: () => first.promise,
      rollback,
      onError,
    });

    latestGeneration = 2;
    const secondRequest = persistLatestProjectOrder({
      orderedIds: ["b", "c", "a"],
      previousOrder: ["b", "a", "c"],
      generation: 2,
      getLatestGeneration: () => latestGeneration,
      persist: () => second.promise,
      rollback,
      onError,
    });

    second.resolve({ ok: true });
    await secondRequest;
    first.resolve({ ok: false, error: "Older request failed" });
    await firstRequest;

    expect(rollback).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("rolls back and reports a failure when the failed drag is still current", async () => {
    const previousOrder = ["a", "b", "c"];
    const rollback = vi.fn();
    const onError = vi.fn();

    await persistLatestProjectOrder({
      orderedIds: ["b", "a", "c"],
      previousOrder,
      generation: 1,
      getLatestGeneration: () => 1,
      persist: () => Promise.resolve({ ok: false, error: "Could not save order" }),
      rollback,
      onError,
    });

    expect(rollback).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledWith(previousOrder);
    expect(onError).toHaveBeenCalledWith("Could not save order");
  });

  it("keeps the queued latest failure current across an earlier success refresh", async () => {
    const first = deferred<{ ok: true }>();
    const second = deferred<{ ok: false; error: string }>();
    const rollback = vi.fn();
    const onError = vi.fn();
    let latestGeneration = 2;
    let pendingGeneration: number | null = 2;

    const firstWrite = serializeProjectOrderPersistence(Promise.resolve(), () =>
      persistLatestProjectOrder({
        orderedIds: ["b", "a", "c"],
        previousOrder: ["a", "b", "c"],
        generation: 1,
        getLatestGeneration: () => latestGeneration,
        persist: () => first.promise,
        rollback,
        onError,
      }),
    );
    const secondWrite = serializeProjectOrderPersistence(firstWrite, () =>
      persistLatestProjectOrder({
        orderedIds: ["b", "c", "a"],
        previousOrder: ["b", "a", "c"],
        generation: 2,
        getLatestGeneration: () => latestGeneration,
        persist: () => second.promise,
        rollback,
        onError,
      }),
    );

    first.resolve({ ok: true });
    await firstWrite;

    // The first success can revalidate the page while the second write
    // is queued. That refresh must not advance the user-reorder generation.
    if (canSyncProjectProps(pendingGeneration)) latestGeneration += 1;

    second.resolve({ ok: false, error: "Latest order was not saved" });
    await secondWrite;
    pendingGeneration = null;

    expect(rollback).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(onError).toHaveBeenCalledWith("Latest order was not saved");
    expect(canSyncProjectProps(pendingGeneration)).toBe(true);
  });
});

describe("moveProjectRelativeToVisibleRows", () => {
  const projects = [
    { id: "active-a", label: "Active A" },
    { id: "archived-hidden", label: "Archived" },
    { id: "active-b", label: "Active B" },
  ];

  it("moves down to the next visible row without stopping at a hidden row", () => {
    const next = moveProjectRelativeToVisibleRows(
      projects,
      ["active-a", "active-b"],
      "active-a",
      "down",
    );

    expect(next?.map((project) => project.id)).toEqual([
      "active-b",
      "archived-hidden",
      "active-a",
    ]);
  });

  it("moves up to the previous visible row and preserves hidden-row placement", () => {
    const next = moveProjectRelativeToVisibleRows(
      projects,
      ["active-a", "active-b"],
      "active-b",
      "up",
    );

    expect(next?.map((project) => project.id)).toEqual([
      "active-b",
      "archived-hidden",
      "active-a",
    ]);
  });

  it("returns null at a visible boundary", () => {
    expect(
      moveProjectRelativeToVisibleRows(
        projects,
        ["active-a", "active-b"],
        "active-a",
        "up",
      ),
    ).toBeNull();
  });

  it("uses the displayed order before switching a sorted view back to custom", () => {
    const next = moveProjectRelativeToVisibleRows(
      projects,
      ["active-b", "active-a"],
      "active-b",
      "down",
    );

    expect(next?.map((project) => project.id)).toEqual([
      "active-a",
      "archived-hidden",
      "active-b",
    ]);
  });
});
