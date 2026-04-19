import { describe, it, expect } from "vitest";
import { audioReducer, type AudioState } from "../artist-audio-context";

const empty: AudioState = {
  currentTrack: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  pendingComment: null,
};

describe("audioReducer", () => {
  it("PLAY_TRACK loads a track + sets isPlaying true", () => {
    const next = audioReducer(empty, {
      type: "PLAY_TRACK",
      track: { id: "t1", url: "https://x/y.mp3", title: "Summer", producerName: "Gili", artworkUrl: null },
    });
    expect(next.currentTrack?.id).toBe("t1");
    expect(next.isPlaying).toBe(true);
    expect(next.position).toBe(0);
    expect(next.pendingComment).toBe(null);
  });

  it("TOGGLE_PLAY flips isPlaying without changing track", () => {
    const playing: AudioState = { ...empty, currentTrack: { id: "t1", url: "u", title: "T", producerName: "P", artworkUrl: null }, isPlaying: true };
    expect(audioReducer(playing, { type: "TOGGLE_PLAY" }).isPlaying).toBe(false);
    expect(audioReducer(playing, { type: "TOGGLE_PLAY" }).currentTrack?.id).toBe("t1");
  });

  it("TOGGLE_PLAY is a no-op when no track is loaded", () => {
    const next = audioReducer(empty, { type: "TOGGLE_PLAY" });
    expect(next).toEqual(empty);
  });

  it("SET_POSITION updates position only", () => {
    const next = audioReducer(empty, { type: "SET_POSITION", position: 42 });
    expect(next.position).toBe(42);
  });

  it("SET_DURATION updates duration only", () => {
    const next = audioReducer(empty, { type: "SET_DURATION", duration: 180 });
    expect(next.duration).toBe(180);
  });

  it("REQUEST_COMMENT pauses + records the timestamp", () => {
    const playing: AudioState = { ...empty, currentTrack: { id: "t1", url: "u", title: "T", producerName: "P", artworkUrl: null }, isPlaying: true, position: 73 };
    const next = audioReducer(playing, { type: "REQUEST_COMMENT" });
    expect(next.isPlaying).toBe(false);
    expect(next.pendingComment).toEqual({ time: 73 });
  });

  it("REQUEST_COMMENT is a no-op when no track is loaded", () => {
    const next = audioReducer(empty, { type: "REQUEST_COMMENT" });
    expect(next).toEqual(empty);
  });

  it("DISMISS_COMMENT clears the pending comment without resuming", () => {
    const withComment: AudioState = { ...empty, currentTrack: { id: "t1", url: "u", title: "T", producerName: "P", artworkUrl: null }, isPlaying: false, position: 73, pendingComment: { time: 73 } };
    const next = audioReducer(withComment, { type: "DISMISS_COMMENT" });
    expect(next.pendingComment).toBe(null);
    expect(next.isPlaying).toBe(false);
  });
});
