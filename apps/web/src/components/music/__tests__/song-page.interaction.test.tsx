// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SongPage, type L3Actions, type SongPageData } from "../song-page";

const mocks = vi.hoisted(() => ({
  playerClose: vi.fn(),
  playerLoad: vi.fn(),
  playerPlay: vi.fn(),
  playerSeek: vi.fn(),
  playerSetVolume: vi.fn(),
  playerToggle: vi.fn(),
  preserveDraft: vi.fn(),
  playbackSnapshot: {
    track: null as null | {
      id: string;
      audioUrl: string | null;
      title: string;
      subtitle: string;
      durationMs: number | null;
    },
    playing: false,
    currentMs: 0,
    audioDurationSec: null as number | null,
    volume: 1,
  },
}));

vi.mock("~/components/audio/waveform-50", () => ({
  Waveform50: () => null,
}));

vi.mock("~/components/audio/persistent-player", () => ({
  PLAYER_EVENTS: { time: "skitza:test-player-time" },
  clampSeekMs: (currentMs: number, deltaMs: number, durationMs: number | null) =>
    Math.min(durationMs ?? Number.POSITIVE_INFINITY, Math.max(0, currentMs + deltaMs)),
  playerClose: mocks.playerClose,
  playerLoad: mocks.playerLoad,
  playerPlay: mocks.playerPlay,
  playerSeek: mocks.playerSeek,
  playerSetVolume: mocks.playerSetVolume,
  playerToggle: mocks.playerToggle,
  useNowPlaying: () => ({
    trackId: mocks.playbackSnapshot.track?.id ?? null,
    playing: mocks.playbackSnapshot.playing,
  }),
  usePlaybackSnapshot: () => mocks.playbackSnapshot,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/runtime-state/use-runtime-state", () => ({
  useRuntimeTextDraft: () => ({
    body: "",
    setBody: vi.fn(),
    setBodyFromUser: vi.fn(),
    preserveDraft: mocks.preserveDraft,
    clearDraft: vi.fn(),
  }),
}));

vi.mock("~/components/dashboard/song/upload-track-modal", () => ({
  UploadTrackModal: (props: {
    open: boolean;
    projectId: string;
    trackId?: string;
    defaultLabel?: string;
  }) =>
    props.open ? (
      <div
        role="dialog"
        aria-label="Upload new version"
        data-project-id={props.projectId}
        data-track-id={props.trackId}
      >
        {props.defaultLabel}
      </div>
    ) : null,
}));

function installMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (media: string) =>
        ({
          matches,
          media,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) as MediaQueryList,
    ),
  );
}

function songData(archived: boolean): SongPageData {
  return {
    track: {
      id: "track-1",
      title: "After the Rain",
      artist: "Noya",
      projectId: "project-1",
      projectTitle: "After the Rain — Single",
      clientName: "Noya",
      artworkUrl: null,
      archivedAtIso: archived ? "2026-07-20T09:00:00.000Z" : null,
      releasedAtIso: null,
      workflowStage: "mixing",
      artistApprovalLocked: false,
      projectLifecycleStatus: "active",
    },
    versions: [
      {
        id: "version-1",
        label: "Mix v1",
        audioUrl: "/audio/after-the-rain.mp3",
        audioDeletedAtIso: null,
        durationMs: 201_000,
        uploadedAtIso: "2026-07-18T09:30:00.000Z",
        producerMarkedFinalAtIso: null,
        artistApprovedAtIso: null,
        previouslyArtistApprovedAtIso: null,
        peaks: [0.2, 0.4],
        delivery: {
          purchaseId: "purchase-1",
          permission: "purchase_fully_paid",
          fullyPaid: true,
          remainingCents: 0,
          currency: "ILS",
          overdue: false,
          totalCents: 120_000,
        },
      },
    ],
    comments: [],
    selectedVersionId: "version-1",
  };
}

function songActions(): L3Actions {
  const success = vi.fn(() => Promise.resolve({ ok: true as const }));
  return {
    addComment: success,
    resolveComment: success,
    renameSong: success,
    editArtist: success,
    setArchived: success,
    renameVersion: success,
  };
}

beforeEach(() => {
  mocks.playerClose.mockReset();
  mocks.playerLoad.mockReset();
  mocks.playerPlay.mockReset();
  mocks.playerSeek.mockReset();
  mocks.playerSetVolume.mockReset();
  mocks.playerToggle.mockReset();
  mocks.preserveDraft.mockReset();
  mocks.playbackSnapshot.track = null;
  mocks.playbackSnapshot.playing = false;
  mocks.playbackSnapshot.currentMs = 0;
  mocks.playbackSnapshot.audioDurationSec = null;
  mocks.playbackSnapshot.volume = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => {
      callback(0);
    }, 0),
  );
});

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  vi.unstubAllGlobals();
});

describe("SongPage professional player interactions", () => {
  it("keeps a project-origin return link and opens the next-version uploader", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();

    render(
      <SongPage
        data={songData(false)}
        actions={songActions()}
        producerProjectHref="/dashboard/clients-projects/project-1"
        versionUpload={{
          projectId: "project-1",
          trackId: "track-1",
          defaultLabel: "V2",
          versionCount: 1,
          publicExposure: "none",
        }}
      />,
    );

    expect(
      screen.getByRole("link", {
        name: "Open After the Rain — Single project",
      }).getAttribute("href"),
    ).toBe("/dashboard/clients-projects/project-1");

    await user.click(screen.getByRole("button", { name: "Upload V2 for After the Rain" }));

    const dialog = await screen.findByRole("dialog", { name: "Upload new version" });
    expect(dialog.getAttribute("data-project-id")).toBe("project-1");
    expect(dialog.getAttribute("data-track-id")).toBe("track-1");
    expect(dialog.textContent).toContain("V2");
  });

  it("uses fixed 15 second transport controls", async () => {
    installMatchMedia(false);
    const user = userEvent.setup();
    mocks.playbackSnapshot.track = {
      id: "version-1",
      audioUrl: "/audio/after-the-rain.mp3",
      title: "After the Rain",
      subtitle: "Noya · Mix v1",
      durationMs: 201_000,
    };
    mocks.playbackSnapshot.currentMs = 60_000;

    render(<SongPage data={songData(false)} actions={songActions()} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("skitza:test-player-time", {
          detail: 60_000,
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: "Back 15 seconds" }));
    expect(mocks.playerSeek).toHaveBeenLastCalledWith(45_000);

    await user.click(screen.getByRole("button", { name: "Forward 15 seconds" }));
    expect(mocks.playerSeek).toHaveBeenLastCalledWith(75_000);
  });

  it("preserves the current time and paused state when switching this song's version", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();
    const data = songData(false);
    const firstVersion = data.versions[0];
    if (!firstVersion) throw new Error("Expected the song fixture to include a version.");
    data.versions.push({
      ...firstVersion,
      id: "version-2",
      label: "Mix v2",
      audioUrl: "/audio/after-the-rain-v2.mp3",
      uploadedAtIso: "2026-07-19T09:30:00.000Z",
    });
    mocks.playbackSnapshot.track = {
      id: "version-1",
      audioUrl: "/audio/after-the-rain.mp3",
      title: "After the Rain",
      subtitle: "Noya · Mix v1",
      durationMs: 201_000,
    };
    mocks.playbackSnapshot.currentMs = 80_000;
    mocks.playbackSnapshot.playing = false;

    render(<SongPage data={data} actions={songActions()} />);
    await user.click(screen.getByRole("button", { name: /Choose version/i }));
    await user.click(screen.getByRole("button", { name: /Mix v2/i }));

    expect(mocks.playerLoad).toHaveBeenCalledWith(expect.objectContaining({ id: "version-2" }), {
      currentMs: 80_000,
      playing: false,
    });
  });

  it("opens Notes as a mobile sheet and preserves its draft when closed", async () => {
    installMatchMedia(false);
    const user = userEvent.setup();

    render(<SongPage data={songData(false)} actions={songActions()} />);
    await user.click(screen.getByRole("button", { name: /Open Notes/i }));

    expect(await screen.findByRole("dialog", { name: "Song notes" })).not.toBeNull();
    await user.keyboard("{Escape}");

    expect(mocks.preserveDraft).toHaveBeenCalled();
  });

  it("lets a producer change the private song cover from More", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();
    const prepareArtwork = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          uploadUrl: "https://uploads.example.test/song-cover",
          uploadToken: "signed-upload-token",
        },
      }),
    );
    const completeArtwork = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { artworkUrl: "/api/song-artwork/track-1" },
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(null, {
            status: 200,
            headers: { etag: '"artwork-etag"' },
          }),
        ),
      ),
    );

    render(
      <SongPage
        data={songData(false)}
        actions={{ ...songActions(), prepareArtwork, completeArtwork }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(
      within(await screen.findByRole("group", { name: "Song actions" })).getByRole("button", {
        name: "Change cover",
      }),
    );

    const input = screen.getByLabelText("Choose song cover");
    await user.upload(
      input,
      new File([new Uint8Array([137, 80, 78, 71])], "cover.png", {
        type: "image/png",
      }),
    );

    await waitFor(() => {
      expect(completeArtwork).toHaveBeenCalledWith({
        trackId: "track-1",
        versionId: "version-1",
        uploadToken: "signed-upload-token",
        objectEtag: '"artwork-etag"',
      });
    });
    expect(await screen.findByAltText("After the Rain cover")).not.toBeNull();
  });

  it("approves an artist-ready version in one click without a confirmation dialog", async () => {
    installMatchMedia(false);
    const user = userEvent.setup();
    const data = songData(false);
    const version = data.versions[0];
    if (!version) throw new Error("Expected the song fixture to include a version.");
    version.producerMarkedFinalAtIso = "2026-07-20T10:00:00.000Z";
    const approveVersion = vi.fn(() => Promise.resolve({ ok: true as const }));

    render(<SongPage data={data} role="artist" actions={{ ...songActions(), approveVersion }} />);
    await user.click(screen.getByRole("button", { name: "Approve this version" }));

    await waitFor(() => {
      expect(approveVersion).toHaveBeenCalledWith({ versionId: "version-1" });
    });
    expect(screen.queryByRole("dialog", { name: /Approve/i })).toBeNull();
    expect(screen.getByText("Approved")).not.toBeNull();
  });
});

describe("SongPage More actions interactions", () => {
  it("hands mobile Sheet focus to Rename song, then returns it to More actions", async () => {
    installMatchMedia(false);
    const user = userEvent.setup();

    render(<SongPage data={songData(false)} actions={songActions()} />);

    const trigger = screen.getByRole("button", { name: "More actions" });
    await user.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: "Song actions" });
    expect(within(sheet).getByRole("group", { name: "Song actions" })).not.toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();

    const triggerFocus = vi.spyOn(trigger, "focus");
    await user.click(within(sheet).getByRole("button", { name: "Rename song" }));

    const dialog = await screen.findByRole("dialog", { name: "Rename song" });
    const input = within(dialog).getByRole("textbox", { name: /Song name/ });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    expect(screen.queryByTestId("song-more-actions-sheet")).toBeNull();
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
    });
    expect(triggerFocus).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it.each([
    {
      archived: false,
      actionLabel: "Archive song",
      dialogName: "Archive song?",
    },
    {
      archived: true,
      actionLabel: "Restore song",
      dialogName: "Restore song?",
    },
  ])(
    "opens the mobile $dialogName dialog from More actions",
    async ({ archived, actionLabel, dialogName }) => {
      installMatchMedia(false);
      const user = userEvent.setup();

      render(<SongPage data={songData(archived)} actions={songActions()} />);

      await user.click(screen.getByRole("button", { name: "More actions" }));
      const sheet = await screen.findByRole("dialog", { name: "Song actions" });
      await user.click(within(sheet).getByRole("button", { name: actionLabel }));

      const dialog = await screen.findByRole("dialog", { name: dialogName });
      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
      expect(screen.queryByTestId("song-more-actions-sheet")).toBeNull();

      await user.click(
        within(dialog).getByRole("button", {
          name: archived ? "Keep archived" : "Keep active",
        }),
      );
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: dialogName })).toBeNull();
      });
    },
  );

  it("returns focus to More actions when the mobile Sheet is dismissed directly", async () => {
    installMatchMedia(false);
    const user = userEvent.setup();

    render(<SongPage data={songData(false)} actions={songActions()} />);

    const trigger = screen.getByRole("button", { name: "More actions" });
    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Song actions" });

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Song actions" })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("uses native desktop disclosure semantics and closes on Escape", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();

    render(<SongPage data={songData(false)} actions={songActions()} />);

    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger.getAttribute("aria-haspopup")).toBeNull();
    await user.click(trigger);

    expect(await screen.findByRole("group", { name: "Song actions" })).not.toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Download" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: "Song actions" })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("closes the desktop disclosure when focus moves outside", async () => {
    installMatchMedia(true);
    const user = userEvent.setup();

    render(
      <>
        <SongPage data={songData(false)} actions={songActions()} />
        <button type="button">Outside control</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("group", { name: "Song actions" })).not.toBeNull();

    const outside = screen.getByRole("button", { name: "Outside control" });
    act(() => {
      outside.focus();
    });

    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "Song actions" })).toBeNull();
    });
    expect(document.activeElement).toBe(outside);
  });
});
