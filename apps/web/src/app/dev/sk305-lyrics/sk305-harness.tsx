"use client";

import {
  SongPage,
  type MusicL3LyricsActionResult,
  type SongPageData,
} from "~/components/music/song-page";
import { RuntimeStatePreviewProvider } from "~/components/runtime-state/runtime-state-provider";

const VERSION_ONE = "11111111-1111-4111-8111-111111111111";
const VERSION_TWO = "22222222-2222-4222-8222-222222222222";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const PURCHASE_ID = "55555555-5555-4555-8555-555555555555";

const SHEET_STAMP = "2026-09-01T12:00:00.000Z";

// A real Hebrew lyric, because the whole point of dir="auto" is that this
// reads right-to-left inside an English UI. An English-only fixture would
// prove nothing.
const HEBREW_SHEET = [
  "אין פה ציפייה לנצח",
  "זה משהו שרציתי רצח",
  "הוא חוזר איתי",
  "הוא חוזר לשם",
  "",
  "חוזר למה שלא היה פה",
  "היה קצר אבל היה טוב",
  "איך הוא סובב אותי כמו דאפו",
].join("\n");

function peaks(offset: number): number[] {
  return Array.from({ length: 200 }, (_, index) => {
    const envelope = 0.22 + Math.abs(Math.sin((index + offset) * 0.12)) * 0.62;
    const detail = Math.sin((index + offset) * 0.47) * 0.12;
    return Math.min(1, Math.max(0.08, Number((envelope + detail).toFixed(3))));
  });
}

function version(id: string, label: string, offset: number, uploadedAtIso: string) {
  return {
    id,
    label,
    audioUrl: "/icon.png",
    downloadUrl: null,
    audioDeletedAtIso: null,
    durationMs: 131_000,
    uploadedAtIso,
    producerMarkedFinalAtIso: null,
    artistApprovedAtIso: null,
    previouslyArtistApprovedAtIso: null,
    peaks: peaks(offset),
    delivery: {
      purchaseId: PURCHASE_ID,
      permission: "payment_required" as const,
      fullyPaid: false,
      remainingCents: 383_500,
      currency: "ILS",
      overdue: false,
      totalCents: 500_000,
    },
  };
}

export function Sk305Harness({
  state,
  role,
}: {
  state: "empty" | "written" | "stale";
  role: "producer" | "artist";
}) {
  const data: SongPageData = {
    track: {
      id: TRACK_ID,
      title: "כתבה במאקו",
      artist: "יובל לוי",
      projectId: PROJECT_ID,
      projectTitle: "כתבה במאקו — Single",
      // The artist payload overloads clientName with the producer's name.
      clientName: role === "artist" ? "Gili Asraf" : "יובל לוי",
      artworkUrl: null,
      archivedAtIso: null,
      releasedAtIso: null,
      workflowStage: "mixing",
      projectLifecycleStatus: "active",
      artistApprovalLocked: false,
      lyrics: state === "empty" ? null : HEBREW_SHEET,
      lyricsUpdatedAtIso: state === "empty" ? null : SHEET_STAMP,
      lyricsUpdatedBy: state === "empty" ? null : "producer",
    },
    versions: [
      version(VERSION_ONE, "V2", 3, "2026-09-03T15:00:00.000Z"),
      version(VERSION_TWO, "V1", 15, "2026-09-01T12:00:00.000Z"),
    ],
    comments: [],
    selectedVersionId: VERSION_ONE,
  };

  const setSongLyrics = (input: { lyrics: string | null }): Promise<MusicL3LyricsActionResult> => {
    if (state === "stale") {
      // Exactly what the server returns when the other side saved first.
      return Promise.resolve({
        ok: false,
        reason: "stale",
        lyrics: `${HEBREW_SHEET}\n\nהשורה שיובל הוסיף`,
        lyricsUpdatedAtIso: new Date(Date.now() - 62_000).toISOString(),
        lyricsUpdatedBy: role === "producer" ? "artist" : "producer",
      });
    }
    return Promise.resolve({
      ok: true,
      lyrics: input.lyrics,
      lyricsUpdatedAtIso: new Date().toISOString(),
      lyricsUpdatedBy: role,
    });
  };

  return (
    <RuntimeStatePreviewProvider identity={{ userId: "dev-sk305", role, contextId: PROJECT_ID }}>
      <div className="min-h-dvh bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]">
        <div id="main-content">
          <SongPage
            data={data}
            role={role}
            actions={{
              setSongLyrics,
              ...(role === "producer"
                ? { markVersionReady: () => Promise.resolve({ ok: true as const }) }
                : { approveVersion: () => Promise.resolve({ ok: true as const }) }),
            }}
            {...(role === "producer"
              ? {
                  versionUpload: {
                    projectId: PROJECT_ID,
                    trackId: TRACK_ID,
                    defaultLabel: "V3",
                    versionCount: 2,
                    publicExposure: "none" as const,
                  },
                }
              : {})}
          />
        </div>
      </div>
    </RuntimeStatePreviewProvider>
  );
}
