"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from "react";

export type Track = {
  id: string;
  url: string;
  title: string;
  producerName: string;
  artworkUrl: string | null;
};

export type AudioState = {
  currentTrack: Track | null;
  isPlaying: boolean;
  position: number; // seconds
  duration: number; // seconds; 0 until metadata loads
  pendingComment: { time: number } | null;
};

type AudioAction =
  | { type: "PLAY_TRACK"; track: Track }
  | { type: "TOGGLE_PLAY" }
  | { type: "SET_POSITION"; position: number }
  | { type: "SET_DURATION"; duration: number }
  | { type: "REQUEST_COMMENT" }
  | { type: "DISMISS_COMMENT" };

export function audioReducer(state: AudioState, action: AudioAction): AudioState {
  switch (action.type) {
    case "PLAY_TRACK":
      return { ...state, currentTrack: action.track, isPlaying: true, position: 0, pendingComment: null };
    case "TOGGLE_PLAY":
      if (!state.currentTrack) return state;
      return { ...state, isPlaying: !state.isPlaying };
    case "SET_POSITION":
      return { ...state, position: action.position };
    case "SET_DURATION":
      return { ...state, duration: action.duration };
    case "REQUEST_COMMENT":
      if (!state.currentTrack) return state;
      return { ...state, isPlaying: false, pendingComment: { time: state.position } };
    case "DISMISS_COMMENT":
      return { ...state, pendingComment: null };
  }
}

const initialState: AudioState = {
  currentTrack: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  pendingComment: null,
};

type ContextShape = {
  state: AudioState;
  playTrack: (track: Track) => void;
  togglePlay: () => void;
  requestComment: () => void;
  dismissComment: () => void;
  // Internal: called by the audio element via ref
  setPosition: (s: number) => void;
  setDuration: (s: number) => void;
};

const ArtistAudioContext = createContext<ContextShape | null>(null);

export function ArtistAudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(audioReducer, initialState);
  const playTrack = useCallback((track: Track) => {
    dispatch({ type: "PLAY_TRACK", track });
  }, []);
  const togglePlay = useCallback(() => {
    dispatch({ type: "TOGGLE_PLAY" });
  }, []);
  const requestComment = useCallback(() => {
    dispatch({ type: "REQUEST_COMMENT" });
  }, []);
  const dismissComment = useCallback(() => {
    dispatch({ type: "DISMISS_COMMENT" });
  }, []);
  const setPosition = useCallback((s: number) => {
    dispatch({ type: "SET_POSITION", position: s });
  }, []);
  const setDuration = useCallback((s: number) => {
    dispatch({ type: "SET_DURATION", duration: s });
  }, []);

  return (
    <ArtistAudioContext.Provider
      value={{ state, playTrack, togglePlay, requestComment, dismissComment, setPosition, setDuration }}
    >
      {children}
    </ArtistAudioContext.Provider>
  );
}

export function useArtistAudio() {
  const ctx = useContext(ArtistAudioContext);
  if (!ctx) throw new Error("useArtistAudio must be used inside <ArtistAudioProvider>");
  return ctx;
}
