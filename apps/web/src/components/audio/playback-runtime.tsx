"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  cacheRecentAudio,
  clearRecentAudioForAccount,
  enforceRecentAudioAccountIsolation,
  isAudioUrlSafeToRestore,
  isRecentAudioCacheEligible,
  readRecentAudio,
  type AudioCachePolicy,
} from "~/lib/audio/recent-audio-cache";
import {
  recordGate1AudioNetworkRequest,
  recordGate1AudioPlaying,
  recordGate1AudioSource,
  startGate1Journey,
} from "~/lib/desktop/gate1-proof";
import {
  desktopSessionCacheAccess,
  getBrowserOnlineSnapshot,
  subscribeBrowserOnline,
  subscribeDesktopSessionValidation,
} from "~/lib/desktop/session-validation";

export type PlayerTrack = {
  id: string;
  /** Stable Song identity, when the caller has it, for exact cross-page cleanup. */
  songId?: string;
  audioUrl: string | null;
  title: string;
  subtitle: string;
  durationMs: number | null;
  artwork?: MediaImage[];
  cachePolicy?: AudioCachePolicy;
  /**
   * Pre-computed waveform peaks (normalized RMS floats 0..1) when the
   * caller already has them (song page, public song player). The dock
   * renders the real envelope on first frame instead of decoding the
   * audio bytes client-side.
   */
  peaks?: number[];
};

export type LoopMode = "off" | "all" | "one";

export type PlaybackSnapshot = {
  track: PlayerTrack | null;
  playing: boolean;
  currentMs: number;
  audioDurationSec: number | null;
  volume: number;
  /**
   * Playback context for prev / next. Set by list surfaces (Library,
   * project page) when a row starts playback; falls back to the single
   * loaded track. Never persisted — a restored session starts with a
   * one-track queue.
   */
  queue: PlayerTrack[];
  loop: LoopMode;
  shuffle: boolean;
  /** Track ids in play order while shuffle is on (current track first). */
  shuffleOrder: string[];
};

export type PlaybackCommand =
  | {
      kind: "set";
      track: PlayerTrack;
      currentMs?: number;
      playing?: boolean;
      queue?: PlayerTrack[];
    }
  | { kind: "toggle" }
  | { kind: "seek"; currentMs: number }
  | { kind: "volume"; volume: number }
  | { kind: "loop"; mode: LoopMode }
  | { kind: "shuffle"; enabled: boolean }
  | { kind: "close" };

export type PlayerLoadOptions = {
  currentMs: number;
  playing: boolean;
};

export type PlayerPlayOptions = {
  /** Sibling tracks (in list order) so prev / next can move through them. */
  queue?: PlayerTrack[];
};

type StructuredPlayerSetDetail = PlayerLoadOptions & {
  track: PlayerTrack;
  queue?: PlayerTrack[];
};

type ResolvedAudioSource = {
  accountId: string | null;
  trackId: string;
  canonicalUrl: string;
  playbackUrl: string;
  proofSource: "recent-cache" | "network";
};

const EMPTY_PLAYBACK: PlaybackSnapshot = {
  track: null,
  playing: false,
  currentMs: 0,
  audioDurationSec: null,
  volume: 1,
  queue: [],
  loop: "off",
  shuffle: false,
  shuffleOrder: [],
};

const EVT_SET = "skitza:player:set";
const EVT_TOGGLE = "skitza:player:toggle";
const EVT_SEEK = "skitza:player:seek";
const EVT_VOLUME = "skitza:player:volume";
const EVT_CLOSE = "skitza:player:close";
const EVT_TIME = "skitza:player:time";
const EVT_NEXT = "skitza:player:next";
const EVT_PREV = "skitza:player:prev";
const EVT_LOOP = "skitza:player:loop";
const EVT_SHUFFLE = "skitza:player:shuffle";

export const PLAYER_EVENTS = {
  set: EVT_SET,
  toggle: EVT_TOGGLE,
  seek: EVT_SEEK,
  volume: EVT_VOLUME,
  close: EVT_CLOSE,
  time: EVT_TIME,
  next: EVT_NEXT,
  prev: EVT_PREV,
  loop: EVT_LOOP,
  shuffle: EVT_SHUFFLE,
} as const;

const PLAYBACK_STORAGE_PREFIX = "skitza:playback:v1:";
/** Loop + shuffle are UI preferences, not account data — one global key. */
const PLAYBACK_MODE_STORAGE_KEY = "skitza:playback:mode:v1";
/** Pressing "previous" this far into a track restarts it instead of going back. */
export const PREVIOUS_TRACK_RESTART_MS = 3_000;
const PLAYER_QUEUE_MAX_ITEMS = 500;
const PLAYER_PEAKS_MAX_ITEMS = 400;

let playbackSnapshot = EMPTY_PLAYBACK;
let playbackAccountId: string | null = null;
const playbackListeners = new Set<() => void>();
const playbackCacheWork = new Map<string, AbortController>();

function emitPlayback(next: PlaybackSnapshot): void {
  playbackSnapshot = next;
  for (const listener of playbackListeners) listener();
}

function updatePlayback(update: (current: PlaybackSnapshot) => PlaybackSnapshot): void {
  emitPlayback(update(playbackSnapshot));
}

function subscribePlayback(listener: () => void): () => void {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

export function usePlaybackSnapshot(): PlaybackSnapshot {
  return useSyncExternalStore(
    subscribePlayback,
    () => playbackSnapshot,
    () => EMPTY_PLAYBACK,
  );
}

export function useNowPlaying(): { trackId: string | null; playing: boolean } {
  const snapshot = usePlaybackSnapshot();
  return {
    trackId: snapshot.track?.id ?? null,
    playing: snapshot.playing,
  };
}

export function publishNowPlaying(next: { trackId: string | null; playing: boolean }): void {
  if (next.trackId === null) {
    emitPlayback({ ...EMPTY_PLAYBACK, volume: playbackSnapshot.volume });
    return;
  }
  if (playbackSnapshot.track?.id !== next.trackId) return;
  updatePlayback((current) => ({ ...current, playing: next.playing }));
}

export function playerPlay(track: PlayerTrack, options?: PlayerPlayOptions): void {
  if (typeof window === "undefined") return;
  startGate1Journey("cached-recent-audio");
  if (options?.queue) {
    const detail: StructuredPlayerSetDetail = {
      track,
      currentMs: 0,
      playing: true,
      queue: options.queue,
    };
    window.dispatchEvent(new CustomEvent(EVT_SET, { detail }));
    return;
  }
  window.dispatchEvent(new CustomEvent(EVT_SET, { detail: track }));
}

/**
 * Load another audio source at an exact position without changing the caller's
 * intended play/pause state. The structured event remains additive: legacy
 * callers may continue dispatching a raw PlayerTrack over PLAYER_EVENTS.set.
 */
export function playerLoad(track: PlayerTrack, options: PlayerLoadOptions): void {
  if (typeof window === "undefined") return;
  const detail: StructuredPlayerSetDetail = {
    track,
    currentMs: options.currentMs,
    playing: options.playing,
  };
  window.dispatchEvent(new CustomEvent(EVT_SET, { detail }));
}

export function playerToggle(): void {
  if (typeof window === "undefined") return;
  if (!playbackSnapshot.playing) startGate1Journey("cached-recent-audio");
  window.dispatchEvent(new CustomEvent(EVT_TOGGLE));
}

export function playerSeek(ms: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_SEEK, { detail: ms }));
}

export function playerSetVolume(volume: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_VOLUME, { detail: volume }));
}

export function playerClose(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_CLOSE));
}

export function playerNext(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_NEXT));
}

export function playerPrevious(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_PREV));
}

export function playerSetLoop(mode: LoopMode): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_LOOP, { detail: mode }));
}

export function playerSetShuffle(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_SHUFFLE, { detail: enabled }));
}

/** off → all → one → off — the Spotify / Apple Music repeat cycle. */
export function nextLoopMode(mode: LoopMode): LoopMode {
  if (mode === "off") return "all";
  if (mode === "all") return "one";
  return "off";
}

function isLoopMode(value: unknown): value is LoopMode {
  return value === "off" || value === "all" || value === "one";
}

/**
 * Play order for the current queue: list order, or the stored shuffle
 * order (filtered to ids still in the queue) while shuffle is on.
 */
export function playbackOrder(snapshot: {
  queue: PlayerTrack[];
  shuffle: boolean;
  shuffleOrder: string[];
}): PlayerTrack[] {
  if (!snapshot.shuffle) return snapshot.queue;
  const byId = new Map(snapshot.queue.map((track) => [track.id, track] as const));
  const ordered = snapshot.shuffleOrder.flatMap((id) => {
    const track = byId.get(id);
    if (!track) return [];
    byId.delete(id);
    return [track];
  });
  // Tracks appended after the order was drawn play at the end.
  return [...ordered, ...byId.values()];
}

/**
 * Fisher–Yates over the queue ids with the current track pinned first so
 * turning shuffle on never interrupts what is playing.
 */
export function shuffledOrder(
  queue: PlayerTrack[],
  currentId: string | null,
  random: () => number = Math.random,
): string[] {
  const rest = queue.map((track) => track.id).filter((id) => id !== currentId);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = rest[i];
    const b = rest[j];
    if (a === undefined || b === undefined) continue;
    rest[i] = b;
    rest[j] = a;
  }
  return currentId !== null && queue.some((track) => track.id === currentId)
    ? [currentId, ...rest]
    : rest;
}

/**
 * Neighbours of the current track in play order. `loop: "all"` wraps at
 * both ends; otherwise the edges return null so the buttons can disable.
 * A track that is not in the queue has no neighbours.
 */
export function queueNeighbors(snapshot: {
  track: PlayerTrack | null;
  queue: PlayerTrack[];
  loop: LoopMode;
  shuffle: boolean;
  shuffleOrder: string[];
}): { previous: PlayerTrack | null; next: PlayerTrack | null } {
  const order = playbackOrder(snapshot);
  const currentId = snapshot.track?.id ?? null;
  const index = currentId === null ? -1 : order.findIndex((track) => track.id === currentId);
  if (index < 0 || order.length === 0) return { previous: null, next: null };
  const wrap = snapshot.loop === "all";
  const previous =
    index > 0 ? (order[index - 1] ?? null) : wrap ? (order[order.length - 1] ?? null) : null;
  const next = index < order.length - 1 ? (order[index + 1] ?? null) : wrap ? (order[0] ?? null) : null;
  return { previous, next };
}

export type TrackEndResolution =
  | { kind: "restart" }
  | { kind: "play"; track: PlayerTrack }
  | { kind: "stop" };

/** What the runtime does when the <audio> element reaches the end. */
export function resolveTrackEnd(snapshot: {
  track: PlayerTrack | null;
  queue: PlayerTrack[];
  loop: LoopMode;
  shuffle: boolean;
  shuffleOrder: string[];
}): TrackEndResolution {
  if (!snapshot.track) return { kind: "stop" };
  if (snapshot.loop === "one") return { kind: "restart" };
  const { next } = queueNeighbors(snapshot);
  if (!next) return { kind: "stop" };
  if (next.id === snapshot.track.id) return { kind: "restart" };
  if (!next.audioUrl) return { kind: "stop" };
  return { kind: "play", track: next };
}

type StoredPlaybackMode = { loop: LoopMode; shuffle: boolean };

export function readPlaybackMode(): StoredPlaybackMode {
  const fallback: StoredPlaybackMode = { loop: "off", shuffle: false };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      loop: isLoopMode(parsed.loop) ? parsed.loop : "off",
      shuffle: parsed.shuffle === true,
    };
  } catch {
    return fallback;
  }
}

function persistPlaybackMode(mode: StoredPlaybackMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, JSON.stringify(mode));
  } catch {
    // Storage can be blocked or full; the mode still applies in memory.
  }
}

export function clampSeekMs(currentMs: number, deltaMs: number, durationMs: number | null): number {
  const safeCurrentMs = Number.isFinite(currentMs) ? Math.max(0, currentMs) : 0;
  const safeDeltaMs = Number.isFinite(deltaMs) ? deltaMs : 0;
  const nextMs = Math.max(0, safeCurrentMs + safeDeltaMs);
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return nextMs;
  }
  return Math.min(durationMs, nextMs);
}

function clampVolume(volume: number, fallback: number): number {
  if (!Number.isFinite(volume)) return fallback;
  return Math.min(1, Math.max(0, volume));
}

function playbackStorageKey(accountId: string): string {
  return `${PLAYBACK_STORAGE_PREFIX}${encodeURIComponent(accountId)}`;
}

type StoredPlayback = {
  version: 1;
  track: PlayerTrack;
  currentMs: number;
  updatedAt: string;
};

const PLAYER_ID_MAX_LENGTH = 256;
const PLAYER_METADATA_MAX_LENGTH = 300;
const PLAYER_AUDIO_URL_MAX_LENGTH = 2_048;
const PLAYER_DURATION_MAX_MS = 7 * 24 * 60 * 60 * 1_000;
const PLAYER_ARTWORK_MAX_ITEMS = 8;

function isFiniteDuration(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= PLAYER_DURATION_MAX_MS)
  );
}

function isAudioCachePolicy(value: unknown): value is AudioCachePolicy | undefined {
  return value === undefined || value === "none" || value === "account-unlocked";
}

function boundedString(value: unknown, maxLength: number, allowEmpty = true): value is string {
  return typeof value === "string" && value.length <= maxLength && (allowEmpty || value.length > 0);
}

/** Peaks are optional, bounded, and every entry must be a finite 0..1 float. */
export function sanitizedPeaks(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > PLAYER_PEAKS_MAX_ITEMS) {
    return undefined;
  }
  const peaks: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 1) {
      return undefined;
    }
    peaks.push(entry);
  }
  return peaks;
}

function sanitizedArtwork(value: unknown): MediaImage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.slice(0, PLAYER_ARTWORK_MAX_ITEMS).flatMap((candidate): MediaImage[] => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const image = candidate as Record<string, unknown>;
    if (!boundedString(image.src, PLAYER_AUDIO_URL_MAX_LENGTH, false)) return [];
    let parsed: URL;
    try {
      parsed = new URL(
        image.src,
        typeof window === "undefined" ? "https://skitza.app" : window.location.origin,
      );
    } catch {
      return [];
    }
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return [];
    }
    if (image.sizes !== undefined && !boundedString(image.sizes, PLAYER_METADATA_MAX_LENGTH)) {
      return [];
    }
    if (image.type !== undefined && !boundedString(image.type, PLAYER_METADATA_MAX_LENGTH)) {
      return [];
    }
    return [
      {
        src: image.src,
        ...(typeof image.sizes === "string" ? { sizes: image.sizes } : {}),
        ...(typeof image.type === "string" ? { type: image.type } : {}),
      },
    ];
  });
  return images.length > 0 ? images : undefined;
}

export function normalizePlayerTrack(value: unknown): PlayerTrack | null {
  if (typeof value !== "object" || value === null) return null;
  const track = value as Record<string, unknown>;
  if (
    !boundedString(track.id, PLAYER_ID_MAX_LENGTH, false) ||
    !(track.songId === undefined || boundedString(track.songId, PLAYER_ID_MAX_LENGTH, false)) ||
    !(
      track.audioUrl === null || boundedString(track.audioUrl, PLAYER_AUDIO_URL_MAX_LENGTH, false)
    ) ||
    !boundedString(track.title, PLAYER_METADATA_MAX_LENGTH) ||
    !boundedString(track.subtitle, PLAYER_METADATA_MAX_LENGTH) ||
    !isFiniteDuration(track.durationMs) ||
    !isAudioCachePolicy(track.cachePolicy)
  ) {
    return null;
  }
  const artwork = sanitizedArtwork(track.artwork);
  const peaks = sanitizedPeaks(track.peaks);
  return {
    id: track.id,
    ...(typeof track.songId === "string" ? { songId: track.songId } : {}),
    audioUrl: track.audioUrl,
    title: track.title,
    subtitle: track.subtitle,
    durationMs: track.durationMs,
    ...(track.cachePolicy === undefined ? {} : { cachePolicy: track.cachePolicy }),
    ...(artwork ? { artwork } : {}),
    ...(peaks ? { peaks } : {}),
  };
}

/** Optional queue on the structured set event: invalid entries are dropped. */
function normalizePlayerQueue(value: unknown): PlayerTrack[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const queue: PlayerTrack[] = [];
  for (const entry of value.slice(0, PLAYER_QUEUE_MAX_ITEMS)) {
    const track = normalizePlayerTrack(entry);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    queue.push(track);
  }
  return queue;
}

/**
 * Normalize both generations of the set-event contract:
 *
 * - legacy: CustomEvent<PlayerTrack>
 * - structured: CustomEvent<{ track, currentMs, playing }>
 *
 * Keeping this parser at the runtime boundary lets existing row/card
 * dispatchers remain unchanged while comparison surfaces can load a new
 * version without losing position or pause state.
 */
export function playbackSetCommandFromDetail(
  value: unknown,
): Extract<PlaybackCommand, { kind: "set" }> | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const structured = Object.prototype.hasOwnProperty.call(record, "track");
  const track = normalizePlayerTrack(structured ? record.track : value);
  if (!track) return null;
  if (!structured) return { kind: "set", track };
  if (
    typeof record.currentMs !== "number" ||
    !Number.isFinite(record.currentMs) ||
    typeof record.playing !== "boolean"
  ) {
    return null;
  }
  const queue = normalizePlayerQueue(record.queue);
  return {
    kind: "set",
    track,
    currentMs: record.currentMs,
    playing: record.playing,
    ...(queue ? { queue } : {}),
  };
}

function storedPlayerTrack(value: unknown, origin: string): PlayerTrack | null {
  const normalized = normalizePlayerTrack(value);
  if (!normalized?.audioUrl || !isAudioUrlSafeToRestore(normalized.audioUrl, origin)) {
    return null;
  }
  return {
    id: normalized.id,
    ...(normalized.songId === undefined ? {} : { songId: normalized.songId }),
    audioUrl: normalized.audioUrl,
    title: normalized.title,
    subtitle: normalized.subtitle,
    durationMs: normalized.durationMs,
    ...(normalized.cachePolicy === undefined ? {} : { cachePolicy: normalized.cachePolicy }),
    ...(normalized.peaks === undefined ? {} : { peaks: normalized.peaks }),
  };
}

export function restorePlaybackForAccount(accountId: string, origin: string): PlaybackSnapshot {
  if (typeof localStorage === "undefined") return EMPTY_PLAYBACK;
  try {
    const raw = localStorage.getItem(playbackStorageKey(accountId));
    if (!raw) return EMPTY_PLAYBACK;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const track = storedPlayerTrack(parsed.track, origin);
    if (
      parsed.version !== 1 ||
      !track ||
      typeof parsed.currentMs !== "number" ||
      !Number.isFinite(parsed.currentMs) ||
      parsed.currentMs < 0 ||
      typeof parsed.updatedAt !== "string" ||
      !Number.isFinite(new Date(parsed.updatedAt).getTime())
    ) {
      localStorage.removeItem(playbackStorageKey(accountId));
      return EMPTY_PLAYBACK;
    }
    const sanitized: StoredPlayback = {
      version: 1,
      track,
      currentMs: parsed.currentMs,
      updatedAt: parsed.updatedAt,
    };
    localStorage.setItem(playbackStorageKey(accountId), JSON.stringify(sanitized));
    const mode = readPlaybackMode();
    return {
      track,
      playing: false,
      currentMs: parsed.currentMs,
      audioDurationSec: null,
      volume: 1,
      queue: [track],
      loop: mode.loop,
      shuffle: mode.shuffle,
      shuffleOrder: mode.shuffle ? [track.id] : [],
    };
  } catch {
    try {
      localStorage.removeItem(playbackStorageKey(accountId));
    } catch {
      // Storage can be blocked or quota-constrained in private browsing.
    }
    return EMPTY_PLAYBACK;
  }
}

export function persistPlaybackSnapshotForAccount(
  accountId: string,
  snapshot: PlaybackSnapshot,
  origin: string,
  currentMs = snapshot.currentMs,
): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const track = storedPlayerTrack(snapshot.track, origin);
    if (!track) {
      localStorage.removeItem(playbackStorageKey(accountId));
      return false;
    }
    const stored: StoredPlayback = {
      version: 1,
      track,
      currentMs: Number.isFinite(currentMs) && currentMs >= 0 ? currentMs : snapshot.currentMs,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(playbackStorageKey(accountId), JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

function persistPlayback(origin: string, currentMs = playbackSnapshot.currentMs): void {
  if (!playbackAccountId) return;
  persistPlaybackSnapshotForAccount(playbackAccountId, playbackSnapshot, origin, currentMs);
}

export async function clearPlaybackForAccount(accountId: string): Promise<void> {
  playbackCacheWork.get(accountId)?.abort();
  playbackCacheWork.delete(accountId);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(playbackStorageKey(accountId));
    }
  } catch {
    // Continue with in-memory and byte-cache cleanup when storage is blocked.
  }
  if (playbackAccountId === accountId) {
    emitPlayback(EMPTY_PLAYBACK);
  }
  try {
    await clearRecentAudioForAccount(accountId);
  } catch {
    // CacheStorage is best effort and must never block account exit.
  }
}

export function clearPlaybackMediaSessionForPrivacy(): void {
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = null;
    } catch {
      // Partial Media Session implementations may reject metadata writes.
    }
    try {
      navigator.mediaSession.playbackState = "none";
    } catch {
      // Partial Media Session implementations may reject state writes.
    }
  }
}

export function resetPlaybackForPrivacy(): void {
  emitPlayback(EMPTY_PLAYBACK);
  clearPlaybackMediaSessionForPrivacy();
}

export function reducePlaybackSnapshot(
  current: PlaybackSnapshot,
  command: PlaybackCommand,
): PlaybackSnapshot {
  switch (command.kind) {
    case "set": {
      const currentMs = clampSeekMs(command.currentMs ?? 0, 0, command.track.durationMs);
      const requestedPlaying = command.playing ?? command.track.audioUrl !== null;
      const queue = nextQueueForTrack(current, command.track, command.queue);
      // Compare the songs, not the array identity: refreshing an entry
      // in place must not redraw the shuffle order, or every skip would
      // reshuffle and the queue would never be traversed once.
      const sameQueue =
        queue.length === current.queue.length &&
        queue.every((entry, index) => entry.id === current.queue[index]?.id);
      const shuffleOrder = current.shuffle
        ? !sameQueue || !current.shuffleOrder.includes(command.track.id)
          ? shuffledOrder(queue, command.track.id)
          : current.shuffleOrder
        : [];
      return {
        track: command.track,
        playing: command.track.audioUrl !== null && requestedPlaying,
        currentMs,
        audioDurationSec: null,
        volume: current.volume,
        queue,
        loop: current.loop,
        shuffle: current.shuffle,
        shuffleOrder,
      };
    }
    case "toggle":
      return current.track?.audioUrl ? { ...current, playing: !current.playing } : current;
    case "seek":
      return Number.isFinite(command.currentMs)
        ? { ...current, currentMs: Math.max(0, command.currentMs) }
        : current;
    case "volume":
      return { ...current, volume: clampVolume(command.volume, current.volume) };
    case "loop":
      return isLoopMode(command.mode) ? { ...current, loop: command.mode } : current;
    case "shuffle": {
      const enabled = command.enabled;
      if (enabled === current.shuffle) return current;
      return {
        ...current,
        shuffle: enabled,
        shuffleOrder: enabled ? shuffledOrder(current.queue, current.track?.id ?? null) : [],
      };
    }
    case "close":
      return { ...EMPTY_PLAYBACK, volume: current.volume, loop: current.loop, shuffle: current.shuffle };
  }
}

/**
 * Queue after loading `track`: an explicit queue wins (with the track
 * inserted at the front if the caller forgot it); otherwise keep the
 * current queue when it already holds the track, else a one-track queue.
 */
function nextQueueForTrack(
  current: PlaybackSnapshot,
  track: PlayerTrack,
  explicit: PlayerTrack[] | undefined,
): PlayerTrack[] {
  if (explicit) {
    return explicit.some((entry) => entry.id === track.id) ? explicit : [track, ...explicit];
  }
  if (current.queue.some((entry) => entry.id === track.id)) {
    return current.queue.map((entry) => (entry.id === track.id ? track : entry));
  }
  return [track];
}

function mediaArtwork(track: PlayerTrack): MediaImage[] {
  const supplied = sanitizedArtwork(track.artwork) ?? [];
  if (supplied.length > 0) return supplied;
  return [
    { src: "/icons/skitza-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/skitza-512.png", sizes: "512x512", type: "image/png" },
  ];
}

/**
 * The only <audio> owner in the application. Mount once under ClerkProvider.
 * Existing PLAYER_EVENTS remain the caller contract; route shells render
 * presentation-only players subscribed to this module store.
 */
export function AppPlaybackRuntime({ accountId }: { accountId: string | null | undefined }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const accountInitializedRef = useRef(false);
  const previousAccountRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const persistAtRef = useRef(0);
  const [resolvedSource, setResolvedSource] = useState<ResolvedAudioSource | null>(null);
  const [, setDesktopValidationVersion] = useState(0);
  const snapshot = usePlaybackSnapshot();
  const browserOnline = useSyncExternalStore(
    subscribeBrowserOnline,
    getBrowserOnlineSnapshot,
    () => true,
  );

  useEffect(
    () =>
      subscribeDesktopSessionValidation(() => {
        setDesktopValidationVersion((version) => version + 1);
      }),
    [],
  );

  const cacheAccountAccess =
    typeof navigator === "undefined"
      ? { kind: "web" as const }
      : desktopSessionCacheAccess(accountId ?? null, browserOnline);
  const desktopAudioAllowed = cacheAccountAccess.kind !== "desktop" || cacheAccountAccess.allowed;
  const desktopAudioAllowedRef = useRef(desktopAudioAllowed);
  desktopAudioAllowedRef.current = desktopAudioAllowed;

  useEffect(() => {
    if (desktopAudioAllowed) {
      return;
    }
    const audio = audioRef.current;
    audio?.pause();
    audio?.removeAttribute("src");
    audio?.load();
    emitPlayback({ ...EMPTY_PLAYBACK, volume: playbackSnapshot.volume });
    clearPlaybackMediaSessionForPrivacy();
    setResolvedSource(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, [desktopAudioAllowed]);

  useEffect(() => {
    if (accountId === undefined) return;
    void enforceRecentAudioAccountIsolation(accountId);
    const previous = previousAccountRef.current;
    if (accountInitializedRef.current && previous !== accountId) {
      resetPlaybackForPrivacy();
      if (previous) void clearPlaybackForAccount(previous);
    }
    accountInitializedRef.current = true;
    previousAccountRef.current = accountId;
    playbackAccountId = accountId;
    if (accountId && desktopAudioAllowed) {
      const restored = restorePlaybackForAccount(accountId, window.location.origin);
      const mode = readPlaybackMode();
      emitPlayback(restored.track ? restored : { ...EMPTY_PLAYBACK, ...mode });
    } else {
      emitPlayback(EMPTY_PLAYBACK);
    }
  }, [accountId, desktopAudioAllowed]);

  useEffect(() => {
    const onSet = (event: Event) => {
      if (!desktopAudioAllowedRef.current) return;
      const command = playbackSetCommandFromDetail((event as CustomEvent<unknown>).detail);
      if (!command) return;
      emitPlayback(reducePlaybackSnapshot(playbackSnapshot, command));
      persistPlayback(window.location.origin);
    };
    const onToggle = () => {
      if (!desktopAudioAllowedRef.current) return;
      updatePlayback((current) => reducePlaybackSnapshot(current, { kind: "toggle" }));
      persistPlayback(window.location.origin);
    };
    const onSeek = (event: Event) => {
      if (!desktopAudioAllowedRef.current) return;
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "number" || !Number.isFinite(detail)) return;
      const nextMs = Math.max(0, detail);
      if (audioRef.current) audioRef.current.currentTime = nextMs / 1000;
      updatePlayback((current) =>
        reducePlaybackSnapshot(current, { kind: "seek", currentMs: nextMs }),
      );
      persistPlayback(window.location.origin);
    };
    const onVolume = (event: Event) => {
      if (!desktopAudioAllowedRef.current) return;
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "number") return;
      updatePlayback((current) =>
        reducePlaybackSnapshot(current, { kind: "volume", volume: detail }),
      );
    };
    const onClose = () => {
      if (!desktopAudioAllowedRef.current) return;
      const currentAccount = playbackAccountId;
      emitPlayback(reducePlaybackSnapshot(playbackSnapshot, { kind: "close" }));
      if (currentAccount) {
        persistPlaybackSnapshotForAccount(currentAccount, EMPTY_PLAYBACK, window.location.origin);
      }
    };
    const loadNeighbor = (track: PlayerTrack) => {
      emitPlayback(
        reducePlaybackSnapshot(playbackSnapshot, {
          kind: "set",
          track,
          currentMs: 0,
          playing: playbackSnapshot.playing || !audioRef.current || audioRef.current.ended,
        }),
      );
      persistPlayback(window.location.origin, 0);
    };
    const onNext = () => {
      if (!desktopAudioAllowedRef.current) return;
      const { next } = queueNeighbors(playbackSnapshot);
      if (!next) return;
      if (next.id === playbackSnapshot.track?.id) {
        restartCurrentTrack();
        return;
      }
      loadNeighbor(next);
    };
    const restartCurrentTrack = () => {
      if (audioRef.current) audioRef.current.currentTime = 0;
      updatePlayback((current) => reducePlaybackSnapshot(current, { kind: "seek", currentMs: 0 }));
      persistPlayback(window.location.origin, 0);
    };
    const onPrev = () => {
      if (!desktopAudioAllowedRef.current) return;
      const liveMs = audioRef.current
        ? Math.floor(audioRef.current.currentTime * 1000)
        : playbackSnapshot.currentMs;
      const { previous } = queueNeighbors(playbackSnapshot);
      if (
        !previous ||
        previous.id === playbackSnapshot.track?.id ||
        liveMs >= PREVIOUS_TRACK_RESTART_MS
      ) {
        restartCurrentTrack();
        return;
      }
      loadNeighbor(previous);
    };
    const onLoop = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isLoopMode(detail)) return;
      updatePlayback((current) => reducePlaybackSnapshot(current, { kind: "loop", mode: detail }));
      persistPlaybackMode({ loop: playbackSnapshot.loop, shuffle: playbackSnapshot.shuffle });
    };
    const onShuffle = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "boolean") return;
      updatePlayback((current) =>
        reducePlaybackSnapshot(current, { kind: "shuffle", enabled: detail }),
      );
      persistPlaybackMode({ loop: playbackSnapshot.loop, shuffle: playbackSnapshot.shuffle });
    };
    window.addEventListener(EVT_SET, onSet as EventListener);
    window.addEventListener(EVT_TOGGLE, onToggle);
    window.addEventListener(EVT_SEEK, onSeek as EventListener);
    window.addEventListener(EVT_VOLUME, onVolume as EventListener);
    window.addEventListener(EVT_CLOSE, onClose);
    window.addEventListener(EVT_NEXT, onNext);
    window.addEventListener(EVT_PREV, onPrev);
    window.addEventListener(EVT_LOOP, onLoop as EventListener);
    window.addEventListener(EVT_SHUFFLE, onShuffle as EventListener);
    return () => {
      window.removeEventListener(EVT_SET, onSet as EventListener);
      window.removeEventListener(EVT_TOGGLE, onToggle);
      window.removeEventListener(EVT_SEEK, onSeek as EventListener);
      window.removeEventListener(EVT_VOLUME, onVolume as EventListener);
      window.removeEventListener(EVT_CLOSE, onClose);
      window.removeEventListener(EVT_NEXT, onNext);
      window.removeEventListener(EVT_PREV, onPrev);
      window.removeEventListener(EVT_LOOP, onLoop as EventListener);
      window.removeEventListener(EVT_SHUFFLE, onShuffle as EventListener);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = snapshot.volume;
  }, [snapshot.volume]);

  useEffect(() => {
    const flushCurrentPosition = () => {
      if (!desktopAudioAllowedRef.current) return;
      const currentTime = audioRef.current?.currentTime;
      const currentMs =
        typeof currentTime === "number" && Number.isFinite(currentTime)
          ? Math.max(0, Math.floor(currentTime * 1_000))
          : playbackSnapshot.currentMs;
      persistPlayback(window.location.origin, currentMs);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushCurrentPosition();
    };
    window.addEventListener("pagehide", flushCurrentPosition);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushCurrentPosition);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const effectAbort = new AbortController();
    const effectWasAborted = () => effectAbort.signal.aborted;
    const track = snapshot.track;
    const canonicalUrl = track?.audioUrl;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!track || !canonicalUrl) {
      setResolvedSource(null);
      return;
    }

    const origin = window.location.origin;
    const cacheAccountId = playbackAccountId;
    const desktopAccess = desktopSessionCacheAccess(cacheAccountId, browserOnline);
    if (desktopAccess.kind === "desktop" && !desktopAccess.allowed) {
      setResolvedSource(null);
      return;
    }
    if (!cacheAccountId || !isRecentAudioCacheEligible(canonicalUrl, track.cachePolicy, origin)) {
      setResolvedSource({
        accountId: cacheAccountId,
        trackId: track.id,
        canonicalUrl,
        playbackUrl: canonicalUrl,
        proofSource: "network",
      });
      return;
    }

    playbackCacheWork.get(cacheAccountId)?.abort();
    playbackCacheWork.set(cacheAccountId, effectAbort);
    setResolvedSource(null);
    void readRecentAudio(cacheAccountId, canonicalUrl, track.cachePolicy, origin).then(
      async (cached) => {
        if (effectWasAborted()) return;
        if (cached) {
          recordGate1AudioSource("recent-cache");
          const objectUrl = URL.createObjectURL(await cached.blob());
          if (effectWasAborted()) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          objectUrlRef.current = objectUrl;
          setResolvedSource({
            accountId: cacheAccountId,
            trackId: track.id,
            canonicalUrl,
            playbackUrl: objectUrl,
            proofSource: "recent-cache",
          });
          return;
        }
        recordGate1AudioSource("network");
        recordGate1AudioNetworkRequest();
        setResolvedSource({
          accountId: cacheAccountId,
          trackId: track.id,
          canonicalUrl,
          playbackUrl: canonicalUrl,
          proofSource: "network",
        });
        void cacheRecentAudio(
          cacheAccountId,
          canonicalUrl,
          track.cachePolicy,
          origin,
          effectAbort.signal,
        );
      },
    );
    return () => {
      effectAbort.abort();
      if (playbackCacheWork.get(cacheAccountId) === effectAbort) {
        playbackCacheWork.delete(cacheAccountId);
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [
    accountId,
    browserOnline,
    desktopAudioAllowed,
    snapshot.track?.id,
    snapshot.track?.audioUrl,
    snapshot.track?.cachePolicy,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const track = snapshot.track;
    if (
      !track?.audioUrl ||
      !resolvedSource ||
      resolvedSource.accountId !== playbackAccountId ||
      resolvedSource.trackId !== track.id ||
      resolvedSource.canonicalUrl !== track.audioUrl
    ) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    if (audio.src !== new URL(resolvedSource.playbackUrl, window.location.origin).toString()) {
      audio.src = resolvedSource.playbackUrl;
      audio.load();
    }
    if (snapshot.currentMs > 0) {
      audio.currentTime = snapshot.currentMs / 1000;
    }
    if (snapshot.playing) {
      recordGate1AudioSource(resolvedSource.proofSource);
      void audio.play().catch(() => {
        updatePlayback((current) => ({ ...current, playing: false }));
      });
    } else {
      audio.pause();
    }
  }, [accountId, resolvedSource, snapshot.playing, snapshot.track?.audioUrl, snapshot.track?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      const currentMs = Math.max(0, Math.floor(audio.currentTime * 1000));
      updatePlayback((current) => ({ ...current, currentMs }));
      window.dispatchEvent(new CustomEvent(EVT_TIME, { detail: currentMs }));
      if (Date.now() - persistAtRef.current >= 5_000) {
        persistAtRef.current = Date.now();
        persistPlayback(window.location.origin);
      }
      if ("mediaSession" in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: Math.min(audio.currentTime, audio.duration),
          });
        } catch {
          // Some Safari versions reject position state during metadata load.
        }
      }
    };
    const onMetadata = () => {
      updatePlayback((current) => ({
        ...current,
        audioDurationSec: Number.isFinite(audio.duration) ? audio.duration : null,
      }));
      if (playbackSnapshot.currentMs > 0) {
        audio.currentTime = playbackSnapshot.currentMs / 1000;
      }
    };
    const onPlay = () => {
      updatePlayback((current) => ({ ...current, playing: true }));
    };
    const onPlaying = () => {
      if (!audio.muted && audio.volume > 0) recordGate1AudioPlaying();
    };
    const onPause = () => {
      updatePlayback((current) => ({ ...current, playing: false }));
      persistPlayback(window.location.origin);
    };
    const onEnded = () => {
      const resolution = resolveTrackEnd(playbackSnapshot);
      if (resolution.kind === "restart") {
        audio.currentTime = 0;
        updatePlayback((current) =>
          reducePlaybackSnapshot(current, { kind: "seek", currentMs: 0 }),
        );
        void audio.play().catch(() => {
          updatePlayback((current) => ({ ...current, playing: false }));
        });
        return;
      }
      if (resolution.kind === "play") {
        emitPlayback(
          reducePlaybackSnapshot(playbackSnapshot, {
            kind: "set",
            track: resolution.track,
            currentMs: 0,
            playing: true,
          }),
        );
        persistPlayback(window.location.origin, 0);
        return;
      }
      updatePlayback((current) => ({ ...current, playing: false }));
      persistPlayback(window.location.origin);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!desktopAudioAllowed) {
      clearPlaybackMediaSessionForPrivacy();
      return;
    }
    const mediaSession = navigator.mediaSession;
    const track = snapshot.track;
    try {
      mediaSession.metadata =
        track && typeof MediaMetadata !== "undefined"
          ? new MediaMetadata({
              title: track.title,
              artist: track.subtitle,
              artwork: mediaArtwork(track),
            })
          : null;
    } catch {
      try {
        mediaSession.metadata = null;
      } catch {
        // Treat metadata as best effort on partial Safari implementations.
      }
    }
    try {
      mediaSession.playbackState = track ? (snapshot.playing ? "playing" : "paused") : "none";
    } catch {
      // Older Safari versions expose a partial Media Session object.
    }

    const seekBy = (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const next = Math.max(
        0,
        Math.min(
          Number.isFinite(audio.duration) ? audio.duration : Infinity,
          audio.currentTime + seconds,
        ),
      );
      playerSeek(next * 1000);
    };
    const installedActions: MediaSessionAction[] = [];
    const installAction = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        mediaSession.setActionHandler(action, handler);
        installedActions.push(action);
      } catch {
        // Safari exposes Media Session before it supports every action.
      }
    };
    installAction("play", () => {
      if (!playbackSnapshot.playing) playerToggle();
    });
    installAction("pause", () => {
      if (playbackSnapshot.playing) playerToggle();
    });
    installAction("seekbackward", (details) => {
      seekBy(-(details.seekOffset ?? 10));
    });
    installAction("seekforward", (details) => {
      seekBy(details.seekOffset ?? 10);
    });
    installAction("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        playerSeek(details.seekTime * 1000);
      }
    });
    const neighbors = queueNeighbors(snapshot);
    if (neighbors.next) {
      installAction("nexttrack", () => {
        playerNext();
      });
    }
    if (neighbors.previous || snapshot.track) {
      installAction("previoustrack", () => {
        playerPrevious();
      });
    }
    return () => {
      for (const action of installedActions) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Treat teardown as best effort on partial Safari implementations.
        }
      }
    };
  }, [
    desktopAudioAllowed,
    snapshot.playing,
    snapshot.track,
    snapshot.queue,
    snapshot.loop,
    snapshot.shuffle,
    snapshot.shuffleOrder,
  ]);

  return (
    <audio
      ref={audioRef}
      data-skitza-playback-engine
      preload="auto"
      className="sr-only"
      aria-hidden="true"
    />
  );
}
