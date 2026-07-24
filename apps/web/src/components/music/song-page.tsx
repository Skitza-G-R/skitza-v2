"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type RefObject } from "react";

import { Waveform50, type WaveformComment } from "~/components/audio/waveform-50";
import {
  PLAYER_EVENTS,
  playerClose,
  playerPlay,
  playerSeek,
  playerToggle,
  useNowPlaying,
  type PlayerTrack,
} from "~/components/audio/persistent-player";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useRuntimeTextDraft } from "~/components/runtime-state/use-runtime-state";
import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { formatMoney } from "~/lib/format/money";

import {
  presentVersionDelivery,
  type VersionDeliveryPermission,
  type VersionDeliveryState,
} from "./delivery-state";
import { SongManagementDialog, type SongManagementDialogConfig } from "./song-management-dialog";
import {
  SongPublicLinkControls,
  type SongPublicSharingActions,
  type SongPublicSharingRefresh,
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

export type L3Actions = {
  addComment: (input: {
    versionId: string;
    body: string;
    timestampMs: number;
  }) => Promise<MusicL3ActionResult>;
  resolveComment: (input: {
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
  setDownloadOverride?: (input: {
    purchaseId: string;
    versionId: string;
    enabled: boolean;
    expectedUnpaidAmountCents: number;
  }) => Promise<MusicL3ActionResult>;
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
export type SongPageRole = "producer" | "artist";

export function songCommentDraftRoute(role: SongPageRole, versionId: string): string {
  const encodedVersionId = encodeURIComponent(versionId);
  return role === "artist"
    ? `/artist/music/song/${encodedVersionId}`
    : `/dashboard/music/${encodedVersionId}`;
}

// ─── Wire types (Date crosses RSC → client as ISO strings) ───────────
export type SongPageVersion = {
  id: string;
  label: string;
  audioUrl: string | null;
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
 * protected before they submit. The server remains authoritative if release
 * state changes while the confirmation dialog is open.
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
        `Before Released, the ${protectedRoles.join(", ")} audio is protected from permanent deletion.`,
        "Move the song to Released or keep another playable version before deleting this audio.",
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
    details.push(
      "This is producer-marked-final audio. Released songs allow it, so check the selection carefully.",
    );
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
      version.delivery.permission === "purchase_fully_paid" ||
      version.delivery.permission === "version_override");
  return {
    id: version.id,
    audioUrl: version.audioUrl,
    title: track.title,
    subtitle: `${label} · ${version.label}`,
    durationMs: version.durationMs,
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
    | "delete-version-audio"
    | "download-override"
    | "approve-version"
    | "reopen-approved-song";
  versionId: string;
};

export function SongPage({
  data,
  role = "producer",
  artistStudioId,
  actions,
  publicSharing,
  publicSharingActions,
  publicSharingRefresh,
}: {
  data: SongPageData;
  role?: SongPageRole;
  artistStudioId?: string | undefined;
  actions: L3Actions;
  publicSharing?: SongPublicSharingView;
  publicSharingActions?: SongPublicSharingActions;
  publicSharingRefresh?: SongPublicSharingRefresh;
}) {
  const [songTitleOverride, setSongTitleOverride] = useState<string | undefined>();
  const [artistOverride, setArtistOverride] = useState<string | null | undefined>();
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
  const [deliveryPermissionOverrides, setDeliveryPermissionOverrides] = useState<
    Record<string, VersionDeliveryPermission>
  >({});
  const versions = useMemo(
    () =>
      data.versions.map((version) => {
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
  const activeVersion = useMemo(
    () =>
      versions.find((v) => v.id === activeVersionId) ??
      resolveInitialSongPageVersion(versions, data.selectedVersionId),
    [activeVersionId, data.selectedVersionId, versions],
  );
  const activeVersionPlayable = activeVersion ? isSongPageVersionPlayable(activeVersion) : false;
  const activeVersionDeleted = activeVersion?.audioDeletedAtIso != null;

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
  // Default to TRUE — founder feedback: "resolve now disappears
  // messages, I want it greyed out and sent to the bottom." Showing
  // resolved by default + sorting them last preserves the
  // conversation history. The toggle below switches to a "hide
  // resolved" mode for producers who want a cleaner view.
  const [showResolved, setShowResolved] = useState<boolean>(true);

  // Live current-time from the waveform — used to anchor the "add note
  // at 0:34" composer chip. Updated by Waveform50's onProgress callback.
  const [currentMs, setCurrentMs] = useState(0);

  // Subscribed read of "what's currently playing" — flips the action-rail
  // play button to "Pause" when the active version is the one playing,
  // and lets the click handler decide between starting fresh vs toggling
  // the existing <audio> element in PersistentPlayer.
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
      if (Number.isFinite(ms) && ms >= 0) setCurrentMs(ms);
    }
    window.addEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    return () => {
      window.removeEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    };
  }, []);

  // Secondary actions overflow menu. Click-out
  // closes it. Premium players keep utility actions out of the primary
  // sightline — the menu collapses into a single circular trigger.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const deliveryOverrideButtonRef = useRef<HTMLButtonElement | null>(null);
  const [managementDialog, setManagementDialog] = useState<OpenSongManagement | null>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    function onDown(e: MouseEvent) {
      const node = overflowRef.current;
      if (node && !node.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOverflowOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement | null>(null);
  const online = useOnlineStatus();
  const commentDraft = useRuntimeTextDraft({
    slot: role === "artist" ? "artist.song-comment-draft" : "producer.song-comment-draft",
    route: songCommentDraftRoute(role, activeVersionId),
    ...(role === "artist" && artistStudioId ? { contextId: artistStudioId } : {}),
    resourceId: activeVersionId,
  });

  // Comments visible right now: server + optimistic for the active
  // version. Resolved comments sink to the BOTTOM (visible but greyed
  // out — see the row's `opacity-60` + line-through styles) so the
  // active conversation stays at the top of the thread. Within each
  // group, comments sort by timeMs asc so they read in track order.
  // The "Hide resolved" toggle drops the resolved rows entirely for
  // producers who want a cleaner view.
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
      .map((c) => ({
        id: c.id,
        timeMs: c.timeMs,
        fromProducer: c.fromProducer,
      }));
  }, [activeVersion?.durationMs, allCommentsForVersion, resolvedOverrides, showResolved]);

  const songTitle = songTitleOverride ?? data.track.title;
  const songArtist = artistOverride !== undefined ? artistOverride : data.track.artist;
  const clientLabel = data.track.clientName ?? songArtist ?? data.track.projectTitle;
  const heroBg = producerGradient(clientLabel);
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
    if (!activeVersion || commentsClosed || isPending) return;
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
        const res = await actions.addComment({
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
    if (!activeVersion) return;
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
        const res = await actions.resolveComment({
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
      playerPlay(activeVersionToPlayerTrack(data.track, activeVersion, role));
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
    playerPlay(activeVersionToPlayerTrack(data.track, activeVersion, role));
  }

  function openManagementDialog(kind: OpenSongManagement["kind"]) {
    if (!activeVersion) return;
    setOverflowOpen(false);
    setManagementDialog({ kind, versionId: activeVersion.id });
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
            "After release, current, producer-marked-final, and last remaining audio may be permanently deleted.",
            "Marking Released does not delete audio by itself.",
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
                    ? "This Released song permits producer-marked-final or last-audio deletion. Review every consequence."
                    : "The audio file is removed from storage, playback, downloads, and public switching."
                  : "This audio is protected until the song is marked Released.",
                confirmLabel: "Permanently delete audio",
                pendingLabel: "Deleting audio…",
                cancelLabel: "Keep audio",
                destructive: true,
                strongWarning: managementPolicy.strongWarning,
                blockedReason: managementPolicy.canDelete
                  ? null
                  : "Keep another safe playable version or mark the song Released before deleting this audio.",
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
    role === "artist"
      ? withArtistStudio(`/artist/music/${data.track.projectId}`, artistStudioId)
      : `/dashboard/music/project/${data.track.projectId}`;
  const topbarCrumbs = [
    ...clientCrumb,
    {
      label: data.track.projectTitle,
      href: projectHref,
    },
    { label: songTitle },
  ];

  if (!activeVersion) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-12 sm:px-6">
        <SetTopBarBreadcrumb crumbs={topbarCrumbs} />
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          This track has no versions yet.
        </p>
      </main>
    );
  }

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
  const newestPlayableVersion = newestPlayableSongPageVersion(versions);
  const isPlayingThis = playState.action === "toggle" && playState.label === "Pause";
  const canUseDownloadAction =
    activeVersionPlayable && (role === "producer" || activeDelivery.canDownload);
  const downloadHref =
    role === "producer"
      ? `/api/download/${activeVersion.id}`
      : `/api/audio/download/${activeVersion.delivery.purchaseId}/${activeVersion.id}`;

  return (
    <main className="sk-page-enter">
      {/* ───── Hero band ─────────────────────────────────────────────
          Editorial-luxury treatment: gradient backdrop bleeds out via
          a deep radial mask + two-stop linear fade, so the band feels
          like the OPENING of a record sleeve rather than a card glued
          to the top of the page. */}
      <header className="relative isolate z-10 text-white" style={{ background: heroBg }}>
        {/* Atmosphere — soft highlight at top-left + ambient bottom fade
            so the gradient melts into the canvas with no hard edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 12% 8%, rgba(255,255,255,0.22), transparent 55%), radial-gradient(80% 60% at 88% 0%, rgba(255,255,255,0.08), transparent 60%), linear-gradient(180deg, rgba(17,16,9,0) 0%, rgba(17,16,9,0.18) 60%, rgb(var(--bg-background)) 100%)",
          }}
        />
        {/* Subtle film-grain hint — adds physical texture without
            cooking the gradient. Only at very low opacity. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay"
          style={{
            backgroundImage: "radial-gradient(rgb(255 255 255) 1px, transparent 1px)",
            backgroundSize: "3px 3px",
          }}
        />

        <div className="relative mx-auto max-w-[1120px] px-4 pt-3 pb-4 sm:px-6 sm:pt-4 sm:pb-5">
          {/* Publishes Music › <client>? › <project> › <song> to the
              sticky topbar (see topbarCrumbs above). Replaces the
              "← Library" back-pill that used to live on this row —
              clicking "Music" in the topbar does the same thing now.
              The project crumb links to the Music project page (same
              section), not the clients-projects album page; the latter
              is still reachable via the cross-link pill on the right
              of this row. */}
          <SetTopBarBreadcrumb crumbs={topbarCrumbs} />

          {/* Cross-section link row — only the project-room pill
              remains. It jumps to clients-projects (a DIFFERENT
              workflow surface), so it isn't redundant with anything in
              the topbar. `justify-end` keeps it right-aligned where it
              already lived. Hidden on artist — no clients-projects
              surface exists for the artist app — and the wrapper row
              collapses with it, so the artist hero doesn't carry a
              dead 16px spacer at the top. */}
          {role === "producer" ? (
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
              <Link
                href={`/dashboard/clients-projects/${data.track.projectId}?tab=music&version=${activeVersion.id}`}
                data-test="project-room-link"
                className="sk-press group inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/20 bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white/90 backdrop-blur-md transition-colors duration-200 hover:bg-white/[0.14] sm:min-h-0"
              >
                <span>Open in project room</span>
                <ChevronRightIcon />
              </Link>
            </div>
          ) : null}

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-5">
            {/* Album-art tile — Double-bezel: glass outer ring + inner
                gradient core with reflection + a centered audio glyph.
                Reads as physical hardware, not a placeholder box. */}
            <div className="reveal-up shrink-0">
              {/* `max-md:w-fit` — in the stacked (mobile) hero the
                  flex-col stretches this block to the full viewport
                  width, leaving the 88px art core stranded inside a
                  wide empty glass slab. Hug the content below md; at
                  md+ the shrink-0 row item already hugs. */}
              <div
                aria-hidden
                className="relative rounded-[20px] p-[2px] max-md:w-fit"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.18) 100%)",
                  boxShadow:
                    "0 18px 48px -16px rgba(0,0,0,0.5), 0 2px 0 0 rgba(255,255,255,0.18) inset",
                }}
              >
                <div
                  className="relative flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[18px] text-white"
                  style={{
                    background:
                      "linear-gradient(155deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.1) 60%, rgba(255,255,255,0.06) 100%)",
                    boxShadow:
                      "inset 0 1px 0 0 rgba(255,255,255,0.18), inset 0 -28px 40px -16px rgba(0,0,0,0.4)",
                  }}
                >
                  <WaveformGlyph />
                  {/* Reflection slash — a subtle diagonal highlight. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.10) 45%, transparent 55%)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Title block + meta */}
            <div className="reveal-up reveal-up-delay-1 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-white/65 uppercase">
                  Song · {data.track.projectTitle}
                </span>
                {projectArchivedLabel ? (
                  <span className="inline-flex rounded-[var(--radius-sm)] border border-white/25 bg-white/12 px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.08em] text-white/90 uppercase backdrop-blur-sm">
                    {projectArchivedLabel}
                  </span>
                ) : null}
                {songArchived ? (
                  <span className="inline-flex rounded-[var(--radius-sm)] border border-white/25 bg-white/12 px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.08em] text-white/90 uppercase backdrop-blur-sm">
                    Song archived
                  </span>
                ) : null}
                {songReleased ? (
                  <span className="inline-flex rounded-[var(--radius-sm)] border border-white/35 bg-white/90 px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(17_16_9)] uppercase">
                    Released
                  </span>
                ) : null}
              </div>
              <h1
                className="font-display mt-1 line-clamp-2 text-[clamp(24px,3.4vw,38px)] leading-[1.05] font-extrabold tracking-[-0.03em] [overflow-wrap:anywhere]"
                style={{ textShadow: "0 2px 14px rgba(0,0,0,0.2)" }}
              >
                {songTitle}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-white/80">
                {clientLabel ? <span className="font-medium">{clientLabel}</span> : null}
                {songArtist && songArtist !== clientLabel ? (
                  <>
                    <span aria-hidden className="text-white/40">
                      ·
                    </span>
                    <span className="text-white/75">Artist: {songArtist}</span>
                  </>
                ) : null}
                {activeVersion.durationMs ? (
                  <>
                    <span aria-hidden className="text-white/40">
                      ·
                    </span>
                    <span className="font-mono tabular-nums">
                      {fmtMs(activeVersion.durationMs)}
                    </span>
                  </>
                ) : null}
                <span aria-hidden className="text-white/40">
                  ·
                </span>
                <span className="text-white/70">
                  uploaded {fmtRelativeIso(activeVersion.uploadedAtIso)}
                </span>
                {activeVersionDeleted ? (
                  <>
                    <span aria-hidden className="text-white/40">
                      ·
                    </span>
                    <span className="inline-flex rounded-[var(--radius-sm)] border border-white/20 bg-white/[0.08] px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.1em] text-white/65 uppercase">
                      Audio deleted
                    </span>
                  </>
                ) : null}
                {isExactArtistApproved || isProducerReady || wasPreviouslyArtistApproved ? (
                  <>
                    <span aria-hidden className="text-white/40">
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-white/90 px-2 py-0.5 text-[10px] font-bold tracking-[0.16em] text-[rgb(17_16_9)] uppercase">
                      {isExactArtistApproved ? <CheckIcon /> : null}
                      {isExactArtistApproved
                        ? "Artist approved"
                        : isProducerReady
                          ? role === "artist"
                            ? "Ready to approve"
                            : "Ready for artist"
                          : "Previously approved"}
                    </span>
                  </>
                ) : null}
              </div>

              {/* Version pills — magnetic hover, monospace labels */}
              {versions.length > 1 ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
                  <span className="mr-1 font-mono text-[9px] font-bold tracking-[0.16em] text-white/55 uppercase">
                    Version
                  </span>
                  {versions.map((v, i) => {
                    const isActive = v.id === activeVersion.id;
                    const isDeleted = v.audioDeletedAtIso != null;
                    const isLatest = v.id === newestPlayableVersion?.id;
                    const versionDelivery = presentVersionDelivery(v.delivery);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          commentDraft.preserveDraft();
                          setActiveVersionId(v.id);
                        }}
                        style={{ animationDelay: `${String(120 + i * 50)}ms` }}
                        className={[
                          "sk-press reveal-up relative inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-sm)] border px-2.5 py-2 font-mono text-[10.5px] font-bold tracking-wide",
                          "transition-[background-color,border-color,transform] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                          isActive
                            ? isDeleted
                              ? "border-white/30 bg-white/[0.08] text-white/70"
                              : "border-white bg-white text-[rgb(17_16_9)] shadow-[0_6px_18px_-6px_rgba(255,255,255,0.45)]"
                            : isDeleted
                              ? "border-white/12 bg-white/[0.04] text-white/50 hover:bg-white/[0.08]"
                              : "border-white/22 bg-white/[0.08] text-white/85 hover:-translate-y-px hover:bg-white/[0.16]",
                        ].join(" ")}
                      >
                        {/* Active version: tiny amber dot — the visual
                            "you are here" cue. Beats text " · current"
                            because the producer scans for color, not copy. */}
                        {isActive ? (
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))] shadow-[0_0_6px_rgb(var(--brand-primary)/0.6)]"
                          />
                        ) : null}
                        <span>{v.label}</span>
                        {isDeleted ? (
                          <span className="text-[8.5px] font-semibold tracking-normal normal-case">
                            · Audio deleted
                          </span>
                        ) : null}
                        {!isDeleted ? (
                          <span className="text-[8.5px] font-semibold tracking-normal normal-case">
                            · {versionDelivery.badge}
                          </span>
                        ) : null}
                        {isActive && isLatest ? (
                          <span className="text-[rgb(17_16_9)/0.55]">· current</span>
                        ) : null}
                        {v.artistApprovedAtIso ? (
                          <span title="Artist approved">✓</span>
                        ) : v.producerMarkedFinalAtIso ? (
                          <span className="text-[8.5px] font-semibold tracking-normal normal-case">
                            · Ready
                          </span>
                        ) : v.previouslyArtistApprovedAtIso ? (
                          <span className="text-[8.5px] font-semibold tracking-normal normal-case">
                            · Previously approved
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Action rail — ONE confident Play CTA + a single secondary
                overflow trigger + a quiet producer-final action. */}
            <div className="reveal-up reveal-up-delay-2 flex shrink-0 flex-wrap items-center gap-2.5">
              {/* Play CTA — primary, magnetic, glow when playing. The
                  data-test pin lives here now — the in-card transport
                  bar was removed so the floating PersistentPlayer dock
                  at the bottom of the screen handles inline controls. */}
              {activeVersionDeleted ? (
                <span
                  role="status"
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border border-white/20 bg-white/[0.08] px-4 text-[12.5px] font-bold text-white/65"
                >
                  Audio deleted
                </span>
              ) : (
                <button
                  type="button"
                  data-test="waveform-play-button"
                  onClick={handlePlayToggle}
                  disabled={playState.disabled}
                  aria-label={playState.label}
                  title={playState.disabled ? "Audio is still uploading" : playState.label}
                  className={[
                    "sk-press group relative inline-flex items-center gap-2 rounded-[var(--radius-md)] py-2 pr-5 pl-2 text-[13px] font-bold",
                    "transition-[transform,box-shadow] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                    "bg-white text-[rgb(17_16_9)] disabled:cursor-not-allowed disabled:opacity-50",
                    isPlayingThis
                      ? "shadow-[0_10px_30px_-8px_rgba(255,255,255,0.5),0_0_0_1px_rgba(255,255,255,0.4)]"
                      : "shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)] hover:-translate-y-px hover:shadow-[0_14px_36px_-8px_rgba(0,0,0,0.4)]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-full",
                      "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.05]",
                      isPlayingThis
                        ? "bg-[rgb(var(--brand-primary))] text-white"
                        : "bg-[rgb(17_16_9)] text-white",
                    ].join(" ")}
                  >
                    {isPlayingThis ? <PauseIcon /> : <PlayIcon />}
                  </span>
                  <span className="tracking-[-0.005em]">{playState.label}</span>
                </button>
              )}

              {role === "producer" && artistApprovalLocked ? (
                <button
                  type="button"
                  data-test="reopen-approved-song"
                  onClick={() => {
                    openManagementDialog("reopen-approved-song");
                  }}
                  disabled={isPending}
                  title="Reopen approved song"
                  aria-label="Reopen approved song"
                  className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] border border-white/28 bg-white/[0.06] px-4 py-2 text-[12.5px] font-bold text-white transition-[background-color,transform] duration-[220ms] hover:-translate-y-px hover:bg-white/[0.14] disabled:opacity-60"
                >
                  <CheckIcon /> Artist approved · Reopen
                </button>
              ) : role === "producer" ? (
                <button
                  type="button"
                  data-test="mark-version-ready"
                  onClick={handleProducerReadyToggle}
                  disabled={isPending || !actions.markVersionReady || activeVersionDeleted}
                  title={isProducerReady ? "Remove ready status" : "Mark exact version ready"}
                  aria-label={isProducerReady ? "Remove ready status" : "Mark exact version ready"}
                  className={[
                    "sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] px-4 py-2 text-[12.5px] font-bold",
                    "transition-[background-color,border-color,box-shadow,transform] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                    isProducerReady
                      ? "border border-white/0 bg-white/95 text-[rgb(17_16_9)] shadow-[0_6px_20px_-6px_rgba(255,255,255,0.45)]"
                      : "border border-white/28 bg-white/[0.06] text-white hover:-translate-y-px hover:bg-white/[0.14]",
                    "disabled:opacity-60",
                  ].join(" ")}
                >
                  <CheckIcon /> {isProducerReady ? "Ready for artist" : "Mark ready"}
                </button>
              ) : isExactArtistApproved ? (
                <span
                  data-test="artist-approved-status"
                  role="status"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] bg-white/95 px-4 py-2 text-[12.5px] font-bold text-[rgb(17_16_9)]"
                >
                  <CheckIcon /> Approved
                </span>
              ) : isProducerReady && !artistApprovalLocked ? (
                <button
                  type="button"
                  data-test="approve-final-version"
                  onClick={() => {
                    openManagementDialog("approve-version");
                  }}
                  disabled={isPending || !actions.approveVersion || activeVersionDeleted}
                  className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] bg-white px-4 py-2 text-[12.5px] font-bold text-[rgb(17_16_9)] shadow-[0_6px_20px_-6px_rgba(255,255,255,0.45)] transition-transform duration-[220ms] hover:-translate-y-px disabled:opacity-60"
                >
                  <CheckIcon /> Approve final version
                </button>
              ) : null}

              {publicSharing ? (
                <SongPublicLinkControls
                  role={role}
                  initialState={publicSharing}
                  shareTitle={songTitle}
                  {...(publicSharingActions ? { actions: publicSharingActions } : {})}
                  {...(publicSharingRefresh ? { refreshLiveState: publicSharingRefresh } : {})}
                />
              ) : null}

              {/* Overflow — single glass circle for download and producer
                  management actions. Origin-aware popover scales from this trigger. */}
              <div ref={overflowRef} className="relative">
                <button
                  ref={moreButtonRef}
                  type="button"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={overflowOpen}
                  onClick={() => {
                    setOverflowOpen((o) => !o);
                  }}
                  className={[
                    "sk-press inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/22",
                    "transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    overflowOpen ? "bg-white/[0.22]" : "bg-white/[0.08] hover:bg-white/[0.16]",
                  ].join(" ")}
                >
                  <MoreIcon />
                </button>
                {overflowOpen ? (
                  <div
                    role="menu"
                    className="sk-pop absolute top-[calc(100%+8px)] right-0 z-30 max-h-[min(70dvh,520px)] w-64 origin-top-right overflow-y-auto rounded-[18px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 text-[rgb(var(--fg-default))] shadow-[0_30px_60px_-15px_rgba(17,16,9,0.35)] max-[400px]:fixed max-[400px]:inset-x-4 max-[400px]:top-auto max-[400px]:bottom-4 max-[400px]:max-h-[calc(100dvh-2rem)] max-[400px]:w-auto max-[400px]:origin-bottom-right"
                  >
                    {canUseDownloadAction ? (
                      <a
                        role="menuitem"
                        aria-label="Download"
                        href={downloadHref}
                        download
                        onClick={() => {
                          setOverflowOpen(false);
                        }}
                        className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-lg)] px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]">
                          <DownloadIcon />
                        </span>
                        Download audio
                      </a>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        disabled
                        title={
                          activeVersionDeleted ? "Audio was deleted" : "Audio is still uploading"
                        }
                        className="flex min-h-11 w-full cursor-not-allowed items-center gap-2.5 rounded-[var(--radius-lg)] px-3 py-2 text-left text-[13px] font-semibold opacity-50"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]">
                          <DownloadIcon />
                        </span>
                        {activeVersionDeleted
                          ? "Audio deleted"
                          : activeVersionPlayable
                            ? activeDelivery.badge
                            : "Download (uploading…)"}
                      </button>
                    )}
                    {role === "producer" &&
                    (actions.renameSong ||
                      actions.editArtist ||
                      actions.setArchived ||
                      actions.markReleased ||
                      actions.renameVersion ||
                      actions.deleteVersionAudio) ? (
                      <>
                        <div
                          role="separator"
                          className="mx-2 my-1 h-px bg-[rgb(var(--border-subtle))]"
                        />
                        {actions.renameSong ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              openManagementDialog("rename-song");
                            }}
                            className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                          >
                            Rename song
                          </button>
                        ) : null}
                        {actions.editArtist ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              openManagementDialog("edit-artist");
                            }}
                            className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                          >
                            Edit artist credit
                          </button>
                        ) : null}
                        {actions.setArchived ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              openManagementDialog("set-archived");
                            }}
                            className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                          >
                            {songArchived ? "Restore song" : "Archive song"}
                          </button>
                        ) : null}
                        {actions.markReleased && !songReleased ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              openManagementDialog("mark-released");
                            }}
                            className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                          >
                            Mark as Released
                          </button>
                        ) : null}
                        {actions.renameVersion ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              openManagementDialog("rename-version");
                            }}
                            className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                          >
                            Rename version
                          </button>
                        ) : null}
                        {actions.deleteVersionAudio && activeVersionPlayable ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              openManagementDialog("delete-version-audio");
                            }}
                            className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold text-[rgb(var(--fg-danger))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)]"
                          >
                            Permanently delete audio
                          </button>
                        ) : actions.deleteVersionAudio && activeVersionDeleted ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              openManagementDialog("delete-version-audio");
                            }}
                            className="flex min-h-11 w-full items-center rounded-[var(--radius-lg)] px-3 text-left text-[13px] font-semibold text-[rgb(var(--fg-danger))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)]"
                          >
                            Retry storage cleanup
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1120px] px-4 pt-4 sm:px-6 sm:pt-5">
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
      </section>

      {/* ───── Body ──────────────────────────────────────────────────
          Waveform first, then comments. The waveform card uses the
          double-bezel pattern — an outer hairline sheath + inner core
          with a soft inset highlight, so it sits on the page like a
          piece of polished hardware instead of a flat content rectangle. */}
      <section className="mx-auto max-w-[1120px] px-4 py-4 sm:px-6 sm:py-5">
        {/* Waveform — Double-Bezel card */}
        <div
          className="reveal-up rounded-[20px] p-[1.5px]"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--fg-default) / 0.08) 0%, rgb(var(--fg-default) / 0.02) 60%, rgb(var(--brand-primary) / 0.18) 100%)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div
            className="rounded-[18px] bg-[rgb(var(--bg-elevated))] p-3 sm:p-4"
            style={{
              boxShadow:
                "inset 0 1px 0 0 rgb(255 255 255 / 0.4), inset 0 -1px 0 0 rgb(var(--fg-default) / 0.04)",
            }}
          >
            {activeVersionDeleted ? (
              <div
                role="status"
                className="flex min-h-[92px] flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-4 text-center"
              >
                <p className="text-[13px] font-bold text-[rgb(var(--fg-muted))]">Audio deleted</p>
                <p className="mt-1 text-[11.5px] text-[rgb(var(--fg-faint))]">
                  Version name, upload date, and comment history remain available.
                </p>
              </div>
            ) : (
              <Waveform50
                durationMs={activeVersion.durationMs ?? 240_000}
                comments={waveformComments}
                seed={activeVersion.id}
                // Pre-computed peaks from track_versions.peaks ride down
                // with the page payload — Waveform50 renders the real
                // envelope on first frame, no client-side decode.
                initialPeaks={activeVersion.peaks}
                // Fallback decode path for legacy versions (peaks=null)
                // OR formats audio-decode missed server-side. Reuse the
                // authorized private stream so this works for both roles.
                peaksUrl={activeVersionPlayable ? (activeVersion.audioUrl ?? undefined) : undefined}
                onProgress={setCurrentMs}
                height={68}
              />
            )}
          </div>
        </div>

        {/* ───── Comments thread ─────────────────────────────────────
            Header → Composer → List. Composer floats at the top so the
            primary action (drop a note at the playhead) is the first
            thing a producer sees after the waveform. */}
        <div className="reveal-up reveal-up-delay-2 mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-[15px] font-bold tracking-[-0.018em] text-[rgb(var(--fg-default))]">
                Notes
              </h2>
              <span className="font-mono text-[10.5px] font-bold text-[rgb(var(--fg-muted))] tabular-nums">
                {String(visibleComments.length)}
                {visibleComments.length !== allCommentsForVersion.length
                  ? ` of ${String(allCommentsForVersion.length)}`
                  : ""}
              </span>
            </div>
            {hasResolvedComments ? (
              <button
                type="button"
                onClick={() => {
                  setShowResolved((s) => !s);
                }}
                className="sk-press relative rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-1 font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase transition-colors before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:bg-[rgb(var(--fg-default)/0.04)] hover:text-[rgb(var(--fg-default))]"
              >
                {showResolved ? "Hide resolved" : "Show resolved"}
              </button>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-[14px] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2 text-[12px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}

          {commentsClosed ? (
            <div
              role="status"
              className="mb-2.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-3 py-2.5 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]"
            >
              {songArchived
                ? "This song is archived. Restore this song to add comments. Listening and comment history remain available."
                : "This project is archived. New comments are closed, but listening and comment history remain available."}
            </div>
          ) : (
            /* Composer — premium pill, focus-state with amber ring. */
            <div
              className={[
                "group/composer mb-2.5 flex items-center gap-2 rounded-[var(--radius-sm)] border bg-[rgb(var(--bg-elevated))] py-1 pr-1 pl-2",
                "border-[rgb(var(--border-subtle))]",
                "transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                "focus-within:border-[rgb(var(--brand-primary)/0.5)] focus-within:shadow-[0_0_0_4px_rgb(var(--brand-primary)/0.12)]",
              ].join(" ")}
            >
              <span className="shrink-0 rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.14)] px-2.5 py-1 font-mono text-[10.5px] font-bold text-[rgb(var(--brand-primary-dark))] tabular-nums">
                @{fmtMs(currentMs)}
              </span>
              <input
                ref={draftRef}
                type="text"
                data-test="comment-input"
                maxLength={2000}
                disabled={isPending}
                placeholder="Add a note at this timestamp…"
                className="min-h-11 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[rgb(var(--fg-muted))] sm:min-h-0"
                value={commentDraft.body}
                onChange={(event) => {
                  commentDraft.setBodyFromUser(event.currentTarget.value);
                }}
                onFocus={handleComposerFocus}
                onBlur={handleComposerBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
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
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--fg-default))] px-4 py-1.5 text-[11.5px] font-bold tracking-wide text-[rgb(var(--bg-elevated))] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-px hover:shadow-[0_8px_20px_-6px_rgb(var(--fg-default)/0.35)] disabled:opacity-60 sm:min-h-0"
              >
                {online ? "Post" : "Offline"}
              </button>
            </div>
          )}

          {visibleComments.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-7 text-center text-[12.5px] text-[rgb(var(--fg-muted))]">
              <ArrowUpHint />
              <p className="mt-2">
                {commentsClosed
                  ? songArchived
                    ? "No notes were added before this song was archived."
                    : "No notes were added before this project was archived."
                  : "No notes yet. Type one above to drop it at the current playhead."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visibleComments.map((c, i) => {
                const override = resolvedOverrides[c.id];
                const isResolved = override !== undefined ? override : c.resolvedAtIso !== null;
                // Stagger entry by index, capped at 5 (after that the cascade
                // gets noticeably slow without adding polish).
                const staggerMs = Math.min(i, 5) * 50;

                // ─── Resolved → compact single-line variant ──────────
                // Greyed out, half-height of an active note. Just the
                // author + timestamp + body preview. Hover reveals the
                // "Reopen" action. Saves a lot of vertical space when
                // a producer has 10+ resolved notes on a track.
                if (isResolved) {
                  // Collapsed by default — single greyed line. On
                  // hover, the row expands: body un-truncates onto a
                  // second line + padding grows + actions slide in.
                  // Producer can re-read context without reopening.
                  return (
                    <li
                      key={c.id}
                      className="group/note reveal-up flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--fg-default)/0.02)] px-2.5 py-1 text-[12px] opacity-65 transition-[opacity,padding] duration-200 hover:py-2 hover:opacity-100"
                      style={{ animationDelay: `${String(staggerMs)}ms` }}
                    >
                      <span
                        aria-hidden
                        className="font-mono text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
                      >
                        ✓
                      </span>
                      <button
                        type="button"
                        data-test="comment-timestamp"
                        onClick={() => {
                          handleJumpToComment(c.timeMs);
                        }}
                        aria-label={`Jump to ${fmtMs(c.timeMs)}`}
                        className="sk-press inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--fg-default)/0.05)] px-1.5 py-0 font-mono text-[10px] font-bold text-[rgb(var(--fg-muted))] tabular-nums hover:bg-[rgb(var(--fg-default)/0.1)] sm:min-h-0 sm:min-w-0"
                      >
                        @{fmtMs(c.timeMs)}
                      </button>
                      <span className="shrink-0 text-[11.5px] font-semibold text-[rgb(var(--fg-muted))]">
                        {c.authorName}
                      </span>
                      {/* Body: truncated single line by default; on
                          row hover, basis grows + line-clamp lifts so
                          the full body wraps onto subsequent lines. */}
                      <span className="min-w-0 flex-1 basis-0 truncate text-[11.5px] text-[rgb(var(--fg-muted))] transition-[max-height,color] duration-200 group-hover:text-[rgb(var(--fg-default))] group-hover/note:whitespace-normal">
                        {c.body}
                      </span>
                      {/* Hover-revealed on desktop; touch devices have
                          no hover, so `[@media(hover:none)]:inline-flex`
                          keeps the affordance permanently visible
                          there with a real 44px-tall hit box. */}
                      <button
                        type="button"
                        data-test="comment-jump"
                        onClick={() => {
                          handleJumpToComment(c.timeMs);
                        }}
                        className="hidden min-h-11 min-w-11 items-center justify-center text-[10px] font-bold tracking-wide text-[rgb(var(--fg-muted))] uppercase group-hover/note:inline-flex hover:text-[rgb(var(--fg-default))] sm:min-h-0 sm:min-w-0 [@media(hover:none)]:inline-flex"
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
                          className="hidden min-h-11 min-w-11 items-center justify-center text-[10px] font-bold tracking-wide text-[rgb(var(--fg-muted))] uppercase group-hover/note:inline-flex hover:text-[rgb(var(--fg-default))] sm:min-h-0 sm:min-w-0 [@media(hover:none)]:inline-flex"
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
                        className="hidden min-h-11 min-w-11 shrink-0 items-center justify-center text-[10px] font-bold tracking-wide text-[rgb(var(--fg-muted))] uppercase group-hover/note:inline-flex hover:text-[rgb(var(--fg-default))] sm:min-h-0 sm:min-w-0 [@media(hover:none)]:inline-flex"
                      >
                        Reopen
                      </button>
                    </li>
                  );
                }

                // ─── Active note — full card ─────────────────────────
                return (
                  <li
                    key={c.id}
                    className={[
                      "group/note reveal-up",
                      "flex items-start gap-2.5 rounded-[12px] border px-2.5 py-2",
                      "transition-[transform,box-shadow,background-color,border-color] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                      c.fromProducer
                        ? "border-[rgb(var(--brand-primary)/0.22)] bg-[rgb(var(--brand-primary)/0.05)]"
                        : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
                      "hover:-translate-y-px hover:shadow-[0_10px_28px_-12px_rgb(var(--fg-default)/0.16)]",
                    ].join(" ")}
                    style={{ animationDelay: `${String(staggerMs)}ms` }}
                  >
                    <span
                      aria-hidden
                      className={[
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tracking-wider text-white uppercase",
                        c.fromProducer
                          ? "bg-[rgb(var(--brand-primary))] shadow-[0_2px_8px_-2px_rgb(var(--brand-primary)/0.55)]"
                          : "bg-[rgb(var(--fg-muted))]",
                      ].join(" ")}
                    >
                      {initials(c.authorName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
                          {c.authorName}
                        </span>
                        <button
                          type="button"
                          data-test="comment-timestamp"
                          onClick={() => {
                            handleJumpToComment(c.timeMs);
                          }}
                          aria-label={`Jump to ${fmtMs(c.timeMs)}`}
                          className="sk-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.14)] px-2 py-0.5 font-mono text-[10px] font-bold text-[rgb(var(--brand-primary-dark))] tabular-nums transition-colors duration-200 hover:bg-[rgb(var(--brand-primary)/0.24)] sm:min-h-0 sm:min-w-0"
                        >
                          @{fmtMs(c.timeMs)}
                        </button>
                        <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                          {fmtRelativeIso(c.createdAtIso)}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-default))]">
                        {c.body}
                      </p>
                      {/* Touch devices have no hover to lift the 60%
                          dim — render the actions at full opacity when
                          the device can't hover. Phone buttons get a
                          real 44px height; desktop keeps the compact
                          text-row treatment. */}
                      <div className="mt-1 flex gap-2.5 text-[10px] font-bold tracking-wide opacity-60 transition-opacity duration-200 group-hover/note:opacity-100 [@media(hover:none)]:opacity-100">
                        <button
                          type="button"
                          data-test="comment-jump"
                          onClick={() => {
                            handleJumpToComment(c.timeMs);
                          }}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] sm:min-h-0 sm:min-w-0"
                        >
                          Jump to
                        </button>
                        {!commentsClosed ? (
                          <button
                            type="button"
                            data-test="comment-reply"
                            onClick={() => {
                              handleReplyToComment(c.authorName);
                            }}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] sm:min-h-0 sm:min-w-0"
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
                          className="inline-flex min-h-11 min-w-11 items-center justify-center text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] sm:min-h-0 sm:min-w-0"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
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
              : moreButtonRef
          }
        />
      ) : null}
    </main>
  );
}

// ─── Local primitives ────────────────────────────────────────────────

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "·";
}

function ChevronRightIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="6 4 10 8 6 12" />
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

function WaveformGlyph() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="4" y1="14" x2="4" y2="18" opacity="0.7" />
      <line x1="8" y1="11" x2="8" y2="21" opacity="0.8" />
      <line x1="12" y1="7" x2="12" y2="25" opacity="0.95" />
      <line x1="16" y1="3" x2="16" y2="29" />
      <line x1="20" y1="7" x2="20" y2="25" opacity="0.95" />
      <line x1="24" y1="11" x2="24" y2="21" opacity="0.8" />
      <line x1="28" y1="14" x2="28" y2="18" opacity="0.7" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v7L9.5 6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
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

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

// Empty-state hint pointing UP to the composer pill so producers
// immediately see where to start their first note.
function ArrowUpHint() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mx-auto opacity-60"
      aria-hidden
    >
      <path d="M12 19V5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}
