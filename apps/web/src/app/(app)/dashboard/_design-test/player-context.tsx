"use client";

// React glue for the pure player-reducer.ts state machine. Provides a
// PlayerProvider that owns the useReducer + a soft progress ticker, and
// a usePlayer() hook that returns { state, play, toggle, scrub, close }.
//
// The ticker is intentionally fake: this sandbox has no actual audio
// pipeline, just a visual progress bar that should advance when the
// user hits play. We dispatch a "tick" action every 250ms with a delta
// proportional to the track's duration. When a track ends, the reducer
// auto-pauses (clamps progress at 1).

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";

import {
  initialPlayerState,
  playerReducer,
  type PlayerState,
  type Track,
} from "./player-reducer";

type PlayerContextValue = {
  state: PlayerState;
  play: (track: Track) => void;
  toggle: () => void;
  scrub: (progress: number) => void;
  close: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

const TICK_MS = 250;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playerReducer, initialPlayerState);

  const play = useCallback((track: Track) => {
    dispatch({ type: "play", track });
  }, []);
  const toggle = useCallback(() => {
    dispatch({ type: "toggle" });
  }, []);
  const scrub = useCallback((progress: number) => {
    dispatch({ type: "scrub", progress });
  }, []);
  const close = useCallback(() => {
    dispatch({ type: "close" });
  }, []);

  // Soft progress ticker. Only runs while a track is loaded AND playing.
  // useEffect deps array — TS doesn't narrow `state` for the deps so we
  // depend on the whole state object.
  useEffect(() => {
    if (state.current === null) return;
    if (!state.playing) return;
    const durationSec = state.current.durationSec;
    if (durationSec <= 0) return;
    const delta = TICK_MS / 1000 / durationSec;
    const id = window.setInterval(() => {
      dispatch({ type: "tick", delta });
    }, TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [state]);

  const value = useMemo<PlayerContextValue>(
    () => ({ state, play, toggle, scrub, close }),
    [state, play, toggle, scrub, close],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (ctx === null) {
    throw new Error("usePlayer must be used inside <PlayerProvider>");
  }
  return ctx;
}

// Convenience selector for "is this specific track currently playing?"
// — used by PlayCircle wired sites to flip the play/pause icon.
export function useIsTrackPlaying(trackId: string): boolean {
  const { state } = usePlayer();
  return state.current !== null && state.current.id === trackId && state.playing;
}
