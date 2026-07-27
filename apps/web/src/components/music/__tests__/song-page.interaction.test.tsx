// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SongPage, type L3Actions, type SongPageData } from "../song-page";

const mocks = vi.hoisted(() => ({
  playerClose: vi.fn(),
  playerPlay: vi.fn(),
  playerSeek: vi.fn(),
  playerToggle: vi.fn(),
}));

vi.mock("~/components/audio/waveform-50", () => ({
  Waveform50: () => null,
}));

vi.mock("~/components/audio/persistent-player", () => ({
  PLAYER_EVENTS: { time: "skitza:test-player-time" },
  playerClose: mocks.playerClose,
  playerPlay: mocks.playerPlay,
  playerSeek: mocks.playerSeek,
  playerToggle: mocks.playerToggle,
  useNowPlaying: () => ({ trackId: null, playing: false }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/runtime-state/use-runtime-state", () => ({
  useRuntimeTextDraft: () => ({
    body: "",
    setBody: vi.fn(),
    setBodyFromUser: vi.fn(),
    preserveDraft: vi.fn(),
    clearDraft: vi.fn(),
  }),
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
  mocks.playerPlay.mockReset();
  mocks.playerSeek.mockReset();
  mocks.playerToggle.mockReset();
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
