// Pure player state machine for the design-test surface. Has zero
// React imports so it ships in both server and client bundles, and the
// 13 unit tests in __tests__/player-reducer.test.ts pin every action.
//
// Discriminated union: when `current` is null, `playing` and `progress`
// don't exist on the state at all — making "scrub a non-existent track"
// impossible to express rather than something we have to guard at every
// dispatch site.

export type Track = {
  id: string;
  title: string;
  project: string;
  duration: string; // formatted "MM:SS"
  durationSec: number;
  grad: string; // CSS gradient class (e.g. "grad-amber")
};

export type PlayerState =
  | { current: null }
  | { current: Track; playing: boolean; progress: number };

export type PlayerAction =
  | { type: "play"; track: Track }
  | { type: "toggle" }
  | { type: "scrub"; progress: number }
  | { type: "close" }
  | { type: "tick"; delta: number };

export const initialPlayerState: PlayerState = { current: null };

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export function playerReducer(
  state: PlayerState,
  action: PlayerAction,
): PlayerState {
  switch (action.type) {
    case "play": {
      // Same track: resume from existing progress.
      // Different track (or none): start fresh at progress 0.
      const sameTrack =
        state.current !== null && state.current.id === action.track.id;
      if (sameTrack && state.current !== null) {
        return {
          current: action.track,
          playing: true,
          progress: state.progress,
        };
      }
      return { current: action.track, playing: true, progress: 0 };
    }

    case "toggle": {
      if (state.current === null) return state;
      return { ...state, playing: !state.playing };
    }

    case "scrub": {
      if (state.current === null) return state;
      return { ...state, progress: clamp(action.progress, 0, 1) };
    }

    case "close": {
      return initialPlayerState;
    }

    case "tick": {
      if (state.current === null) return state;
      if (!state.playing) return state;
      const next = state.progress + action.delta;
      if (next >= 1) {
        // Track ended: clamp at 1 and auto-pause.
        return { ...state, progress: 1, playing: false };
      }
      return { ...state, progress: next };
    }
  }
}
