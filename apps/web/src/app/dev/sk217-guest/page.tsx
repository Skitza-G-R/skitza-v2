import Link from "next/link";
import { notFound } from "next/navigation";

import { SongPage, type SongPageData } from "~/components/music/song-page";
import { Wordmark } from "~/components/nav/wordmark";
import { RuntimeStatePreviewProvider } from "~/components/runtime-state/runtime-state-provider";
import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

const VERSION_ONE = "11111111-1111-4111-8111-111111111111";
const VERSION_TWO = "22222222-2222-4222-8222-222222222222";

function peaks(offset: number): number[] {
  return Array.from({ length: 200 }, (_, index) => {
    const envelope = 0.22 + Math.abs(Math.sin((index + offset) * 0.12)) * 0.62;
    const detail = Math.sin((index + offset) * 0.47) * 0.12;
    return Math.min(1, Math.max(0.08, Number((envelope + detail).toFixed(3))));
  });
}

export default async function Sk217GuestVisualCheck({
  searchParams,
}: {
  searchParams: Promise<{ download?: string }>;
}) {
  if (!isDevGalleryAvailable()) notFound();

  const query = await searchParams;
  const data: SongPageData = {
    track: {
      id: "33333333-3333-4333-8333-333333333333",
      title: "Totalit",
      artist: "Gili Asraf",
      projectId: "44444444-4444-4444-8444-444444444444",
      projectTitle: "האיש שהיה",
      clientName: "Gili Asraf",
      artworkUrl: null,
      archivedAtIso: null,
      releasedAtIso: null,
      workflowStage: "mixing",
      projectLifecycleStatus: "active",
      artistApprovalLocked: false,
    },
    versions: [
      {
        id: VERSION_ONE,
        label: "V2",
        audioUrl: "/icon.png",
        downloadUrl: query.download === "1" ? "/icon.png?download=1" : null,
        audioDeletedAtIso: null,
        durationMs: 130_000,
        uploadedAtIso: "2026-08-09T12:00:00.000Z",
        producerMarkedFinalAtIso: null,
        artistApprovedAtIso: null,
        previouslyArtistApprovedAtIso: null,
        peaks: peaks(3),
        delivery: {
          purchaseId: "55555555-5555-4555-8555-555555555555",
          permission: query.download === "1" ? "version_override" : "payment_required",
          fullyPaid: false,
          remainingCents: 1_000,
          currency: "ILS",
          overdue: false,
          totalCents: 1_000,
        },
      },
      {
        id: VERSION_TWO,
        label: "V1",
        audioUrl: "/icon.png",
        downloadUrl: null,
        audioDeletedAtIso: null,
        durationMs: 128_000,
        uploadedAtIso: "2026-08-07T12:00:00.000Z",
        producerMarkedFinalAtIso: null,
        artistApprovedAtIso: null,
        previouslyArtistApprovedAtIso: null,
        peaks: peaks(15),
        delivery: {
          purchaseId: "55555555-5555-4555-8555-555555555555",
          permission: "payment_required",
          fullyPaid: false,
          remainingCents: 1_000,
          currency: "ILS",
          overdue: false,
          totalCents: 1_000,
        },
      },
    ],
    comments: [],
    selectedVersionId: VERSION_ONE,
  };

  return (
    <RuntimeStatePreviewProvider
      identity={{
        userId: "dev-sk217-guest",
        role: "artist",
        contextId: "44444444-4444-4444-8444-444444444444",
      }}
    >
      <div className="min-h-dvh bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]">
        <header className="border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.96)]">
          <div className="mx-auto flex min-h-20 max-w-[1120px] items-center justify-between px-4 sm:min-h-24 sm:px-6">
            <span className="inline-flex min-h-11 items-center">
              <Wordmark size={30} lowercase />
            </span>
            <Link
              href={`/sign-in?redirect_url=${encodeURIComponent(`/artist/music/song/${VERSION_ONE}`)}`}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 text-[15px] font-semibold"
            >
              Log in
            </Link>
          </div>
        </header>
        <div id="main-content">
          <SongPage data={data} role="guest" actions={{}} />
        </div>
      </div>
    </RuntimeStatePreviewProvider>
  );
}
