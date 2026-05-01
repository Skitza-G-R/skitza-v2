import { describe, expect, it } from "vitest";

import {
  initialPlayerState,
  playerReducer,
  type PlayerState,
  type Track,
} from "../player-reducer";

const trackA: Track = {
  id: "trk-a",
  title: "Track A",
  project: "Album X",
  duration: "03:30",
  durationSec: 210,
  grad: "grad-amber",
};

const trackB: Track = {
  id: "trk-b",
  title: "Track B",
  project: "Album Y",
  duration: "04:00",
  durationSec: 240,
  grad: "grad-rose",
};

describe("playerReducer", () => {
  it("starts with no current track", () => {
    expect(initialPlayerState).toEqual({ current: null });
  });

  it("play sets current track, playing=true, progress=0", () => {
    const next = playerReducer(initialPlayerState, {
      type: "play",
      track: trackA,
    });
    expect(next.current).not.toBeNull();
    if (next.current) {
      expect(next.current.id).toBe("trk-a");
      expect(next.playing).toBe(true);
      expect(next.progress).toBe(0);
    }
  });

  it("play with same track resumes from existing progress (does NOT reset)", () => {
    const playing: PlayerState = {
      current: trackA,
      playing: false,
      progress: 0.42,
    };
    const next = playerReducer(playing, { type: "play", track: trackA });
    if (next.current) {
      expect(next.current.id).toBe("trk-a");
      expect(next.playing).toBe(true);
      expect(next.progress).toBe(0.42);
    } else {
      throw new Error("expected current track");
    }
  });

  it("play with a different track resets progress to 0", () => {
    const state: PlayerState = {
      current: trackA,
      playing: true,
      progress: 0.7,
    };
    const next = playerReducer(state, { type: "play", track: trackB });
    if (next.current) {
      expect(next.current.id).toBe("trk-b");
      expect(next.playing).toBe(true);
      expect(next.progress).toBe(0);
    } else {
      throw new Error("expected current track");
    }
  });

  it("toggle flips playing when a track is loaded", () => {
    const state: PlayerState = {
      current: trackA,
      playing: true,
      progress: 0.3,
    };
    const next = playerReducer(state, { type: "toggle" });
    if (next.current) {
      expect(next.playing).toBe(false);
      expect(next.progress).toBe(0.3);
    } else {
      throw new Error("expected current track");
    }
  });

  it("toggle is a no-op when no track is loaded", () => {
    const next = playerReducer(initialPlayerState, { type: "toggle" });
    expect(next).toEqual(initialPlayerState);
  });

  it("scrub clamps progress to [0, 1]", () => {
    const state: PlayerState = {
      current: trackA,
      playing: true,
      progress: 0,
    };
    const tooHigh = playerReducer(state, { type: "scrub", progress: 1.5 });
    const tooLow = playerReducer(state, { type: "scrub", progress: -0.2 });
    const inRange = playerReducer(state, { type: "scrub", progress: 0.6 });
    if (
      tooHigh.current === null ||
      tooLow.current === null ||
      inRange.current === null
    ) {
      throw new Error("expected current tracks");
    }
    expect(tooHigh.progress).toBe(1);
    expect(tooLow.progress).toBe(0);
    expect(inRange.progress).toBe(0.6);
  });

  it("scrub is a no-op when no track is loaded", () => {
    const next = playerReducer(initialPlayerState, {
      type: "scrub",
      progress: 0.5,
    });
    expect(next).toEqual(initialPlayerState);
  });

  it("close resets to initial state", () => {
    const state: PlayerState = {
      current: trackA,
      playing: true,
      progress: 0.5,
    };
    const next = playerReducer(state, { type: "close" });
    expect(next).toEqual(initialPlayerState);
  });

  it("tick advances progress by delta when playing", () => {
    const state: PlayerState = {
      current: trackA,
      playing: true,
      progress: 0.2,
    };
    const next = playerReducer(state, { type: "tick", delta: 0.05 });
    if (next.current) {
      expect(next.progress).toBeCloseTo(0.25);
      expect(next.playing).toBe(true);
    } else {
      throw new Error("expected current track");
    }
  });

  it("tick is a no-op when paused", () => {
    const state: PlayerState = {
      current: trackA,
      playing: false,
      progress: 0.2,
    };
    const next = playerReducer(state, { type: "tick", delta: 0.05 });
    expect(next).toEqual(state);
  });

  it("tick is a no-op when no track is loaded", () => {
    const next = playerReducer(initialPlayerState, {
      type: "tick",
      delta: 0.05,
    });
    expect(next).toEqual(initialPlayerState);
  });

  it("tick clamps progress at 1 and pauses (track ends)", () => {
    const state: PlayerState = {
      current: trackA,
      playing: true,
      progress: 0.97,
    };
    const next = playerReducer(state, { type: "tick", delta: 0.1 });
    if (next.current) {
      expect(next.progress).toBe(1);
      expect(next.playing).toBe(false);
    } else {
      throw new Error("expected current track");
    }
  });
});
