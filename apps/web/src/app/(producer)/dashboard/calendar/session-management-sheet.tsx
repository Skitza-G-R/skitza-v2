"use client";

import { ArrowLeft, CalendarClock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";

import {
  cancelSession,
  getSessionRescheduleAvailability,
  previewSessionReschedule,
  recordLateArtistCancel,
  rescheduleSession,
  setSessionTitle,
  type ManualWarningCode,
  type ProducerExactSessionAvailability,
} from "./calendar-actions";
import { newCalendarOperationKey } from "./calendar-operation-key";
import { formatCalendarDate, formatCalendarTime } from "./calendar-time";
import { CenteredWheelPicker, type CenteredWheelPickerOption } from "./centered-wheel-picker";
import { GoogleBusyProtectionWarning } from "./google-busy-protection-warning";
import type { SessionManagementStep } from "./manual-session-launcher-context";
import type { SessionListItem } from "./session-row";

type Preview = Extract<
  Awaited<ReturnType<typeof previewSessionReschedule>>,
  { ok: true }
>["preview"];

type Step = SessionManagementStep | "reschedule_warnings" | "title";
type Reason = "schedule_conflict" | "studio_unavailable" | "equipment_issue" | "other";
type RescheduleInput = Readonly<{
  id: string;
  studioDate: string;
  studioStartMin: number;
  startsAtIso: string;
}>;

const DESKTOP_SHEET_QUERY = "(min-width: 640px)";
const REASON_OPTIONS: ReadonlyArray<{ id: Reason; label: string }> = [
  { id: "schedule_conflict", label: "Schedule conflict" },
  { id: "studio_unavailable", label: "Studio unavailable" },
  { id: "equipment_issue", label: "Equipment issue" },
  { id: "other", label: "Other" },
];

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hours)} hr`;
  return `${String(hours)} hr ${String(rest)} min`;
}

function billingLabel(value: SessionListItem["billingTreatment"]): string {
  if (value === "complimentary") return "Complimentary";
  if (value === "billable_extra") return "Payment due";
  return "Included session";
}

function canReschedule(session: SessionListItem, ended: boolean): boolean {
  return !ended && session.status === "confirmed" && !session.changeRequest;
}

function canCancel(session: SessionListItem, ended: boolean): boolean {
  return (
    !ended &&
    (session.status === "confirmed" || session.status === "pending_approval") &&
    !session.changeRequest
  );
}

function canEditTitle(session: SessionListItem, ended: boolean): boolean {
  return !ended && session.status === "confirmed";
}

function sessionHasEnded(session: SessionListItem, nowMs: number): boolean {
  const startsAtMs = new Date(session.startsAt).getTime();
  const endsAtMs = startsAtMs + session.durationMin * 60_000;
  return !Number.isFinite(endsAtMs) || endsAtMs <= nowMs;
}

function subscribeToDesktopSheet(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(DESKTOP_SHEET_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => {
    media.removeEventListener("change", onStoreChange);
  };
}

function readDesktopSheet(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DESKTOP_SHEET_QUERY).matches
  );
}

function readServerDesktopSheet(): boolean {
  return false;
}

export function SessionManagementSheet({
  open,
  onOpenChange,
  session,
  initialStep = "summary",
  timeZone,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  session: SessionListItem;
  initialStep?: SessionManagementStep;
  timeZone: string;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const originalTitle = session.title?.trim() || session.packageName?.trim() || "Session";
  const openedAt = useRef(Date.now());
  const [step, setStep] = useState<Step>(() =>
    sessionHasEnded(session, openedAt.current) ? "summary" : initialStep,
  );
  const [studioDate, setStudioDate] = useState("");
  const [studioStartMin, setStudioStartMin] = useState<number | null>(null);
  const [startsAtIso, setStartsAtIso] = useState<string | null>(null);
  const [availability, setAvailability] = useState<ProducerExactSessionAvailability | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewedInput, setReviewedInput] = useState<RescheduleInput | null>(null);
  const [stepFocusSequence, setStepFocusSequence] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [sessionTitle, setSessionTitleValue] = useState(originalTitle);
  const isDesktopSheet = useSyncExternalStore(
    subscribeToDesktopSheet,
    readDesktopSheet,
    readServerDesktopSheet,
  );
  const [isPending, startTransition] = useTransition();
  const [isAvailabilityPending, startAvailabilityTransition] = useTransition();
  const operationKey = useRef("");
  const availabilityRequest = useRef(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    availabilityRequest.current += 1;
    if (!open) return;
    openedAt.current = Date.now();
    const ended = sessionHasEnded(session, openedAt.current);
    setStep(ended ? "summary" : initialStep);
    setStudioDate("");
    setStudioStartMin(null);
    setStartsAtIso(null);
    setAvailability(null);
    setPreview(null);
    setReviewedInput(null);
    setError(null);
    setReason(null);
    setNote("");
    setSessionTitleValue(originalTitle);
    operationKey.current = newCalendarOperationKey(`producer-reschedule:${session.id}`);
    if (!ended && initialStep === "reschedule") loadRescheduleAvailability();
    return () => {
      availabilityRequest.current += 1;
    };
  }, [initialStep, open, originalTitle, session.durationMin, session.id, session.startsAt]);

  useEffect(() => {
    if (!open) return;
    stepHeading.current?.focus({ preventScroll: true });
  }, [open, step, stepFocusSequence]);

  function goTo(next: Step): void {
    setError(null);
    setStep(next);
  }

  function rescheduleInput(): RescheduleInput | null {
    if (!studioDate || studioStartMin === null || !startsAtIso) return null;
    return { id: session.id, studioDate, studioStartMin, startsAtIso };
  }

  function resetPreview(): void {
    setPreview(null);
    setReviewedInput(null);
    setError(null);
    operationKey.current = newCalendarOperationKey(`producer-reschedule:${session.id}`);
  }

  function loadRescheduleAvailability(): void {
    const request = availabilityRequest.current + 1;
    availabilityRequest.current = request;
    setError(null);
    startAvailabilityTransition(async () => {
      try {
        const result = await getSessionRescheduleAvailability({ id: session.id });
        if (request !== availabilityRequest.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setAvailability(result.availability);
        const currentStartMs = new Date(session.startsAt).getTime();
        const allSlots = result.availability.days.flatMap((day) => day.slots);
        const preferred =
          allSlots.find((slot) => new Date(slot.startsAt).getTime() > currentStartMs) ??
          allSlots[0];
        if (preferred) {
          setStudioDate(preferred.studioDate);
          setStudioStartMin(preferred.studioStartMin);
          setStartsAtIso(preferred.startsAt);
        }
      } catch {
        if (request !== availabilityRequest.current) return;
        setError("Could not load available times. Please try again.");
      }
    });
  }

  function openReschedule(): void {
    goTo("reschedule");
    if (!availability) loadRescheduleAvailability();
  }

  function chooseRescheduleDate(nextDate: string): void {
    if (isPending) return;
    const day = availability?.days.find((candidate) => candidate.date === nextDate);
    const slot = day?.slots[0];
    if (!slot) return;
    setStudioDate(nextDate);
    setStudioStartMin(slot.studioStartMin);
    setStartsAtIso(slot.startsAt);
    resetPreview();
  }

  function chooseRescheduleTime(nextStartsAt: string): void {
    if (isPending) return;
    const slot = availability?.days
      .find((day) => day.date === studioDate)
      ?.slots.find((candidate) => candidate.startsAt === nextStartsAt);
    if (!slot) return;
    setStudioStartMin(slot.studioStartMin);
    setStartsAtIso(slot.startsAt);
    resetPreview();
  }

  function checkReschedule(): void {
    const input = rescheduleInput();
    if (!input || isPending) {
      setError("Choose the new studio date and start time.");
      return;
    }
    if (!online) {
      setError("Reconnect to reschedule this session.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await previewSessionReschedule(input);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPreview(result.preview);
        if (result.preview.hardConflicts.length > 0) {
          setReviewedInput(null);
          setError(result.preview.hardConflicts.map((issue) => issue.message).join(" "));
          return;
        }
        if (
          result.preview.warnings.length > 0 ||
          result.preview.googleCalendarProtection === "reduced"
        ) {
          setReviewedInput(input);
          setStep("reschedule_warnings");
          return;
        }
        await saveReschedule(input, [], result.preview, false);
      } catch {
        setError("Could not check this new time. Please try again.");
      }
    });
  }

  async function saveReschedule(
    input: RescheduleInput,
    acknowledgedWarnings: ManualWarningCode[],
    reviewedPreview: Preview,
    acknowledgedReducedGoogleProtection: boolean,
  ): Promise<void> {
    try {
      const result = await rescheduleSession({
        ...input,
        operationKey: operationKey.current,
        acknowledgedWarnings,
        acknowledgedReducedGoogleProtection,
      });
      if (!result.ok) {
        if (
          "requiresReducedGoogleProtectionReview" in result &&
          !acknowledgedReducedGoogleProtection
        ) {
          setPreview({ ...reviewedPreview, googleCalendarProtection: "reduced" });
          setReviewedInput(input);
          setStep("reschedule_warnings");
          setStepFocusSequence((current) => current + 1);
          setError(null);
          return;
        }
        setStep("reschedule");
        setReviewedInput(null);
        setError(result.error);
        return;
      }
      toast(
        result.googleCalendarProtection === "reduced"
          ? "Session rescheduled. Google availability could not be fully checked; the artist’s calendar update is queued."
          : "Session rescheduled. The artist’s calendar update is queued.",
        result.googleCalendarProtection === "reduced" ? "info" : "success",
      );
      onOpenChange(false);
      router.refresh();
    } catch {
      setStep("reschedule");
      setReviewedInput(null);
      setError("Could not reschedule this session. Please try again.");
    }
  }

  function confirmReschedule(): void {
    const input = reviewedInput;
    if (!input || !preview || isPending) return;
    startTransition(async () => {
      await saveReschedule(
        input,
        preview.warnings.map((warning) => warning.code as ManualWarningCode),
        preview,
        preview.googleCalendarProtection === "reduced",
      );
    });
  }

  function confirmCancellation(): void {
    if (!reason || isPending) return;
    if (!online) {
      setError("Reconnect to cancel this session.");
      return;
    }
    setError(null);
    const reasonLabel = REASON_OPTIONS.find((option) => option.id === reason)?.label ?? reason;
    startTransition(async () => {
      try {
        const result = await cancelSession({
          id: session.id,
          reason: reasonLabel,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast("Session cancelled. The artist’s session use was returned.", "success");
        onOpenChange(false);
        router.refresh();
      } catch {
        setError("Could not cancel this session. Please try again.");
      }
    });
  }

  // The only outcome the producer still records by hand. A plain producer
  // cancel RETURNS the session use, so without this a phone late-cancel would
  // hand the artist their session back for free.
  function recordLateCancel(): void {
    if (isPending) return;
    if (!online) {
      setError("Reconnect to record this late cancellation.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordLateArtistCancel({ id: session.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast("Late cancellation recorded. This uses one of the artist's sessions.", "success");
        onOpenChange(false);
        router.refresh();
      } catch {
        setError("Could not record this late cancellation. Please try again.");
      }
    });
  }

  function saveTitle(): void {
    const nextTitle = sessionTitle.trim();
    if (!nextTitle) {
      setError("Enter a session title.");
      return;
    }
    if (!online) {
      setError("Reconnect to change this session title.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await setSessionTitle({ id: session.id, title: nextTitle });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast("Session title updated.", "success");
        onOpenChange(false);
        router.refresh();
      } catch {
        setError("Could not change this session title. Please try again.");
      }
    });
  }

  function handleOpenChange(next: boolean): void {
    if (!next && isPending) return;
    onOpenChange(next);
  }

  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);
  const ended = sessionHasEnded(session, openedAt.current);
  const rescheduleDay = availability?.days.find((day) => day.date === studioDate) ?? null;
  const rescheduleDateOptions: readonly CenteredWheelPickerOption[] =
    availability?.days.map((day) => ({
      value: day.date,
      label: `${dateKeyLabel(day.date, availability.today)}${day.slots.length === 0 ? " · Full" : ""}`,
      ariaLabel: `${dateKeyLabel(day.date, availability.today)}${day.slots.length === 0 ? ", unavailable" : ", available"}`,
      disabled: day.slots.length === 0,
    })) ?? [];
  const rescheduleTimeOptions = exactTimeOptions(rescheduleDay?.slots ?? []);
  const sheetTitle =
    step === "summary"
      ? "Session details"
      : step === "cancel"
        ? "Cancel session"
        : step === "title"
          ? "Edit session title"
          : step === "reschedule_warnings"
            ? "Review new time"
            : "Reschedule session";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side={isDesktopSheet ? "right" : "bottom"}
        showHandle={!isDesktopSheet}
        overlayClassName="bg-[rgb(var(--bg-sidebar)/0.16)] backdrop-blur-[1px]"
        className={
          isDesktopSheet
            ? "!max-w-[440px] !gap-0 !p-0 sm:!rounded-l-[var(--radius-xl)]"
            : "!max-h-[calc(var(--sk-viewport-height,100dvh)-12px)] !gap-0 !overflow-hidden !p-0 !pt-3"
        }
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-[rgb(var(--border-subtle))] px-5 py-4 sm:px-7 sm:py-6">
          {step !== "summary" ? (
            <button
              type="button"
              aria-label={
                step === "reschedule_warnings"
                  ? "Back to time selection"
                  : "Back to session details"
              }
              disabled={isPending}
              onClick={() => {
                goTo(step === "reschedule_warnings" ? "reschedule" : "summary");
              }}
              className={iconButtonClass}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <SheetTitle
              ref={stepHeading}
              tabIndex={-1}
              className={
                step === "reschedule"
                  ? "text-[21px] tracking-[-0.035em] whitespace-nowrap outline-none sm:text-[24px]"
                  : "text-[25px] outline-none sm:text-[24px]"
              }
            >
              {sheetTitle}
            </SheetTitle>
            <SheetDescription className="sr-only">
              View this session, edit its title, reschedule it, or cancel it.
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Close"
              disabled={isPending}
              className={iconButtonClass}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </SheetClose>
        </header>

        <div
          key={step}
          aria-busy={isPending || undefined}
          className="reveal-up min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"
        >
          <div
            data-testid="session-management-controls"
            inert={isPending ? true : undefined}
            className={isPending ? "pointer-events-none opacity-70" : undefined}
          >
            {step === "summary" ? (
              <div className="grid gap-5">
                <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5 text-center">
                  <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-text))]">
                    <CalendarClock className="h-5 w-5" aria-hidden />
                  </span>
                  <h2 className="mt-3 text-xl font-bold text-[rgb(var(--fg-default))]">
                    {originalTitle}
                  </h2>
                  <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
                    {session.artistName}
                  </p>
                  <p className="font-display mt-4 text-[27px] leading-none font-bold tracking-[-0.035em]">
                    {formatCalendarTime(start, timeZone)}–{formatCalendarTime(end, timeZone)}
                  </p>
                  <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
                    {formatCalendarDate(start, timeZone)} · {durationLabel(session.durationMin)}
                  </p>
                </section>

                <dl className="grid gap-3 text-sm">
                  <Detail label="Client" value={session.artistName} />
                  <Detail label="Session" value={originalTitle} />
                  <Detail label="Billing" value={billingLabel(session.billingTreatment)} />
                  {session.artistRsvpStatus ? (
                    <Detail
                      label="Artist invitation"
                      value={session.artistRsvpStatus.replace("_", " ")}
                    />
                  ) : null}
                </dl>

                {session.changeRequest ? (
                  <p className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.08)] p-4 text-sm">
                    Decide the artist’s pending {session.changeRequest.kind} request before changing
                    this session.
                  </p>
                ) : null}
                {ended ? (
                  <p className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4 text-sm text-[rgb(var(--fg-secondary))]">
                    This session has ended. Its details are view-only.
                  </p>
                ) : null}
              </div>
            ) : step === "reschedule" ? (
              <div>
                <p className="text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                  Choose a new time for {session.artistName}. Duration and billing stay the same.
                </p>
                {availability?.canBook === false ? (
                  <p className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.08)] p-4 text-sm">
                    New times can’t be booked for this session right now — its project or package
                    isn’t active. Reactivate it to reschedule; cancelling still works.
                  </p>
                ) : null}
                <div className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3.5">
                  {isAvailabilityPending ? (
                    <div className="flex min-h-52 items-center justify-center text-center text-sm text-[rgb(var(--fg-muted))]">
                      Finding available times…
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                      <CenteredWheelPicker
                        id="reschedule-date-wheel"
                        label="Date"
                        options={rescheduleDateOptions}
                        value={studioDate}
                        onValueChange={chooseRescheduleDate}
                        visibleRows={5}
                        emphasis="prominent"
                        emptyMessage="No dates available"
                        disabled={isPending}
                      />
                      <CenteredWheelPicker
                        id="reschedule-time-wheel"
                        label="Start"
                        options={rescheduleTimeOptions}
                        value={startsAtIso}
                        onValueChange={chooseRescheduleTime}
                        visibleRows={5}
                        emphasis="prominent"
                        disabled={isPending || !studioDate}
                        emptyMessage="No times available"
                      />
                    </div>
                  )}
                </div>
                <p className="mt-2 text-center text-xs text-[rgb(var(--fg-muted))]">
                  Studio time · {timeZone}
                </p>
                {availability?.googleCalendarProtection === "reduced" ? (
                  <GoogleBusyProtectionWarning embedded />
                ) : null}
              </div>
            ) : step === "reschedule_warnings" && preview ? (
              <div>
                <h2 className="font-display text-xl font-bold">Check these warnings</h2>
                <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                  Review the availability warnings before changing the session.
                </p>
                {preview.googleCalendarProtection === "reduced" ? (
                  <GoogleBusyProtectionWarning embedded />
                ) : null}
                <ul className="mt-5 grid gap-3" aria-label="Scheduling warnings">
                  {preview.warnings.map((warning) => (
                    <li
                      key={warning.code}
                      className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-3 text-sm"
                    >
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : step === "title" ? (
              <div>
                <p className="text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                  This title syncs to the linked Google Calendar when Google Calendar is connected.
                </p>
                <label className="mt-5 flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">Session title</span>
                  <input
                    type="text"
                    maxLength={200}
                    disabled={isPending}
                    value={sessionTitle}
                    onChange={(event) => {
                      setSessionTitleValue(event.target.value);
                      setError(null);
                    }}
                    autoComplete="off"
                    className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))]"
                  />
                </label>
              </div>
            ) : (
              <div>
                <p className="text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                  This frees the slot, returns the session use, and notifies {session.artistName}.
                  Any refund still follows the signed agreement off-app.
                </p>
                {/* SK-280: a phone late-cancel must be recordable as the
                    ARTIST's late cancellation (uses a session) — a producer
                    cancel refunds it. The server rejects this while the
                    cancellation window hasn't started. */}
                <button
                  type="button"
                  disabled={isPending || !online}
                  onClick={() => {
                    recordLateCancel();
                  }}
                  className="mt-3 text-left text-[13px] font-semibold text-[rgb(var(--fg-danger-text))] underline decoration-dotted underline-offset-4 disabled:opacity-50"
                >
                  The artist cancelled late — record it instead (uses their session)
                </button>
                <fieldset className="mt-5">
                  <legend className="text-sm font-semibold">Reason</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {REASON_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] px-3 text-sm has-[:checked]:border-[rgb(var(--fg-danger))] has-[:checked]:bg-[rgb(var(--fg-danger)/0.06)]"
                      >
                        <input
                          type="radio"
                          name="cancel-reason"
                          disabled={isPending}
                          checked={reason === option.id}
                          onChange={() => {
                            setReason(option.id);
                            setError(null);
                          }}
                          className="accent-[rgb(var(--fg-danger))]"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="mt-5 flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">Note for the artist (optional)</span>
                  <textarea
                    rows={4}
                    maxLength={900}
                    disabled={isPending}
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value);
                    }}
                    placeholder="Add a short explanation…"
                    className="min-h-24 resize-none rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))]"
                  />
                </label>
              </div>
            )}
          </div>

          {isPending ? (
            <p role="status" className="mt-4 text-sm text-[rgb(var(--fg-secondary))]">
              Saving…
            </p>
          ) : null}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        </div>

        <footer className="shrink-0 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-7 sm:pt-4 sm:pb-6">
          {step === "summary" ? (
            <div className="grid gap-2">
              {canReschedule(session, ended) ? (
                <button
                  type="button"
                  onClick={() => {
                    openReschedule();
                  }}
                  className={`${primaryButtonClass} w-full`}
                >
                  Reschedule
                </button>
              ) : null}
              {canEditTitle(session, ended) ? (
                <button
                  type="button"
                  onClick={() => {
                    goTo("title");
                  }}
                  className={secondaryButtonClass}
                >
                  Edit title
                </button>
              ) : null}
              {canCancel(session, ended) ? (
                <button
                  type="button"
                  onClick={() => {
                    goTo("cancel");
                  }}
                  className={dangerQuietButtonClass}
                >
                  Cancel session
                </button>
              ) : null}
              {!canReschedule(session, ended) &&
              !canEditTitle(session, ended) &&
              !canCancel(session, ended) ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                  }}
                  className={secondaryButtonClass}
                >
                  Done
                </button>
              ) : null}
            </div>
          ) : step === "title" ? (
            <button
              type="button"
              disabled={
                isPending ||
                !online ||
                !sessionTitle.trim() ||
                sessionTitle.trim() === originalTitle
              }
              onClick={saveTitle}
              className={`${primaryButtonClass} w-full`}
            >
              {isPending ? "Saving…" : online ? "Save title" : "Reconnect to save"}
            </button>
          ) : step === "reschedule" ? (
            <button
              type="button"
              disabled={isPending || isAvailabilityPending || !online || !rescheduleInput()}
              onClick={checkReschedule}
              className={`${primaryButtonClass} w-full`}
            >
              {isPending ? "Checking…" : online ? "Reschedule session" : "Reconnect to save"}
            </button>
          ) : step === "reschedule_warnings" ? (
            <button
              type="button"
              disabled={isPending || !online}
              onClick={confirmReschedule}
              className={`${primaryButtonClass} w-full`}
            >
              {isPending
                ? "Saving…"
                : preview?.warnings.length
                  ? "Reschedule anyway"
                  : "Save new time"}
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending || !online || !reason}
              onClick={confirmCancellation}
              className={`${dangerButtonClass} w-full`}
            >
              {isPending ? "Cancelling…" : online ? "Cancel session" : "Reconnect to cancel"}
            </button>
          )}
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[rgb(var(--border-subtle))] pb-3 last:border-0 last:pb-0">
      <dt className="text-[rgb(var(--fg-muted))]">{label}</dt>
      <dd className="max-w-[65%] truncate text-right font-semibold text-[rgb(var(--fg-default))] capitalize">
        {value}
      </dd>
    </div>
  );
}

function dateKeyLabel(value: string, today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0),
  );
  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(",", "");
  return value === today ? `Today · ${label}` : label;
}

function minuteLabel(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function exactTimeOptions(
  slots: ProducerExactSessionAvailability["days"][number]["slots"],
): readonly CenteredWheelPickerOption[] {
  const counts = new Map<number, number>();
  for (const slot of slots) {
    counts.set(slot.studioStartMin, (counts.get(slot.studioStartMin) ?? 0) + 1);
  }
  const seen = new Map<number, number>();
  return slots.map((slot) => {
    const occurrence = (seen.get(slot.studioStartMin) ?? 0) + 1;
    seen.set(slot.studioStartMin, occurrence);
    const duplicate = (counts.get(slot.studioStartMin) ?? 0) > 1;
    const suffix = duplicate ? (occurrence === 1 ? " · first" : " · second") : "";
    return {
      value: slot.startsAt,
      label: `${minuteLabel(slot.studioStartMin)}${suffix}`,
      ariaLabel: `${minuteLabel(slot.studioStartMin)}${duplicate ? `, ${occurrence === 1 ? "first" : "second"} occurrence` : ""}`,
    };
  });
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-danger-text))]"
    >
      {children}
    </p>
  );
}

const iconButtonClass =
  "sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-sunken))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50";
const secondaryButtonClass =
  "sk-press inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] disabled:opacity-50";
const primaryButtonClass =
  "sk-cta-press inline-flex h-12 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-bold text-[rgb(var(--bg-sidebar))] shadow-[0_10px_24px_-16px_rgb(var(--brand-primary-dark))] disabled:cursor-not-allowed disabled:bg-[rgb(var(--brand-primary)/0.34)] disabled:text-[rgb(var(--fg-muted))] disabled:shadow-none";
const dangerQuietButtonClass =
  "sk-press inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--bg-elevated))] px-5 text-sm font-bold text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.06)]";
const dangerButtonClass =
  "sk-press inline-flex h-12 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45";
