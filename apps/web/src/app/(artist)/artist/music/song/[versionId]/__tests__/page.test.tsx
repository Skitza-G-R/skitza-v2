import { TRPCError } from "@trpc/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createCaller: vi.fn(),
  songPage: vi.fn<(props: unknown) => void>(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));

vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: { createCaller: mocks.createCaller },
}));

vi.mock("~/components/artist/artist-track-version-acknowledger", () => ({
  ArtistTrackVersionAcknowledger: () => null,
}));

vi.mock("~/components/music/song-page", () => ({
  SongPage: (props: unknown) => {
    mocks.songPage(props);
    return <div>Artist Song</div>;
  },
}));

vi.mock("../actions", () => ({
  l3AddComment: vi.fn(),
  l3ApproveVersion: vi.fn(),
  l3ResolveComment: vi.fn(),
  refreshArtistPublicSongLink: vi.fn(),
}));

import ArtistSongPage from "../page";

const VERSION_ID = "ff8ff16b-7b1f-4313-8233-458096705d2f";
const TRACK_ID = "11111111-1111-4111-8111-111111111111";
const PURCHASE_ID = "22222222-2222-4222-8222-222222222222";

function callerWith(publicSharingError: TRPCError) {
  return {
    artist: {
      music: {
        detail: vi.fn().mockResolvedValue({
          track: {
            id: TRACK_ID,
            title: "Artist Song",
            artist: "Artist",
            projectId: "33333333-3333-4333-8333-333333333333",
            projectTitle: "Project",
            clientName: "Artist",
            artworkUrl: null,
            archivedAt: null,
            releasedAt: null,
            workflowStage: "in_progress",
            projectLifecycleStatus: "active",
            artistApprovalLocked: false,
            producerId: "44444444-4444-4444-8444-444444444444",
          },
          versions: [
            {
              id: VERSION_ID,
              purchaseId: PURCHASE_ID,
              purchaseTotalCents: 1_000,
              label: "V1",
              audioUrl: "/api/audio/history/producer/version",
              audioDeletedAt: null,
              durationMs: 120_000,
              uploadedAt: new Date("2026-08-04T12:00:00.000Z"),
              producerMarkedFinalAt: null,
              artistApprovedAt: null,
              previouslyArtistApprovedAt: null,
              peaks: null,
            },
          ],
          comments: [],
          selectedVersionId: VERSION_ID,
        }),
      },
    },
    songPublication: {
      artistState: vi.fn().mockRejectedValue(publicSharingError),
    },
    audioDelivery: {
      artistEntitlement: vi.fn().mockResolvedValue({
        purchaseId: PURCHASE_ID,
        permission: "payment_required",
        fullyPaid: false,
        unpaidAmountCents: 1_000,
        currency: "USD",
        overdue: false,
      }),
    },
  };
}

describe("Artist Song route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "artist-user" });
  });

  it("keeps the owned Song available when optional public-link signing is unconfigured", async () => {
    mocks.createCaller.mockReturnValue(
      callerWith(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          cause: new Error("Missing or weak SONG_PUBLIC_LINK_SECRET"),
        }),
      ),
    );

    const ui = await ArtistSongPage({ params: Promise.resolve({ versionId: VERSION_ID }) });

    expect(renderToStaticMarkup(ui)).toContain("Artist Song");
    expect(mocks.songPage.mock.calls[0]?.[0]).not.toHaveProperty("publicSharing");
  });

  it("still surfaces unrelated public-sharing failures", async () => {
    const unexpected = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Public song state is invalid",
    });
    mocks.createCaller.mockReturnValue(callerWith(unexpected));

    await expect(
      ArtistSongPage({ params: Promise.resolve({ versionId: VERSION_ID }) }),
    ).rejects.toBe(unexpected);
  });
});
