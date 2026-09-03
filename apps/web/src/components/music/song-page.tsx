"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type RefObject,
} from "react";

import { Waveform50, type WaveformComment } from "~/components/audio/waveform-50";
import { UploadTrackModal } from "~/components/dashboard/song/upload-track-modal";
import {
  PLAYER_EVENTS,
  clampSeekMs,
  playerClose,
  playerLoad,
  playerPlay,
  playerSeek,
  playerSetVolume,
  playerToggle,
  useNowPlaying,
  usePlaybackSnapshot,
  type PlayerTrack,
} from "~/components/audio/persistent-player";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { RuntimeStateDisabledProvider } from "~/components/runtime-state/runtime-state-provider";
import { useRuntimeTextDraft } from "~/components/runtime-state/use-runtime-state";
import { Card } from "~/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { formatMoney } from "~/lib/format/money";
import { shareNative } from "~/lib/native/share";

import {
  presentVersionDelivery,
  type VersionDeliveryPermission,
  type VersionDeliveryState,
} from "./delivery-state";
import { gradientForSeed } from "./lib";
import { ProjectCover } from "./project-cover";
import { canonicalSongPageAddress, replaceBrowserSongPageVersion } from "./song-page-address";
import { SongManagementDialog, type SongManagementDialogConfig } from "./song-management-dialog";
import {
  SongPublicLinkControls,
  type SongPublicSharingActions,
  type SongPublicSharingView,
} from "./song-public-link-controls";

// Server actions are passed in as props (see SongPage signature
// below) rather than imported by a relative path. This is the seam
// that lets the same component back two routes — producer's
// /dashboard/music/[versionId] and artist's
// /artist/music/song/[versionId] — each with its own
// `revalidatePath`-targeted variant.
export type MusicL3ActionResult = { ok: true } | { ok: false; error: string };

export function runOnlineMusicManagement(
  online: boolean,
  action: () => Promise<MusicL3ActionResult>,
): Promise<MusicL3ActionResult> {
  if (!online) {
    return Promise.resolve({
      ok: false,
      error: "Reconnect before making this change. Nothing was changed.",
    });
  }
  return action();
}

export type MusicL3DeleteAudioActionResult =
  | {
      ok: true;
      nextPlaybackVersionId?: string | null;
      removedPortfolioEntry?: boolean;
      disabledPublicLink?: boolean;
    }
  | { ok: false; error: string };

export type MusicL3PrepareArtworkActionResult =
  | {
      ok: true;
      data: {
        uploadUrl: string;
        uploadToken: string;
      };
    }
  | { ok: false; error: string };

export type MusicL3CompleteArtworkActionResult =
  | {
      ok: true;
      data: {
        artworkUrl: string;
      };
    }
  | { ok: false; error: string };

export type L3Actions = {
  addComment?: (input: {
    versionId: string;
    body: string;
    timestampMs: number;
  }) => Promise<MusicL3ActionResult>;
  resolveComment?: (input: {
    versionId: string;
    id: string;
    resolved: boolean;
  }) => Promise<MusicL3ActionResult>;
  // Producer-only readiness. It never writes artist approval history.
  markVersionReady?: (input: { versionId: string; ready: boolean }) => Promise<MusicL3ActionResult>;
  // Artist-only exact-version approval.
  approveVersion?: (input: { versionId: string }) => Promise<MusicL3ActionResult>;
  // Producer-only reopen. Preserves approval history and unlocks uploads.
  reopenSong?: (input: { trackId: string; versionId: string }) => Promise<MusicL3ActionResult>;
  renameSong?: (input: {
    projectId: string;
    trackId: string;
    versionId: string;
    title: string;
  }) => Promise<MusicL3ActionResult>;
  editArtist?: (input: {
    projectId: string;
    trackId: string;
    versionId: string;
    artist: string | null;
  }) => Promise<MusicL3ActionResult>;
  setArchived?: (input: {
    projectId: string;
    trackId: string;
    versionId: string;
    archived: boolean;
  }) => Promise<MusicL3ActionResult>;
  markReleased?: (input: {
    projectId: string;
    trackId: string;
    versionId: string;
  }) => Promise<MusicL3ActionResult>;
  renameVersion?: (input: {
    projectId: string;
    versionId: string;
    label: string;
  }) => Promise<MusicL3ActionResult>;
  deleteVersionAudio?: (input: {
    projectId: string;
    versionId: string;
    operationKey: string;
  }) => Promise<MusicL3DeleteAudioActionResult>;
  deleteVersion?: (input: { projectId: string; versionId: string }) => Promise<MusicL3ActionResult>;
  deleteSong?: (input: { projectId: string; trackId: string }) => Promise<MusicL3ActionResult>;
  setDownloadOverride?: (input: {
    purchaseId: string;
    versionId: string;
    enabled: boolean;
    expectedUnpaidAmountCents: number;
  }) => Promise<MusicL3ActionResult>;
  prepareArtwork?: (input: {
    trackId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }) => Promise<MusicL3PrepareArtworkActionResult>;
  completeArtwork?: (input: {
    trackId: string;
    versionId: string;
    uploadToken: string;
    objectEtag: string;
  }) => Promise<MusicL3CompleteArtworkActionResult>;
};

// Which side of the app is rendering this screen. Default = "producer"
// so existing call-sites keep working unchanged.
//
// In artist mode:
//   - producer readiness/reopen controls are replaced by exact artist approval.
//   - the **"Open in project room"** pill is hidden (the artist
//     doesn't have a clients-projects surface to cross-link into).
//   - the breadcrumb middle crumb reads `track.clientName`, which the
//     artist wire payload overloads with the producer's display name.
export type SongPageRole = "producer" | "artist" | "guest";

export type ProducerVersionUpload = {
  projectId: string;
  trackId: string;
  defaultLabel: string;
  versionCount: number;
  publicExposure: "none" | "link" | "portfolio" | "link_and_portfolio";
};

export function songCommentDraftRoute(role: SongPageRole, versionId: string): string {
  const encodedVersionId = encodeURIComponent(versionId);
  if (role === "artist") return `/artist/music/song/${encodedVersionId}`;
  if (role === "guest") return "/listen";
  return `/dashboard/music/${encodedVersionId}`;
}

// ─── Wire types (Date crosses RSC → client as ISO strings) ───────────
export type SongPageVersion = {
  id: string;
  label: string;
  audioUrl: string | null;
  /** Guest-only attachment route. Null/undefined means no public download grant. */
  downloadUrl?: string | null;
  /** Explicit storage tombstone. Null/undefined means the audio was not deleted. */
  audioDeletedAtIso?: string | null;
  durationMs: number | null;
  uploadedAtIso: string;
  /** Producer declaration that this exact stored audio is ready for approval. */
  producerMarkedFinalAtIso: string | null;
  /** Current exact artist approval, present on at most one version per song. */
  artistApprovedAtIso: string | null;
  /** Preserved latest approval for this version after the song was reopened. */
  previouslyArtistApprovedAtIso: string | null;
  /**
   * Pre-computed waveform peaks (200 normalized RMS floats 0..1).
   * Computed server-side at upload completion. Null for legacy rows
   * before the migration applied OR for formats audio-decode couldn't
   * parse — the Waveform50 client decode picks up either case.
   */
  peaks: number[] | null;
  /** Exact purchase/version delivery result supplied by the protected backend. */
  delivery: VersionDeliveryState;
};

export type SongPageComment = {
  id: string;
  versionId: string;
  timeMs: number;
  body: string;
  fromProducer: boolean;
  authorName: string;
  createdAtIso: string;
  resolvedAtIso: string | null;
};

export type SongPageData = {
  track: {
    id: string;
    title: string;
    artist: string | null;
    projectId: string;
    projectTitle: string;
    clientName: string | null;
    artworkUrl?: string | null;
    archivedAtIso: string | null;
    releasedAtIso: string | null;
    workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
    artistApprovalLocked: boolean;
    projectLifecycleStatus?: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  };
  versions: SongPageVersion[];
  comments: SongPageComment[];
  selectedVersionId: string;
};

// ─── Pure helpers (exported for direct unit-testing) ─────────────────

export function isSongPageVersionPlayable(version: SongPageVersion): boolean {
  return version.audioDeletedAtIso == null && version.audioUrl !== null;
}

export function newestPlayableSongPageVersion(
  versions: readonly SongPageVersion[],
): SongPageVersion | null {
  return versions.find(isSongPageVersionPlayable) ?? null;
}

export function isTombstonedVersionLoaded(
  versions: readonly SongPageVersion[],
  loadedVersionId: string | null,
): boolean {
  if (loadedVersionId === null) return false;
  return versions.some(
    (version) => version.id === loadedVersionId && version.audioDeletedAtIso != null,
  );
}

/**
 * Deep links normally request one exact version. If that audio was deleted,
 * open the newest still-playable version instead. When no audio survives, keep
 * the requested (or newest historical) row so its date and comments remain
 * inspectable without presenting a player target.
 */
export function resolveInitialSongPageVersion(
  versions: readonly SongPageVersion[],
  selectedVersionId: string,
): SongPageVersion | null {
  const requested = versions.find((version) => version.id === selectedVersionId) ?? null;
  if (requested && isSongPageVersionPlayable(requested)) return requested;
  return newestPlayableSongPageVersion(versions) ?? requested ?? versions[0] ?? null;
}

export type DeleteVersionAudioPolicy = {
  canDelete: boolean;
  isStorageCleanupRetry: boolean;
  isCurrent: boolean;
  isFinal: boolean;
  isLast: boolean;
  isReleased: boolean;
  strongWarning: boolean;
  details: string[];
};

/**
 * The UI mirrors the server's deletion guard so producers learn why audio is
 * protected before they submit. The server remains authoritative if state
 * changes while the confirmation dialog is open.
 */
export function deleteVersionAudioPolicy(input: {
  versions: readonly SongPageVersion[];
  version: SongPageVersion;
  isReleased: boolean;
}): DeleteVersionAudioPolicy {
  const playableVersions = input.versions.filter(isSongPageVersionPlayable);
  const isStored = isSongPageVersionPlayable(input.version);
  const isStorageCleanupRetry = input.version.audioDeletedAtIso != null;
  const isCurrent = newestPlayableSongPageVersion(playableVersions)?.id === input.version.id;
  const isFinal = input.version.producerMarkedFinalAtIso !== null;
  const isLast = playableVersions.length === 1 && playableVersions[0]?.id === input.version.id;
  const isReleased = input.isReleased;
  const protectedRoles = [
    ...(isCurrent ? ["current"] : []),
    ...(isFinal ? ["producer-marked-final"] : []),
    ...(isLast ? ["last remaining"] : []),
  ];

  if (isStorageCleanupRetry) {
    return {
      canDelete: true,
      isStorageCleanupRetry,
      isCurrent,
      isFinal,
      isLast,
      isReleased,
      strongWarning: false,
      details: [
        "This safely retries removal of the already-deleted version's stored audio object. It is safe to repeat.",
        "The original deletion time, version name, upload date, and comment history stay unchanged.",
        "Playback, downloads, and public switching remain unavailable for this version.",
      ],
    };
  }

  if (!isStored) {
    return {
      canDelete: false,
      isStorageCleanupRetry,
      isCurrent,
      isFinal,
      isLast,
      isReleased,
      strongWarning: false,
      details: ["This version does not have completed stored audio to delete."],
    };
  }

  if (!isReleased && protectedRoles.length > 0) {
    return {
      canDelete: false,
      isStorageCleanupRetry,
      isCurrent,
      isFinal,
      isLast,
      isReleased,
      strongWarning: false,
      details: [
        `The ${protectedRoles.join(", ")} audio is protected in this legacy audio-only cleanup flow.`,
        "Use Delete Version or Delete Song to permanently remove it with its history.",
      ],
    };
  }

  const details = [
    "This permanently deletes the real stored audio object. It cannot be undone.",
    "The lightweight version name, upload date, and comment history remains available.",
  ];
  if (isCurrent) {
    details.push(
      "This is the current audio. The newest remaining playable version becomes current.",
    );
  }
  if (isFinal) {
    details.push("This is producer-marked-final audio. Check the selection carefully.");
  }
  if (isLast) {
    details.push(
      "This is the last playable audio. Its portfolio entry will be removed and the public link disabled.",
    );
  }

  return {
    canDelete: true,
    isStorageCleanupRetry,
    isCurrent,
    isFinal,
    isLast,
    isReleased,
    strongWarning: isReleased && (isFinal || isLast),
    details,
  };
}

// Builds the PlayerTrack payload that PersistentPlayer expects when we
// dispatch `skitza:player:set` to start playback of the active version.
//
// The subtitle convention follows the rest of the dashboard
// (recent-uploads-shelf.tsx → cardPlayDetail): "Client · vN" reads
// better than "vN · Client" when the floating player ticker truncates.
// Falls back through clientName → artist → projectTitle so we never
// render "null · v3" for legacy rows that never carried a client name.
export function activeVersionToPlayerTrack(
  track: SongPageData["track"],
  version: SongPageVersion,
  role: SongPageRole,
): PlayerTrack {
  const label = track.clientName ?? track.artist ?? track.projectTitle;
  const accountUnlocked =
    isSongPageVersionPlayable(version) &&
    version.delivery.permission !== "audio_deleted" &&
    (role === "producer" ||
      (role === "artist" &&
        (version.delivery.permission === "purchase_fully_paid" ||
          version.delivery.permission === "version_override")));
  return {
    id: version.id,
    songId: track.id,
    audioUrl: version.audioUrl,
    title: track.title,
    subtitle: `${label} · ${version.label}`,
    durationMs: version.durationMs,
    ...(track.artworkUrl
      ? {
          artwork: [
            {
              src: track.artworkUrl,
              sizes: "512x512",
            },
          ],
        }
      : {}),
    ...(accountUnlocked ? { cachePolicy: "account-unlocked" as const } : {}),
  };
}

// Derives the play button's UI + behaviour from the current player
// state. Three branches matter:
//
//   1. audioUrl is null         → disabled (nothing to play yet,
//                                  upload still pending)
//   2. THIS version is loaded   → toggle pause/resume on the existing
//      in PersistentPlayer         <audio> element rather than reload it
//                                  (label flips Pause/Play with state)
//   3. nothing or another track → start fresh via `playerPlay`
//
// Returning a tagged action lets the click handler stay dumb:
//   `state.action === "toggle" ? playerToggle() : playerPlay(track)`
export type PlayButtonState = {
  label: "Play" | "Pause";
  disabled: boolean;
  action: "play-new" | "toggle";
};

export function playButtonState(input: {
  activeVersionId: string;
  audioUrl: string | null;
  audioDeletedAtIso?: string | null;
  nowPlaying: { trackId: string | null; playing: boolean };
}): PlayButtonState {
  if (input.audioDeletedAtIso != null || input.audioUrl === null) {
    return { label: "Play", disabled: true, action: "play-new" };
  }
  const isThisVersionLoaded = input.nowPlaying.trackId === input.activeVersionId;
  if (isThisVersionLoaded) {
    return {
      label: input.nowPlaying.playing ? "Pause" : "Play",
      disabled: false,
      action: "toggle",
    };
  }
  return {
    label: "Play",
    disabled: false,
    action: "play-new",
  };
}

type OpenSongManagement = {
  kind:
    | "rename-song"
    | "edit-artist"
    | "set-archived"
    | "mark-released"
    | "rename-version"
    | "delete-version"
    | "delete-song"
    | "delete-version-audio"
    | "download-override"
    | "approve-version"
    | "reopen-approved-song";
  versionId: string;
};

const DESKTOP_MORE_ACTIONS_MEDIA_QUERY = "(min-width: 1024px)";

function SongDeletionRedirect({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.push(href);
    router.refresh();
  }, [href, router]);

  return null;
}

export type SongPageProps = {
  data: SongPageData;
  role?: SongPageRole;
  /**
   * Gallery and onboarding-simulation only: this page is rendered inside a
   * fixed-width frame rather than as its own route.
   *
   * The page normally reads the viewport to choose its layout, which is wrong
   * inside a device frame: the two-column desktop layout burst out of a 392px
   * phone frame, the notes thread hid behind a sheet on real phones, and the
   * 200-bar desktop waveform was crammed into a phone-width box. Embedded, the
   * page stays one column, the notes render inline, the waveform keeps its
   * phone bar count, and it never rewrites the browser address, because a
   * frame has no route of its own.
   */
  embedded?: boolean | undefined;
  artistStudioId?: string | undefined;
  producerProjectHref?: string | undefined;
  versionUpload?: ProducerVersionUpload | undefined;
  actions: L3Actions;
  publicSharing?: SongPublicSharingView;
  publicSharingActions?: SongPublicSharingActions;
};

export function SongPage(props: SongPageProps) {
  if (props.role === "guest") {
    return (
      <RuntimeStateDisabledProvider>
        <SongPageContent {...props} />
      </RuntimeStateDisabledProvider>
    );
  }

  return <SongPageContent {...props} />;
}

function SongPageContent({
  data,
  role = "producer",
  embedded = false,
  artistStudioId,
  producerProjectHref,
  versionUpload,
  actions,
  publicSharing,
  publicSharingActions,
}: SongPageProps) {
  const [songTitleOverride, setSongTitleOverride] = useState<string | undefined>();
  const [artistOverride, setArtistOverride] = useState<string | null | undefined>();
  const [artworkUrlOverride, setArtworkUrlOverride] = useState<string | null | undefined>();
  const [archivedOverride, setArchivedOverride] = useState<boolean | null>(null);
  const [releasedOverride, setReleasedOverride] = useState<boolean | null>(null);
  const [versionLabelOverrides, setVersionLabelOverrides] = useState<Record<string, string>>({});
  const [producerReadyOverrides, setProducerReadyOverrides] = useState<Record<string, boolean>>({});
  const [artistApprovalVersionOverride, setArtistApprovalVersionOverride] = useState<
    string | null | undefined
  >(undefined);
  const [previousApprovalOverrides, setPreviousApprovalOverrides] = useState<
    Record<string, string>
  >({});
  const [optimisticDeletedAtByVersion, setOptimisticDeletedAtByVersion] = useState<
    Record<string, string>
  >({});
  const [optimisticallyDeletedVersionIds, setOptimisticallyDeletedVersionIds] = useState<
    readonly string[]
  >([]);
  const [deliveryPermissionOverrides, setDeliveryPermissionOverrides] = useState<
    Record<string, VersionDeliveryPermission>
  >({});
  const [versionUploadOpen, setVersionUploadOpen] = useState(false);
  const [songDeletionRedirectHref, setSongDeletionRedirectHref] = useState<string | null>(null);
  const versions = useMemo(
    () =>
      data.versions
        .filter((version) => !optimisticallyDeletedVersionIds.includes(version.id))
        .map((version) => {
          const label = versionLabelOverrides[version.id];
          const deletedAt = optimisticDeletedAtByVersion[version.id];
          const readyOverride = producerReadyOverrides[version.id];
          const deliveryPermissionOverride = deliveryPermissionOverrides[version.id];
          const currentArtistApproval =
            artistApprovalVersionOverride === undefined
              ? version.artistApprovedAtIso
              : artistApprovalVersionOverride === version.id
                ? new Date().toISOString()
                : null;
          const previousApproval = previousApprovalOverrides[version.id];
          return {
            ...version,
            ...(label === undefined ? {} : { label }),
            ...(deletedAt === undefined ? {} : { audioUrl: null, audioDeletedAtIso: deletedAt }),
            delivery: {
              ...version.delivery,
              permission:
                deletedAt === undefined
                  ? (deliveryPermissionOverride ?? version.delivery.permission)
                  : "audio_deleted",
            },
            ...(readyOverride === undefined
              ? {}
              : { producerMarkedFinalAtIso: readyOverride ? new Date().toISOString() : null }),
            artistApprovedAtIso: currentArtistApproval,
            ...(previousApproval === undefined
              ? {}
              : { previouslyArtistApprovedAtIso: previousApproval }),
          };
        }),
    [
      artistApprovalVersionOverride,
      data.versions,
      deliveryPermissionOverrides,
      optimisticDeletedAtByVersion,
      optimisticallyDeletedVersionIds,
      previousApprovalOverrides,
      producerReadyOverrides,
      versionLabelOverrides,
    ],
  );
  const artistApprovalLocked =
    artistApprovalVersionOverride === undefined
      ? data.track.artistApprovalLocked
      : artistApprovalVersionOverride !== null;

  // Active version — the one the L1 row pointed at by default. Switching
  // a version filters the comment thread to that version's notes.
  const [activeVersionId, setActiveVersionId] = useState(
    () =>
      resolveInitialSongPageVersion(versions, data.selectedVersionId)?.id ?? data.selectedVersionId,
  );
  const previousRouteVersionIdRef = useRef(data.selectedVersionId);
  const activeVersion = useMemo(
    () =>
      versions.find((v) => v.id === activeVersionId) ??
      resolveInitialSongPageVersion(versions, data.selectedVersionId),
    [activeVersionId, data.selectedVersionId, versions],
  );
  const activeVersionPlayable = activeVersion ? isSongPageVersionPlayable(activeVersion) : false;
  const activeVersionDeleted = activeVersion?.audioDeletedAtIso != null;

  useEffect(() => {
    if (activeVersionId && !embedded) replaceBrowserSongPageVersion(role, activeVersionId);
  }, [activeVersionId, embedded, role]);

  // App Router can preserve this client component while navigating between
  // two exact /music/[versionId] URLs. Follow that route-prop change, but do
  // not reset a version the listener deliberately chose when the same route
  // merely refreshes with a new versions array.
  useEffect(() => {
    if (previousRouteVersionIdRef.current === data.selectedVersionId) return;
    previousRouteVersionIdRef.current = data.selectedVersionId;
    setActiveVersionId(
      resolveInitialSongPageVersion(versions, data.selectedVersionId)?.id ?? data.selectedVersionId,
    );
  }, [data.selectedVersionId, versions]);

  // A refresh can tombstone the version that was active before the mutation.
  // Move to the newest surviving audio. A later deliberate click on a deleted
  // version still selects its history because this effect only follows data.
  useEffect(() => {
    setActiveVersionId((currentId) => {
      const current = versions.find((version) => version.id === currentId) ?? null;
      if (current && isSongPageVersionPlayable(current)) return currentId;
      return newestPlayableSongPageVersion(versions)?.id ?? current?.id ?? currentId;
    });
  }, [versions]);

  // Optimistic comments + resolutions, keyed by versionId. Server
  // mutations re-render the parent (revalidatePath) so these only
  // exist during the round-trip.
  const [optimisticByVersion, setOptimisticByVersion] = useState<Record<string, SongPageComment[]>>(
    {},
  );
  const [resolvedOverrides, setResolvedOverrides] = useState<Record<string, boolean>>({});
  // Keep the active conversation focused by default. Resolved notes
  // remain available through the explicit toggle, where they render
  // greyed out and sorted after open notes for both roles.
  const [showResolved, setShowResolved] = useState<boolean>(false);

  // Live current-time from the waveform — used to anchor the "add note
  // at 0:34" composer chip. Updated by Waveform50's onProgress callback.
  const [currentMs, setCurrentMs] = useState(0);

  // Subscribed read of "what's currently playing" — flips the action-rail
  // play button to "Pause" when the active version is the one playing,
  // and lets the click handler decide between starting fresh vs toggling
  // the existing <audio> element in PersistentPlayer.
  const playbackSnapshot = usePlaybackSnapshot();
  const nowPlaying = useNowPlaying();

  // Storage reconciliation can fail after the database tombstone commits.
  // The server action revalidates this page in `finally`; when that refreshed
  // tombstone arrives, revoke any stale player that still holds the old URL.
  useEffect(() => {
    if (isTombstonedVersionLoaded(versions, nowPlaying.trackId)) playerClose();
  }, [nowPlaying.trackId, versions]);

  // Tracks whether playback was ours-paused for typing. Used by the
  // composer's onFocus + handleAddComment so submitting (or
  // dismissing) the composer auto-resumes only when WE paused, not
  // when the producer had already paused themselves.
  const wasPlayingBeforeFocus = useRef(false);

  // Sync the composer's `@mm:ss` chip with live audio time. Without
  // this, currentMs only updates on user click/drag/keyboard
  // (Waveform50's onProgress fires only on user interaction). The
  // founder reported the timestamp falling behind the dock; this
  // listener mirrors PersistentPlayer's broadcast so the chip stays
  // exact while audio plays.
  useEffect(() => {
    function onTime(e: Event) {
      const ms = (e as CustomEvent<number>).detail;
      if (
        Number.isFinite(ms) &&
        ms >= 0 &&
        (playbackSnapshot.track === null || playbackSnapshot.track.id === activeVersionId)
      ) {
        setCurrentMs(ms);
      }
    }
    window.addEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    return () => {
      window.removeEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    };
  }, [activeVersionId, playbackSnapshot.track]);

  // Secondary actions overflow menu. Click-out
  // closes it. Premium players keep utility actions out of the primary
  // sightline — the menu collapses into a single circular trigger.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  // A frame that pins the page to phone width must also get the phone layout,
  // whatever the viewport around it says.
  const isDesktopMoreActions = embedded ? false : isDesktopViewport;
  const moreActionsPanelId = useId();
  const versionPanelId = useId();
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const versionRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const versionButtonRef = useRef<HTMLButtonElement | null>(null);
  const openingManagementFromSheetRef = useRef(false);
  const openingManagementFromVersionRef = useRef(false);
  const deliveryOverrideButtonRef = useRef<HTMLButtonElement | null>(null);
  const artworkInputRef = useRef<HTMLInputElement | null>(null);
  const notesDragStartYRef = useRef<number | null>(null);
  const [artworkUploading, setArtworkUploading] = useState(false);
  const [managementDialog, setManagementDialog] = useState<OpenSongManagement | null>(null);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MORE_ACTIONS_MEDIA_QUERY);
    const update = () => {
      setIsDesktopViewport(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!overflowOpen || !isDesktopMoreActions) return;
    function isDialogTarget(target: EventTarget | null): boolean {
      return target instanceof Element && target.closest('[role="dialog"]') !== null;
    }
    function onDown(e: PointerEvent) {
      if (isDialogTarget(e.target)) return;
      const node = overflowRef.current;
      if (node && !node.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    function onFocusIn(e: FocusEvent) {
      if (isDialogTarget(e.target)) return;
      const node = overflowRef.current;
      if (node && !node.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (isDialogTarget(e.target)) return;
      e.preventDefault();
      setOverflowOpen(false);
      window.requestAnimationFrame(() => {
        moreButtonRef.current?.focus();
      });
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKey);
    };
  }, [isDesktopMoreActions, overflowOpen]);

  useEffect(() => {
    if (!versionMenuOpen || !isDesktopMoreActions) return;
    function onDown(e: PointerEvent) {
      const node = versionRef.current;
      if (node && !node.contains(e.target as Node)) setVersionMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setVersionMenuOpen(false);
      window.requestAnimationFrame(() => {
        versionButtonRef.current?.focus();
      });
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [isDesktopMoreActions, versionMenuOpen]);

  const [isPending, startTransition] = useTransition();
  const [sharingAddress, setSharingAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement | null>(null);
  const online = useOnlineStatus();
  const { toast } = useToast();
  const commentDraft = useRuntimeTextDraft({
    slot: role === "artist" ? "artist.song-comment-draft" : "producer.song-comment-draft",
    route: songCommentDraftRoute(role, activeVersionId),
    ...(role === "artist" && artistStudioId ? { contextId: artistStudioId } : {}),
    resourceId: activeVersionId,
  });

  // Comments visible right now: server + optimistic for the active
  // version. When requested, resolved comments sink to the BOTTOM and
  // render greyed out so the active conversation stays first. Within
  // each group, comments sort by timeMs asc so they read in track order.
  const visibleComments = useMemo(() => {
    if (!activeVersionId) return [];
    const server = data.comments.filter((c) => c.versionId === activeVersionId);
    const optimistic = optimisticByVersion[activeVersionId] ?? [];
    const merged = [...server, ...optimistic];
    const isCommentResolved = (c: SongPageComment): boolean => {
      const override = resolvedOverrides[c.id];
      return override !== undefined ? override : c.resolvedAtIso !== null;
    };
    const filtered = merged.filter((c) => (showResolved ? true : !isCommentResolved(c)));
    return filtered.sort((a, b) => {
      const aRes = isCommentResolved(a);
      const bRes = isCommentResolved(b);
      // Resolved last — primary sort key.
      if (aRes !== bRes) return aRes ? 1 : -1;
      return a.timeMs - b.timeMs;
    });
  }, [activeVersionId, data.comments, optimisticByVersion, resolvedOverrides, showResolved]);

  const allCommentsForVersion = useMemo(() => {
    if (!activeVersionId) return [];
    const server = data.comments.filter((c) => c.versionId === activeVersionId);
    const optimistic = optimisticByVersion[activeVersionId] ?? [];
    return [...server, ...optimistic];
  }, [activeVersionId, data.comments, optimisticByVersion]);

  const hasResolvedComments = allCommentsForVersion.some((c) => {
    const override = resolvedOverrides[c.id];
    return override !== undefined ? override : c.resolvedAtIso !== null;
  });

  // Markers fed to the waveform — comments for the active version only.
  // We don't render markers for resolved comments unless `showResolved`
  // is on (matches the comment thread).
  const waveformComments: WaveformComment[] = useMemo(() => {
    if (!activeVersion?.durationMs) return [];
    return allCommentsForVersion
      .filter((c) => {
        const override = resolvedOverrides[c.id];
        const isResolved = override !== undefined ? override : c.resolvedAtIso !== null;
        return showResolved ? true : !isResolved;
      })
      .map((c) => {
        const override = resolvedOverrides[c.id];
        return {
          id: c.id,
          timeMs: c.timeMs,
          fromProducer: c.fromProducer,
          resolved: override !== undefined ? override : c.resolvedAtIso !== null,
        };
      });
  }, [activeVersion?.durationMs, allCommentsForVersion, resolvedOverrides, showResolved]);

  const songTitle = songTitleOverride ?? data.track.title;
  const songArtist = artistOverride !== undefined ? artistOverride : data.track.artist;
  const artworkUrl =
    artworkUrlOverride !== undefined ? artworkUrlOverride : (data.track.artworkUrl ?? null);
  const clientLabel = data.track.clientName ?? songArtist ?? data.track.projectTitle;
  const playbackTrackData: SongPageData["track"] = {
    ...data.track,
    title: songTitle,
    artist: songArtist,
    artworkUrl,
  };
  const projectArchivedLabel =
    data.track.projectLifecycleStatus === "completed"
      ? "Archived · Completed"
      : data.track.projectLifecycleStatus === "canceled"
        ? "Archived · Canceled"
        : null;
  const songArchived = archivedOverride ?? data.track.archivedAtIso !== null;
  const songReleased = releasedOverride ?? data.track.releasedAtIso !== null;
  const commentsClosed = projectArchivedLabel !== null || songArchived;

  function handleAddComment() {
    if (!activeVersion || !actions.addComment || commentsClosed || isPending) return;
    const addComment = actions.addComment;
    const body = commentDraft.body.trim();
    if (!body) return;
    if (!online) {
      commentDraft.preserveDraft(body);
      setError("Reconnect to post this comment. Your draft is saved.");
      return;
    }
    setError(null);
    commentDraft.preserveDraft(body);
    const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
    const optimistic: SongPageComment = {
      id: tempId,
      versionId: activeVersion.id,
      timeMs: currentMs,
      body,
      fromProducer: true,
      authorName: "You",
      createdAtIso: new Date().toISOString(),
      resolvedAtIso: null,
    };
    setOptimisticByVersion((prev) => ({
      ...prev,
      [activeVersion.id]: [...(prev[activeVersion.id] ?? []), optimistic],
    }));
    commentDraft.setBody("");

    // If we paused playback when the composer got focus, resume
    // playback now that the producer's done typing. Pre-flip the
    // ref so the input's onBlur can't double-fire.
    const shouldResume = wasPlayingBeforeFocus.current;
    wasPlayingBeforeFocus.current = false;
    if (shouldResume) {
      playerToggle();
    }

    startTransition(async () => {
      try {
        const res = await addComment({
          versionId: activeVersion.id,
          body,
          timestampMs: currentMs,
        });
        if (!res.ok) {
          // Roll back optimistic on a server-confirmed rejection.
          setOptimisticByVersion((prev) => ({
            ...prev,
            [activeVersion.id]: (prev[activeVersion.id] ?? []).filter((c) => c.id !== tempId),
          }));
          commentDraft.setBody(body);
          setError(res.error);
          return;
        }
        // Clear optimistic only after server-confirmed success. The
        // server action revalidates the canonical row from the DB.
        setOptimisticByVersion((prev) => ({
          ...prev,
          [activeVersion.id]: (prev[activeVersion.id] ?? []).filter((c) => c.id !== tempId),
        }));
        commentDraft.clearDraft();
      } catch {
        // A rejected transport never counts as success. Restore both
        // the persisted draft and the visible composer for retry.
        setOptimisticByVersion((prev) => ({
          ...prev,
          [activeVersion.id]: (prev[activeVersion.id] ?? []).filter((c) => c.id !== tempId),
        }));
        commentDraft.setBody(body);
        setError("Couldn’t post this comment. Your draft is saved. Try again.");
      }
    });
  }

  // Focus on the composer pauses live playback so the producer can
  // think + type without the music racing ahead. Submitting (handle
  // AddComment) or blurring resumes playback if WE paused it.
  function handleComposerFocus() {
    if (!activeVersion) return;
    const isThisVersionPlaying = nowPlaying.trackId === activeVersion.id && nowPlaying.playing;
    if (isThisVersionPlaying) {
      wasPlayingBeforeFocus.current = true;
      playerToggle();
    }
  }

  function handleComposerBlur() {
    // Resume on blur ONLY if the composer didn't submit (handleAdd
    // Comment already resumed in that path). The flag is cleared on
    // submit, so this branch only fires when the user clicked away
    // without posting.
    if (wasPlayingBeforeFocus.current) {
      wasPlayingBeforeFocus.current = false;
      playerToggle();
    }
  }

  function handleResolveToggle(comment: SongPageComment) {
    if (!activeVersion || !actions.resolveComment) return;
    const resolveComment = actions.resolveComment;
    if (!online) {
      setError("Reconnect to update this comment. No change was saved.");
      return;
    }
    const override = resolvedOverrides[comment.id];
    const currentResolved = override !== undefined ? override : comment.resolvedAtIso !== null;
    const next = !currentResolved;
    setError(null);
    setResolvedOverrides((p) => ({ ...p, [comment.id]: next }));
    startTransition(async () => {
      try {
        const res = await resolveComment({
          versionId: activeVersion.id,
          id: comment.id,
          resolved: next,
        });
        if (res.ok) return;
        setResolvedOverrides((p) => ({ ...p, [comment.id]: currentResolved }));
        setError(res.error);
      } catch {
        setResolvedOverrides((p) => ({ ...p, [comment.id]: currentResolved }));
        setError("Couldn’t update this comment. Try again.");
      }
    });
  }

  function handleProducerReadyToggle() {
    if (!activeVersion) return;
    if (!actions.markVersionReady || artistApprovalLocked) return;
    if (!online) {
      setError("Reconnect to update this version. No change was saved.");
      return;
    }
    const isReady = activeVersion.producerMarkedFinalAtIso !== null;
    const markReadyAction = actions.markVersionReady;
    setError(null);
    startTransition(async () => {
      try {
        const res = await markReadyAction({
          versionId: activeVersion.id,
          ready: !isReady,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setProducerReadyOverrides(
          Object.fromEntries(
            versions.map((version) => [version.id, !isReady && version.id === activeVersion.id]),
          ),
        );
      } catch {
        setError(
          "Couldn’t confirm the ready status. Check your connection, then refresh before trying again.",
        );
      }
    });
  }

  // Jump to a comment's timestamp. If the active version isn't the one
  // currently playing in the dock, push it into PersistentPlayer FIRST
  // so the seek lands on a loaded <audio> element. Then dispatch the
  // seek and ensure the player is unpaused so the producer immediately
  // hears the moment they clicked.
  function handleJumpToComment(timeMs: number) {
    if (!activeVersion) return;
    if (!isSongPageVersionPlayable(activeVersion)) return;
    const isThisVersionLoaded = nowPlaying.trackId === activeVersion.id;
    if (!isThisVersionLoaded) {
      playerPlay(activeVersionToPlayerTrack(playbackTrackData, activeVersion, role));
    } else if (!nowPlaying.playing) {
      playerToggle();
    }
    // playerPlay resets currentTime to 0 inside PersistentPlayer; fire
    // the seek on the next macrotask so it doesn't get clobbered by
    // that reset. setTimeout(0) is enough — the player's onSet handler
    // is synchronous.
    setTimeout(() => {
      playerSeek(timeMs);
    }, 0);
    setCurrentMs(timeMs);
  }

  // Reply to a comment — pre-fills the composer with @author and
  // focuses it so the producer can just start typing. The `@author `
  // mention isn't parsed server-side yet, but it's a familiar
  // interaction and survives any future mention-renderer wiring.
  function handleReplyToComment(authorName: string) {
    if (commentsClosed) return;
    const input = draftRef.current;
    if (!input) return;
    const prefix = `@${authorName} `;
    if (!commentDraft.body.startsWith(prefix)) commentDraft.setBody(prefix);
    input.focus();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    input.scrollIntoView({
      block: "center",
      behavior: reduceMotion.matches ? "auto" : "smooth",
    });
  }

  // Play / Pause click — branches on the helper-derived action so the
  // toggle path doesn't reload the <audio> element when the producer is
  // already listening to this version.
  function handlePlayToggle() {
    if (!activeVersion) return;
    const state = playButtonState({
      activeVersionId: activeVersion.id,
      audioUrl: activeVersion.audioUrl,
      ...(activeVersion.audioDeletedAtIso === undefined
        ? {}
        : { audioDeletedAtIso: activeVersion.audioDeletedAtIso }),
      nowPlaying,
    });
    if (state.disabled) return;
    if (state.action === "toggle") {
      playerToggle();
      return;
    }
    playerPlay(activeVersionToPlayerTrack(playbackTrackData, activeVersion, role));
  }

  async function handleShareSongAddress() {
    if (!activeVersion || role === "guest" || sharingAddress) return;
    setSharingAddress(true);
    try {
      const url = canonicalSongPageAddress(role, activeVersion.id);
      const result = await shareNative({
        title: songTitle,
        text: `Listen to ${songTitle} on Skitza`,
        url,
        fallbackText: url,
      });
      if (result.status === "shared") toast("Song shared", "success");
      if (result.status === "copied") toast("Song link copied", "success");
      if (result.status === "unavailable") {
        toast("Could not share this song. Try again.", "error");
      }
    } catch {
      toast("Could not share this song. Try again.", "error");
    } finally {
      setSharingAddress(false);
    }
  }

  function handleVersionSelect(version: SongPageVersion) {
    commentDraft.preserveDraft();
    const thisSongIsLoaded =
      playbackSnapshot.track !== null &&
      versions.some((candidate) => candidate.id === playbackSnapshot.track?.id);
    if (thisSongIsLoaded && isSongPageVersionPlayable(version)) {
      const preservedMs = clampSeekMs(playbackSnapshot.currentMs, 0, version.durationMs);
      playerLoad(activeVersionToPlayerTrack(playbackTrackData, version, role), {
        currentMs: preservedMs,
        playing: playbackSnapshot.playing,
      });
      setCurrentMs(preservedMs);
    } else if (!thisSongIsLoaded) {
      setCurrentMs(0);
    }
    setActiveVersionId(version.id);
    setVersionMenuOpen(false);
  }

  function handleSkip(deltaMs: number) {
    if (!activeVersion || !isSongPageVersionPlayable(activeVersion)) return;
    const isLoaded = playbackSnapshot.track?.id === activeVersion.id;
    const sourceMs = isLoaded ? playbackSnapshot.currentMs : currentMs;
    const nextMs = clampSeekMs(sourceMs, deltaMs, activeVersion.durationMs);
    if (isLoaded) {
      playerSeek(nextMs);
    } else {
      playerLoad(activeVersionToPlayerTrack(playbackTrackData, activeVersion, role), {
        currentMs: nextMs,
        playing: false,
      });
    }
    setCurrentMs(nextMs);
  }

  function closeNotes() {
    commentDraft.preserveDraft();
    setNotesOpen(false);
  }

  function handleArtistApprove() {
    if (
      !activeVersion ||
      !actions.approveVersion ||
      activeVersionDeleted ||
      isPending ||
      activeVersion.producerMarkedFinalAtIso === null
    ) {
      return;
    }
    if (!online) {
      setError("Reconnect to approve this version. No change was saved.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await actions.approveVersion?.({ versionId: activeVersion.id });
        if (!result) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setArtistApprovalVersionOverride(activeVersion.id);
      } catch {
        setError("Couldn’t approve this version. Check your connection and try again.");
      }
    });
  }

  async function handleArtworkFile(file: File) {
    if (!actions.prepareArtwork || !actions.completeArtwork || artworkUploading) return;
    setArtworkUploading(true);
    setError(null);
    try {
      const prepared = await actions.prepareArtwork({
        trackId: data.track.id,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      const upload = await fetch(prepared.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) {
        setError("Couldn’t upload this cover. Try again.");
        return;
      }
      const objectEtag = upload.headers.get("etag");
      if (!objectEtag) {
        setError("The cover uploaded, but it could not be verified. Try again.");
        return;
      }
      const completed = await actions.completeArtwork({
        trackId: data.track.id,
        versionId: activeVersionId,
        uploadToken: prepared.data.uploadToken,
        objectEtag,
      });
      if (!completed.ok) {
        setError(completed.error);
        return;
      }
      setArtworkUrlOverride(completed.data.artworkUrl);
    } catch {
      setError("Couldn’t change this cover. Check your connection and try again.");
    } finally {
      setArtworkUploading(false);
      if (artworkInputRef.current) artworkInputRef.current.value = "";
    }
  }

  function openManagementDialog(kind: OpenSongManagement["kind"], versionId = activeVersion?.id) {
    if (!versionId) return;
    setOverflowOpen(false);
    setManagementDialog({ kind, versionId });
  }

  function openMoreActionsManagementDialog(kind: OpenSongManagement["kind"]) {
    openingManagementFromVersionRef.current = false;
    openingManagementFromSheetRef.current = !isDesktopMoreActions;
    openManagementDialog(kind);
  }

  function handleManagementSubmit(value: string): Promise<MusicL3ActionResult> {
    return runOnlineMusicManagement(online, () => handleOnlineManagementSubmit(value));
  }

  async function handleOnlineManagementSubmit(value: string): Promise<MusicL3ActionResult> {
    if (!managementDialog) {
      return { ok: false, error: "Choose an action and try again." };
    }
    const targetVersion = versions.find((version) => version.id === managementDialog.versionId);
    if (!targetVersion) {
      return { ok: false, error: "This version is no longer available." };
    }

    const common = {
      projectId: data.track.projectId,
      trackId: data.track.id,
      versionId: targetVersion.id,
    };

    if (managementDialog.kind === "approve-version") {
      if (!actions.approveVersion) {
        return { ok: false, error: "Artist approval is unavailable." };
      }
      const result = await actions.approveVersion({ versionId: targetVersion.id });
      if (result.ok) setArtistApprovalVersionOverride(targetVersion.id);
      return result;
    }

    if (managementDialog.kind === "reopen-approved-song") {
      if (!actions.reopenSong) return { ok: false, error: "Reopen is unavailable." };
      const approvedVersion = versions.find((version) => version.artistApprovedAtIso !== null);
      const result = await actions.reopenSong({
        trackId: data.track.id,
        versionId: targetVersion.id,
      });
      if (result.ok) {
        if (approvedVersion?.artistApprovedAtIso) {
          setPreviousApprovalOverrides((current) => ({
            ...current,
            [approvedVersion.id]: approvedVersion.artistApprovedAtIso as string,
          }));
        }
        setArtistApprovalVersionOverride(null);
        setProducerReadyOverrides(
          Object.fromEntries(versions.map((version) => [version.id, false])),
        );
      }
      return result;
    }

    if (managementDialog.kind === "rename-song") {
      if (!actions.renameSong) return { ok: false, error: "Rename is unavailable." };
      const result = await actions.renameSong({ ...common, title: value });
      if (result.ok) setSongTitleOverride(value);
      return result;
    }

    if (managementDialog.kind === "edit-artist") {
      if (!actions.editArtist) {
        return { ok: false, error: "Artist credit editing is unavailable." };
      }
      const artist = value.length > 0 ? value : null;
      const result = await actions.editArtist({ ...common, artist });
      if (result.ok) setArtistOverride(artist);
      return result;
    }

    if (managementDialog.kind === "set-archived") {
      if (!actions.setArchived) {
        return { ok: false, error: "Song archiving is unavailable." };
      }
      const archived = !songArchived;
      const result = await actions.setArchived({ ...common, archived });
      if (result.ok) setArchivedOverride(archived);
      return result;
    }

    if (managementDialog.kind === "mark-released") {
      if (!actions.markReleased) {
        return { ok: false, error: "Mark as Released is unavailable." };
      }
      const result = await actions.markReleased(common);
      if (result.ok) setReleasedOverride(true);
      return result;
    }

    if (managementDialog.kind === "rename-version") {
      if (!actions.renameVersion) {
        return { ok: false, error: "Version renaming is unavailable." };
      }
      const result = await actions.renameVersion({
        projectId: common.projectId,
        versionId: common.versionId,
        label: value,
      });
      if (result.ok) {
        setVersionLabelOverrides((current) => ({
          ...current,
          [targetVersion.id]: value,
        }));
      }
      return result;
    }

    if (managementDialog.kind === "download-override") {
      if (!actions.setDownloadOverride) {
        return { ok: false, error: "Early download control is unavailable." };
      }
      const enabled = targetVersion.delivery.permission !== "version_override";
      const result = await actions.setDownloadOverride({
        purchaseId: targetVersion.delivery.purchaseId,
        versionId: targetVersion.id,
        enabled,
        expectedUnpaidAmountCents: targetVersion.delivery.remainingCents,
      });
      if (result.ok) {
        setDeliveryPermissionOverrides((current) => ({
          ...current,
          [targetVersion.id]: enabled ? "version_override" : "payment_required",
        }));
      }
      return result;
    }

    if (managementDialog.kind === "delete-song") {
      if (!actions.deleteSong) return { ok: false, error: "Song deletion is unavailable." };
      const result = await actions.deleteSong({
        projectId: common.projectId,
        trackId: common.trackId,
      });
      if (result.ok) {
        if (versions.some((version) => version.id === nowPlaying.trackId)) playerClose();
        setSongDeletionRedirectHref(projectHref ?? "/dashboard/music");
      }
      return result;
    }

    if (managementDialog.kind === "delete-version") {
      if (!actions.deleteVersion) {
        return { ok: false, error: "Version deletion is unavailable." };
      }
      if (versions.length <= 1) {
        return { ok: false, error: "This is the only Version. Delete the Song instead." };
      }
      const result = await actions.deleteVersion({
        projectId: common.projectId,
        versionId: common.versionId,
      });
      if (!result.ok) return result;
      if (nowPlaying.trackId === targetVersion.id) playerClose();
      const remaining = versions.filter((version) => version.id !== targetVersion.id);
      setOptimisticallyDeletedVersionIds((current) =>
        current.includes(targetVersion.id) ? current : [...current, targetVersion.id],
      );
      const nextVersion = newestPlayableSongPageVersion(remaining) ?? remaining[0];
      if (nextVersion) {
        setActiveVersionId(nextVersion.id);
        setSongDeletionRedirectHref(
          `/dashboard/music/${encodeURIComponent(nextVersion.id)}${
            producerProjectHref ? `?from=${encodeURIComponent(data.track.projectId)}` : ""
          }`,
        );
      }
      return result;
    }

    if (!actions.deleteVersionAudio) {
      return { ok: false, error: "Audio deletion is unavailable." };
    }
    const policy = deleteVersionAudioPolicy({
      versions,
      version: targetVersion,
      isReleased: songReleased,
    });
    if (!policy.canDelete) {
      return { ok: false, error: policy.details[0] ?? "This audio is protected." };
    }

    const operationKey = crypto.randomUUID();
    const result = await actions.deleteVersionAudio({
      projectId: common.projectId,
      versionId: common.versionId,
      operationKey,
    });
    if (!result.ok) return result;

    if (policy.isStorageCleanupRetry) {
      // The committed tombstone is the durable source of truth. A retry only
      // reconciles its retained storage identity, so preserve the original
      // deletion time and history selection while closing any stale player.
      if (nowPlaying.trackId === targetVersion.id) playerClose();
      return result;
    }

    const deletedAt = new Date().toISOString();
    setOptimisticDeletedAtByVersion((current) => ({
      ...current,
      [targetVersion.id]: deletedAt,
    }));
    if (nowPlaying.trackId === targetVersion.id) playerClose();

    const remaining = versions.map((version) =>
      version.id === targetVersion.id
        ? { ...version, audioUrl: null, audioDeletedAtIso: deletedAt }
        : version,
    );
    const requestedFallback = result.nextPlaybackVersionId
      ? remaining.find(
          (version) =>
            version.id === result.nextPlaybackVersionId && isSongPageVersionPlayable(version),
        )
      : null;
    const fallback = requestedFallback ?? newestPlayableSongPageVersion(remaining);
    setActiveVersionId(fallback?.id ?? targetVersion.id);
    return result;
  }

  const managementVersion = managementDialog
    ? (versions.find((version) => version.id === managementDialog.versionId) ?? null)
    : null;
  const managementPolicy = managementVersion
    ? deleteVersionAudioPolicy({
        versions,
        version: managementVersion,
        isReleased: songReleased,
      })
    : null;
  let managementConfig: SongManagementDialogConfig | null = null;
  if (managementDialog && managementVersion) {
    switch (managementDialog.kind) {
      case "approve-version":
        managementConfig = {
          id: `approve-version:${managementVersion.id}`,
          title: `Approve ${managementVersion.label} as final?`,
          description: "Your approval applies only to this exact audio version.",
          confirmLabel: "Approve final version",
          pendingLabel: "Approving…",
          cancelLabel: "Not yet",
          details: [
            "The producer cannot approve on your behalf.",
            "Approval locks new version uploads for this song until the producer reopens it.",
            "For a 50/50 purchase, the final payment becomes due once every included song is approved.",
          ],
        };
        break;
      case "reopen-approved-song":
        managementConfig = {
          id: `reopen-approved-song:${managementVersion.id}`,
          title: "Reopen this approved song?",
          description: "Use this when more work or a corrected final version is needed.",
          confirmLabel: "Reopen song",
          pendingLabel: "Reopening…",
          cancelLabel: "Keep approved",
          strongWarning: true,
          details: [
            "The existing artist approval stays in the song history.",
            "The producer-ready marker is cleared and version uploads unlock.",
            "The corrected exact final version must be marked ready and approved again.",
            "Any final installment already triggered remains due.",
          ],
        };
        break;
      case "rename-song":
        managementConfig = {
          id: `rename-song:${managementVersion.id}`,
          title: "Rename song",
          description: "Change the song title everywhere it appears in Music.",
          confirmLabel: "Save song name",
          pendingLabel: "Saving…",
          field: {
            label: "Song name",
            initialValue: songTitle,
            placeholder: "Song name",
            maxLength: 120,
            emptyError: "Enter a song name.",
          },
        };
        break;
      case "edit-artist":
        managementConfig = {
          id: `edit-artist:${managementVersion.id}`,
          title: "Edit artist credit",
          description: "Update the artist credit, or leave it blank to remove it.",
          confirmLabel: "Save artist credit",
          pendingLabel: "Saving…",
          field: {
            label: "Artist credit",
            initialValue: songArtist ?? "",
            placeholder: "Artist name",
            maxLength: 120,
            allowEmpty: true,
          },
        };
        break;
      case "set-archived":
        managementConfig = songArchived
          ? {
              id: `restore-song:${managementVersion.id}`,
              title: "Restore song?",
              description: "Returns this song to active work.",
              confirmLabel: "Restore song",
              pendingLabel: "Restoring…",
              cancelLabel: "Keep archived",
              details: [
                "Listening, version history, and the public link stay as they are.",
                "New comments and version uploads can resume.",
              ],
            }
          : {
              id: `archive-song:${managementVersion.id}`,
              title: "Archive song?",
              description: "Pauses new work on this song without archiving its project.",
              confirmLabel: "Archive song",
              pendingLabel: "Archiving…",
              cancelLabel: "Keep active",
              details: [
                "The song stays listenable and keeps its history and public link.",
                "New comments and version uploads are blocked until you restore it.",
                "Other songs in this project are not archived.",
              ],
            };
        break;
      case "mark-released":
        managementConfig = {
          id: `mark-released:${managementVersion.id}`,
          title: "Mark song as Released?",
          description: "Released is separate from Done / Delivered and cannot be undone.",
          confirmLabel: "Mark as Released",
          pendingLabel: "Marking Released…",
          cancelLabel: "Not yet",
          strongWarning: true,
          details: [
            "Use this only after the song has been officially released.",
            "This status is separate from Done / Delivered.",
            "Marking Released does not change playback, Versions, comments, or stored audio.",
          ],
        };
        break;
      case "rename-version":
        managementConfig = {
          id: `rename-version:${managementVersion.id}`,
          title: "Rename version",
          description: managementVersion.audioDeletedAtIso
            ? "Only the lightweight version name changes. Its deleted-audio history stays intact."
            : "Give this audio version a clearer name.",
          confirmLabel: "Save version name",
          pendingLabel: "Saving…",
          field: {
            label: "Version name",
            initialValue: managementVersion.label,
            placeholder: "V1",
            maxLength: 40,
            emptyError: "Enter a version name.",
          },
        };
        break;
      case "download-override": {
        const delivery = presentVersionDelivery(managementVersion.delivery);
        const removeOverride = managementVersion.delivery.permission === "version_override";
        managementConfig = {
          id: `download-override:${managementVersion.id}:${removeOverride ? "disable" : "enable"}`,
          title: removeOverride
            ? `Remove early download from ${managementVersion.label}?`
            : `Allow ${managementVersion.label} download now?`,
          description: removeOverride
            ? "This removes early access from this exact version only."
            : "This unlocks only the selected audio version before full payment.",
          confirmLabel: removeOverride ? "Remove early access" : "Allow download now",
          pendingLabel: removeOverride ? "Removing…" : "Allowing…",
          cancelLabel: "Keep current access",
          strongWarning: !removeOverride,
          blockedReason:
            delivery.key === "deleted"
              ? "Deleted audio cannot be made downloadable."
              : managementVersion.delivery.fullyPaid
                ? "This purchase is fully paid and no longer needs an early override."
                : null,
          details: [
            managementVersion.delivery.remainingCents > 0
              ? `${formatMoney(managementVersion.delivery.remainingCents, managementVersion.delivery.currency, { withCents: true })} remains owed on this purchase.`
              : "No cash balance remains, but waived amounts do not count as full payment for downloads.",
            `Only ${managementVersion.label} changes. Every other version keeps its own access state.`,
            "The debt, payment schedule, and payment history stay visible.",
            "Stems and other Google Drive deliverables stay locked until full payment.",
          ],
        };
        break;
      }
      case "delete-version":
        managementConfig = {
          id: `delete-version:${managementVersion.id}`,
          title: `Delete ${managementVersion.label}?`,
          description:
            "This permanently removes this Version, its audio, notes, approval, downloads, notifications, and public history.",
          confirmLabel: "Delete Version",
          pendingLabel: "Deleting Version…",
          cancelLabel: "Keep Version",
          destructive: true,
          strongWarning: true,
          blockedReason:
            versions.length <= 1 ? "This is the only Version. Delete the Song instead." : null,
          details: [
            "This cannot be undone.",
            managementVersion.artistApprovedAtIso
              ? "The artist-approved Version will be permanently removed."
              : managementVersion.producerMarkedFinalAtIso
                ? "The producer-final Version will be permanently removed."
                : "The selected Version will be permanently removed.",
            "The Song, Project, purchase, payments, and bookings stay.",
          ],
        };
        break;
      case "delete-song":
        managementConfig = {
          id: `delete-song:${data.track.id}`,
          title: `Delete ${songTitle}?`,
          description:
            "This permanently removes the Song and every Version and audio file in its history.",
          confirmLabel: "Delete Song",
          pendingLabel: "Deleting Song…",
          cancelLabel: "Keep Song",
          destructive: true,
          strongWarning: true,
          details: [
            `All ${String(versions.length)} Version${versions.length === 1 ? "" : "s"}, notes, approvals, downloads, notifications, and public history will be removed.`,
            "Portfolio entries using this Song will be removed.",
            "The Project, client, purchase, payments, agreement, and bookings stay.",
            "This cannot be undone.",
          ],
        };
        break;
      case "delete-version-audio":
        if (managementPolicy) {
          managementConfig = managementPolicy.isStorageCleanupRetry
            ? {
                id: `retry-storage-cleanup:${managementVersion.id}`,
                title: `Retry storage cleanup for ${managementVersion.label}?`,
                description:
                  "The version is already deleted in Skitza. This safely retries removal of its exact stored audio object.",
                confirmLabel: "Retry storage cleanup",
                pendingLabel: "Retrying cleanup…",
                cancelLabel: "Not now",
                destructive: true,
                details: managementPolicy.details,
              }
            : {
                id: `delete-version-audio:${managementVersion.id}`,
                title: `Permanently delete ${managementVersion.label} audio?`,
                description: managementPolicy.canDelete
                  ? managementPolicy.strongWarning
                    ? "Review every consequence before removing this protected stored audio."
                    : "The audio file is removed from storage, playback, downloads, and public switching."
                  : "This audio cannot be removed with this legacy audio-only cleanup action.",
                confirmLabel: "Permanently delete audio",
                pendingLabel: "Deleting audio…",
                cancelLabel: "Keep audio",
                destructive: true,
                strongWarning: managementPolicy.strongWarning,
                blockedReason: managementPolicy.canDelete
                  ? null
                  : "Use Delete Version or Delete Song if you need to permanently remove it.",
                details: managementPolicy.details,
              };
        }
        break;
    }
  }

  // Topbar crumbs: Music › <client>? › <project> › <song>. Client is
  // plain text here — the Music section doesn't fetch the contact id,
  // so we can't link to /dashboard/clients-projects/clients/<id> yet.
  // The clients-projects song page DOES link; if/when we add contact
  // resolution to the Music wire, this can match that pattern.
  //
  // SK-32: project crumb href is role-aware. Producer L2 lives at
  // /dashboard/music/project/<id>; artist L2 lives at /artist/music/
  // <id> (different route shape, not just prefix). Same role switch
  // the tracklist row href already uses in project-page.tsx.
  const clientCrumb = data.track.clientName ? [{ label: data.track.clientName }] : [];
  const projectHref =
    role === "guest"
      ? undefined
      : role === "artist"
        ? withArtistStudio(`/artist/music/${data.track.projectId}`, artistStudioId)
        : (producerProjectHref ?? `/dashboard/music/project/${data.track.projectId}`);
  const topbarCrumbs = [
    ...clientCrumb,
    {
      label: data.track.projectTitle,
      ...(projectHref ? { href: projectHref } : {}),
    },
    { label: songTitle },
  ];

  if (!activeVersion) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-12 sm:px-6">
        {role !== "guest" ? <SetTopBarBreadcrumb crumbs={topbarCrumbs} /> : null}
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          This track has no versions yet.
        </p>
      </main>
    );
  }

  const renderedVersion = activeVersion;
  const isProducerReady = activeVersion.producerMarkedFinalAtIso !== null;
  const isExactArtistApproved = activeVersion.artistApprovedAtIso !== null;
  const wasPreviouslyArtistApproved = activeVersion.previouslyArtistApprovedAtIso !== null;
  const activeDelivery = presentVersionDelivery(activeVersion.delivery);
  const playState = playButtonState({
    activeVersionId: activeVersion.id,
    audioUrl: activeVersion.audioUrl,
    ...(activeVersion.audioDeletedAtIso === undefined
      ? {}
      : { audioDeletedAtIso: activeVersion.audioDeletedAtIso }),
    nowPlaying,
  });
  const isPlayingThis = playState.action === "toggle" && playState.label === "Pause";
  const canUseDownloadAction =
    activeVersionPlayable &&
    (role === "producer" ||
      (role === "guest" ? Boolean(activeVersion.downloadUrl) : activeDelivery.canDownload));
  const downloadHref =
    role === "producer"
      ? `/api/download/${activeVersion.id}`
      : role === "guest"
        ? (activeVersion.downloadUrl ?? "")
        : `/api/audio/download/${activeVersion.delivery.purchaseId}/${activeVersion.id}`;
  const moreActionsPanelProps = {
    role,
    actions,
    canUseDownloadAction,
    downloadHref,
    activeVersionDeleted,
    activeVersionPlayable,
    activeDeliveryBadge: activeDelivery.badge,
    songArchived,
    songReleased,
    artistApprovalLocked,
    artworkUploading,
    onChangeCover: () => {
      artworkInputRef.current?.click();
    },
    publicSharingControl:
      role === "producer" && publicSharing ? (
        <SongPublicLinkControls
          role="producer"
          initialState={publicSharing}
          shareTitle={songTitle}
          triggerStyle="menu"
          portfolioOnly
          {...(publicSharingActions ? { actions: publicSharingActions } : {})}
        />
      ) : null,
    onDismiss: () => {
      setOverflowOpen(false);
    },
    onOpenManagement: openMoreActionsManagementDialog,
  } satisfies Omit<SongMoreActionsPanelProps, "className" | "testId">;

  const effectiveDurationMs =
    activeVersion.durationMs ??
    (playbackSnapshot.track?.id === activeVersion.id && playbackSnapshot.audioDurationSec !== null
      ? Math.round(playbackSnapshot.audioDurationSec * 1000)
      : null);
  const displayedCurrentMs =
    playbackSnapshot.track?.id === activeVersion.id ? playbackSnapshot.currentMs : currentMs;
  function renderArtwork(className: string, compact = false) {
    return (
      <div
        data-test={artworkUrl ? "song-artwork" : "song-artwork-fallback"}
        className={[
          "relative shrink-0 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] shadow-[var(--shadow-md)]",
          className,
        ].join(" ")}
      >
        {artworkUrl ? (
          // Private, same-origin artwork is intentionally served without the
          // Next image optimizer so its authenticated response is never shared.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artworkUrl} alt={`${songTitle} cover`} className="h-full w-full object-cover" />
        ) : (
          <ProjectCover
            seed={data.track.projectId}
            gradient={gradientForSeed(data.track.projectId)}
            kind={null}
            showKind={false}
            wordmark={!compact}
            radius="inherit"
            shadow="none"
            className="h-full w-full"
          />
        )}
      </div>
    );
  }

  function renderVersionOptions() {
    return (
      <div className="divide-y divide-[rgb(var(--border-subtle))]">
        {versions.map((version) => {
          const selected = version.id === renderedVersion.id;
          const delivery = presentVersionDelivery(version.delivery);
          const state =
            role === "guest"
              ? version.artistApprovedAtIso
                ? "Approved"
                : version.producerMarkedFinalAtIso
                  ? "Ready"
                  : "Available"
              : version.audioDeletedAtIso !== null
                ? "Audio deleted"
                : version.artistApprovedAtIso
                  ? "Artist approved"
                  : version.producerMarkedFinalAtIso
                    ? "Ready"
                    : version.previouslyArtistApprovedAtIso
                      ? "Previously approved"
                      : delivery.badge;
          return (
            <div
              key={version.id}
              className={[
                "flex min-h-14 w-full items-stretch transition-colors",
                selected
                  ? "bg-[rgb(var(--brand-primary)/0.1)]"
                  : "hover:bg-[rgb(var(--fg-default)/0.04)]",
              ].join(" ")}
            >
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => {
                  handleVersionSelect(version);
                }}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px] font-bold text-[rgb(var(--fg-default))]">
                    {version.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[rgb(var(--fg-muted))]">
                    {fmtRelativeIso(version.uploadedAtIso)} ·{" "}
                    {version.durationMs ? fmtMs(version.durationMs) : "Duration pending"}
                  </span>
                </span>
                <span
                  className={[
                    "shrink-0 text-[11px] font-semibold",
                    version.artistApprovedAtIso
                      ? "text-[rgb(var(--fg-success-text))]"
                      : selected
                        ? "text-[rgb(var(--brand-primary-dark))]"
                        : "text-[rgb(var(--fg-muted))]",
                  ].join(" ")}
                >
                  {selected ? "Selected" : state}
                </span>
              </button>
              {role === "producer" && (actions.deleteVersion || actions.deleteSong) ? (
                <button
                  type="button"
                  aria-label={`More actions for ${version.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setVersionMenuOpen(false);
                    openingManagementFromVersionRef.current = true;
                    openManagementDialog(
                      versions.length === 1 ? "delete-song" : "delete-version",
                      version.id,
                    );
                  }}
                  className="sk-press inline-flex min-h-11 w-11 shrink-0 items-center justify-center self-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--fg-default)/0.07)] hover:text-[rgb(var(--fg-default))]"
                >
                  <MoreIcon />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderVersionControl() {
    return (
      <div ref={versionRef} className="relative">
        <button
          ref={versionButtonRef}
          type="button"
          aria-label={`Choose version. ${renderedVersion.label} selected`}
          aria-expanded={versionMenuOpen}
          aria-controls={versionMenuOpen ? versionPanelId : undefined}
          onClick={() => {
            setVersionMenuOpen((open) => !open);
          }}
          className="sk-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 font-mono text-[11px] font-bold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))] lg:min-h-10 lg:rounded-[var(--radius-md)]"
        >
          <span>{renderedVersion.label}</span>
          <ChevronDownIcon />
        </button>
        {versionMenuOpen && isDesktopMoreActions ? (
          <div
            id={versionPanelId}
            role="group"
            aria-label="Version history"
            className="sk-pop absolute top-[calc(100%+8px)] left-0 z-40 max-h-[min(62dvh,480px)] w-[330px] overflow-y-auto rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 text-[rgb(var(--fg-default))] shadow-[var(--shadow-lg)]"
          >
            {renderVersionOptions()}
          </div>
        ) : null}
        <Sheet
          open={versionMenuOpen && !isDesktopMoreActions}
          onOpenChange={(open) => {
            setVersionMenuOpen(open);
          }}
        >
          <SheetContent
            id={versionPanelId}
            side="bottom"
            className="max-h-[78dvh] gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] sm:p-0"
          >
            <div className="border-b border-[rgb(var(--border-subtle))] px-4 pt-2 pb-3">
              <SheetTitle>Version history</SheetTitle>
              <SheetDescription>Choose the audio version to review.</SheetDescription>
            </div>
            <div className="overflow-y-auto p-2">{renderVersionOptions()}</div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  function renderWorkflowControl() {
    if (role === "guest") {
      return (
        <span className="inline-flex min-h-11 items-center text-[12px] font-semibold text-[rgb(var(--fg-muted))]">
          {isExactArtistApproved
            ? "Approved"
            : isProducerReady
              ? "Ready for artist"
              : "Waiting for producer"}
        </span>
      );
    }
    if (role === "producer" && artistApprovalLocked) {
      return (
        <span
          data-test="artist-approved-status"
          role="status"
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success-text)/0.24)] bg-[rgb(var(--fg-success-text)/0.1)] px-4 text-[12px] font-bold text-[rgb(var(--fg-success-text))]"
        >
          <CheckIcon /> Artist approved
        </span>
      );
    }
    if (role === "producer") {
      return (
        <button
          type="button"
          data-test="mark-version-ready"
          onClick={handleProducerReadyToggle}
          disabled={isPending || !actions.markVersionReady || activeVersionDeleted}
          title={isProducerReady ? "Remove ready status" : "Mark exact version ready"}
          aria-label={isProducerReady ? "Remove ready status" : "Mark exact version ready"}
          className={[
            "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border px-4 text-[12px] font-bold transition-colors disabled:opacity-50",
            isProducerReady
              ? "border-[rgb(var(--brand-primary)/0.45)] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))]"
              : "border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))]",
          ].join(" ")}
        >
          <CheckIcon /> {isProducerReady ? "Ready for artist" : "Mark ready"}
        </button>
      );
    }
    if (isExactArtistApproved) {
      return (
        <span
          data-test="artist-approved-status"
          role="status"
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success-text)/0.24)] bg-[rgb(var(--fg-success-text)/0.1)] px-4 text-[12px] font-bold text-[rgb(var(--fg-success-text))]"
        >
          <CheckIcon /> Approved
        </span>
      );
    }
    if (isProducerReady && !artistApprovalLocked) {
      return (
        <button
          type="button"
          data-test="approve-final-version"
          onClick={handleArtistApprove}
          disabled={isPending || !actions.approveVersion || activeVersionDeleted}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[12px] font-bold text-[rgb(var(--fg-primary))] transition-colors hover:bg-[rgb(var(--brand-primary-hover))] disabled:opacity-50"
        >
          <CheckIcon /> Approve this version
        </button>
      );
    }
    return (
      <span className="inline-flex min-h-11 items-center text-[12px] font-semibold text-[rgb(var(--fg-muted))]">
        Waiting for producer
      </span>
    );
  }

  function renderVersionUploadControl() {
    if (role !== "producer" || !versionUpload) return null;
    return (
      <button
        type="button"
        data-test="upload-new-version"
        aria-label={`Upload new Version for ${songTitle}`}
        onClick={() => {
          setVersionUploadOpen(true);
        }}
        className="sk-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[12px] font-bold text-[rgb(var(--bg-background))] transition-colors hover:bg-[rgb(var(--fg-default)/0.88)]"
      >
        <PlusIcon /> Upload new Version
      </button>
    );
  }

  function renderMoreControl() {
    if (role === "artist" || (role === "guest" && !canUseDownloadAction)) return null;
    return (
      <div ref={overflowRef} className="relative">
        <button
          ref={moreButtonRef}
          type="button"
          aria-label="More actions"
          aria-haspopup={isDesktopMoreActions ? undefined : "dialog"}
          aria-expanded={overflowOpen}
          aria-controls={overflowOpen ? moreActionsPanelId : undefined}
          onClick={() => {
            setOverflowOpen((open) => !open);
          }}
          className={[
            "sk-press inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors",
            "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[var(--shadow-sm)] hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]",
          ].join(" ")}
        >
          <MoreIcon />
        </button>
        {overflowOpen && isDesktopMoreActions ? (
          <SongMoreActionsPanel
            {...moreActionsPanelProps}
            id={moreActionsPanelId}
            testId="song-more-actions-popover"
            className="sk-pop absolute top-[calc(100%+8px)] right-0 z-50 max-h-[min(72dvh,560px)] w-72 origin-top-right overflow-y-auto rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 text-[rgb(var(--fg-default))] shadow-[var(--shadow-lg)]"
          />
        ) : null}
        <Sheet
          open={overflowOpen && !isDesktopMoreActions}
          onOpenChange={(open) => {
            if (!open) setOverflowOpen(false);
          }}
        >
          <SheetContent
            id={moreActionsPanelId}
            side="bottom"
            data-testid="song-more-actions-sheet"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (openingManagementFromSheetRef.current) {
                openingManagementFromSheetRef.current = false;
                return;
              }
              moreButtonRef.current?.focus();
            }}
            className="max-h-[88dvh] w-full gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] sm:p-0"
          >
            <SheetTitle className="sr-only">Song actions</SheetTitle>
            <SheetDescription className="sr-only">
              Share, download, or manage this song.
            </SheetDescription>
            <SongMoreActionsPanel
              {...moreActionsPanelProps}
              testId="song-more-actions-sheet-panel"
              className="overflow-y-auto p-2 pt-3 text-[rgb(var(--fg-default))]"
            />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  function renderShareControl() {
    if (role === "guest") return null;
    return (
      <button
        type="button"
        aria-label="Share song"
        aria-busy={sharingAddress}
        data-test="share-song-address"
        disabled={sharingAddress}
        onClick={() => {
          void handleShareSongAddress();
        }}
        className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[var(--shadow-sm)] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))] disabled:opacity-50"
      >
        <ShareIcon />
      </button>
    );
  }

  function renderNotesPanel(surface: "desktop" | "sheet") {
    const desktop = surface === "desktop";
    return (
      <Card
        className={[
          "flex min-h-0 flex-1 flex-col bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]",
          desktop ? "rounded-[var(--radius-lg)]" : "rounded-none border-0 shadow-none",
        ].join(" ")}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[rgb(var(--border-subtle))] px-5 py-4">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-[18px] font-bold tracking-[-0.02em]">Notes</h2>
            <span className="font-mono text-[10px] font-bold text-[rgb(var(--fg-muted))] tabular-nums">
              {String(visibleComments.length)}
              {visibleComments.length !== allCommentsForVersion.length
                ? ` of ${String(allCommentsForVersion.length)}`
                : ""}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {hasResolvedComments ? (
              <button
                type="button"
                onClick={() => {
                  setShowResolved((shown) => !shown);
                }}
                className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 text-[11px] font-bold text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] lg:min-h-9 lg:rounded-[var(--radius-md)]"
              >
                {showResolved ? "Hide resolved" : "Show resolved"}
              </button>
            ) : null}
            {!desktop ? (
              <button
                type="button"
                aria-label="Close Notes"
                onClick={closeNotes}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--fg-default)/0.05)]"
              >
                <ChevronDownIcon />
              </button>
            ) : null}
          </div>
        </div>

        {surface === "sheet" ? (
          <div className="flex shrink-0 items-center gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-3">
            {renderArtwork("h-12 w-12 rounded-[8px]!", true)}
            <button
              type="button"
              onClick={handlePlayToggle}
              disabled={playState.disabled}
              aria-label={playState.label}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-default))] text-white disabled:opacity-45"
            >
              {isPlayingThis ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold">{songTitle}</p>
              <p className="truncate font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                {fmtMs(displayedCurrentMs)} /{" "}
                {effectiveDurationMs ? fmtMs(effectiveDurationMs) : "—"}
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mx-4 mt-3 shrink-0 rounded-[10px] border border-[rgb(var(--fg-danger)/0.28)] bg-[rgb(var(--fg-danger)/0.07)] px-3 py-2 text-[12px] text-[rgb(var(--fg-danger))]"
          >
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {visibleComments.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center text-center">
              <p className="max-w-[28ch] text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
                {commentsClosed
                  ? songArchived
                    ? "No notes were added before this song was archived."
                    : "No notes were added before this project was archived."
                  : "No notes yet. Add one at the current time."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[rgb(var(--border-subtle))]">
              {visibleComments.map((c) => {
                const override = resolvedOverrides[c.id];
                const resolved = override !== undefined ? override : c.resolvedAtIso !== null;
                return (
                  <li
                    key={c.id}
                    id={`song-note-${c.id}`}
                    data-song-comment={c.id}
                    className={["py-4", resolved ? "text-[rgb(var(--fg-muted))]" : ""].join(" ")}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={[
                          "mt-1 h-2 w-2 shrink-0 rounded-full",
                          resolved
                            ? "bg-[rgb(var(--fg-muted)/0.5)]"
                            : "bg-[rgb(var(--brand-primary))]",
                        ].join(" ")}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[13px] font-bold">{c.authorName}</span>
                          <button
                            type="button"
                            data-test="comment-timestamp"
                            onClick={() => {
                              handleJumpToComment(c.timeMs);
                            }}
                            aria-label={`Jump to ${fmtMs(c.timeMs)}`}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center font-mono text-[10px] font-bold text-[rgb(var(--brand-primary-dark))] tabular-nums lg:min-h-8 lg:min-w-0"
                          >
                            {fmtMs(c.timeMs)}
                          </button>
                          <span className="font-mono text-[9px] text-[rgb(var(--fg-faint))]">
                            {fmtRelativeIso(c.createdAtIso)}
                          </span>
                        </div>
                        <p
                          className={[
                            "mt-0.5 text-[13.5px] leading-[1.5]",
                            resolved ? "text-[rgb(var(--fg-muted))]" : "",
                          ].join(" ")}
                        >
                          {c.body}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-3 text-[10px] font-bold text-[rgb(var(--fg-muted))]">
                          <button
                            type="button"
                            data-test="comment-jump"
                            onClick={() => {
                              handleJumpToComment(c.timeMs);
                            }}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-[rgb(var(--fg-default))] lg:min-h-8 lg:min-w-0"
                          >
                            Jump
                          </button>
                          {!commentsClosed ? (
                            <button
                              type="button"
                              data-test="comment-reply"
                              onClick={() => {
                                handleReplyToComment(c.authorName);
                              }}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-[rgb(var(--fg-default))] lg:min-h-8 lg:min-w-0"
                            >
                              Reply
                            </button>
                          ) : null}
                          <button
                            type="button"
                            data-test="comment-resolve"
                            disabled={isPending}
                            onClick={() => {
                              handleResolveToggle(c);
                            }}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-[rgb(var(--fg-default))] disabled:opacity-50 lg:min-h-8 lg:min-w-0"
                          >
                            {resolved ? "Reopen" : "Resolve"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
          {commentsClosed ? (
            <p role="status" className="text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
              {songArchived
                ? "This song is archived. Restore it to add notes."
                : "This project is archived. New comments are closed."}
            </p>
          ) : (
            <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-sunken))] p-1 focus-within:border-[rgb(var(--brand-primary))]">
              <span className="shrink-0 px-2 font-mono text-[10px] font-bold text-[rgb(var(--brand-primary-dark))] tabular-nums">
                {fmtMs(displayedCurrentMs)}
              </span>
              <input
                ref={draftRef}
                type="text"
                data-test="comment-input"
                maxLength={2000}
                disabled={isPending}
                placeholder="Add a note at this time…"
                className="min-h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[rgb(var(--fg-muted))]"
                value={commentDraft.body}
                onChange={(event) => {
                  commentDraft.setBodyFromUser(event.currentTarget.value);
                }}
                onFocus={handleComposerFocus}
                onBlur={handleComposerBlur}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddComment();
                  }
                }}
              />
              <button
                type="button"
                data-test="comment-post"
                onClick={handleAddComment}
                disabled={isPending}
                aria-disabled={!online}
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[11px] font-bold text-white disabled:opacity-50"
              >
                {online ? "Post" : "Offline"}
              </button>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <>
      {songDeletionRedirectHref ? <SongDeletionRedirect href={songDeletionRedirectHref} /> : null}
      <main
        data-test="professional-song-page"
        className="sk-page-enter relative isolate min-h-full overflow-x-clip bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]"
      >
        {role !== "guest" ? <SetTopBarBreadcrumb crumbs={topbarCrumbs} /> : null}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[320px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.09)] via-[rgb(var(--bg-background)/0.72)] to-[rgb(var(--bg-background))]"
        />

        {role === "producer" && actions.prepareArtwork && actions.completeArtwork ? (
          <input
            ref={artworkInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Choose song cover"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleArtworkFile(file);
            }}
          />
        ) : null}

        <div
          className={[
            "relative z-10 mx-auto w-full max-w-[1120px] px-4 py-4 sm:px-6 sm:py-6 lg:py-8 lg:pb-10",
            role === "producer" ? "pb-24" : "",
          ].join(" ")}
        >
          <header className="mb-4">
            <Card className="relative grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 p-4 sm:grid-cols-[108px_minmax(0,1fr)] sm:gap-x-5 sm:p-5 lg:grid-cols-[120px_minmax(0,1fr)]">
              {renderArtwork(
                "h-[88px] w-[88px] sm:h-[108px] sm:w-[108px] lg:h-[120px] lg:w-[120px]",
              )}
              <div className="min-w-0 pt-0.5">
                {projectHref ? (
                  <Link
                    href={projectHref}
                    aria-label={"Open " + data.track.projectTitle + " project"}
                    className="inline-flex min-h-11 max-w-[calc(100%-6rem)] items-center text-[11.5px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-default))]"
                  >
                    <span className="truncate">{data.track.projectTitle}</span>
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 max-w-[calc(100%-6rem)] items-center text-[11.5px] font-semibold text-[rgb(var(--fg-muted))]">
                    <span className="truncate">{data.track.projectTitle}</span>
                  </span>
                )}
                <h1 className="font-display mt-1 line-clamp-2 text-[26px] leading-[1.02] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-[30px] lg:text-[34px]">
                  {songTitle}
                </h1>
                {(songArtist ?? clientLabel) ? (
                  <p className="mt-1.5 truncate text-[13px] font-medium text-[rgb(var(--fg-muted))]">
                    {songArtist ?? clientLabel}
                  </p>
                ) : null}
              </div>
              <div className="absolute top-4 right-4 flex items-center gap-2 sm:top-5 sm:right-5">
                {renderShareControl()}
                {renderMoreControl()}
              </div>

              <div className="col-span-2 mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[rgb(var(--fg-muted))] lg:col-span-1 lg:col-start-2 lg:mt-2">
                <span className="font-mono tabular-nums">
                  {effectiveDurationMs ? fmtMs(effectiveDurationMs) : "Duration pending"}
                </span>
                <span aria-hidden>·</span>
                <span>
                  Uploaded{" "}
                  <span className="font-mono">{fmtRelativeIso(activeVersion.uploadedAtIso)}</span>
                </span>
                {songReleased ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>Released</span>
                  </>
                ) : null}
                {songArchived || projectArchivedLabel ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{songArchived ? "Song archived" : projectArchivedLabel}</span>
                  </>
                ) : null}
                {activeVersionDeleted ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>Audio deleted</span>
                  </>
                ) : null}
                {wasPreviouslyArtistApproved && !isExactArtistApproved ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>Previously approved</span>
                  </>
                ) : null}
              </div>
              <div className="col-span-2 mt-4 flex flex-wrap items-center gap-2 lg:col-span-1 lg:col-start-2 lg:mt-3">
                {renderVersionControl()}
                {renderVersionUploadControl()}
                {renderWorkflowControl()}
              </div>
            </Card>
          </header>

          {error && !notesOpen ? (
            <p
              role="alert"
              className="mb-4 rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.28)] bg-[rgb(var(--fg-danger)/0.07)] px-3 py-2 text-[12px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}

          <div
            className={[
              "grid gap-4",
              role === "guest" || embedded
                ? ""
                : "lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)] lg:items-stretch",
            ].join(" ")}
          >
            <section className="flex min-w-0 flex-col gap-4">
              <div className="rounded-[var(--radius-xl)] border border-[rgb(var(--fg-onsidebar)/0.1)] bg-[rgb(var(--bg-sidebar))] px-4 py-5 text-[rgb(var(--fg-onsidebar))] shadow-[var(--shadow-md)] [--fg-muted:200_192_178] sm:px-5 lg:px-6 lg:py-6">
                {activeVersionDeleted ? (
                  <div
                    role="status"
                    className="flex min-h-[184px] flex-col items-center justify-center border-y border-[rgb(var(--fg-onsidebar)/0.1)] text-center"
                  >
                    <p className="text-[13px] font-bold text-[rgb(var(--fg-onsidebar)/0.74)]">
                      Audio deleted
                    </p>
                    <p className="mt-1 text-[11px] text-[rgb(var(--fg-onsidebar)/0.5)]">
                      The version details and notes remain available.
                    </p>
                  </div>
                ) : (
                  <>
                    <Waveform50
                      appearance="studio"
                      density={embedded ? 96 : { mobile: 96, desktop: 200 }}
                      durationMs={effectiveDurationMs ?? 240_000}
                      comments={role === "guest" ? [] : waveformComments}
                      seed={activeVersion.id}
                      initialMs={displayedCurrentMs}
                      initialPeaks={activeVersion.peaks}
                      peaksUrl={
                        activeVersionPlayable ? (activeVersion.audioUrl ?? undefined) : undefined
                      }
                      onProgress={setCurrentMs}
                      onSeek={(ms) => {
                        setCurrentMs(ms);
                        if (
                          playbackSnapshot.track?.id !== activeVersion.id &&
                          isSongPageVersionPlayable(activeVersion)
                        ) {
                          playerLoad(
                            activeVersionToPlayerTrack(playbackTrackData, activeVersion, role),
                            {
                              currentMs: ms,
                              playing: false,
                            },
                          );
                        }
                      }}
                      {...(role === "guest"
                        ? {}
                        : {
                            onCommentSelect: (comment: WaveformComment) => {
                              handleJumpToComment(comment.timeMs);
                              if (!isDesktopMoreActions) setNotesOpen(true);
                              window.setTimeout(() => {
                                document
                                  .getElementById("song-note-" + comment.id)
                                  ?.scrollIntoView({ block: "center" });
                              }, 0);
                            },
                          })}
                      height={isDesktopMoreActions ? 142 : 104}
                    />
                  </>
                )}

                <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center">
                  <span aria-hidden />
                  <div className="flex items-center justify-center gap-4 sm:gap-6">
                    <button
                      type="button"
                      aria-label="Back 15 seconds"
                      onClick={() => {
                        handleSkip(-15_000);
                      }}
                      disabled={!activeVersionPlayable}
                      className="sk-press inline-flex h-12 w-12 flex-col items-center justify-center rounded-full text-[rgb(var(--fg-onsidebar)/0.72)] transition-colors hover:bg-[rgb(var(--fg-onsidebar)/0.07)] hover:text-[rgb(var(--fg-onsidebar))] disabled:opacity-35"
                    >
                      <SkipBackIcon />
                      <span className="mt-0.5 font-mono text-[10px]">15</span>
                    </button>
                    <button
                      type="button"
                      data-test="waveform-play-button"
                      onClick={handlePlayToggle}
                      disabled={playState.disabled}
                      aria-label={playState.label}
                      className="sk-press inline-flex h-[60px] w-[60px] items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))] shadow-[0_8px_24px_rgb(var(--brand-primary)/0.22)] transition-colors hover:bg-[rgb(var(--brand-primary-hover))] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isPlayingThis ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                    </button>
                    <button
                      type="button"
                      aria-label="Forward 15 seconds"
                      onClick={() => {
                        handleSkip(15_000);
                      }}
                      disabled={!activeVersionPlayable}
                      className="sk-press inline-flex h-12 w-12 flex-col items-center justify-center rounded-full text-[rgb(var(--fg-onsidebar)/0.72)] transition-colors hover:bg-[rgb(var(--fg-onsidebar)/0.07)] hover:text-[rgb(var(--fg-onsidebar))] disabled:opacity-35"
                    >
                      <SkipForwardIcon />
                      <span className="mt-0.5 font-mono text-[10px]">15</span>
                    </button>
                  </div>

                  <div className="hidden items-center justify-end gap-3 text-[rgb(var(--fg-onsidebar)/0.58)] xl:flex">
                    <VolumeIcon />
                    <label className="sr-only" htmlFor="song-player-volume">
                      Player volume
                    </label>
                    <input
                      id="song-player-volume"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={playbackSnapshot.volume}
                      onChange={(event) => {
                        playerSetVolume(Number(event.currentTarget.value));
                      }}
                      className="h-11 w-28 accent-[rgb(var(--brand-primary))]"
                    />
                  </div>
                </div>
              </div>

              {role !== "guest" && embedded ? (
                <div className="flex min-h-[320px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))]">
                  {renderNotesPanel("desktop")}
                </div>
              ) : null}

              {role !== "guest" && !embedded ? (
                <div className="lg:hidden">
                  <button
                    type="button"
                    aria-label={"Open Notes, " + String(allCommentsForVersion.length) + " notes"}
                    onClick={() => {
                      setNotesOpen(true);
                    }}
                    className="sk-press flex min-h-14 w-full items-center justify-between rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[13px] font-bold text-[rgb(var(--fg-default))] shadow-[var(--shadow-sm)] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
                  >
                    <span>Notes</span>
                    <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2 py-1 font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                      {String(allCommentsForVersion.length)}
                    </span>
                  </button>
                </div>
              ) : null}

              {role !== "guest" ? (
                <div>
                  <VersionDeliveryPanel
                    role={role}
                    artistStudioId={artistStudioId}
                    version={activeVersion}
                    delivery={activeDelivery}
                    downloadHref={downloadHref}
                    canUseDownloadAction={canUseDownloadAction}
                    canManageOverride={Boolean(actions.setDownloadOverride)}
                    overrideButtonRef={deliveryOverrideButtonRef}
                    onManageOverride={() => {
                      openManagementDialog("download-override");
                    }}
                  />
                </div>
              ) : null}
            </section>

            {role !== "guest" && isDesktopMoreActions ? (
              <aside className="flex min-h-[420px]" aria-label="Song notes">
                {renderNotesPanel("desktop")}
              </aside>
            ) : null}
          </div>
        </div>

        {role !== "guest" ? (
          <Sheet
            open={notesOpen && !isDesktopMoreActions && !embedded}
            onOpenChange={(open) => {
              if (!open) closeNotes();
            }}
          >
            <SheetContent
              side="bottom"
              aria-describedby="song-notes-description"
              onPointerDown={(event) => {
                const top = event.currentTarget.getBoundingClientRect().top;
                notesDragStartYRef.current = event.clientY - top <= 84 ? event.clientY : null;
              }}
              onPointerUp={(event) => {
                const start = notesDragStartYRef.current;
                notesDragStartYRef.current = null;
                if (start !== null && event.clientY - start > 80) closeNotes();
              }}
              className="w-full gap-0 overflow-hidden px-0 pt-2 pb-[env(safe-area-inset-bottom)] sm:px-0 sm:pt-2 sm:pb-[env(safe-area-inset-bottom)]"
            >
              <SheetTitle className="sr-only">Song notes</SheetTitle>
              <SheetDescription id="song-notes-description" className="sr-only">
                Review timestamped notes and add a note at the current playback time.
              </SheetDescription>
              {renderNotesPanel("sheet")}
            </SheetContent>
          </Sheet>
        ) : null}

        {role === "producer" && versionUpload ? (
          <UploadTrackModal
            open={versionUploadOpen}
            onClose={() => {
              setVersionUploadOpen(false);
            }}
            projectId={versionUpload.projectId}
            mode="new-version"
            trackId={versionUpload.trackId}
            defaultLabel={versionUpload.defaultLabel}
            tracks={[
              {
                id: versionUpload.trackId,
                title: songTitle,
                versionCount: versionUpload.versionCount,
                publicExposure: versionUpload.publicExposure,
              },
            ]}
          />
        ) : null}

        {managementConfig ? (
          <SongManagementDialog
            open={managementDialog !== null}
            config={managementConfig}
            onOpenChange={(open) => {
              if (!open) setManagementDialog(null);
            }}
            onSubmit={handleManagementSubmit}
            returnFocusRef={
              managementDialog?.kind === "download-override"
                ? deliveryOverrideButtonRef
                : openingManagementFromVersionRef.current
                  ? versionButtonRef
                  : moreButtonRef
            }
          />
        ) : null}
      </main>
    </>
  );
}

// ─── Local primitives ────────────────────────────────────────────────

type SongMoreActionsPanelProps = {
  role: SongPageRole;
  actions: L3Actions;
  canUseDownloadAction: boolean;
  downloadHref: string;
  activeVersionDeleted: boolean;
  activeVersionPlayable: boolean;
  activeDeliveryBadge: string;
  songArchived: boolean;
  songReleased: boolean;
  artistApprovalLocked: boolean;
  artworkUploading: boolean;
  onChangeCover: () => void;
  publicSharingControl: ReactNode;
  onDismiss: () => void;
  onOpenManagement: (kind: OpenSongManagement["kind"]) => void;
  id?: string;
  className: string;
  testId: string;
};

function SongMoreActionsPanel({
  role,
  actions,
  canUseDownloadAction,
  downloadHref,
  activeVersionDeleted,
  activeVersionPlayable,
  activeDeliveryBadge,
  songArchived,
  songReleased,
  artistApprovalLocked,
  artworkUploading,
  onChangeCover,
  publicSharingControl,
  onDismiss,
  onOpenManagement,
  id,
  className,
  testId,
}: SongMoreActionsPanelProps) {
  const hasProducerManagement =
    role === "producer" &&
    Boolean(
      actions.renameSong ||
      actions.editArtist ||
      actions.setArchived ||
      actions.markReleased ||
      actions.renameVersion ||
      actions.deleteSong ||
      actions.deleteVersionAudio,
    );

  return (
    <div id={id} role="group" aria-label="Song actions" data-testid={testId} className={className}>
      {publicSharingControl}
      {canUseDownloadAction ? (
        <a
          aria-label="Download"
          href={downloadHref}
          download
          onClick={onDismiss}
          className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-lg)] px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]">
            <DownloadIcon />
          </span>
          Download audio
        </a>
      ) : role !== "guest" ? (
        <button
          type="button"
          disabled
          title={activeVersionDeleted ? "Audio was deleted" : "Audio is still uploading"}
          className="flex min-h-11 w-full cursor-not-allowed items-center gap-2.5 rounded-[var(--radius-lg)] px-3 py-2 text-left text-[13px] font-semibold opacity-50"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]">
            <DownloadIcon />
          </span>
          {activeVersionDeleted
            ? "Audio deleted"
            : activeVersionPlayable
              ? activeDeliveryBadge
              : "Download (uploading…)"}
        </button>
      ) : null}
      {role === "producer" && actions.prepareArtwork && actions.completeArtwork ? (
        <button
          type="button"
          disabled={artworkUploading}
          onClick={() => {
            onDismiss();
            onChangeCover();
          }}
          className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)] disabled:opacity-50"
        >
          {artworkUploading ? "Uploading cover…" : "Change cover"}
        </button>
      ) : null}
      {role === "producer" && artistApprovalLocked && actions.reopenSong ? (
        <button
          type="button"
          data-test="reopen-approved-song"
          onClick={() => {
            onOpenManagement("reopen-approved-song");
          }}
          className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
        >
          Reopen approved song
        </button>
      ) : null}
      {hasProducerManagement ? (
        <>
          <div role="separator" className="mx-2 my-1 h-px bg-[rgb(var(--border-subtle))]" />
          {actions.renameSong ? (
            <button
              type="button"
              onClick={() => {
                onOpenManagement("rename-song");
              }}
              className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
            >
              Rename song
            </button>
          ) : null}
          {actions.editArtist ? (
            <button
              type="button"
              onClick={() => {
                onOpenManagement("edit-artist");
              }}
              className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
            >
              Edit artist credit
            </button>
          ) : null}
          {actions.setArchived ? (
            <button
              type="button"
              onClick={() => {
                onOpenManagement("set-archived");
              }}
              className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
            >
              {songArchived ? "Restore song" : "Archive song"}
            </button>
          ) : null}
          {actions.markReleased && !songReleased ? (
            <button
              type="button"
              onClick={() => {
                onOpenManagement("mark-released");
              }}
              className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
            >
              Mark as Released
            </button>
          ) : null}
          {actions.renameVersion ? (
            <button
              type="button"
              onClick={() => {
                onOpenManagement("rename-version");
              }}
              className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
            >
              Rename version
            </button>
          ) : null}
          {actions.deleteSong ? (
            <button
              type="button"
              onClick={() => {
                onOpenManagement("delete-song");
              }}
              className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold text-[rgb(var(--fg-danger))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)]"
            >
              Delete song
            </button>
          ) : actions.deleteVersionAudio && activeVersionPlayable ? (
            <button
              type="button"
              onClick={() => {
                onOpenManagement("delete-version-audio");
              }}
              className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold text-[rgb(var(--fg-danger))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)]"
            >
              Permanently delete audio
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function VersionDeliveryPanel({
  role,
  artistStudioId,
  version,
  delivery,
  downloadHref,
  canUseDownloadAction,
  canManageOverride,
  overrideButtonRef,
  onManageOverride,
}: {
  role: SongPageRole;
  artistStudioId: string | undefined;
  version: SongPageVersion;
  delivery: ReturnType<typeof presentVersionDelivery>;
  downloadHref: string;
  canUseDownloadAction: boolean;
  canManageOverride: boolean;
  overrideButtonRef: RefObject<HTMLButtonElement | null>;
  onManageOverride: () => void;
}) {
  const hasDebt = delivery.remainingCents > 0;
  const canManage =
    role === "producer" &&
    canManageOverride &&
    delivery.key !== "paid" &&
    delivery.key !== "deleted";

  return (
    <div
      data-test="version-delivery-state"
      className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)]"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-[9.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              {version.label} delivery
            </span>
            <span
              className={[
                "inline-flex rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-bold",
                delivery.key === "paid"
                  ? "bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success))]"
                  : delivery.key === "early_override"
                    ? "bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-text))]"
                    : delivery.key === "deleted"
                      ? "bg-[rgb(var(--fg-default)/0.07)] text-[rgb(var(--fg-muted))]"
                      : "bg-[rgb(var(--fg-danger)/0.1)] text-[rgb(var(--fg-danger))]",
              ].join(" ")}
            >
              {delivery.badge}
            </span>
          </div>
          <h2 className="mt-1 text-[14px] font-extrabold break-words text-[rgb(var(--fg-default))]">
            {delivery.title}
          </h2>
          <p className="mt-1 max-w-[68ch] text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {delivery.description}
          </p>
          {hasDebt ? (
            <p className="mt-2 font-mono text-[12px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
              {formatMoney(delivery.remainingCents, delivery.currency, { withCents: true })}{" "}
              remaining
              {version.delivery.overdue ? " · overdue" : ""}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          {role === "artist" && canUseDownloadAction ? (
            <a
              href={downloadHref}
              download
              className="sk-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-bold text-[rgb(var(--bg-background))]"
            >
              <DownloadIcon /> Download {version.label}
            </a>
          ) : role === "artist" && hasDebt && delivery.key !== "deleted" ? (
            <Link
              href={withArtistStudio(
                `/artist/payments/${encodeURIComponent(version.delivery.purchaseId)}`,
                artistStudioId,
              )}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-bold text-[rgb(var(--bg-background))]"
            >
              Complete payment
            </Link>
          ) : null}

          {canManage ? (
            <button
              ref={overrideButtonRef}
              type="button"
              onClick={onManageOverride}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 text-[13px] font-bold text-[rgb(var(--fg-default))]"
            >
              {delivery.key === "early_override" ? "Remove early access" : "Allow download now"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

function fmtRelativeIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${String(Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${String(Math.floor(diff / hour))}h ago`;
  if (diff < 7 * day) return `${String(Math.floor(diff / day))}d ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 8.5 7 12 13 5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function PlayIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v7L9.5 6z" />
    </svg>
  );
}

function PauseIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <rect x="3" y="2.5" width="2" height="7" rx="0.5" />
      <rect x="7" y="2.5" width="2" height="7" rx="0.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v8" />
      <polyline points="4.5 7 8 10.5 11.5 7" />
      <line x1="2.5" y1="13.5" x2="13.5" y2="13.5" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 10V2" />
      <path d="m5 5 3-3 3 3" />
      <path d="M4 7.5h-.5A1.5 1.5 0 0 0 2 9v3.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5H12" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7v5h5" />
      <path d="M5.4 16.7A8 8 0 1 0 6 6.3L4 8" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 7v5h-5" />
      <path d="M18.6 16.7A8 8 0 1 1 18 6.3L20 8" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-white/52"
      aria-hidden
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15 9a4 4 0 0 1 0 6" />
      <path d="M18 6a8 8 0 0 1 0 12" />
    </svg>
  );
}
