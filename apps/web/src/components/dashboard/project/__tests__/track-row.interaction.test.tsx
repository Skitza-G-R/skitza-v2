// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrackRow, type TrackRowData } from "../track-row";

const mocks = vi.hoisted(() => ({
  nowPlaying: { trackId: null as string | null, playing: false },
  playerPlay: vi.fn(),
  playerToggle: vi.fn(),
}));

vi.mock("~/components/audio/persistent-player", () => ({
  useNowPlaying: () => mocks.nowPlaying,
  playerPlay: mocks.playerPlay,
  playerToggle: mocks.playerToggle,
}));

const PLAYABLE_TRACK: TrackRowData = {
  id: "song-1",
  title: "Night Drive",
  artist: "Maya",
  workflowStage: "mixing",
  progress: 64,
  currentVersion: "V3",
  durationMs: 213_000,
  playback: {
    versionId: "version-3",
    audioUrl: "https://audio.example/night-drive.mp3",
    versionLabel: "V3",
    projectName: "First Album",
    durationMs: 213_000,
  },
};

const UNPLAYABLE_TRACK: TrackRowData = {
  id: "song-2",
  title: "Waiting Song",
  artist: "Maya",
  workflowStage: "mixing",
  progress: 64,
  currentVersion: "V3",
  durationMs: 213_000,
};

beforeEach(() => {
  mocks.nowPlaying.trackId = null;
  mocks.nowPlaying.playing = false;
  mocks.playerPlay.mockReset();
  mocks.playerToggle.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TrackRow interactions", () => {
  it("keeps Song Space navigation separate from the Play button", async () => {
    const user = userEvent.setup();
    render(<TrackRow projectId="project-1" track={PLAYABLE_TRACK} index={1} />);

    const rowLink = screen.getByRole("link", { name: "Open Night Drive" });
    expect(rowLink.getAttribute("href")).toBe("/dashboard/clients-projects/project-1/songs/song-1");
    const progress = screen.getByRole("progressbar", {
      name: "Night Drive progress",
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("64");
    expect(progress.getAttribute("aria-valuetext")).toBe("64% complete");

    const playButton = screen.getByRole("button", { name: "Play Night Drive" });
    expect(playButton.closest("a")).toBeNull();
    await user.click(playButton);

    expect(mocks.playerPlay).toHaveBeenCalledWith({
      id: "version-3",
      audioUrl: "https://audio.example/night-drive.mp3",
      title: "Night Drive",
      subtitle: "First Album · V3",
      durationMs: 213_000,
      cachePolicy: "account-unlocked",
    });
    expect(mocks.playerToggle).not.toHaveBeenCalled();
  });

  it("toggles the existing mini-player track instead of opening Song Space", async () => {
    mocks.nowPlaying.trackId = "version-3";
    mocks.nowPlaying.playing = true;
    const user = userEvent.setup();
    render(<TrackRow projectId="project-1" track={PLAYABLE_TRACK} index={1} />);

    await user.click(screen.getByRole("button", { name: "Pause Night Drive" }));

    expect(mocks.playerToggle).toHaveBeenCalledOnce();
    expect(mocks.playerPlay).not.toHaveBeenCalled();
  });

  it("keeps the Play control disabled when no playable version exists", () => {
    render(<TrackRow projectId="project-1" index={2} track={UNPLAYABLE_TRACK} />);

    expect(
      screen
        .getByRole("button", {
          name: "No playable audio for Waiting Song",
        })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
