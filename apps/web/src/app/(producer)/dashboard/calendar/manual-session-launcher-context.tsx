"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ManualSessionDraft, ManualSessionSlot } from "./calendar-slot";

type ManualSessionLauncherContextValue = {
  openManualSession: (slot: ManualSessionSlot | null) => void;
  provisionalSlot: ManualSessionDraft | null;
};

const defaultValue: ManualSessionLauncherContextValue = {
  openManualSession: () => undefined,
  provisionalSlot: null,
};

const ManualSessionLauncherContext = createContext<ManualSessionLauncherContextValue>(defaultValue);

export function ManualSessionLauncherProvider({
  children,
  openManualSession = defaultValue.openManualSession,
  provisionalSlot = null,
}: {
  children: ReactNode;
  openManualSession?: ManualSessionLauncherContextValue["openManualSession"];
  provisionalSlot?: ManualSessionDraft | null;
}) {
  return (
    <ManualSessionLauncherContext.Provider value={{ openManualSession, provisionalSlot }}>
      {children}
    </ManualSessionLauncherContext.Provider>
  );
}

export function useManualSessionLauncher(): ManualSessionLauncherContextValue {
  return useContext(ManualSessionLauncherContext);
}
