"use client";

import { useEffect, useMemo } from "react";

import { useToast } from "~/components/ui/toast";

import { GoogleCalendarControl } from "./google-calendar-control";
import {
  disconnectGoogleCalendar,
  refreshGoogleCalendarCalendars,
  saveGoogleCalendarSelection,
} from "./google-calendar-actions";
import type {
  GoogleCalendarActionResult,
  GoogleCalendarControlActions,
  GoogleCalendarUiModel,
} from "./google-calendar-ui-model";

const CONNECT_PATH = "/api/integrations/google-calendar/connect";

export type GoogleCalendarCallbackStatus =
  | "selection"
  | "connected"
  | "denied"
  | "wrong-account"
  | "reconnect"
  | "error";

function navigateBrowser(href: string): void {
  window.location.assign(href);
}

function openGoogleAuthorization(
  intent: "connect" | "reconnect" | "switch_account",
  navigate: (href: string) => void,
): Promise<GoogleCalendarActionResult> {
  if (!navigator.onLine) return Promise.resolve({ ok: false, reason: "offline" });
  const query = new URLSearchParams({ intent });
  navigate(`${CONNECT_PATH}?${query.toString()}`);
  return Promise.resolve({ ok: true });
}

export function GoogleCalendarControlBoundary({
  model,
  callbackStatus,
  navigate = navigateBrowser,
}: {
  model: GoogleCalendarUiModel;
  callbackStatus?: GoogleCalendarCallbackStatus;
  navigate?: (href: string) => void;
}) {
  const { toast } = useToast();
  useEffect(() => {
    if (!callbackStatus || callbackStatus === "selection") return;
    const message =
      callbackStatus === "connected"
        ? "Google Calendar connected."
        : callbackStatus === "denied"
          ? "Google Calendar permission was not granted."
          : callbackStatus === "wrong-account"
            ? "Choose the Google account already connected to Skitza."
            : callbackStatus === "reconnect"
              ? "Google needs permission again. Reconnect to continue."
              : "Google Calendar could not be connected. Try again.";
    toast(message, callbackStatus === "connected" ? "success" : "error");
  }, [callbackStatus, toast]);

  const actions = useMemo<GoogleCalendarControlActions>(
    () => ({
      connect: () => openGoogleAuthorization("connect", navigate),
      reconnect: () => openGoogleAuthorization("reconnect", navigate),
      confirmAccountSwitch: () => openGoogleAuthorization("switch_account", navigate),
      refreshCalendars: () => {
        if (!navigator.onLine) return Promise.resolve({ ok: false, reason: "offline" });
        return refreshGoogleCalendarCalendars();
      },
      saveSelection: (selection) => {
        if (!navigator.onLine) return Promise.resolve({ ok: false, reason: "offline" });
        return saveGoogleCalendarSelection(selection);
      },
      disconnect: () => {
        if (!navigator.onLine) return Promise.resolve({ ok: false, reason: "offline" });
        return disconnectGoogleCalendar();
      },
    }),
    [navigate],
  );

  return <GoogleCalendarControl model={model} actions={actions} />;
}
