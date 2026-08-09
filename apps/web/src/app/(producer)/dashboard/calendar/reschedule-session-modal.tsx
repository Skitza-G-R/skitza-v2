"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";

import {
  previewSessionReschedule,
  rescheduleSession,
  type ManualWarningCode,
} from "./calendar-actions";
import { newCalendarOperationKey } from "./calendar-operation-key";
import { GoogleBusyProtectionWarning } from "./google-busy-protection-warning";
import type { SessionListItem } from "./session-row";

type Preview = Extract<
  Awaited<ReturnType<typeof previewSessionReschedule>>,
  { ok: true }
>["preview"];

function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function RescheduleSessionModal({
  open,
  onOpenChange,
  session,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  session: SessionListItem;
  timeZone: string;
}) {
  const [studioDate, setStudioDate] = useState("");
  const [studioTime, setStudioTime] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const operationKey = useRef("");
  const online = useOnlineStatus();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setStudioDate("");
    setStudioTime("");
    setPreview(null);
    setConfirmWarnings(false);
    setError(null);
    operationKey.current = newCalendarOperationKey(`producer-reschedule:${session.id}`);
  }, [open, session.id]);

  function input() {
    const studioStartMin = parseTime(studioTime);
    if (!studioDate || studioStartMin === null) return null;
    return { id: session.id, studioDate, studioStartMin };
  }

  function resetPreview() {
    setPreview(null);
    setConfirmWarnings(false);
    setError(null);
    operationKey.current = newCalendarOperationKey(`producer-reschedule:${session.id}`);
  }

  function check() {
    const next = input();
    if (!next || isPending) {
      setError("Choose the new studio date and start time.");
      return;
    }
    if (!online) {
      setError("Reconnect to reschedule this session.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await previewSessionReschedule(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);
      if (result.preview.hardConflicts.length > 0) {
        setError(result.preview.hardConflicts.map((issue) => issue.message).join(" "));
        return;
      }
      if (
        result.preview.warnings.length > 0 ||
        result.preview.googleCalendarProtection === "reduced"
      ) {
        setConfirmWarnings(true);
        return;
      }
      await save(next, []);
    });
  }

  async function save(
    next: NonNullable<ReturnType<typeof input>>,
    acknowledgedWarnings: ManualWarningCode[],
  ) {
    const result = await rescheduleSession({
      ...next,
      operationKey: operationKey.current,
      acknowledgedWarnings,
    });
    if (!result.ok) {
      setConfirmWarnings(false);
      setError(result.error);
      return;
    }
    toast(
      result.googleCalendarProtection === "reduced"
        ? "Session rescheduled. Google busy-time protection was limited for this check; the artist’s calendar update is queued."
        : "Session rescheduled. The artist’s calendar update is queued.",
      result.googleCalendarProtection === "reduced" ? "info" : "success",
    );
    onOpenChange(false);
  }

  function saveAnyway() {
    const next = input();
    if (!next || !preview || isPending) return;
    startTransition(async () => {
      await save(
        next,
        preview.warnings.map((warning) => warning.code as ManualWarningCode),
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[94dvh] !max-w-[520px] flex-col gap-0 overflow-hidden !p-0">
        <header className="shrink-0 border-b border-[rgb(var(--border-subtle))] px-5 py-5 pe-16 sm:px-7">
          <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-dark))] uppercase">
            Change confirmed session
          </p>
          <DialogTitle className="mt-1 text-[24px]">Reschedule session</DialogTitle>
          <DialogDescription className="mt-1.5">
            Choose a new studio time for {session.artistName}. The duration and billing treatment
            stay the same.
          </DialogDescription>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {confirmWarnings && preview ? (
            <div>
              <h2 className="font-display text-xl font-bold">
                {preview.warnings.length > 0 ? "Check these warnings" : "Review this change"}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                {preview.warnings.length > 0
                  ? "This time does not overlap another Skitza session. Review these availability warnings before rescheduling."
                  : "This time does not overlap another Skitza session, but Google busy times could not be checked."}
              </p>
              {preview.googleCalendarProtection === "reduced" ? (
                <GoogleBusyProtectionWarning embedded />
              ) : null}
              {preview.warnings.length > 0 ? (
                <ul className="mt-5 space-y-3" aria-label="Scheduling warnings">
                  {preview.warnings.map((warning) => (
                    <li
                      key={warning.code}
                      className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-3 text-sm"
                    >
                      {warning.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-semibold">Studio date</span>
                <input
                  type="date"
                  value={studioDate}
                  onChange={(event) => {
                    setStudioDate(event.target.value);
                    resetPreview();
                  }}
                  className={controlClass}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-semibold">Start time</span>
                <input
                  type="time"
                  step={900}
                  value={studioTime}
                  onChange={(event) => {
                    setStudioTime(event.target.value);
                    resetPreview();
                  }}
                  className={controlClass}
                />
                <span className="text-xs text-[rgb(var(--fg-muted))]">
                  Studio time · {timeZone}
                </span>
              </label>
            </div>
          )}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-danger-text))]"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-7 sm:pb-4">
          {confirmWarnings ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setConfirmWarnings(false);
                }}
                className={secondaryButtonClass}
              >
                Back
              </button>
              <button
                type="button"
                disabled={isPending || !online}
                onClick={saveAnyway}
                className={primaryButtonClass}
              >
                {isPending
                  ? "Saving…"
                  : preview?.warnings.length
                    ? "Reschedule anyway"
                    : "Reschedule session"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  onOpenChange(false);
                }}
                className={secondaryButtonClass}
              >
                Keep current time
              </button>
              <button
                type="button"
                disabled={isPending || !online}
                onClick={check}
                className={primaryButtonClass}
              >
                {isPending ? "Checking…" : "Check new time"}
              </button>
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

const controlClass =
  "h-11 min-w-0 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-3 text-sm text-[rgb(var(--fg-default))] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))]";
const secondaryButtonClass =
  "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] disabled:opacity-50";
const primaryButtonClass =
  "sk-cta-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-bold text-[rgb(var(--bg-sidebar))] disabled:cursor-not-allowed disabled:opacity-50";
