// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeStatePreviewProvider } from "~/components/runtime-state/runtime-state-provider";
import { SongPage, type SongPageData } from "../song-page";

// SK-298: the song page is reused inside the onboarding simulation's phone
// frame. It normally reads the VIEWPORT to decide what to show, which is wrong
// there: the desktop layout burst out of a 392px bezel, the notes hid behind a
// sheet, the 200-bar waveform turned to mush, the volume slider spilled past
// the frame, and the address bar was rewritten to a route that does not exist
// in the story. `embedded` is the one flag that settles all of it, so these
// tests pin each part.

const mocks = vi.hoisted(() => ({
  replaceBrowserSongPageVersion: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("../song-page-address", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  replaceBrowserSongPageVersion: mocks.replaceBrowserSongPageVersion,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("~/components/runtime-state/online-required-link", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOnlineStatus: () => true,
}));

/** The desktop treatment is what a device frame must never inherit. */
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

const PEAKS = Array.from({ length: 200 }, (_, index) => 0.2 + (index % 7) / 20);

function songData(): SongPageData {
  return {
    track: {
      id: "track-embedded",
      title: "Blue Hour",
      artist: "Noya Levi",
      projectId: "project-embedded",
      projectTitle: "Blue Hour",
      clientName: "Maya Stone",
      artworkUrl: null,
      archivedAtIso: null,
      releasedAtIso: null,
      workflowStage: "mastering",
      projectLifecycleStatus: "active",
      artistApprovalLocked: false,
    },
    versions: [
      {
        id: "version-embedded-v2",
        label: "v2",
        audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=",
        audioDeletedAtIso: null,
        durationMs: 198_000,
        uploadedAtIso: "2026-09-02T09:00:00.000Z",
        producerMarkedFinalAtIso: "2026-09-02T09:00:00.000Z",
        artistApprovedAtIso: null,
        previouslyArtistApprovedAtIso: null,
        peaks: PEAKS,
        delivery: {
          purchaseId: "purchase-embedded",
          permission: "payment_required",
          fullyPaid: false,
          remainingCents: 90_000,
          currency: "ILS",
          overdue: false,
          totalCents: 180_000,
        },
      },
    ],
    comments: [
      {
        id: "comment-embedded",
        versionId: "version-embedded-v2",
        timeMs: 42_000,
        body: "This is the take.",
        fromProducer: false,
        authorName: "Noya Levi",
        createdAtIso: "2026-09-02T08:00:00.000Z",
        resolvedAtIso: null,
      },
    ],
    selectedVersionId: "version-embedded-v2",
  };
}

function renderSong(embedded: boolean) {
  render(
    <RuntimeStatePreviewProvider
      identity={{ userId: "test", role: "artist", contextId: "project-embedded" }}
    >
      <SongPage
        role="artist"
        {...(embedded ? { embedded: true } : {})}
        data={songData()}
        actions={{ approveVersion: () => Promise.resolve({ ok: true }) }}
      />
    </RuntimeStatePreviewProvider>,
  );
}

beforeEach(() => {
  // A desktop viewport is the case that used to break inside a frame.
  installMatchMedia(true);
  mocks.replaceBrowserSongPageVersion.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("SongPage embedded in a device frame (SK-298)", () => {
  it("drops the volume slider, which is revealed by viewport width and spills past a frame", () => {
    renderSong(true);
    expect(screen.queryByLabelText("Player volume")).toBeNull();
  });

  it("keeps the volume slider on its own route", () => {
    renderSong(false);
    expect(screen.getByLabelText("Player volume")).toBeTruthy();
  });

  it("never rewrites the browser address, because a frame has no route", () => {
    renderSong(true);
    expect(mocks.replaceBrowserSongPageVersion).not.toHaveBeenCalled();
  });

  it("keeps the address in step on its own route", () => {
    renderSong(false);
    expect(mocks.replaceBrowserSongPageVersion).toHaveBeenCalledWith(
      "artist",
      "version-embedded-v2",
    );
  });

  it("shows the notes thread inline instead of hiding it behind a sheet", () => {
    renderSong(true);
    expect(screen.getByText("This is the take.")).toBeTruthy();
    expect(screen.queryByLabelText(/^Open Notes/)).toBeNull();
  });
});
