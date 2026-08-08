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
  detailHref: "/dashboard/music/version-3?from=project-1",
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
  detailHref: "/dashboard/music/version-history?from=project-1",
};

const NO_VERSION_TRACK: TrackRowData = {
  id: "song-3",
  title: "First Upload",
  artist: "Maya",
  workflowStage: "brief",
  progress: 5,
  detailHref: "/dashboard/clients-projects/project-1?song=song-3&upload=1",
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
  it("opens the existing player Song Page and keeps Play separate", async () => {
    const user = userEvent.setup();
    render(<TrackRow track={PLAYABLE_TRACK} index={1} />);

    const rowLink = screen.getByRole("link", { name: "Open Night Drive" });
    expect(rowLink.getAttribute("href")).toBe("/dashboard/music/version-3?from=project-1");
    expect(rowLink.hasAttribute("aria-current")).toBe(false);
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
      songId: "song-1",
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
    render(<TrackRow track={PLAYABLE_TRACK} index={1} />);

    await user.click(screen.getByRole("button", { name: "Pause Night Drive" }));

    expect(mocks.playerToggle).toHaveBeenCalledOnce();
    expect(mocks.playerPlay).not.toHaveBeenCalled();
  });

  it("opens retained version history while keeping Play disabled when audio is unavailable", () => {
    render(<TrackRow index={2} track={UNPLAYABLE_TRACK} />);

    expect(screen.getByRole("link", { name: "Open Waiting Song" }).getAttribute("href")).toBe(
      "/dashboard/music/version-history?from=project-1",
    );
    expect(
      screen
        .getByRole("button", {
          name: "No playable audio for Waiting Song",
        })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("uses the one-shot upload handoff when a song has no version page yet", () => {
    render(<TrackRow index={3} track={NO_VERSION_TRACK} />);

    expect(screen.getByRole("link", { name: "Open First Upload" }).getAttribute("href")).toBe(
      "/dashboard/clients-projects/project-1?song=song-3&upload=1",
    );
    expect(
      screen
        .getByRole("button", { name: "No playable audio for First Upload" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
