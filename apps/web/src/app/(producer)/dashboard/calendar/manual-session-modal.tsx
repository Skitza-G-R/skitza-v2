"use client";

import { CalendarDays, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import type { ProducerManualSessionOptions } from "~/server/domain/session-booking/manual";

import {
  createManualSession,
  previewManualSession,
  type ManualBillingTreatment,
  type ManualWarningCode,
} from "./calendar-actions";
import { newCalendarOperationKey } from "./calendar-operation-key";
import type { ManualSessionDraft, ManualSessionSlot } from "./calendar-slot";
import { GoogleBusyProtectionWarning } from "./google-busy-protection-warning";

type Preview = Extract<Awaited<ReturnType<typeof previewManualSession>>, { ok: true }>["preview"];
type GoogleCalendarProtection = "active" | "reduced";

const DESKTOP_SHEET_QUERY = "(min-width: 640px)";
const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const value = timeInputValue(index * 15);
  return { label: value, value };
});

const BILLING_COPY: Readonly<Record<ManualBillingTreatment, { label: string; body: string }>> = {
  included: {
    label: "Included session",
    body: "Uses one session from this project.",
  },
  complimentary: {
    label: "Complimentary",
    body: "Uses no included session.",
  },
  billable_extra: {
    label: "Payment due",
    body: "Records payment due. No invoice or charge is created.",
  },
};

function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function timeInputValue(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hours)} hr`;
  return `${String(hours)} hr ${String(rest)} min`;
}

function studioDateLabel(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return "Choose date & time";
  const date = new Date(
    Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12, 0, 0),
  );
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(",", "");
}

function timeRangeLabel(startMin: number, durationMin: number | null): string {
  const start = timeInputValue(startMin);
  if (!durationMin) return start;
  return `${start}\u2013${timeInputValue(startMin + durationMin)}`;
}

function studioTimeZoneLabel(timeZone: string): string {
  const city = timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? timeZone;
  return `${city} time`;
}

/**
 * Producer-only manual booking drawer.
 *
 * `initialSlot` pre-fills a calendar double-click. `onDraftChange` mirrors the
 * current valid studio slot (and its server-derived project duration) so the
 * calendar can draw a provisional block. It emits `null` while no valid slot
 * exists and when the drawer closes.
 */
export function ManualSessionModal({
  open,
  onOpenChange,
  options,
  initialSlot,
  onDraftChange,
  onGoogleBusyProtectionReduced,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  options: ProducerManualSessionOptions;
  initialSlot?: ManualSessionSlot | null;
  onDraftChange?: (draft: ManualSessionDraft | null) => void;
  onGoogleBusyProtectionReduced?: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [studioDate, setStudioDate] = useState("");
  const [studioTime, setStudioTime] = useState("");
  const [title, setTitle] = useState("");
  const [billingTreatment, setBillingTreatment] = useState<ManualBillingTreatment | null>(null);
  const [showTimeEditor, setShowTimeEditor] = useState(true);
  const [showTitleEditor, setShowTitleEditor] = useState(false);
  const [showBillingEditor, setShowBillingEditor] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDesktopSheet, setIsDesktopSheet] = useState(false);
  const [isPending, startTransition] = useTransition();
  const operationKey = useRef(newCalendarOperationKey("producer-manual"));
  const warningHeading = useRef<HTMLHeadingElement>(null);
  const onDraftChangeRef = useRef(onDraftChange);
  const online = useOnlineStatus();
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DESKTOP_SHEET_QUERY);
    const update = () => {
      setIsDesktopSheet(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  const client = options.clients.find((candidate) => candidate.id === clientId) ?? null;
  const projects = client?.projects ?? [];
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const studioStartMin = parseTime(studioTime);
  const hasStudioSlot = Boolean(studioDate && studioStartMin !== null);
  const durationMin = project?.eligibility === "eligible" ? project.durationMin : null;
  const canSubmit = Boolean(
    clientId &&
    projectId &&
    hasStudioSlot &&
    billingTreatment &&
    project?.eligibility === "eligible",
  );

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  useEffect(() => {
    if (!open) {
      onDraftChangeRef.current?.(null);
      return;
    }
    setClientId("");
    setProjectId("");
    setStudioDate(initialSlot?.studioDate ?? "");
    setStudioTime(initialSlot ? timeInputValue(initialSlot.studioStartMin) : "");
    setTitle("");
    setBillingTreatment(null);
    setShowTimeEditor(!initialSlot);
    setShowTitleEditor(false);
    setShowBillingEditor(false);
    setPreview(null);
    setConfirmWarnings(false);
    setError(null);
    operationKey.current = newCalendarOperationKey("producer-manual");
  }, [initialSlot?.studioDate, initialSlot?.studioStartMin, open]);

  useEffect(() => {
    if (!open || !studioDate || studioStartMin === null) {
      onDraftChangeRef.current?.(null);
      return;
    }
    onDraftChangeRef.current?.({
      studioDate,
      studioStartMin,
      durationMin,
    });
  }, [durationMin, open, studioDate, studioStartMin]);

  useEffect(() => {
    if (confirmWarnings) warningHeading.current?.focus();
  }, [confirmWarnings]);

  function requestOpenChange(next: boolean): void {
    if (!next) onDraftChangeRef.current?.(null);
    onOpenChange(next);
  }

  function resetPreview(): void {
    setPreview(null);
    setConfirmWarnings(false);
    setError(null);
    operationKey.current = newCalendarOperationKey("producer-manual");
  }

  function chooseClient(nextClientId: string): void {
    setClientId(nextClientId);
    setProjectId("");
    setTitle("");
    setBillingTreatment(null);
    setShowTitleEditor(false);
    setShowBillingEditor(false);
    resetPreview();
  }

  function chooseProject(nextProjectId: string): void {
    setProjectId(nextProjectId);
    const next = projects.find((candidate) => candidate.id === nextProjectId);
    setTitle(next?.defaultTitle ?? "");
    setBillingTreatment(next?.defaultTreatment ?? null);
    setShowTitleEditor(false);
    setShowBillingEditor(Boolean(next && !next.defaultTreatment));
    resetPreview();
  }

  function formInput() {
    if (!clientId || !projectId || !studioDate || studioStartMin === null) return null;
    return {
      clientId,
      projectId,
      studioDate,
      studioStartMin,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(billingTreatment ? { billingTreatment } : {}),
    };
  }

  function submit(): void {
    if (isPending) return;
    if (!online) {
      setError("Reconnect to create this session.");
      return;
    }
    const input = formInput();
    if (!input || !billingTreatment) {
      setError("Choose a client, project, date, time, and billing option.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await previewManualSession(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);
      if (result.preview.hardConflicts.length > 0) {
        setShowTimeEditor(true);
        setError(result.preview.hardConflicts.map((issue) => issue.message).join(" "));
        return;
      }
      if (result.preview.warnings.length > 0 || protectionFrom(result.preview) === "reduced") {
        setConfirmWarnings(true);
        return;
      }
      await create(input, []);
    });
  }

  async function create(
    input: NonNullable<ReturnType<typeof formInput>>,
    acknowledgedWarnings: ManualWarningCode[],
  ): Promise<void> {
    if (!billingTreatment) return;
    const result = await createManualSession({
      ...input,
      billingTreatment,
      operationKey: operationKey.current,
      acknowledgedWarnings,
    });
    if (!result.ok) {
      setConfirmWarnings(false);
      setError(result.error);
      return;
    }
    if (protectionFrom(result.session) === "reduced") {
      onGoogleBusyProtectionReduced?.();
    }
    toast("Session confirmed. The artist’s calendar invite is queued.", "success");
    requestOpenChange(false);
  }

  function createAnyway(): void {
    const input = formInput();
    if (!input || !preview || !billingTreatment || isPending) return;
    startTransition(async () => {
      await create(
        input,
        preview.warnings.map((warning) => warning.code as ManualWarningCode),
      );
    });
  }

  const dateLabel = hasStudioSlot ? studioDateLabel(studioDate) : "Choose date & time";
  const timeLabel =
    hasStudioSlot && studioStartMin !== null
      ? timeRangeLabel(studioStartMin, durationMin ?? null)
      : "";
  const timeZoneLabel = studioTimeZoneLabel(options.studioTimeZone);

  return (
    <Sheet open={open} onOpenChange={requestOpenChange}>
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
        <header className="reveal-up flex shrink-0 items-center justify-between gap-4 px-5 pt-3 pb-3 sm:items-start sm:border-b sm:border-[rgb(var(--border-subtle))] sm:px-7 sm:py-6">
          <div className="min-w-0">
            <SheetTitle className="text-[26px] sm:text-[24px]">Book a session</SheetTitle>
            <SheetDescription className="sr-only">
              Choose an existing client and project. Session length and credit come from the
              project’s package.
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Close"
              disabled={isPending}
              className="sk-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-sunken))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </SheetClose>
        </header>

        {confirmWarnings && preview ? (
          <WarningReview
            preview={preview}
            warningHeading={warningHeading}
            error={error}
            isPending={isPending}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-7 sm:py-6">
            <div className="grid gap-4 sm:gap-6">
              <section className="reveal-up" aria-label="Session time">
                {!isDesktopSheet ? (
                  <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                    When
                  </p>
                ) : null}

                {!isDesktopSheet && hasStudioSlot && !showTimeEditor ? (
                  <div
                    data-testid="manual-time-summary"
                    className="relative flex min-h-[94px] items-center justify-between gap-4 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] py-3.5 pr-3.5 pl-5 shadow-[0_10px_28px_-24px_rgb(var(--brand-primary-dark))]"
                    aria-live="polite"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--brand-primary))]"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold tracking-[0.04em] text-[rgb(var(--fg-default))] uppercase">
                        {dateLabel}
                      </p>
                      <p className="font-display mt-0.5 text-[24px] leading-none font-bold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
                        {timeLabel}
                      </p>
                      <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">{timeZoneLabel}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowTimeEditor(true);
                      }}
                      className={quietActionClass}
                      aria-expanded={false}
                      aria-controls="manual-time-editor"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0" aria-live="polite">
                      <p className="text-[20px] leading-tight font-semibold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                        {!isDesktopSheet && showTimeEditor ? "Choose date & time" : dateLabel}
                      </p>
                      {isDesktopSheet && timeLabel ? (
                        <p
                          data-testid="manual-time-summary"
                          className="font-display mt-1 text-[32px] leading-none font-bold tracking-[-0.04em] text-[rgb(var(--fg-default))]"
                        >
                          {timeLabel}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-[rgb(var(--fg-muted))]">
                        {isDesktopSheet && durationMin
                          ? `${durationLabel(durationMin)} · fixed by this project’s package · `
                          : "Studio time · "}
                        {isDesktopSheet ? options.studioTimeZone : timeZoneLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowTimeEditor((current) => !current);
                      }}
                      className={quietActionClass}
                      aria-expanded={showTimeEditor}
                      aria-controls="manual-time-editor"
                    >
                      {showTimeEditor ? "Hide" : hasStudioSlot ? "Change" : "Choose"}
                    </button>
                  </div>
                )}

                {showTimeEditor ? (
                  <div
                    id="manual-time-editor"
                    className="reveal-up mt-3 grid grid-cols-1 gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3.5 sm:mt-4 sm:grid-cols-2"
                  >
                    <Field label="Date" htmlFor="manual-date">
                      <input
                        id="manual-date"
                        type="date"
                        value={studioDate}
                        onChange={(event) => {
                          const nextDate = event.target.value;
                          setStudioDate(nextDate);
                          if (!isDesktopSheet && nextDate && studioStartMin !== null) {
                            setShowTimeEditor(false);
                          }
                          resetPreview();
                        }}
                        className={controlClass}
                      />
                    </Field>
                    <Field label="Start" htmlFor="manual-time">
                      <select
                        id="manual-time"
                        value={studioTime}
                        onChange={(event) => {
                          const nextTime = event.target.value;
                          setStudioTime(nextTime);
                          if (!isDesktopSheet && studioDate && parseTime(nextTime) !== null) {
                            setShowTimeEditor(false);
                          }
                          resetPreview();
                        }}
                        className={controlClass}
                        aria-describedby="manual-timezone"
                      >
                        <option value="">Choose a start time</option>
                        {TIME_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <span id="manual-timezone" className="sr-only">
                      Studio time, {options.studioTimeZone}
                    </span>
                    {hasStudioSlot && isDesktopSheet ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowTimeEditor(false);
                        }}
                        className={`${quietActionClass} ms-auto sm:col-span-2`}
                      >
                        Done
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <div className="reveal-up-delay-1 grid gap-3 sm:gap-4">
                <Field label="Client" htmlFor="manual-client" mobileCard>
                  <select
                    id="manual-client"
                    value={clientId}
                    onChange={(event) => {
                      chooseClient(event.target.value);
                    }}
                    className={mobileSelectControlClass}
                  >
                    <option value="">Choose a client</option>
                    {options.clients.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </Field>

                {isDesktopSheet || client ? (
                  <Field label="Project" htmlFor="manual-project" mobileCard>
                    <select
                      id="manual-project"
                      value={projectId}
                      disabled={!client}
                      onChange={(event) => {
                        chooseProject(event.target.value);
                      }}
                      className={mobileSelectControlClass}
                    >
                      <option value="">
                        {client ? "Choose a project" : "Choose a client first"}
                      </option>
                      {projects.map((option) => (
                        <option
                          key={option.id}
                          value={option.id}
                          disabled={option.eligibility !== "eligible"}
                        >
                          {option.title}
                          {option.eligibility === "multiple_active_session_packages"
                            ? " — multiple session packages"
                            : option.eligibility === "no_active_session_package"
                              ? " — no active session package"
                              : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </div>

              {project?.eligibility === "eligible" ? (
                <section className="reveal-up-delay-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-[rgb(var(--fg-default))]">
                      {title.trim() || project.defaultTitle || project.productName || "Session"}
                    </p>
                    <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
                      {durationMin === null ? "Duration unavailable" : durationLabel(durationMin)} ·{" "}
                      {billingTreatment ? BILLING_COPY[billingTreatment].label : "Choose billing"}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                      {billingTreatment
                        ? billingDetail(billingTreatment, project.remainingIncluded)
                        : "No included sessions remain."}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-[rgb(var(--border-subtle))] pt-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowTitleEditor((current) => !current);
                      }}
                      className={quietActionClass}
                      aria-expanded={showTitleEditor}
                      aria-controls="manual-title-editor"
                    >
                      {showTitleEditor ? "Done" : "Edit title"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowBillingEditor((current) => !current);
                      }}
                      className={quietActionClass}
                      aria-expanded={showBillingEditor}
                      aria-controls="manual-billing-editor"
                    >
                      {showBillingEditor
                        ? "Hide billing"
                        : billingTreatment
                          ? "Change billing"
                          : "Choose billing"}
                    </button>
                  </div>

                  {showTitleEditor ? (
                    <div id="manual-title-editor" className="reveal-up mt-3">
                      <label htmlFor="manual-title" className="sr-only">
                        Session title (optional)
                      </label>
                      <input
                        id="manual-title"
                        value={title}
                        maxLength={200}
                        placeholder={project.defaultTitle ?? "Session"}
                        onChange={(event) => {
                          setTitle(event.target.value);
                          resetPreview();
                        }}
                        className={controlClass}
                      />
                    </div>
                  ) : null}

                  {showBillingEditor ? (
                    <fieldset id="manual-billing-editor" className="reveal-up mt-3">
                      <legend className="sr-only">Billing treatment</legend>
                      <div className="grid gap-2">
                        {project.allowedTreatments.map((treatment) => (
                          <label
                            key={treatment}
                            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 transition-[border-color,background-color,transform] duration-200 ease-out active:scale-[0.99] has-[:checked]:border-[rgb(var(--brand-primary))] has-[:checked]:bg-[rgb(var(--brand-primary)/0.08)] motion-reduce:transition-none"
                          >
                            <input
                              type="radio"
                              name="manual-billing"
                              value={treatment}
                              checked={billingTreatment === treatment}
                              onChange={() => {
                                setBillingTreatment(treatment);
                                setShowBillingEditor(false);
                                resetPreview();
                              }}
                              className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand-primary-dark))]"
                            />
                            <span>
                              <span className="block text-sm font-semibold">
                                {BILLING_COPY[treatment].label}
                              </span>
                              <span className="mt-0.5 block text-xs leading-snug text-[rgb(var(--fg-muted))]">
                                {BILLING_COPY[treatment].body}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                </section>
              ) : null}

              {project?.eligibility === "eligible" ? (
                <p className="reveal-up-delay-3 flex items-center gap-2.5 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  <span
                    aria-hidden
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.09)] text-[rgb(var(--fg-default))]"
                  >
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  The artist will receive a calendar invitation.
                </p>
              ) : null}

              {isPending ? (
                <p role="status" className="text-sm text-[rgb(var(--fg-secondary))]">
                  Checking availability…
                </p>
              ) : null}
              {error ? <ErrorMessage>{error}</ErrorMessage> : null}
            </div>
          </div>
        )}

        <footer className="shrink-0 bg-[rgb(var(--bg-elevated))] px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:border-t sm:border-[rgb(var(--border-subtle))] sm:px-7 sm:pt-4 sm:pb-6">
          {confirmWarnings ? (
            <div className="grid grid-cols-[auto_1fr] gap-2">
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
                onClick={createAnyway}
                className={primaryButtonClass}
              >
                {isPending
                  ? "Creating…"
                  : preview?.warnings.length
                    ? "Create anyway"
                    : "Book session"}
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={isPending || !online || !canSubmit}
                onClick={submit}
                className={`${primaryButtonClass} w-full`}
              >
                {isPending ? "Checking…" : online ? "Book session" : "Reconnect to book"}
              </button>
            </>
          )}
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function WarningReview({
  preview,
  warningHeading,
  error,
  isPending,
}: {
  preview: Preview;
  warningHeading: RefObject<HTMLHeadingElement | null>;
  error: string | null;
  isPending: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
      <h2
        ref={warningHeading}
        tabIndex={-1}
        className="font-display text-xl font-bold outline-none"
      >
        {preview.warnings.length > 0 ? "Check these warnings" : "Review this booking"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
        {preview.warnings.length > 0
          ? "Nothing overlaps another Skitza session. Review these availability warnings before creating the session."
          : "Nothing overlaps another Skitza session, but Google busy times could not be checked."}
      </p>
      {protectionFrom(preview) === "reduced" ? <GoogleBusyProtectionWarning embedded /> : null}
      {preview.warnings.length > 0 ? (
        <ul className="mt-5 space-y-3" aria-label="Scheduling warnings">
          {preview.warnings.map((warning) => (
            <li
              key={warning.code}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-default))]"
            >
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
      {isPending ? (
        <p role="status" className="mt-4 text-sm text-[rgb(var(--fg-secondary))]">
          Creating session…
        </p>
      ) : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
    </div>
  );
}

function billingDetail(
  treatment: ManualBillingTreatment,
  remainingIncluded: number | null,
): string {
  if (treatment === "complimentary") return "No session credit used.";
  if (treatment === "billable_extra") return "Payment due is recorded; no charge is created.";
  if (remainingIncluded === null) return "Unlimited included sessions.";
  return `${String(remainingIncluded)} included session${remainingIncluded === 1 ? "" : "s"} available.`;
}

function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-danger-text))]"
    >
      {children}
    </p>
  );
}

function Field({
  label,
  htmlFor,
  children,
  mobileCard = false,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  mobileCard?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={
        mobileCard ? "relative flex min-w-0 flex-col sm:gap-1.5" : "flex min-w-0 flex-col gap-1.5"
      }
    >
      <span
        className={
          mobileCard
            ? "pointer-events-none absolute top-2.5 left-4 z-10 text-xs font-medium text-[rgb(var(--fg-muted))] sm:static sm:text-sm sm:font-semibold sm:text-[rgb(var(--fg-default))]"
            : "text-sm font-semibold text-[rgb(var(--fg-default))]"
        }
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const controlClass =
  "h-11 min-w-0 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-3 text-sm text-[rgb(var(--fg-default))] outline-none transition-[border-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55";
const mobileSelectControlClass =
  "h-[68px] min-w-0 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 pt-5 text-base font-semibold text-[rgb(var(--fg-default))] outline-none transition-[border-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55 sm:h-11 sm:px-3 sm:pt-0 sm:text-sm sm:font-normal";
const quietActionClass =
  "sk-press inline-flex h-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] px-2.5 text-xs font-bold text-[rgb(var(--brand-primary-dark))] underline-offset-4 hover:bg-[rgb(var(--brand-primary)/0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))]";
const secondaryButtonClass =
  "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] disabled:opacity-50";
const primaryButtonClass =
  "sk-cta-press inline-flex h-12 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-bold text-[rgb(var(--bg-sidebar))] shadow-[0_10px_24px_-16px_rgb(var(--brand-primary-dark))] disabled:cursor-not-allowed disabled:bg-[rgb(var(--brand-primary)/0.34)] disabled:text-[rgb(var(--fg-muted))] disabled:shadow-none disabled:opacity-100";

function protectionFrom(value: unknown): GoogleCalendarProtection {
  if (
    typeof value === "object" &&
    value !== null &&
    "googleCalendarProtection" in value &&
    value.googleCalendarProtection === "reduced"
  ) {
    return "reduced";
  }
  return "active";
}
