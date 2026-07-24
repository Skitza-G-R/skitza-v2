"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  cacheRecentAudio,
  clearRecentAudioForAccount,
  isAudioUrlSafeToRestore,
  isRecentAudioCacheEligible,
  readRecentAudio,
  type AudioCachePolicy,
} from "~/lib/audio/recent-audio-cache";

export type PlayerTrack = {
  id: string;
  audioUrl: string | null;
  title: string;
  subtitle: string;
  durationMs: number | null;
  artwork?: MediaImage[];
  cachePolicy?: AudioCachePolicy;
};

export type PlaybackSnapshot = {
  track: PlayerTrack | null;
  playing: boolean;
  currentMs: number;
  audioDurationSec: number | null;
};

type ResolvedAudioSource = {
  accountId: string | null;
  trackId: string;
  canonicalUrl: string;
  playbackUrl: string;
};

const EMPTY_PLAYBACK: PlaybackSnapshot = {
  track: null,
  playing: false,
  currentMs: 0,
  audioDurationSec: null,
};

const EVT_SET = "skitza:player:set";
const EVT_TOGGLE = "skitza:player:toggle";
const EVT_SEEK = "skitza:player:seek";
const EVT_CLOSE = "skitza:player:close";
const EVT_TIME = "skitza:player:time";

export const PLAYER_EVENTS = {
  set: EVT_SET,
  toggle: EVT_TOGGLE,
  seek: EVT_SEEK,
  close: EVT_CLOSE,
  time: EVT_TIME,
} as const;

const PLAYBACK_STORAGE_PREFIX = "skitza:playback:v1:";

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
    emitPlayback(EMPTY_PLAYBACK);
    return;
  }
  if (playbackSnapshot.track?.id !== next.trackId) return;
  updatePlayback((current) => ({ ...current, playing: next.playing }));
}

export function playerPlay(track: PlayerTrack): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_SET, { detail: track }));
}

export function playerToggle(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_TOGGLE));
}

export function playerSeek(ms: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_SEEK, { detail: ms }));
}

export function playerClose(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT_CLOSE));
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

function isFiniteDuration(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isStoredTrack(value: unknown, origin: string): value is PlayerTrack {
  if (typeof value !== "object" || value === null) return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.id === "string" &&
    track.id.length > 0 &&
    typeof track.audioUrl === "string" &&
    isAudioUrlSafeToRestore(track.audioUrl, origin) &&
    typeof track.title === "string" &&
    typeof track.subtitle === "string" &&
    isFiniteDuration(track.durationMs) &&
    (track.cachePolicy === undefined ||
      track.cachePolicy === "none" ||
      track.cachePolicy === "public-unlocked")
  );
}

function restorePlayback(accountId: string, origin: string): PlaybackSnapshot {
  if (typeof localStorage === "undefined") return EMPTY_PLAYBACK;
  const raw = localStorage.getItem(playbackStorageKey(accountId));
  if (!raw) return EMPTY_PLAYBACK;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      !isStoredTrack(parsed.track, origin) ||
      typeof parsed.currentMs !== "number" ||
      !Number.isFinite(parsed.currentMs) ||
      parsed.currentMs < 0 ||
      typeof parsed.updatedAt !== "string" ||
      !Number.isFinite(new Date(parsed.updatedAt).getTime())
    ) {
      localStorage.removeItem(playbackStorageKey(accountId));
      return EMPTY_PLAYBACK;
    }
    return {
      track: parsed.track,
      playing: false,
      currentMs: parsed.currentMs,
      audioDurationSec: null,
    };
  } catch {
    localStorage.removeItem(playbackStorageKey(accountId));
    return EMPTY_PLAYBACK;
  }
}

function persistPlayback(origin: string): void {
  if (
    !playbackAccountId ||
    typeof localStorage === "undefined" ||
    !playbackSnapshot.track?.audioUrl ||
    !isAudioUrlSafeToRestore(playbackSnapshot.track.audioUrl, origin)
  ) {
    if (playbackAccountId && typeof localStorage !== "undefined") {
      localStorage.removeItem(playbackStorageKey(playbackAccountId));
    }
    return;
  }
  const stored: StoredPlayback = {
    version: 1,
    track: playbackSnapshot.track,
    currentMs: playbackSnapshot.currentMs,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(playbackStorageKey(playbackAccountId), JSON.stringify(stored));
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

export function resetPlaybackForPrivacy(): void {
  emitPlayback(EMPTY_PLAYBACK);
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

function validPlayerTrack(value: unknown): value is PlayerTrack {
  if (typeof value !== "object" || value === null) return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.id === "string" &&
    track.id.length > 0 &&
    (typeof track.audioUrl === "string" || track.audioUrl === null) &&
    typeof track.title === "string" &&
    typeof track.subtitle === "string" &&
    isFiniteDuration(track.durationMs)
  );
}

function mediaArtwork(track: PlayerTrack): MediaImage[] {
  const supplied = Array.isArray(track.artwork)
    ? track.artwork.filter((item) => typeof item.src === "string" && item.src.length > 0)
    : [];
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
  const snapshot = usePlaybackSnapshot();

  useEffect(() => {
    if (accountId === undefined) return;
    const previous = previousAccountRef.current;
    if (accountInitializedRef.current && previous !== accountId) {
      resetPlaybackForPrivacy();
      if (previous) void clearPlaybackForAccount(previous);
    }
    accountInitializedRef.current = true;
    previousAccountRef.current = accountId;
    playbackAccountId = accountId;
    if (accountId) {
      emitPlayback(restorePlayback(accountId, window.location.origin));
    } else {
      emitPlayback(EMPTY_PLAYBACK);
    }
  }, [accountId]);

  useEffect(() => {
    const onSet = (event: Event) => {
      const track = (event as CustomEvent<unknown>).detail;
      if (!validPlayerTrack(track)) return;
      emitPlayback({
        track,
        playing: track.audioUrl !== null,
        currentMs: 0,
        audioDurationSec: null,
      });
      persistPlayback(window.location.origin);
    };
    const onToggle = () => {
      updatePlayback((current) =>
        current.track?.audioUrl ? { ...current, playing: !current.playing } : current,
      );
      persistPlayback(window.location.origin);
    };
    const onSeek = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "number" || !Number.isFinite(detail)) return;
      const nextMs = Math.max(0, detail);
      if (audioRef.current) audioRef.current.currentTime = nextMs / 1000;
      updatePlayback((current) => ({ ...current, currentMs: nextMs }));
      persistPlayback(window.location.origin);
    };
    const onClose = () => {
      const currentAccount = playbackAccountId;
      emitPlayback(EMPTY_PLAYBACK);
      if (currentAccount && typeof localStorage !== "undefined") {
        localStorage.removeItem(playbackStorageKey(currentAccount));
      }
    };
    window.addEventListener(EVT_SET, onSet as EventListener);
    window.addEventListener(EVT_TOGGLE, onToggle);
    window.addEventListener(EVT_SEEK, onSeek as EventListener);
    window.addEventListener(EVT_CLOSE, onClose);
    return () => {
      window.removeEventListener(EVT_SET, onSet as EventListener);
      window.removeEventListener(EVT_TOGGLE, onToggle);
      window.removeEventListener(EVT_SEEK, onSeek as EventListener);
      window.removeEventListener(EVT_CLOSE, onClose);
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
    if (!cacheAccountId || !isRecentAudioCacheEligible(canonicalUrl, track.cachePolicy, origin)) {
      setResolvedSource({
        accountId: cacheAccountId,
        trackId: track.id,
        canonicalUrl,
        playbackUrl: canonicalUrl,
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
          });
          return;
        }
        setResolvedSource({
          accountId: cacheAccountId,
          trackId: track.id,
          canonicalUrl,
          playbackUrl: canonicalUrl,
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
  }, [accountId, snapshot.track?.id, snapshot.track?.audioUrl, snapshot.track?.cachePolicy]);

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
    const onPause = () => {
      updatePlayback((current) => ({ ...current, playing: false }));
      persistPlayback(window.location.origin);
    };
    const onEnded = () => {
      updatePlayback((current) => ({ ...current, playing: false }));
      persistPlayback(window.location.origin);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
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
    return () => {
      for (const action of installedActions) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Treat teardown as best effort on partial Safari implementations.
        }
      }
    };
  }, [snapshot.playing, snapshot.track]);

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
