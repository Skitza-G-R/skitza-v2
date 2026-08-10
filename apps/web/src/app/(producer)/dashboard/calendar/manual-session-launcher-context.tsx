"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ManualSessionDraft, ManualSessionSlot } from "./calendar-slot";
import type { SessionListItem } from "./session-row";

export type SessionManagementStep = "summary" | "reschedule" | "cancel";

type ManualSessionLauncherContextValue = {
  openManualSession: (slot: ManualSessionSlot | null) => void;
  openSessionManagement: (session: SessionListItem, step?: SessionManagementStep) => void;
  provisionalSlot: ManualSessionDraft | null;
  reportGoogleBusyProtection: (reduced: boolean) => void;
};

const defaultValue: ManualSessionLauncherContextValue = {
  openManualSession: () => undefined,
  openSessionManagement: () => undefined,
  provisionalSlot: null,
  reportGoogleBusyProtection: () => undefined,
};

const ManualSessionLauncherContext = createContext<ManualSessionLauncherContextValue>(defaultValue);

export function ManualSessionLauncherProvider({
  children,
  openManualSession = defaultValue.openManualSession,
  openSessionManagement = defaultValue.openSessionManagement,
  provisionalSlot = null,
  reportGoogleBusyProtection = defaultValue.reportGoogleBusyProtection,
}: {
  children: ReactNode;
  openManualSession?: ManualSessionLauncherContextValue["openManualSession"];
  openSessionManagement?: ManualSessionLauncherContextValue["openSessionManagement"];
  provisionalSlot?: ManualSessionDraft | null;
  reportGoogleBusyProtection?: ManualSessionLauncherContextValue["reportGoogleBusyProtection"];
}) {
  return (
    <ManualSessionLauncherContext.Provider
      value={{
        openManualSession,
        openSessionManagement,
        provisionalSlot,
        reportGoogleBusyProtection,
      }}
    >
      {children}
    </ManualSessionLauncherContext.Provider>
  );
}

export function useManualSessionLauncher(): ManualSessionLauncherContextValue {
  return useContext(ManualSessionLauncherContext);
}
