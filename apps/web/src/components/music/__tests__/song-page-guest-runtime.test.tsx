import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SongPage, type SongPageData } from "../song-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("~/components/audio/waveform-50", () => ({
  Waveform50: () => null,
}));

vi.mock("~/components/audio/persistent-player", () => ({
  PLAYER_EVENTS: { time: "skitza:test-player-time" },
  clampSeekMs: (currentMs: number) => currentMs,
  playerClose: vi.fn(),
  playerLoad: vi.fn(),
  playerPlay: vi.fn(),
  playerSeek: vi.fn(),
  playerSetVolume: vi.fn(),
  playerToggle: vi.fn(),
  useNowPlaying: () => ({ trackId: null, playing: false }),
  usePlaybackSnapshot: () => ({
    track: null,
    playing: false,
    currentMs: 0,
    audioDurationSec: null,
    volume: 1,
  }),
}));

vi.mock("~/components/dashboard/song/upload-track-modal", () => ({
  UploadTrackModal: () => null,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const data: SongPageData = {
  track: {
    id: "track-1",
    title: "After the Rain",
    artist: "Noya",
    projectId: "project-1",
    projectTitle: "After the Rain — Single",
    clientName: "Noya",
    artworkUrl: null,
    archivedAtIso: null,
    releasedAtIso: null,
    workflowStage: "mixing",
    artistApprovalLocked: false,
    projectLifecycleStatus: "active",
  },
  versions: [
    {
      id: "version-1",
      label: "Mix v1",
      audioUrl: "/api/audio/public/song/version-1?capability=test",
      downloadUrl: null,
      audioDeletedAtIso: null,
      durationMs: 201_000,
      uploadedAtIso: "2026-08-15T09:30:00.000Z",
      producerMarkedFinalAtIso: null,
      artistApprovedAtIso: null,
      previouslyArtistApprovedAtIso: null,
      peaks: [0.2, 0.4],
      delivery: {
        purchaseId: "purchase-1",
        permission: "payment_required",
        fullyPaid: false,
        remainingCents: 0,
        currency: "ILS",
        overdue: false,
        totalCents: 0,
      },
    },
  ],
  comments: [],
  selectedVersionId: "version-1",
};

describe("SongPage guest runtime boundary", () => {
  it("server-renders guest listening without an authenticated app shell", () => {
    expect(() =>
      renderToStaticMarkup(<SongPage data={data} role="guest" actions={{}} />),
    ).not.toThrow();
  });
});
