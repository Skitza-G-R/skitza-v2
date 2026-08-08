// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

const playbackMocks = vi.hoisted(() => ({
  close: vi.fn(),
  snapshot: {
    track: null as null | { songId?: string },
    playing: false,
    currentMs: 0,
    audioDurationSec: null,
    volume: 1,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigationMocks.refresh }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/audio/persistent-player", () => ({
  playerClose: playbackMocks.close,
  usePlaybackSnapshot: () => playbackMocks.snapshot,
}));

import { SongManagementControls } from "../song-management-controls";

const renameSong = vi.fn(() => Promise.resolve({ ok: true as const }));
const editArtist = vi.fn(() => Promise.resolve({ ok: true as const }));
const setArchived = vi.fn(() => Promise.resolve({ ok: true as const }));

beforeEach(() => {
  navigationMocks.refresh.mockReset();
  playbackMocks.close.mockReset();
  playbackMocks.snapshot.track = null;
  renameSong.mockClear();
  editArtist.mockClear();
  setArchived.mockClear();
});

afterEach(cleanup);

describe("song management permanent deletion", () => {
  it("requires a strong confirmation before deleting the complete song", async () => {
    const deleteSong = vi.fn(() => Promise.resolve({ ok: true as const }));
    playbackMocks.snapshot.track = { songId: "track-1" };

    render(
      <SongManagementControls
        projectId="project-1"
        trackId="track-1"
        title="Midnight Drive"
        artist="Maya Vale"
        archived={false}
        renameSong={renameSong}
        editArtist={editArtist}
        setArchived={setArchived}
        deleteSong={deleteSong}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions for Midnight Drive" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete song/i }));

    expect(screen.getByRole("heading", { name: "Delete song permanently" })).toBeTruthy();
    expect(screen.getByText(/all versions and their audio files/i)).toBeTruthy();
    expect(screen.getByText(/comments, approvals, downloads, and public history/i)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(deleteSong).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete song permanently" }));

    await waitFor(() => {
      expect(deleteSong).toHaveBeenCalledWith({
        projectId: "project-1",
        trackId: "track-1",
      });
    });
    expect(navigationMocks.refresh).toHaveBeenCalledTimes(1);
    expect(playbackMocks.close).toHaveBeenCalledTimes(1);
  });

  it("keeps unrelated persistent playback open after Song deletion", async () => {
    const deleteSong = vi.fn(() => Promise.resolve({ ok: true as const }));
    playbackMocks.snapshot.track = { songId: "another-track" };

    render(
      <SongManagementControls
        projectId="project-1"
        trackId="track-1"
        title="Midnight Drive"
        artist="Maya Vale"
        archived={false}
        renameSong={renameSong}
        editArtist={editArtist}
        setArchived={setArchived}
        deleteSong={deleteSong}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions for Midnight Drive" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete song/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete song permanently" }));

    await waitFor(() => {
      expect(deleteSong).toHaveBeenCalledOnce();
    });
    expect(playbackMocks.close).not.toHaveBeenCalled();
  });

  it("keeps the confirmation open and shows a server error", async () => {
    const deleteSong = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: "The song could not be deleted safely.",
      }),
    );

    render(
      <SongManagementControls
        projectId="project-1"
        trackId="track-1"
        title="Midnight Drive"
        artist={null}
        archived={false}
        renameSong={renameSong}
        editArtist={editArtist}
        setArchived={setArchived}
        deleteSong={deleteSong}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions for Midnight Drive" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete song/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete song permanently" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The song could not be deleted safely.",
    );
    expect(navigationMocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Delete song permanently" })).toBeTruthy();
  });
});
