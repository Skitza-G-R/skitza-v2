"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { bookingActionLabel, locationLabel } from "~/components/artist/sessions/book-data";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { markMeaningfulInstallAction } from "~/lib/pwa/install-guidance";
import { formatGmtClockTime } from "~/lib/timezone-display";

import { confirmBookingAction, rescheduleBookingAction } from "./actions";
import { findPrepaidSessionByAllowance } from "./prepaid-session-selection";

type ExactSlot = {
  startsAtISO: string;
  endsAtISO: string;
  studioDate: string;
  studioStartMin: number;
};

type AvailabilityDay = {
  date: string;
  slots: ExactSlot[];
};

type Availability = {
  days: AvailabilityDay[];
  artistTimeZone: string;
  studioTimeZone: string;
  today: string;
};

type Studio = {
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

type ActivePackage = {
  purchaseId: string;
  sessionAllowanceId: string;
  projectId: string;
  title: string;
  packageName: string;
  sessionCount: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  unlimitedSessions: boolean;
  durationMin: number;
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  autoConfirm: boolean;
};

type Props = {
  activeStudioId: string;
  availability: Availability;
  studios: Studio[];
  activePackages: ActivePackage[];
  initialSessionAllowanceId: string | null;
  rescheduleSessionId: string | null;
};

type Step = "package" | "day" | "time" | "review";

function civilDate(date: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

function formatDayLong(date: string): string {
  return civilDate(date, { weekday: "long", month: "long", day: "numeric" });
}

function formatDayCard(date: string): { weekday: string; date: string } {
  return {
    weekday: civilDate(date, { weekday: "short" }),
    date: civilDate(date, { month: "short", day: "numeric" }),
  };
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${String(remainder)} min`;
  if (remainder === 0) return `${String(hours)} hr`;
  return `${String(hours)} hr ${String(remainder)} min`;
}

function formatInstant(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(iso).toLocaleString(undefined, { ...options, timeZone });
}

function formatTime(iso: string, timeZone: string, includeZone = false): string {
  if (includeZone) return formatGmtClockTime(new Date(iso), timeZone);
  return formatInstant(iso, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInstantDate(iso: string, timeZone: string): string {
  return formatInstant(iso, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(key: string): string {
  return civilDate(`${key}-01`, { month: "long", year: "numeric" });
}

export function BookingClient({
  activeStudioId,
  availability,
  studios,
  activePackages,
  initialSessionAllowanceId,
  rescheduleSessionId,
}: Props) {
  const router = useRouter();
  const online = useOnlineStatus();
  const activeStudio = studios.find((studio) => studio.producerId === activeStudioId) ?? null;
  const packageStepRequired =
    !rescheduleSessionId && activePackages.length > 1 && !initialSessionAllowanceId;
  const [step, setStep] = useState<Step>(packageStepRequired ? "package" : "day");
  const [selectedAllowanceId, setSelectedAllowanceId] = useState<string | null>(
    initialSessionAllowanceId,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedStartsAtISO, setSelectedStartsAtISO] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; id: string; status: "pending_approval" | "confirmed" }
    | { ok: false; error: string }
    | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const operationKey = useRef<string | null>(null);

  const selectedPackage = findPrepaidSessionByAllowance(
    activePackages,
    selectedAllowanceId,
  );
  const selectedDay =
    availability.days.find((day) => day.date === selectedDate) ?? null;
  const selectedSlot =
    selectedDay?.slots.find((slot) => slot.startsAtISO === selectedStartsAtISO) ?? null;

  useEffect(() => {
    if (initialSessionAllowanceId) {
      setSelectedAllowanceId(initialSessionAllowanceId);
    }
  }, [initialSessionAllowanceId]);

  function resetCommand() {
    operationKey.current = null;
    setResult(null);
  }

  function back() {
    if (step === "review") {
      setStep("time");
      return;
    }
    if (step === "time") {
      setSelectedStartsAtISO(null);
      setStep("day");
      return;
    }
    if (step === "day" && packageStepRequired) {
      setStep("package");
      return;
    }
    if (rescheduleSessionId) {
      router.push(withArtistStudio(`/artist/sessions/${rescheduleSessionId}`, activeStudioId));
      return;
    }
    router.push(withArtistStudio("/artist/sessions", activeStudioId));
  }

  function continueFromPackage() {
    if (!selectedPackage || !online) return;
    const params = new URLSearchParams({
      studio: activeStudioId,
      project: selectedPackage.projectId,
      allowance: selectedPackage.sessionAllowanceId,
    });
    startTransition(() => {
      router.replace(`/artist/book?${params.toString()}`);
    });
  }

  function chooseDate(date: string) {
    setSelectedDate(date);
    setSelectedStartsAtISO(null);
    resetCommand();
    setStep("time");
  }

  function chooseTime(startsAtISO: string) {
    setSelectedStartsAtISO(startsAtISO);
    resetCommand();
  }

  function continueFromTime() {
    if (!selectedSlot) return;
    setStep("review");
  }

  function submit() {
    if (!online || !selectedPackage || !selectedSlot || isPending) return;
    startTransition(async () => {
      operationKey.current ??= crypto.randomUUID();
      try {
        const response = rescheduleSessionId
          ? await rescheduleBookingAction({
              id: rescheduleSessionId,
              startsAt: selectedSlot.startsAtISO,
              operationKey: operationKey.current,
            })
          : await confirmBookingAction({
              producerId: activeStudioId,
              startsAt: selectedSlot.startsAtISO,
              durationMin: selectedPackage.durationMin,
              projectId: selectedPackage.projectId,
              purchaseId: selectedPackage.purchaseId,
              sessionAllowanceId: selectedPackage.sessionAllowanceId,
              operationKey: operationKey.current,
            });
        setResult(response);
        if (response.ok) {
          markMeaningfulInstallAction();
          router.push(withArtistStudio(`/artist/sessions?just=${response.id}`, activeStudioId));
        }
      } catch {
        setResult({
          ok: false,
          error: "Couldn’t save this session. Check your connection and try again.",
        });
      }
    });
  }

  const title = rescheduleSessionId ? "Reschedule" : "Book a session";
  const stepLabel =
    step === "package"
      ? "Choose package"
      : step === "day"
        ? "Choose day"
        : step === "time"
          ? "Choose time"
          : "Review";

  if (!selectedPackage && activePackages.length === 0) {
    return (
      <FocusedFrame title={title} sub={activeStudio?.name} onBack={back}>
        <div className="flex flex-1 flex-col justify-center text-center">
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
            No sessions available
          </h1>
          <p className="mx-auto mt-3 max-w-[330px] text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
            View this studio’s services to get a session package.
          </p>
          <Link
            href={withArtistStudio("/artist/store", activeStudioId)}
            className="sk-press mt-8 inline-flex min-h-12 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 font-semibold text-[rgb(var(--bg-sidebar))]"
          >
            View services
          </Link>
        </div>
      </FocusedFrame>
    );
  }

  return (
    <FocusedFrame title={title} sub={activeStudio?.name} onBack={back}>
      <header>
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
          {stepLabel}
        </p>
        <h1 className="font-display mt-2 text-[28px] leading-[1.08] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          {step === "package"
            ? "Which package is this for?"
            : step === "day"
              ? "Pick your next available day"
              : step === "time"
                ? selectedDate
                  ? formatDayLong(selectedDate)
                  : "Choose a time"
                : "Review your session"}
        </h1>
        {selectedPackage && step !== "package" ? (
          <p className="mt-2 text-[13px] text-[rgb(var(--fg-secondary))]">
            {selectedPackage.packageName} · {formatDuration(selectedPackage.durationMin)} ·{" "}
            {locationLabel(selectedPackage.locationType)}
          </p>
        ) : null}
      </header>

      <div className="mt-7 flex-1">
        {step === "package" ? (
          <PackageStep
            packages={activePackages}
            selectedAllowanceId={selectedAllowanceId}
            onSelect={(id) => {
              setSelectedAllowanceId(id);
              resetCommand();
            }}
          />
        ) : null}

        {step === "day" ? (
          <DayStep
            days={availability.days}
            showCalendar={showCalendar}
            onToggleCalendar={() => {
              setShowCalendar((visible) => !visible);
            }}
            onSelect={chooseDate}
          />
        ) : null}

        {step === "time" && selectedDay ? (
          <TimeStep
            day={selectedDay}
            artistTimeZone={availability.artistTimeZone}
            selectedStartsAtISO={selectedStartsAtISO}
            onSelect={chooseTime}
          />
        ) : null}

        {step === "review" && selectedSlot && selectedPackage ? (
          <ReviewStep
            slot={selectedSlot}
            package={selectedPackage}
            producerName={activeStudio?.name ?? "Your producer"}
            artistTimeZone={availability.artistTimeZone}
            studioTimeZone={availability.studioTimeZone}
            autoConfirm={selectedPackage.autoConfirm}
          />
        ) : null}

        {result && !result.ok ? (
          <p
            role="alert"
            className="mt-5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-danger-text))]"
          >
            {result.error}
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 mt-8 bg-[rgb(var(--bg-background))] pt-3 pb-[max(env(safe-area-inset-bottom),20px)]">
        {step === "package" ? (
          <PrimaryCta
            disabled={!selectedPackage || !online || isPending}
            ariaBusy={isPending}
            onClick={continueFromPackage}
            sub={!online ? "Reconnect to load this package" : undefined}
          >
            {isPending ? "Loading dates…" : "Continue"}
          </PrimaryCta>
        ) : null}
        {step === "time" ? (
          <PrimaryCta
            disabled={!selectedSlot}
            onClick={continueFromTime}
            sub={selectedSlot ? undefined : "Choose one available time"}
          >
            Review time
          </PrimaryCta>
        ) : null}
        {step === "review" && selectedPackage ? (
          <PrimaryCta
            disabled={!online || isPending || result?.ok === true}
            ariaBusy={isPending}
            onClick={submit}
            sub={
              !online
                ? "Reconnect before submitting"
                : rescheduleSessionId
                  ? "Your current time stays booked until this succeeds"
                  : selectedPackage.autoConfirm
                    ? "This time confirms immediately"
                    : `${activeStudio?.name ?? "Your producer"} will review this held time`
            }
          >
            {isPending
              ? rescheduleSessionId
                ? "Rescheduling…"
                : "Sending…"
              : rescheduleSessionId
                ? "Reschedule to this time"
                : bookingActionLabel(!selectedPackage.autoConfirm)}
          </PrimaryCta>
        ) : null}
      </div>
    </FocusedFrame>
  );
}

function FocusedFrame({
  title,
  sub,
  onBack,
  children,
}: {
  title: string;
  sub?: string | undefined;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[rgb(var(--bg-background))]">
      <FunnelTopBar title={title} {...(sub ? { sub } : {})} onBack={onBack} />
      <main className="mx-auto flex min-h-[calc(100dvh-57px)] w-full max-w-[560px] flex-col px-5 pt-8 sm:px-7">
        {children}
      </main>
    </div>
  );
}

function PackageStep({
  packages,
  selectedAllowanceId,
  onSelect,
}: {
  packages: ActivePackage[];
  selectedAllowanceId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {packages.map((item) => {
        const selected = item.sessionAllowanceId === selectedAllowanceId;
        const remaining = item.unlimitedSessions
          ? "Unlimited sessions"
          : `${String(item.sessionsRemaining)} remaining`;
        return (
          <button
            key={item.sessionAllowanceId}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onSelect(item.sessionAllowanceId);
            }}
            className="sk-press w-full rounded-[var(--radius-lg)] border p-4 text-left"
            style={{
              background: selected
                ? "rgb(var(--brand-primary) / 0.08)"
                : "rgb(var(--bg-elevated))",
              borderColor: selected
                ? "rgb(var(--brand-primary))"
                : "rgb(var(--border-subtle))",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-[rgb(var(--fg-default))]">{item.packageName}</p>
                <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-secondary))]">
                  {formatDuration(item.durationMin)} · {locationLabel(item.locationType)}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[10px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                {remaining}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DayStep({
  days,
  showCalendar,
  onToggleCalendar,
  onSelect,
}: {
  days: AvailabilityDay[];
  showCalendar: boolean;
  onToggleCalendar: () => void;
  onSelect: (date: string) => void;
}) {
  const nextDays = days.slice(0, 4);
  if (days.length === 0) {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-lg)] border border-dashed px-5 py-8 text-center text-sm leading-relaxed text-[rgb(var(--fg-secondary))]"
        style={{ borderColor: "rgb(var(--border-strong))" }}
      >
        No open times are available in this booking window.
      </div>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {nextDays.map((day) => {
          const label = formatDayCard(day.date);
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => {
                onSelect(day.date);
              }}
              className="sk-press min-h-24 rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] p-4 text-left"
              style={{ borderColor: "rgb(var(--border-subtle))", boxShadow: "var(--shadow-sm)" }}
            >
              <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary-dark))] uppercase">
                {label.weekday}
              </span>
              <span className="font-display mt-2 block text-[18px] font-extrabold text-[rgb(var(--fg-default))]">
                {label.date}
              </span>
              <span className="mt-1 block text-[11.5px] text-[rgb(var(--fg-muted))]">
                {String(day.slots.length)} {day.slots.length === 1 ? "time" : "times"}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleCalendar}
        aria-expanded={showCalendar}
        className="sk-press mt-4 min-h-11 w-full rounded-[var(--radius-lg)] text-sm font-semibold text-[rgb(var(--brand-primary-dark))]"
      >
        {showCalendar ? "Hide calendar" : "More dates"}
      </button>
      {showCalendar ? <MonthCalendar days={days} onSelect={onSelect} /> : null}
    </div>
  );
}

function MonthCalendar({
  days,
  onSelect,
}: {
  days: AvailabilityDay[];
  onSelect: (date: string) => void;
}) {
  const months = useMemo(() => [...new Set(days.map((day) => monthKey(day.date)))], [days]);
  const [monthIndex, setMonthIndex] = useState(0);
  const key = months[monthIndex] ?? months[0];
  if (!key) return null;
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return null;
  const available = new Set(days.filter((day) => monthKey(day.date) === key).map((day) => day.date));
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  return (
    <section
      aria-label="Available dates calendar"
      className="mt-3 rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] p-4"
      style={{ borderColor: "rgb(var(--border-subtle))" }}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={monthIndex === 0}
          onClick={() => {
            setMonthIndex((index) => Math.max(0, index - 1));
          }}
          className="sk-press h-11 w-11 rounded-full disabled:opacity-30"
        >
          ←
        </button>
        <h2 className="font-display text-[15px] font-extrabold">{monthLabel(key)}</h2>
        <button
          type="button"
          aria-label="Next month"
          disabled={monthIndex === months.length - 1}
          onClick={() => {
            setMonthIndex((index) => Math.min(months.length - 1, index + 1));
          }}
          className="sk-press h-11 w-11 rounded-full disabled:opacity-30"
        >
          →
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center font-mono text-[9px] text-[rgb(var(--fg-muted))] uppercase">
        {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
          <span key={`${label}-${String(index)}`}>{label}</span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <span key={`empty-${String(index)}`} />;
          const date = `${key}-${String(day).padStart(2, "0")}`;
          const enabled = available.has(date);
          return (
            <button
              key={date}
              type="button"
              disabled={!enabled}
              onClick={() => {
                onSelect(date);
              }}
              className="sk-press aspect-square rounded-[var(--radius-md)] text-[12px] font-semibold disabled:text-[rgb(var(--fg-muted)/0.35)]"
              style={
                enabled
                  ? {
                      background: "rgb(var(--brand-primary) / 0.12)",
                      color: "rgb(var(--fg-default))",
                    }
                  : undefined
              }
            >
              {day}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TimeStep({
  day,
  artistTimeZone,
  selectedStartsAtISO,
  onSelect,
}: {
  day: AvailabilityDay;
  artistTimeZone: string;
  selectedStartsAtISO: string | null;
  onSelect: (startsAtISO: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {day.slots.map((slot) => {
        const selected = slot.startsAtISO === selectedStartsAtISO;
        return (
          <button
            key={slot.startsAtISO}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onSelect(slot.startsAtISO);
            }}
            className="sk-press min-h-14 rounded-[var(--radius-lg)] border px-3 py-3 text-sm font-semibold"
            style={{
              background: selected
                ? "rgb(var(--brand-primary))"
                : "rgb(var(--bg-elevated))",
              color: selected ? "rgb(var(--bg-sidebar))" : "rgb(var(--fg-default))",
              borderColor: selected
                ? "rgb(var(--brand-primary-dark))"
                : "rgb(var(--border-subtle))",
            }}
          >
            {formatTime(slot.startsAtISO, artistTimeZone, true)}
          </button>
        );
      })}
    </div>
  );
}

function ReviewStep({
  slot,
  package: selectedPackage,
  producerName,
  artistTimeZone,
  studioTimeZone,
  autoConfirm,
}: {
  slot: ExactSlot;
  package: ActivePackage;
  producerName: string;
  artistTimeZone: string;
  studioTimeZone: string;
  autoConfirm: boolean;
}) {
  const zonesDiffer = artistTimeZone !== studioTimeZone;
  return (
    <section
      className="overflow-hidden rounded-[var(--radius-xl)] border bg-[rgb(var(--bg-elevated))]"
      style={{ borderColor: "rgb(var(--border-subtle))", boxShadow: "var(--shadow-md)" }}
    >
      <div className="bg-[rgb(var(--bg-sidebar))] px-5 py-6 text-white">
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase">
          Your time
        </p>
        <h2 className="font-display mt-2 text-[25px] leading-tight font-extrabold tracking-[-0.03em]">
          {formatInstantDate(slot.startsAtISO, artistTimeZone)}
        </h2>
        <p className="mt-1 text-[18px] font-semibold">
          {formatTime(slot.startsAtISO, artistTimeZone, true)}
        </p>
        {zonesDiffer ? (
          <p className="mt-3 text-[12px] text-[rgb(255_255_255_/_0.58)]">
            Studio time · {formatInstantDate(slot.startsAtISO, studioTimeZone)} ·{" "}
            {formatTime(slot.startsAtISO, studioTimeZone, true)}
          </p>
        ) : null}
      </div>
      <dl className="divide-y divide-[rgb(var(--border-subtle))] px-5">
        <ReviewRow label="Package" value={selectedPackage.packageName} />
        <ReviewRow label="Duration" value={formatDuration(selectedPackage.durationMin)} />
        <ReviewRow label="Location" value={locationLabel(selectedPackage.locationType)} />
        <ReviewRow label="Studio" value={producerName} />
      </dl>
      <p className="px-5 py-4 text-[12.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
        {autoConfirm
          ? "This available time will be confirmed immediately."
          : "This time will be held while the producer reviews your request."}
      </p>
    </section>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="text-[12px] text-[rgb(var(--fg-muted))]">{label}</dt>
      <dd className="text-right text-[13px] font-semibold text-[rgb(var(--fg-default))]">
        {value}
      </dd>
    </div>
  );
}
