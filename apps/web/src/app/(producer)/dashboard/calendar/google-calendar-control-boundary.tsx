"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { useToast } from "~/components/ui/toast";

import { GoogleCalendarControl } from "./google-calendar-control";
import {
  clearGoogleCalendarSyncIssue,
  disconnectGoogleCalendar,
  refreshGoogleCalendarCalendars,
  repairGoogleCalendarSync,
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

function repairSignature(model: GoogleCalendarUiModel): string | null {
  if (model.status !== "connected") return null;
  const attention =
    model.syncSummary.notSynced + model.syncSummary.missing + model.syncSummary.conflicts;
  if (attention + model.syncSummary.syncing === 0) return null;
  return [
    model.syncSummary.syncing,
    model.syncSummary.notSynced,
    model.syncSummary.missing,
    model.syncSummary.conflicts,
    ...model.syncSummary.issues.flatMap((issue) => [
      issue.bookingId,
      issue.syncState,
      issue.startsAtIso,
    ]),
  ].join(":");
}

export function GoogleCalendarControlBoundary({
  model,
  timeZone = "UTC",
  callbackStatus,
  navigate = navigateBrowser,
}: {
  model: GoogleCalendarUiModel;
  timeZone?: string;
  callbackStatus?: GoogleCalendarCallbackStatus;
  navigate?: (href: string) => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const repairInFlight = useRef(false);
  const syncRepairSignature = repairSignature(model);
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

  useEffect(() => {
    if (!syncRepairSignature || !navigator.onLine) return;
    let active = true;
    // SK-280: an unrepairable sync issue used to re-run the repair and force
    // a full page refresh every 30 seconds forever. A successful repair
    // changes the model (and with it this effect's signature), so a signature
    // that survives three attempts is terminal — stop retrying until it
    // changes or the page is reopened.
    let attempts = 0;
    let intervalId = 0;
    const repair = async () => {
      if (repairInFlight.current || !navigator.onLine) return;
      if (attempts >= 3) {
        window.clearInterval(intervalId);
        return;
      }
      attempts += 1;
      repairInFlight.current = true;
      try {
        const result = await repairGoogleCalendarSync({ forcePending: false });
        if (active && result.ok) router.refresh();
      } catch {
        // The durable retry remains available to the next bounded wake.
      } finally {
        repairInFlight.current = false;
      }
    };
    void repair();
    intervalId = window.setInterval(() => void repair(), 30_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [router, syncRepairSignature]);

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
      repairSync: async () => {
        if (!navigator.onLine) return { ok: false, reason: "offline" };
        const result = await repairGoogleCalendarSync({ forcePending: true });
        if (result.ok) router.refresh();
        return result;
      },
      clearSyncIssue: async (issue) => {
        if (!navigator.onLine) return { ok: false, reason: "offline" };
        const result = await clearGoogleCalendarSyncIssue(issue);
        if (result.ok) router.refresh();
        return result;
      },
    }),
    [navigate, router],
  );

  return <GoogleCalendarControl model={model} actions={actions} timeZone={timeZone} />;
}
