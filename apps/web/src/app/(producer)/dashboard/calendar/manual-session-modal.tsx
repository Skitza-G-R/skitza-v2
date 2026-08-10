"use client";

import { CalendarDays, Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type RefObject,
} from "react";

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
  getManualSessionAvailability,
  previewManualSession,
  type ManualBillingTreatment,
  type ManualSessionFormInput,
  type ManualWarningCode,
  type ProducerExactSessionAvailability,
} from "./calendar-actions";
import { newCalendarOperationKey } from "./calendar-operation-key";
import type { ManualSessionDraft, ManualSessionSlot } from "./calendar-slot";
import { CenteredWheelPicker, type CenteredWheelPickerOption } from "./centered-wheel-picker";
import { GoogleBusyProtectionWarning } from "./google-busy-protection-warning";

type Preview = Extract<Awaited<ReturnType<typeof previewManualSession>>, { ok: true }>["preview"];
type Picker = "client" | "project" | "when" | null;
type GoogleCalendarProtection = "active" | "reduced";
type ReviewedManualInput = ManualSessionFormInput &
  Readonly<{
    startsAtIso: string;
    billingTreatment: ManualBillingTreatment;
  }>;

const DESKTOP_SHEET_QUERY = "(min-width: 640px)";
const MANY_CLIENTS_THRESHOLD = 8;
const CLIENT_PLACEHOLDER = "__choose-client__";
const PROJECT_PLACEHOLDER = "__choose-project__";

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

function studioDateLabel(value: string, today?: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return "Choose a date";
  const date = new Date(
    Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12, 0, 0),
  );
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(",", "");
  return value === today ? `Today · ${formatted}` : formatted;
}

function studioTimeZoneLabel(timeZone: string): string {
  const city = timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? timeZone;
  return `${city} time`;
}

function timeRangeLabel(startMin: number, durationMin: number): string {
  return `${timeInputValue(startMin)}–${timeInputValue(startMin + durationMin)}`;
}

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
  const [clientSearch, setClientSearch] = useState("");
  const [studioDate, setStudioDate] = useState("");
  const [studioStartMin, setStudioStartMin] = useState<number | null>(null);
  const [startsAtIso, setStartsAtIso] = useState<string | null>(null);
  const [availability, setAvailability] = useState<ProducerExactSessionAvailability | null>(null);
  const [activePicker, setActivePicker] = useState<Picker>("client");
  const [title, setTitle] = useState("");
  const [billingTreatment, setBillingTreatment] = useState<ManualBillingTreatment | null>(null);
  const [showTitleEditor, setShowTitleEditor] = useState(false);
  const [showBillingEditor, setShowBillingEditor] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewedInput, setReviewedInput] = useState<ReviewedManualInput | null>(null);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [warningFocusSequence, setWarningFocusSequence] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState({
    id: "manual-client-wheel",
    sequence: 0,
  });
  const [isDesktopSheet, setIsDesktopSheet] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isAvailabilityPending, startAvailabilityTransition] = useTransition();
  const operationKey = useRef(newCalendarOperationKey("producer-manual"));
  const availabilityRequest = useRef(0);
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
  const durationMin =
    availability?.durationMin ?? (project?.eligibility === "eligible" ? project.durationMin : null);
  const selectedDay = availability?.days.find((day) => day.date === studioDate) ?? null;
  const selectedSlot = selectedDay?.slots.find((slot) => slot.startsAt === startsAtIso) ?? null;
  const hasStudioSlot = Boolean(selectedSlot && studioStartMin !== null);
  const canSubmit = Boolean(
    clientId &&
    projectId &&
    hasStudioSlot &&
    billingTreatment &&
    project?.eligibility === "eligible",
  );

  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLocaleLowerCase();
    if (!query) return options.clients;
    return options.clients.filter((candidate) =>
      candidate.name.toLocaleLowerCase().includes(query),
    );
  }, [clientSearch, options.clients]);

  const clientOptions: readonly CenteredWheelPickerOption[] =
    filteredClients.length === 0
      ? []
      : [
          {
            value: CLIENT_PLACEHOLDER,
            label: "Choose a client",
            disabled: true,
            placeholder: true,
          },
          ...filteredClients.map((candidate) => ({
            value: candidate.id,
            label: candidate.name,
          })),
        ];
  const projectOptions: readonly CenteredWheelPickerOption[] =
    projects.length === 0
      ? []
      : [
          {
            value: PROJECT_PLACEHOLDER,
            label: "Choose a project",
            disabled: true,
            placeholder: true,
          },
          ...projects.map((candidate) => ({
            value: candidate.id,
            label:
              candidate.eligibility === "eligible"
                ? candidate.title
                : `${candidate.title} · ${projectEligibilityLabel(candidate.eligibility)}`,
            ariaLabel:
              candidate.eligibility === "eligible"
                ? candidate.title
                : `${candidate.title}, ${projectEligibilityLabel(candidate.eligibility)}`,
            disabled: candidate.eligibility !== "eligible",
          })),
        ];
  const dateOptions: readonly CenteredWheelPickerOption[] =
    availability?.days.map((day) => ({
      value: day.date,
      label: `${studioDateLabel(day.date, availability.today)}${day.slots.length === 0 ? " · Full" : ""}`,
      ariaLabel: `${studioDateLabel(day.date, availability.today)}${day.slots.length === 0 ? ", unavailable" : ", available"}`,
      disabled: day.slots.length === 0,
    })) ?? [];
  const timeOptions = useMemo(
    () => exactTimeOptions(selectedDay?.slots ?? []),
    [selectedDay?.slots],
  );

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  useEffect(() => {
    if (!open) {
      onDraftChangeRef.current?.(null);
      return;
    }
    availabilityRequest.current += 1;
    setClientId("");
    setProjectId("");
    setClientSearch("");
    setStudioDate(initialSlot?.studioDate ?? "");
    setStudioStartMin(initialSlot?.studioStartMin ?? null);
    setStartsAtIso(null);
    setAvailability(null);
    setActivePicker("client");
    setTitle("");
    setBillingTreatment(null);
    setShowTitleEditor(false);
    setShowBillingEditor(false);
    setPreview(null);
    setReviewedInput(null);
    setConfirmWarnings(false);
    setError(null);
    requestManualFocus("manual-client-wheel");
    operationKey.current = newCalendarOperationKey("producer-manual");
  }, [initialSlot?.studioDate, initialSlot?.studioStartMin, open]);

  useEffect(() => {
    if (!open || !studioDate || studioStartMin === null) {
      onDraftChangeRef.current?.(null);
      return;
    }
    onDraftChangeRef.current?.({ studioDate, studioStartMin, durationMin });
  }, [durationMin, open, studioDate, studioStartMin]);

  useEffect(() => {
    if (confirmWarnings) warningHeading.current?.focus();
  }, [confirmWarnings, warningFocusSequence]);

  useEffect(() => {
    if (!open || confirmWarnings) return;
    document.getElementById(focusRequest.id)?.focus({ preventScroll: true });
  }, [confirmWarnings, focusRequest, open]);

  function requestManualFocus(id: string): void {
    setFocusRequest((current) => ({ id, sequence: current.sequence + 1 }));
  }

  function requestOpenChange(next: boolean): void {
    if (!next && isPending) return;
    if (!next) onDraftChangeRef.current?.(null);
    onOpenChange(next);
  }

  function resetPreview(): void {
    setPreview(null);
    setReviewedInput(null);
    setConfirmWarnings(false);
    setError(null);
    operationKey.current = newCalendarOperationKey("producer-manual");
  }

  function clearTimeAvailability(): void {
    availabilityRequest.current += 1;
    setAvailability(null);
    setStartsAtIso(null);
  }

  function chooseClient(nextClientId: string): void {
    if (isPending) return;
    setClientId(nextClientId);
    setProjectId("");
    setTitle("");
    setBillingTreatment(null);
    setShowTitleEditor(false);
    setShowBillingEditor(false);
    clearTimeAvailability();
    resetPreview();
  }

  function continueFromClient(): void {
    if (!clientId || isPending) return;
    setClientSearch("");
    setActivePicker("project");
    requestManualFocus("manual-project-wheel");
  }

  function chooseProject(nextProjectId: string): void {
    if (isPending) return;
    setProjectId(nextProjectId);
    const next = projects.find((candidate) => candidate.id === nextProjectId);
    setTitle(next?.defaultTitle ?? "");
    setBillingTreatment(next?.defaultTreatment ?? null);
    setShowTitleEditor(false);
    setShowBillingEditor(Boolean(next && !next.defaultTreatment));
    clearTimeAvailability();
    resetPreview();
  }

  function continueFromProject(): void {
    if (isPending || !clientId || !projectId || project?.eligibility !== "eligible") return;
    const request = availabilityRequest.current + 1;
    availabilityRequest.current = request;
    setError(null);
    startAvailabilityTransition(async () => {
      const result = await getManualSessionAvailability({ clientId, projectId });
      if (request !== availabilityRequest.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const nextAvailability = result.availability;
      setAvailability(nextAvailability);
      if (nextAvailability.googleCalendarProtection === "reduced") {
        onGoogleBusyProtectionReduced?.();
      }
      const preferred = findPreferredSlot(nextAvailability, {
        studioDate,
        studioStartMin,
      });
      if (preferred) {
        setStudioDate(preferred.studioDate);
        setStudioStartMin(preferred.studioStartMin);
        setStartsAtIso(preferred.startsAt);
      } else {
        setStudioDate("");
        setStudioStartMin(null);
        setStartsAtIso(null);
      }
      setActivePicker("when");
      requestManualFocus("manual-date-wheel");
    });
  }

  function chooseDate(nextDate: string): void {
    if (isPending) return;
    const day = availability?.days.find((candidate) => candidate.date === nextDate);
    const nextSlot = day?.slots[0];
    if (!nextSlot) return;
    setStudioDate(nextDate);
    setStudioStartMin(nextSlot.studioStartMin);
    setStartsAtIso(nextSlot.startsAt);
    resetPreview();
  }

  function chooseExactTime(nextStartsAt: string): void {
    if (isPending) return;
    const slot = selectedDay?.slots.find((candidate) => candidate.startsAt === nextStartsAt);
    if (!slot) return;
    setStudioStartMin(slot.studioStartMin);
    setStartsAtIso(slot.startsAt);
    resetPreview();
  }

  function formInput(): ReviewedManualInput | null {
    if (
      !clientId ||
      !projectId ||
      !studioDate ||
      studioStartMin === null ||
      !startsAtIso ||
      !billingTreatment
    ) {
      return null;
    }
    return {
      clientId,
      projectId,
      studioDate,
      studioStartMin,
      startsAtIso,
      ...(title.trim() ? { title: title.trim() } : {}),
      billingTreatment,
    };
  }

  function submit(): void {
    if (isPending) return;
    if (!online) {
      setError("Reconnect to create this session.");
      return;
    }
    const input = formInput();
    if (!input) {
      setError("Choose a client, project, available date and time, and billing option.");
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
        setReviewedInput(null);
        setActivePicker("when");
        requestManualFocus("manual-date-wheel");
        setError(result.preview.hardConflicts.map((issue) => issue.message).join(" "));
        return;
      }
      if (result.preview.warnings.length > 0 || protectionFrom(result.preview) === "reduced") {
        setReviewedInput(input);
        setConfirmWarnings(true);
        setWarningFocusSequence((current) => current + 1);
        return;
      }
      await create(input, [], result.preview, false);
    });
  }

  async function create(
    input: ReviewedManualInput,
    acknowledgedWarnings: ManualWarningCode[],
    reviewedPreview: Preview,
    acknowledgedReducedGoogleProtection: boolean,
  ): Promise<void> {
    const result = await createManualSession({
      ...input,
      billingTreatment: input.billingTreatment,
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
        setConfirmWarnings(true);
        setWarningFocusSequence((current) => current + 1);
        setError(null);
        onGoogleBusyProtectionReduced?.();
        return;
      }
      setConfirmWarnings(false);
      setActivePicker("when");
      requestManualFocus("manual-date-wheel");
      setError(result.error);
      return;
    }
    if (protectionFrom(result.session) === "reduced") onGoogleBusyProtectionReduced?.();
    toast("Session confirmed. The artist’s calendar invite is queued.", "success");
    requestOpenChange(false);
  }

  function createAnyway(): void {
    const input = reviewedInput;
    if (!input || !preview || isPending) return;
    startTransition(async () => {
      await create(
        input,
        preview.warnings.map((warning) => warning.code as ManualWarningCode),
        preview,
        protectionFrom(preview) === "reduced",
      );
    });
  }

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
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[rgb(var(--border-subtle))] px-5 py-4 sm:px-7 sm:py-6">
          <div className="min-w-0">
            <SheetTitle className="text-[26px] sm:text-[24px]">Book a session</SheetTitle>
            <SheetDescription className="sr-only">
              Choose a client, project, and available studio time.
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

        {confirmWarnings && preview ? (
          <WarningReview
            preview={preview}
            warningHeading={warningHeading}
            error={error}
            isPending={isPending}
          />
        ) : (
          <div
            aria-busy={isPending || undefined}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7 sm:py-6"
          >
            <div
              data-testid="manual-session-controls"
              inert={isPending ? true : undefined}
              className={`grid gap-3.5 transition-opacity duration-150 motion-reduce:transition-none ${isPending ? "pointer-events-none opacity-70" : ""}`}
            >
              <PickerSection
                eyebrow="1 · Client"
                summary={client?.name ?? "Choose a client"}
                complete={Boolean(client)}
                expanded={activePicker === "client"}
                disabled={isPending}
                onChange={() => {
                  setActivePicker("client");
                  requestManualFocus("manual-client-wheel");
                }}
              >
                {options.clients.length > MANY_CLIENTS_THRESHOLD ? (
                  <label className="relative mb-3 block">
                    <span className="sr-only">Search clients</span>
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[rgb(var(--fg-muted))]"
                    />
                    <input
                      type="search"
                      disabled={isPending}
                      value={clientSearch}
                      onChange={(event) => {
                        if (isPending) return;
                        const nextSearch = event.target.value;
                        setClientSearch(nextSearch);
                        const selectedClient = options.clients.find(
                          (candidate) => candidate.id === clientId,
                        );
                        if (
                          selectedClient &&
                          !selectedClient.name
                            .toLocaleLowerCase()
                            .includes(nextSearch.trim().toLocaleLowerCase())
                        ) {
                          chooseClient("");
                        }
                      }}
                      placeholder="Search clients…"
                      className={`${controlClass} ps-10 text-center`}
                    />
                  </label>
                ) : null}
                <CenteredWheelPicker
                  id="manual-client-wheel"
                  label="Client"
                  options={clientOptions}
                  value={clientId || (clientOptions.length > 0 ? CLIENT_PLACEHOLDER : null)}
                  onValueChange={chooseClient}
                  visibleRows={3}
                  disabled={isPending}
                  emptyMessage={clientSearch ? "No matching clients" : "No clients available"}
                />
                <button
                  type="button"
                  disabled={isPending || !clientId}
                  onClick={continueFromClient}
                  className={`${stepButtonClass} mt-3 w-full`}
                >
                  Continue
                </button>
              </PickerSection>

              {client ? (
                <PickerSection
                  eyebrow="2 · Project"
                  summary={project?.title ?? "Choose a project"}
                  complete={Boolean(project)}
                  expanded={activePicker === "project"}
                  disabled={isPending}
                  onChange={() => {
                    setActivePicker("project");
                    requestManualFocus("manual-project-wheel");
                  }}
                >
                  <CenteredWheelPicker
                    id="manual-project-wheel"
                    label="Project"
                    options={projectOptions}
                    value={projectId || (projectOptions.length > 0 ? PROJECT_PLACEHOLDER : null)}
                    onValueChange={chooseProject}
                    visibleRows={3}
                    disabled={isPending}
                    emptyMessage="No projects available"
                  />
                  <button
                    type="button"
                    disabled={
                      isPending ||
                      !projectId ||
                      project?.eligibility !== "eligible" ||
                      isAvailabilityPending
                    }
                    onClick={continueFromProject}
                    className={`${stepButtonClass} mt-3 w-full`}
                  >
                    {isAvailabilityPending ? "Finding available times…" : "Continue"}
                  </button>
                </PickerSection>
              ) : null}

              {project?.eligibility === "eligible" && availability ? (
                <PickerSection
                  eyebrow="3 · Date & time"
                  summary={
                    hasStudioSlot && studioStartMin !== null && durationMin
                      ? `${studioDateLabel(studioDate, availability.today)} · ${timeRangeLabel(studioStartMin, durationMin)}`
                      : "Choose an available time"
                  }
                  complete={hasStudioSlot}
                  expanded={activePicker === "when"}
                  disabled={isPending}
                  onChange={() => {
                    setActivePicker("when");
                    requestManualFocus("manual-date-wheel");
                  }}
                >
                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                    <CenteredWheelPicker
                      id="manual-date-wheel"
                      label="Date"
                      options={dateOptions}
                      value={studioDate}
                      onValueChange={chooseDate}
                      visibleRows={5}
                      emphasis="prominent"
                      disabled={isPending}
                      emptyMessage="No dates available"
                    />
                    <CenteredWheelPicker
                      id="manual-time-wheel"
                      label="Start"
                      options={timeOptions}
                      value={startsAtIso}
                      onValueChange={chooseExactTime}
                      visibleRows={5}
                      emphasis="prominent"
                      disabled={isPending || !studioDate}
                      emptyMessage="No times available"
                    />
                  </div>
                  <p className="mt-2 text-center text-xs text-[rgb(var(--fg-muted))]">
                    Studio time · {timeZoneLabel}
                  </p>
                  <button
                    type="button"
                    disabled={isPending || !hasStudioSlot}
                    onClick={() => {
                      setActivePicker(null);
                      requestManualFocus("manual-book-session");
                    }}
                    className={`${stepButtonClass} mt-3 w-full`}
                  >
                    Done
                  </button>
                </PickerSection>
              ) : null}

              {availability?.googleCalendarProtection === "reduced" ? (
                <GoogleBusyProtectionWarning embedded />
              ) : null}

              {project?.eligibility === "eligible" ? (
                <section className="reveal-up rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4">
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

                  <div className="mt-3 flex flex-wrap gap-1 border-t border-[rgb(var(--border-subtle))] pt-2.5">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setShowTitleEditor((current) => !current);
                      }}
                      className={quietActionClass}
                      aria-expanded={showTitleEditor}
                    >
                      {showTitleEditor ? "Done" : "Edit title"}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setShowBillingEditor((current) => !current);
                      }}
                      className={quietActionClass}
                      aria-expanded={showBillingEditor}
                    >
                      {showBillingEditor
                        ? "Hide billing"
                        : billingTreatment
                          ? "Change billing"
                          : "Choose billing"}
                    </button>
                  </div>

                  {showTitleEditor ? (
                    <label className="reveal-up mt-3 block">
                      <span className="sr-only">Session title (optional)</span>
                      <input
                        disabled={isPending}
                        value={title}
                        maxLength={200}
                        placeholder={project.defaultTitle ?? "Session"}
                        onChange={(event) => {
                          if (isPending) return;
                          setTitle(event.target.value);
                          resetPreview();
                        }}
                        className={controlClass}
                      />
                    </label>
                  ) : null}

                  {showBillingEditor ? (
                    <fieldset className="reveal-up mt-3">
                      <legend className="sr-only">Billing</legend>
                      <div className="grid gap-2">
                        {project.allowedTreatments.map((treatment) => (
                          <label
                            key={treatment}
                            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 has-[:checked]:border-[rgb(var(--brand-primary))] has-[:checked]:bg-[rgb(var(--brand-primary)/0.08)]"
                          >
                            <input
                              type="radio"
                              disabled={isPending}
                              name="manual-billing"
                              value={treatment}
                              checked={billingTreatment === treatment}
                              onChange={() => {
                                if (isPending) return;
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
                <p className="flex items-center gap-2.5 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.09)]">
                    <CalendarDays className="h-4 w-4" aria-hidden />
                  </span>
                  The artist will receive a calendar invitation.
                </p>
              ) : null}
            </div>
            {isPending ? (
              <p role="status" className="mt-3 text-sm text-[rgb(var(--fg-secondary))]">
                Checking availability…
              </p>
            ) : null}
            {error ? <ErrorMessage>{error}</ErrorMessage> : null}
          </div>
        )}

        {confirmWarnings || activePicker === null ? (
          <footer className="shrink-0 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-7 sm:pt-4 sm:pb-6">
            {confirmWarnings ? (
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setConfirmWarnings(false);
                    requestManualFocus("manual-book-session");
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
              <button
                id="manual-book-session"
                type="button"
                disabled={isPending || isAvailabilityPending || !online || !canSubmit}
                onClick={submit}
                className={`${primaryButtonClass} w-full`}
              >
                {isPending ? "Checking…" : online ? "Book session" : "Reconnect to book"}
              </button>
            )}
          </footer>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PickerSection({
  eyebrow,
  summary,
  complete,
  expanded,
  disabled,
  onChange,
  children,
}: {
  eyebrow: string;
  summary: string;
  complete: boolean;
  expanded: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={[
        "rounded-[var(--radius-lg)] border transition-[border-color,background-color,box-shadow] duration-200 motion-reduce:transition-none",
        expanded
          ? "border-[rgb(var(--brand-primary)/0.42)] bg-[rgb(var(--bg-sunken))] p-3.5 shadow-[0_12px_30px_-28px_rgb(var(--brand-primary-dark))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3",
      ].join(" ")}
    >
      {expanded ? (
        <>
          <p className="mb-3 text-center font-mono text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary-text))] uppercase">
            {eyebrow}
          </p>
          {children}
        </>
      ) : (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
              {eyebrow}
            </p>
            <p
              className={[
                "mt-1 truncate text-center text-sm font-bold sm:text-left",
                complete ? "text-[rgb(var(--fg-default))]" : "text-[rgb(var(--fg-muted))]",
              ].join(" ")}
            >
              {summary}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onChange}
            className={`${quietActionClass} disabled:pointer-events-none disabled:opacity-45`}
            aria-label={`${complete ? "Change" : "Choose"} ${eyebrow.replace(/^\d+\s*·\s*/, "").toLowerCase()}`}
          >
            {complete ? "Change" : "Choose"}
          </button>
        </div>
      )}
    </section>
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
          ? "Review these availability warnings before creating the session."
          : "Google availability could not be fully checked."}
      </p>
      {protectionFrom(preview) === "reduced" ? <GoogleBusyProtectionWarning embedded /> : null}
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
      {isPending ? (
        <p role="status" className="mt-4 text-sm text-[rgb(var(--fg-secondary))]">
          Creating session…
        </p>
      ) : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
    </div>
  );
}

function exactTimeOptions(
  slots: ProducerExactSessionAvailability["days"][number]["slots"],
): readonly CenteredWheelPickerOption[] {
  const counts = new Map<number, number>();
  for (const slot of slots)
    counts.set(slot.studioStartMin, (counts.get(slot.studioStartMin) ?? 0) + 1);
  const seen = new Map<number, number>();
  return slots.map((slot) => {
    const occurrence = (seen.get(slot.studioStartMin) ?? 0) + 1;
    seen.set(slot.studioStartMin, occurrence);
    const duplicate = (counts.get(slot.studioStartMin) ?? 0) > 1;
    const suffix = duplicate ? (occurrence === 1 ? " · first" : " · second") : "";
    return {
      value: slot.startsAt,
      label: `${timeInputValue(slot.studioStartMin)}${suffix}`,
      ariaLabel: `${timeInputValue(slot.studioStartMin)}${duplicate ? `, ${occurrence === 1 ? "first" : "second"} occurrence` : ""}`,
    };
  });
}

function findPreferredSlot(
  availability: ProducerExactSessionAvailability,
  preferred: { studioDate: string; studioStartMin: number | null },
) {
  const preferredDay = availability.days.find((day) => day.date === preferred.studioDate);
  if (preferredDay) {
    const exact = preferredDay.slots.find(
      (slot) => slot.studioStartMin === preferred.studioStartMin,
    );
    if (exact) return exact;
    if (preferredDay.slots[0]) return preferredDay.slots[0];
  }
  return availability.days.flatMap((day) => day.slots)[0] ?? null;
}

function projectEligibilityLabel(
  value: "eligible" | "no_active_session_package" | "multiple_active_session_packages",
): string {
  if (value === "no_active_session_package") return "no active session package";
  if (value === "multiple_active_session_packages") return "multiple active session packages";
  return "available";
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

const iconButtonClass =
  "sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-sunken))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50";
const controlClass =
  "h-11 min-w-0 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-3 text-sm text-[rgb(var(--fg-default))] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))]";
const quietActionClass =
  "sk-press inline-flex h-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] px-3 text-xs font-bold text-[rgb(var(--brand-primary-text))] hover:bg-[rgb(var(--brand-primary)/0.09)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none";
const stepButtonClass =
  "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-sm font-bold text-[rgb(var(--fg-inverse))] disabled:cursor-not-allowed disabled:opacity-35";
const secondaryButtonClass =
  "sk-press inline-flex h-12 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] disabled:opacity-50";
const primaryButtonClass =
  "sk-cta-press inline-flex h-12 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-bold text-[rgb(var(--bg-sidebar))] shadow-[0_10px_24px_-16px_rgb(var(--brand-primary-dark))] disabled:cursor-not-allowed disabled:bg-[rgb(var(--brand-primary)/0.34)] disabled:text-[rgb(var(--fg-muted))] disabled:shadow-none";
