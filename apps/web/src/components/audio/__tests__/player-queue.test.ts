import { afterEach, describe, expect, it, vi } from "vitest";

import {
  nextLoopMode,
  normalizePlayerTrack,
  playbackOrder,
  playbackSetCommandFromDetail,
  queueNeighbors,
  readPlaybackMode,
  reducePlaybackSnapshot,
  resolveTrackEnd,
  sanitizedPeaks,
  shuffledOrder,
  type PlaybackSnapshot,
  type PlayerTrack,
} from "../playback-runtime";

// The founder reported the arrow beside play jumping 15 seconds instead
// of moving to the next song. Fixing the label alone would not have
// helped: the player had no notion of a queue, so "next song" had
// nothing to move to. These cover the queue, repeat and shuffle model
// the transport now drives.

function makeTrack(id: string, overrides: Partial<PlayerTrack> = {}): PlayerTrack {
  return {
    id,
    audioUrl: `/api/audio/stream/${id}`,
    title: `Song ${id}`,
    subtitle: "Artist · V1",
    durationMs: 180_000,
    ...overrides,
  };
}

const a = makeTrack("a");
const b = makeTrack("b");
const c = makeTrack("c");

function snapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    track: null,
    playing: false,
    currentMs: 0,
    audioDurationSec: null,
    volume: 1,
    queue: [],
    loop: "off",
    shuffle: false,
    shuffleOrder: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── playbackOrder ───────────────────────────────────────────────────

describe("playbackOrder", () => {
  it("is the list order while shuffle is off", () => {
    const order = playbackOrder({
      queue: [a, b, c],
      shuffle: false,
      shuffleOrder: ["c", "a", "b"],
    });
    expect(order.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("follows the drawn shuffle order while shuffle is on", () => {
    const order = playbackOrder({ queue: [a, b, c], shuffle: true, shuffleOrder: ["c", "a", "b"] });
    expect(order.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("drops ids that have left the queue and appends ones that joined it late", () => {
    // A stale order must never resurrect a removed song or hide a new
    // one — the queue is the source of truth, the order only sequences.
    const order = playbackOrder({
      queue: [a, c],
      shuffle: true,
      shuffleOrder: ["c", "b", "a"],
    });
    expect(order.map((t) => t.id)).toEqual(["c", "a"]);

    const withLateJoiner = playbackOrder({
      queue: [a, b, c],
      shuffle: true,
      shuffleOrder: ["c", "a"],
    });
    expect(withLateJoiner.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

// ─── shuffledOrder ───────────────────────────────────────────────────

describe("shuffledOrder", () => {
  it("pins the current song first so turning shuffle on never interrupts playback", () => {
    const order = shuffledOrder([a, b, c], "b", () => 0);
    expect(order[0]).toBe("b");
  });

  it("keeps every queued song exactly once", () => {
    const order = shuffledOrder([a, b, c], "a", () => 0.42);
    expect([...order].sort()).toEqual(["a", "b", "c"]);
  });

  it("omits a current id that is not in the queue", () => {
    const order = shuffledOrder([a, b], "zzz", () => 0);
    expect([...order].sort()).toEqual(["a", "b"]);
  });

  it("handles an empty queue", () => {
    expect(shuffledOrder([], null)).toEqual([]);
  });
});

// ─── queueNeighbors ──────────────────────────────────────────────────

describe("queueNeighbors", () => {
  it("resolves both neighbours in the middle of a queue", () => {
    const { previous, next } = queueNeighbors(snapshot({ track: b, queue: [a, b, c] }));
    expect(previous?.id).toBe("a");
    expect(next?.id).toBe("c");
  });

  it("stops at the edges with repeat off", () => {
    expect(queueNeighbors(snapshot({ track: a, queue: [a, b, c] })).previous).toBeNull();
    expect(queueNeighbors(snapshot({ track: c, queue: [a, b, c] })).next).toBeNull();
  });

  it("wraps at both edges with repeat all", () => {
    const first = queueNeighbors(snapshot({ track: a, queue: [a, b, c], loop: "all" }));
    const last = queueNeighbors(snapshot({ track: c, queue: [a, b, c], loop: "all" }));
    expect(first.previous?.id).toBe("c");
    expect(last.next?.id).toBe("a");
  });

  it("has no neighbours for a single-song queue with repeat off", () => {
    expect(queueNeighbors(snapshot({ track: a, queue: [a] }))).toEqual({
      previous: null,
      next: null,
    });
  });

  it("has no neighbours when the loaded song is not in the queue", () => {
    expect(queueNeighbors(snapshot({ track: makeTrack("orphan"), queue: [a, b] }))).toEqual({
      previous: null,
      next: null,
    });
  });

  it("follows the shuffled order rather than the list order", () => {
    const { next } = queueNeighbors(
      snapshot({ track: a, queue: [a, b, c], shuffle: true, shuffleOrder: ["a", "c", "b"] }),
    );
    expect(next?.id).toBe("c");
  });
});

// ─── resolveTrackEnd ─────────────────────────────────────────────────

describe("resolveTrackEnd — what happens when a song finishes", () => {
  it("repeats the same song on repeat-one", () => {
    expect(resolveTrackEnd(snapshot({ track: a, queue: [a, b], loop: "one" }))).toEqual({
      kind: "restart",
    });
  });

  it("advances through the queue", () => {
    expect(resolveTrackEnd(snapshot({ track: a, queue: [a, b] }))).toEqual({
      kind: "play",
      track: b,
    });
  });

  it("stops at the end of the queue with repeat off", () => {
    expect(resolveTrackEnd(snapshot({ track: b, queue: [a, b] }))).toEqual({ kind: "stop" });
  });

  it("wraps to the top of the queue on repeat-all", () => {
    expect(resolveTrackEnd(snapshot({ track: b, queue: [a, b], loop: "all" }))).toEqual({
      kind: "play",
      track: a,
    });
  });

  it("restarts a lone song on repeat-all instead of reloading it", () => {
    // Reloading would refetch the audio and lose the buffered stream.
    expect(resolveTrackEnd(snapshot({ track: a, queue: [a], loop: "all" }))).toEqual({
      kind: "restart",
    });
  });

  it("stops rather than loading a neighbour with no audio", () => {
    const silent = makeTrack("silent", { audioUrl: null });
    expect(resolveTrackEnd(snapshot({ track: a, queue: [a, silent] }))).toEqual({ kind: "stop" });
  });

  it("stops when nothing is loaded", () => {
    expect(resolveTrackEnd(snapshot())).toEqual({ kind: "stop" });
  });
});

// ─── reducer: queue, repeat, shuffle ─────────────────────────────────

describe("reducePlaybackSnapshot — queue", () => {
  it("stores the queue a list surface hands over", () => {
    const next = reducePlaybackSnapshot(snapshot(), { kind: "set", track: b, queue: [a, b, c] });
    expect(next.queue.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(next.track).toBe(b);
  });

  it("prepends a loaded song the caller left out of its own queue", () => {
    const next = reducePlaybackSnapshot(snapshot(), { kind: "set", track: c, queue: [a, b] });
    expect(next.queue.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps the existing queue when the new song is already in it", () => {
    const current = snapshot({ track: a, queue: [a, b, c] });
    const next = reducePlaybackSnapshot(current, { kind: "set", track: c });
    expect(next.queue.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to a one-song queue for a song from nowhere", () => {
    const current = snapshot({ track: a, queue: [a, b] });
    const next = reducePlaybackSnapshot(current, { kind: "set", track: makeTrack("solo") });
    expect(next.queue.map((t) => t.id)).toEqual(["solo"]);
  });

  it("keeps repeat and shuffle preferences when the player is closed", () => {
    const current = snapshot({ track: a, queue: [a, b], loop: "all", shuffle: true });
    const next = reducePlaybackSnapshot(current, { kind: "close" });
    expect(next.track).toBeNull();
    expect(next.queue).toEqual([]);
    expect(next.loop).toBe("all");
    expect(next.shuffle).toBe(true);
  });
});

describe("reducePlaybackSnapshot — repeat and shuffle", () => {
  it("cycles repeat off → all → one → off", () => {
    expect(nextLoopMode("off")).toBe("all");
    expect(nextLoopMode("all")).toBe("one");
    expect(nextLoopMode("one")).toBe("off");
  });

  it("applies a repeat mode and ignores an unknown one", () => {
    const on = reducePlaybackSnapshot(snapshot(), { kind: "loop", mode: "one" });
    expect(on.loop).toBe("one");
    const bogus = reducePlaybackSnapshot(on, {
      kind: "loop",
      mode: "sideways" as unknown as "off",
    });
    expect(bogus.loop).toBe("one");
  });

  it("draws an order pinned to the current song when shuffle turns on", () => {
    const current = snapshot({ track: b, queue: [a, b, c] });
    const next = reducePlaybackSnapshot(current, { kind: "shuffle", enabled: true });
    expect(next.shuffle).toBe(true);
    expect(next.shuffleOrder[0]).toBe("b");
    expect([...next.shuffleOrder].sort()).toEqual(["a", "b", "c"]);
  });

  it("clears the order when shuffle turns off", () => {
    const on = snapshot({ track: b, queue: [a, b], shuffle: true, shuffleOrder: ["b", "a"] });
    const off = reducePlaybackSnapshot(on, { kind: "shuffle", enabled: false });
    expect(off.shuffle).toBe(false);
    expect(off.shuffleOrder).toEqual([]);
  });

  it("redraws the order when a new queue loads while shuffle is on", () => {
    const on = snapshot({ track: a, queue: [a], shuffle: true, shuffleOrder: ["a"] });
    const next = reducePlaybackSnapshot(on, { kind: "set", track: b, queue: [a, b, c] });
    expect(next.shuffleOrder[0]).toBe("b");
    expect([...next.shuffleOrder].sort()).toEqual(["a", "b", "c"]);
  });
});

// ─── event boundary ──────────────────────────────────────────────────

describe("playbackSetCommandFromDetail — queue on the wire", () => {
  it("accepts a structured set carrying a queue", () => {
    const command = playbackSetCommandFromDetail({
      track: a,
      currentMs: 0,
      playing: true,
      queue: [a, b],
    });
    expect(command?.queue?.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("drops malformed queue entries and duplicates instead of rejecting the load", () => {
    const command = playbackSetCommandFromDetail({
      track: a,
      currentMs: 0,
      playing: true,
      queue: [a, { id: "" }, null, a, b],
    });
    expect(command?.queue?.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("leaves the queue unset for a legacy single-track event", () => {
    const command = playbackSetCommandFromDetail(a);
    expect(command?.track.id).toBe("a");
    expect(command?.queue).toBeUndefined();
  });
});

// ─── peaks boundary ──────────────────────────────────────────────────
// Peaks travel over the same window event bus (and into localStorage) as
// the rest of the track, so they get the same bounded validation.

describe("sanitizedPeaks", () => {
  it("keeps a normalized envelope", () => {
    expect(sanitizedPeaks([0, 0.5, 1])).toEqual([0, 0.5, 1]);
  });

  it("rejects values outside 0..1, non-numbers and non-finite entries", () => {
    expect(sanitizedPeaks([0.5, 1.4])).toBeUndefined();
    expect(sanitizedPeaks([0.5, -0.1])).toBeUndefined();
    expect(sanitizedPeaks([0.5, Number.NaN])).toBeUndefined();
    expect(sanitizedPeaks([0.5, "0.4"])).toBeUndefined();
  });

  it("rejects an empty array, a non-array and an oversized envelope", () => {
    expect(sanitizedPeaks([])).toBeUndefined();
    expect(sanitizedPeaks("nope")).toBeUndefined();
    expect(sanitizedPeaks(Array.from({ length: 401 }, () => 0.5))).toBeUndefined();
  });

  it("survives the track normalizer, and a bad envelope drops without dropping the track", () => {
    expect(normalizePlayerTrack({ ...a, peaks: [0.2, 0.9] })?.peaks).toEqual([0.2, 0.9]);
    const bad = normalizePlayerTrack({ ...a, peaks: [2] });
    expect(bad?.id).toBe("a");
    expect(bad?.peaks).toBeUndefined();
  });
});

// ─── persisted repeat / shuffle preference ───────────────────────────

describe("readPlaybackMode", () => {
  function stubStorage(raw: string | null) {
    vi.stubGlobal("localStorage", {
      getItem: () => raw,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  }

  it("restores a stored repeat + shuffle preference", () => {
    stubStorage(JSON.stringify({ loop: "all", shuffle: true }));
    expect(readPlaybackMode()).toEqual({ loop: "all", shuffle: true });
  });

  it("falls back to off for missing, malformed or unknown values", () => {
    stubStorage(null);
    expect(readPlaybackMode()).toEqual({ loop: "off", shuffle: false });
    stubStorage("{not json");
    expect(readPlaybackMode()).toEqual({ loop: "off", shuffle: false });
    stubStorage(JSON.stringify({ loop: "sideways", shuffle: "yes" }));
    expect(readPlaybackMode()).toEqual({ loop: "off", shuffle: false });
  });
});

describe("shuffle stability across skips", () => {
  it("keeps the drawn order while moving through the same queue", () => {
    // Redrawing on every skip would let shuffled playback revisit songs
    // and never finish the queue, so the order has to survive a load of
    // a song that is already in it.
    const current = snapshot({
      track: a,
      queue: [a, b, c],
      shuffle: true,
      shuffleOrder: ["a", "c", "b"],
    });
    const next = reducePlaybackSnapshot(current, { kind: "set", track: c });
    expect(next.shuffleOrder).toEqual(["a", "c", "b"]);
    expect(queueNeighbors(next).next?.id).toBe("b");
  });

  it("redraws once the queue itself changes", () => {
    const current = snapshot({
      track: a,
      queue: [a, b],
      shuffle: true,
      shuffleOrder: ["a", "b"],
    });
    const next = reducePlaybackSnapshot(current, { kind: "set", track: c, queue: [a, b, c] });
    expect(next.shuffleOrder[0]).toBe("c");
    expect([...next.shuffleOrder].sort()).toEqual(["a", "b", "c"]);
  });
});
