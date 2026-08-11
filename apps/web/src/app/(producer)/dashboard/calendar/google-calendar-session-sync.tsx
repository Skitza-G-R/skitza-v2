"use client";

import { AlertTriangle, CalendarClock, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  getGoogleCalendarSyncStatus,
  restoreGoogleCalendarEvent,
  retryGoogleCalendarSync,
  type GoogleCalendarSessionActionResult,
} from "./google-calendar-session-actions";
import type {
  GoogleCalendarSessionSync,
  GoogleCalendarSessionSyncState,
} from "./google-calendar-session-sync-model";

type SyncAction = "retry" | "restore";
const PENDING_POLL_INTERVAL_MS = 1_500;

export function LiveGoogleCalendarSessionSyncStatus({
  bookingId,
  sync,
  compact = false,
}: {
  bookingId: string;
  sync: GoogleCalendarSessionSync | null | undefined;
  compact?: boolean;
}) {
  const [visibleState, setVisibleState] = useState<GoogleCalendarSessionSyncState | null>(
    sync?.state ?? null,
  );

  useEffect(() => {
    setVisibleState(sync?.state ?? null);
  }, [bookingId, sync?.state]);

  useEffect(() => {
    if (visibleState !== "pending") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const result = await getGoogleCalendarSyncStatus({ id: bookingId });
      if (cancelled) return;
      if (result.ok && result.status) {
        setVisibleState(result.status);
        if (result.status !== "pending") return;
      }
      timer = setTimeout(() => {
        void poll();
      }, PENDING_POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => {
      void poll();
    }, PENDING_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bookingId, visibleState]);

  return (
    <GoogleCalendarSessionSyncStatus
      bookingId={bookingId}
      sync={visibleState ? { state: visibleState } : null}
      compact={compact}
    />
  );
}

export function GoogleCalendarSessionSyncStatus({
  bookingId,
  sync,
  compact = false,
}: {
  bookingId: string;
  sync: GoogleCalendarSessionSync | null | undefined;
  compact?: boolean;
}) {
  const [pendingAction, setPendingAction] = useState<SyncAction | null>(null);
  const [successfulAction, setSuccessfulAction] = useState<SyncAction | null>(null);
  const [feedback, setFeedback] = useState("");
  const actionLockRef = useRef(false);
  const operationKeyRef = useRef<Readonly<{ identity: string; value: string }> | null>(null);
  const visibleIdentity = `${bookingId}:${sync?.state ?? "none"}`;

  useEffect(() => {
    actionLockRef.current = false;
    operationKeyRef.current = null;
    setPendingAction(null);
    setSuccessfulAction(null);
    setFeedback("");
  }, [visibleIdentity]);

  if (!sync || sync.state === "synced") return null;

  const details = syncDetails(sync.state);
  const action = sync.state === "missing" ? "restore" : details.canRetry ? "retry" : null;

  async function runAction(nextAction: SyncAction) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setPendingAction(nextAction);
    setSuccessfulAction(null);
    setFeedback("");
    const operationIdentity = `${visibleIdentity}:${nextAction}`;
    if (operationKeyRef.current?.identity !== operationIdentity) {
      operationKeyRef.current = {
        identity: operationIdentity,
        value: createOperationKey(nextAction, bookingId),
      };
    }
    const operationKey = operationKeyRef.current.value;
    let result: GoogleCalendarSessionActionResult;
    try {
      result =
        nextAction === "restore"
          ? await restoreGoogleCalendarEvent({ id: bookingId, operationKey })
          : await retryGoogleCalendarSync({ id: bookingId, operationKey });
    } catch {
      result = { ok: false, error: "Could not update Google Calendar. Try again." };
    }
    setFeedback(
      result.ok
        ? nextAction === "restore"
          ? "Google event restore started."
          : "Calendar sync retry started."
        : result.error,
    );
    if (result.ok) {
      setSuccessfulAction(nextAction);
    } else {
      actionLockRef.current = false;
    }
    setPendingAction(null);
  }

  const actionLocked = pendingAction !== null || successfulAction !== null;

  return (
    <div
      className={[
        "mt-2 rounded-[var(--radius-md)] border px-2.5 py-2",
        sync.state === "pending"
          ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))]"
          : "border-[rgb(var(--fg-warning)/0.3)] bg-[rgb(var(--fg-warning)/0.08)]",
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className="inline-flex min-w-0 flex-1 items-start gap-1.5 text-[11px] leading-snug text-[rgb(var(--fg-secondary))]"
          style={{ fontWeight: 650 }}
        >
          {sync.state === "pending" ? (
            <Loader2
              className="mt-px shrink-0 animate-spin motion-reduce:animate-none"
              size={13}
              aria-hidden
            />
          ) : sync.state === "disconnected" ? (
            <CalendarClock className="mt-px shrink-0" size={13} aria-hidden />
          ) : (
            <AlertTriangle className="mt-px shrink-0" size={13} aria-hidden />
          )}
          <span>{details.label}</span>
        </span>
        {action ? (
          <button
            type="button"
            disabled={actionLocked}
            aria-busy={pendingAction !== null ? "true" : undefined}
            onClick={() => void runAction(action)}
            className={[
              "sk-press inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--bg-overlay))] disabled:cursor-not-allowed disabled:opacity-65",
              "focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] focus-visible:outline-none",
              compact ? "lg:h-8 lg:px-2" : "lg:h-8",
            ].join(" ")}
          >
            {pendingAction ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" size={13} aria-hidden />
            ) : (
              <RotateCcw size={13} aria-hidden />
            )}
            {pendingAction
              ? "Working…"
              : successfulAction
                ? "Started"
                : action === "restore"
                  ? "Restore event"
                  : "Retry"}
          </button>
        ) : null}
      </div>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-h-[1px] text-[10.5px] leading-snug text-[rgb(var(--fg-muted))]"
      >
        {feedback ? <span className="mt-1.5 block">{feedback}</span> : ""}
      </p>
    </div>
  );
}

function syncDetails(state: GoogleCalendarSessionSyncState): {
  label: string;
  canRetry: boolean;
} {
  switch (state) {
    case "synced":
      return { label: "Synced", canRetry: false };
    case "pending":
      return { label: "Syncing calendar", canRetry: false };
    case "not_synced":
      return { label: "Not synced", canRetry: true };
    case "missing":
      return { label: "Google event missing", canRetry: false };
    case "conflict":
      return {
        label: "Google change couldn’t be applied. Skitza time was kept.",
        canRetry: true,
      };
    case "disconnected":
      return { label: "Google disconnected. Reconnect above to sync.", canRetry: false };
  }
}

function createOperationKey(action: SyncAction, bookingId: string): string {
  const nonce =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `producer-google-${action}:${bookingId}:${nonce}`;
}
