// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playerMocks = vi.hoisted(() => ({
  nowPlaying: { trackId: null as string | null, playing: false },
  playerPlay: vi.fn(),
  playerToggle: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/music",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("~/components/audio/persistent-player", () => ({
  playerPlay: playerMocks.playerPlay,
  playerToggle: playerMocks.playerToggle,
  useNowPlaying: () => playerMocks.nowPlaying,
}));

import { SongsGrid, type MusicLibraryTrackRow } from "../library-screen";

const playableSong: MusicLibraryTrackRow = {
  id: "row-1",
  kind: "track",
  trackId: "song-1",
  latestVersionId: "version-1",
  producerId: "producer-1",
  projectId: "project-1",
  projectTitle: "Full production",
  projectLifecycleStatus: "active",
  clientName: "Lital",
  trackTitle: "Lama",
  trackArtist: "Lital Ohayon",
  archivedAtIso: null,
  releasedAtIso: null,
  audioDeletedAtIso: null,
  label: "V1",
  uploadedAtIso: "2026-07-28T08:00:00.000Z",
  audioUrl: "https://audio.example/version-1.mp3",
  durationMs: 213_000,
  unreadComments: 0,
  plays: 0,
};

function renderGrid(): void {
  render(<SongsGrid songs={[playableSong]} role="producer" addSongHref="/dashboard/music" />);
}

beforeEach(() => {
  playerMocks.nowPlaying = { trackId: null, playing: false };
  playerMocks.playerPlay.mockReset();
  playerMocks.playerToggle.mockReset();
});

afterEach(cleanup);

describe("Music library grid player controls", () => {
  it("starts the persistent player from the circular Play button without wrapping it in navigation", () => {
    renderGrid();

    const play = screen.getByRole("button", { name: "Play" });
    expect(play.closest("a")).toBeNull();

    fireEvent.click(play);

    expect(playerMocks.playerPlay).toHaveBeenCalledTimes(1);
    expect(playerMocks.playerPlay).toHaveBeenCalledWith({
      id: "version-1",
      audioUrl: "https://audio.example/version-1.mp3",
      title: "Lama",
      subtitle: "Lital Ohayon · V1",
      durationMs: 213_000,
      cachePolicy: "account-unlocked",
    });
    expect(playerMocks.playerToggle).not.toHaveBeenCalled();
  });

  it("keeps song-page navigation on the artwork surface only", () => {
    renderGrid();

    const artworkLink = screen.getByRole("link", { name: "Open Lama song page" });
    expect(artworkLink.getAttribute("href")).toBe("/dashboard/music/version-1");
    expect(artworkLink.getAttribute("data-song-artwork-link")).toBe("true");
    expect(screen.getByText("Lama").closest("a")).toBeNull();
  });

  it("toggles the loaded track instead of restarting it", () => {
    playerMocks.nowPlaying = { trackId: "version-1", playing: true };
    renderGrid();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(playerMocks.playerToggle).toHaveBeenCalledTimes(1);
    expect(playerMocks.playerPlay).not.toHaveBeenCalled();
  });
});
