"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ProducerPicker } from "~/components/artist/producer-picker";
import { PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { bookingActionLabel, locationLabel } from "~/components/artist/sessions/book-data";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { markMeaningfulInstallAction } from "~/lib/pwa/install-guidance";

import { confirmBookingAction, rescheduleBookingAction } from "./actions";
import { findPrepaidSessionByAllowance } from "./prepaid-session-selection";

type BlockShape = { startMin: number; endMin: number; available: boolean };
type Day = {
  date: string;
  weekday: number;
  blocks: BlockShape[];
};
type Availability = { days: Day[]; timeZone: string; today: string };
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
  packageName: string | null;
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

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SLOT_INCREMENT_MIN = 30;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

function dayHasAvailability(day: Day | undefined): boolean {
  return day?.blocks.some((block) => block.available) ?? false;
}

// ──────────────────────────────────────────────────────────────────────
// Formatters & date math
// ──────────────────────────────────────────────────────────────────────

function fmtClock(minutes: number): string {
  const ref = new Date(2000, 0, 1, 0, 0, 0, 0);
  ref.setMinutes(minutes);
  return ref.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDurationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hours)} hr`;
  return `${String(hours)} hr ${String(rest)} min`;
}

function fmtMonthYear(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function isoForCell(year: number, month0: number, day: number): string {
  const m = String(month0 + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${String(year)}-${m}-${d}`;
}

function shiftIsoByDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return isoForCell(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

// Half-hour start-time options inside a block, capped so the session
// still fits before the block closes.
function startsForBlock(block: BlockShape, durationMin: number): number[] {
  const out: number[] = [];
  const latest = block.endMin - durationMin;
  for (let t = block.startMin; t <= latest; t += SLOT_INCREMENT_MIN) {
    out.push(t);
  }
  return out;
}

type StartOption = { minutes: number; block: "morning" | "evening" };

// ──────────────────────────────────────────────────────────────────────
// Main client — single mobile-first column (proto S10 "Time" screen).
// Title → producer/session summary → month calendar → legend → inline
// time chips → service/credit picker → pinned "Request this slot".
// ──────────────────────────────────────────────────────────────────────

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
  const today = availability.today;

  const daysByDate = useMemo(() => {
    const m = new Map<string, Day>();
    for (const d of availability.days) m.set(d.date, d);
    return m;
  }, [availability.days]);

  const hasAnyAvailability = useMemo(() => {
    for (const d of availability.days) {
      if (dayHasAvailability(d)) return true;
    }
    return false;
  }, [availability.days]);

  const initialYear = Number(today.slice(0, 4));
  const initialMonth = Number(today.slice(5, 7)) - 1;
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [chosenStart, setChosenStart] = useState<number | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<"morning" | "evening" | null>(null);
  const [selectedSessionAllowanceId, setSelectedSessionAllowanceId] = useState<string | null>(
    initialSessionAllowanceId,
  );
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { ok: true; id: string; status: "pending_approval" | "confirmed" }
    | { ok: false; error: string }
    | null
  >(null);
  const operationKeyRef = useRef<string | null>(null);

  const selectedPackage = findPrepaidSessionByAllowance(activePackages, selectedSessionAllowanceId);
  const activeStudio = studios.find((s) => s.producerId === activeStudioId);

  // A successful request can consume the final prepaid session. Server
  // refreshes then remove that package from activePackages; never leave the
  // client in a stale credit mode that could hide services or resubmit it.
  useEffect(() => {
    if (selectedSessionAllowanceId && !selectedPackage) {
      setSelectedSessionAllowanceId(null);
      setSelectedDate(null);
      setChosenStart(null);
      setSelectedBlock(null);
      setResult(null);
      operationKeyRef.current = null;
    }
  }, [selectedPackage, selectedSessionAllowanceId]);

  const startsForSelected: StartOption[] = useMemo(() => {
    if (!selectedDate || !selectedPackage) return [];
    const day = daysByDate.get(selectedDate);
    if (!day) return [];
    const out: StartOption[] = [];
    for (const block of day.blocks) {
      if (!block.available) continue;
      for (const m of startsForBlock(block, selectedPackage.durationMin)) {
        out.push({ minutes: m, block: m < 12 * 60 ? "morning" : "evening" });
      }
    }
    return out;
  }, [selectedDate, daysByDate, selectedPackage?.durationMin]);

  const resetSelection = () => {
    setSelectedDate(null);
    setChosenStart(null);
    setSelectedBlock(null);
    setResult(null);
    operationKeyRef.current = null;
  };

  const handleSwitchStudio = (id: string) => {
    if (!online) {
      setResult({ ok: false, error: "Reconnect to load another studio’s booking times." });
      return;
    }
    resetSelection();
    setSelectedSessionAllowanceId(null);
    router.push(`/artist/book?studio=${id}`);
  };

  const handlePickAllowance = (id: string) => {
    if (!online) {
      setResult({ ok: false, error: "Reconnect to load dates for this purchased session." });
      return;
    }
    if (id === selectedSessionAllowanceId) return;
    const selected = activePackages.find((pkg) => pkg.sessionAllowanceId === id);
    if (!selected) return;
    resetSelection();
    setSelectedSessionAllowanceId(id);
    const params = new URLSearchParams({
      studio: activeStudioId,
      project: selected.projectId,
      allowance: id,
    });
    router.replace(`/artist/book?${params.toString()}`);
  };

  const handlePickDate = (date: string) => {
    setSelectedDate(date);
    setChosenStart(null);
    setSelectedBlock(null);
    setResult(null);
    operationKeyRef.current = null;
  };

  const handlePickStart = (opt: StartOption) => {
    setChosenStart(opt.minutes);
    setSelectedBlock(opt.block);
    setResult(null);
    operationKeyRef.current = null;
  };

  const handleConfirm = () => {
    if (!online) {
      setResult({
        ok: false,
        error: "Reconnect before booking. No session has been requested.",
      });
      return;
    }
    if (!selectedDate || chosenStart == null || !selectedBlock || !selectedPackage) return;
    startTransition(async () => {
      operationKeyRef.current ??= crypto.randomUUID();
      const operationKey = operationKeyRef.current;
      try {
        const res = rescheduleSessionId
          ? await rescheduleBookingAction({
              id: rescheduleSessionId,
              date: selectedDate,
              startMin: chosenStart,
              operationKey,
            })
          : await confirmBookingAction({
              producerId: activeStudioId,
              date: selectedDate,
              block: selectedBlock,
              startMin: chosenStart,
              durationMin: selectedPackage.durationMin,
              projectId: null,
              productId: null,
              existingProjectId: selectedPackage.projectId,
              purchaseId: selectedPackage.purchaseId,
              sessionAllowanceId: selectedPackage.sessionAllowanceId,
              operationKey,
            });
        setResult(res);
        if (res.ok) {
          markMeaningfulInstallAction();
          router.push(withArtistStudio(`/artist/sessions?just=${res.id}`, activeStudioId));
        }
      } catch {
        setResult({
          ok: false,
          error: "Couldn’t confirm this booking. Check your connection and try again.",
        });
      }
    });
  };

  const canGoBack =
    viewYear > initialYear || (viewYear === initialYear && viewMonth > initialMonth);

  // Gating — identical booleans to the original, only the markup moved.
  const showConfirm = chosenStart != null && selectedBlock !== null && selectedPackage !== null;
  const actionLabel = rescheduleSessionId
    ? "Reschedule session"
    : bookingActionLabel(!selectedPackage?.autoConfirm);

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-6">
      {studios.length > 1 && !rescheduleSessionId ? (
        <ProducerPicker studios={studios} activeId={activeStudioId} onSelect={handleSwitchStudio} />
      ) : null}

      {/* ── Title + producer/session summary (folds the old LeftContext) ── */}
      <header className="sk-rise space-y-3" style={{ animationDelay: "40ms" }}>
        <h1 className="font-syne text-[28px] leading-[1.04] font-extrabold tracking-[-0.03em] text-balance text-[rgb(var(--fg-default))]">
          {rescheduleSessionId ? "Choose your new time" : "When works for you?"}
        </h1>
        <SummaryLine activeStudio={activeStudio ?? null} selectedPackage={selectedPackage} />
      </header>

      {/* Purchase identity comes first: it owns duration, location and policy. */}
      {activePackages.length > 0 ? (
        <CreditsBlock
          packages={activePackages}
          selectedAllowanceId={selectedSessionAllowanceId}
          onPick={handlePickAllowance}
        />
      ) : rescheduleSessionId ? (
        <p
          role="alert"
          className="rounded-[var(--radius-lg)] border px-4 py-3 text-sm text-[rgb(var(--fg-secondary))]"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
        >
          This session can no longer be rescheduled. Return to My Sessions for its current status.
        </p>
      ) : (
        <Link
          href={withArtistStudio("/artist/store", activeStudioId)}
          className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[rgb(var(--bg-sidebar))]"
        >
          Browse services to request a session
        </Link>
      )}

      {selectedPackage && selectedSessionAllowanceId === initialSessionAllowanceId ? (
        <>
          <CalendarCard
            className="sk-rise"
            style={{ animationDelay: "100ms" }}
            year={viewYear}
            month0={viewMonth}
            daysByDate={daysByDate}
            today={today}
            selectedDate={selectedDate}
            hasAnyAvailability={hasAnyAvailability}
            producerName={activeStudio?.name ?? null}
            onPickDate={handlePickDate}
            onPrevMonth={
              canGoBack
                ? () => {
                    const prev = new Date(Date.UTC(viewYear, viewMonth - 1));
                    setViewYear(prev.getUTCFullYear());
                    setViewMonth(prev.getUTCMonth());
                  }
                : null
            }
            onNextMonth={() => {
              const next = new Date(Date.UTC(viewYear, viewMonth + 1));
              setViewYear(next.getUTCFullYear());
              setViewMonth(next.getUTCMonth());
            }}
          />

          <Legend />

          {selectedDate ? (
            <TimeSection
              key={selectedDate}
              selectedDate={selectedDate}
              starts={startsForSelected}
              chosenStart={chosenStart}
              durationMin={selectedPackage.durationMin}
              onPickStart={handlePickStart}
            />
          ) : null}

          <TimeZoneNote timeZone={availability.timeZone} />
        </>
      ) : selectedPackage ? (
        <p
          className="rounded-[var(--radius-lg)] border px-4 py-3 text-sm text-[rgb(var(--fg-secondary))]"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
          aria-live="polite"
        >
          Refreshing dates for this purchased session…
        </p>
      ) : null}

      {activePackages.length > 0 && !rescheduleSessionId ? (
        <div>
          <Link
            href={withArtistStudio("/artist/store", activeStudioId)}
            className="sk-press inline-flex min-h-11 items-center text-sm font-semibold text-[rgb(var(--brand-primary-dark))] underline underline-offset-4"
          >
            Request a new service instead
          </Link>
        </div>
      ) : null}

      {result && !result.ok ? (
        <p
          role="alert"
          className="rounded-card px-3.5 py-2.5 text-[12.5px]"
          style={{
            background: "rgb(var(--fg-danger) / 0.08)",
            color: "rgb(var(--fg-danger))",
          }}
        >
          {result.error}
        </p>
      ) : null}
      {/* ── Pinned-low primary CTA ── */}
      <div
        className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 pt-1 lg:bottom-3"
        style={{
          background: "linear-gradient(180deg, transparent, rgb(var(--bg-background)) 38%)",
        }}
      >
        <PrimaryCta
          onClick={handleConfirm}
          disabled={!online || !showConfirm || isPending || result?.ok === true}
          sub={
            !online
              ? "Reconnect to confirm this live booking"
              : result?.ok
                ? undefined
                : selectedPackage == null
                  ? "Choose the purchase that owns this session"
                  : selectedDate == null || chosenStart == null
                    ? "Pick a date and time to continue"
                    : rescheduleSessionId
                      ? "Your old time stays booked until this succeeds"
                      : selectedPackage.autoConfirm
                        ? "This time will be confirmed immediately"
                        : `Holding this time${activeStudio?.name ? ` while ${activeStudio.name} confirms` : ""}`
          }
        >
          {isPending
            ? rescheduleSessionId
              ? "Rescheduling…"
              : "Sending…"
            : result?.ok
              ? "Done"
              : selectedPackage
                ? actionLabel
                : "Choose a purchased session"}
        </PrimaryCta>
      </div>

      {/* Shared motion keyframes scoped to /artist/book. All animations
          stay on transform + opacity for hardware acceleration; all
          custom curves use the strong ease-out from Emil's notes. */}
      <style jsx global>{`
        @keyframes book-stagger-in {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes book-pulse-soft {
          0%,
          100% {
            opacity: 0.7;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.18);
          }
        }
        @keyframes book-avatar-pop {
          from {
            opacity: 0;
            transform: scale(0.94);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .book-stagger {
          animation: book-stagger-in 220ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        .book-pulse {
          animation: book-pulse-soft 2.4s ease-in-out infinite;
          transform-origin: center;
          will-change: transform, opacity;
        }
        .book-avatar-pop {
          animation: book-avatar-pop 360ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        @media (hover: hover) and (pointer: fine) {
          .book-day-available:hover:not([aria-selected="true"]) {
            transform: scale(1.04);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .book-stagger,
          .book-pulse,
          .book-avatar-pop {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Summary line — producer avatar + name + session meta (folds the old
// LeftContext side rail into one tight row under the title).
// ──────────────────────────────────────────────────────────────────────

function SummaryLine({
  activeStudio,
  selectedPackage,
}: {
  activeStudio: Studio | null;
  selectedPackage: ActivePackage | null;
}) {
  const initial = (activeStudio?.name ?? "S").charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-2.5">
      {activeStudio?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={activeStudio.logoUrl}
          alt=""
          className="book-avatar-pop h-8 w-8 shrink-0 rounded-full object-cover"
          style={{ boxShadow: "0 0 0 2px rgb(var(--brand-primary) / 0.3)" }}
        />
      ) : (
        <div
          aria-hidden
          className="book-avatar-pop font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-[rgb(var(--bg-sidebar))]"
          style={{
            background:
              "linear-gradient(140deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))",
          }}
        >
          {initial}
        </div>
      )}
      <p className="min-w-0 text-[13px] leading-snug text-[rgb(var(--fg-secondary))]">
        <span className="font-semibold text-[rgb(var(--fg-default))]">
          {activeStudio?.name ?? "Studio session"}
        </span>
        {selectedPackage ? (
          <span className="text-[rgb(var(--fg-muted))]">
            {" · "}
            <span className="font-semibold text-[rgb(var(--fg-default))]">
              {formatDurationLabel(selectedPackage.durationMin)}
            </span>{" "}
            · {locationLabel(selectedPackage.locationType)} · {selectedPackage.minLeadHours}h notice
            · {selectedPackage.bufferMinutes}m buffer ·{" "}
            {selectedPackage.autoConfirm ? "Instant confirmation" : "Producer approval"}
          </span>
        ) : (
          <span className="text-[rgb(var(--fg-muted))]">
            {" · Choose a purchased session first"}
          </span>
        )}
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Calendar card — month grid + month nav + keyboard nav
// ──────────────────────────────────────────────────────────────────────

function CalendarCard({
  className,
  style,
  year,
  month0,
  daysByDate,
  today,
  selectedDate,
  hasAnyAvailability,
  producerName,
  onPickDate,
  onPrevMonth,
  onNextMonth,
}: {
  className?: string;
  style?: React.CSSProperties;
  year: number;
  month0: number;
  daysByDate: Map<string, Day>;
  today: string;
  selectedDate: string | null;
  hasAnyAvailability: boolean;
  producerName: string | null;
  onPickDate: (date: string) => void;
  onPrevMonth: (() => void) | null;
  onNextMonth: () => void;
}) {
  const firstWeekday = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: ({ day: number; iso: string } | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) {
    cells.push({ day: d, iso: isoForCell(year, month0, d) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  // Roving-tabindex target — the cell that will receive focus first
  // when the user tabs into the grid. Defaults to the selected day,
  // then today, then the first available day in view.
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusDateRef = useRef<string | null>(null);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const firstAvailableInView = useMemo(() => {
    for (const c of cells) {
      if (!c) continue;
      if (c.iso < today) continue;
      const d = daysByDate.get(c.iso);
      if (dayHasAvailability(d)) return c.iso;
    }
    return null;
  }, [cells, daysByDate, today]);
  const datesInView = new Set(cells.flatMap((cell) => (cell ? [cell.iso] : [])));
  const rovingDate =
    (focusedDate && datesInView.has(focusedDate) ? focusedDate : null) ??
    (selectedDate && datesInView.has(selectedDate) ? selectedDate : null) ??
    (datesInView.has(today) ? today : null) ??
    firstAvailableInView ??
    cells.find((cell) => cell !== null)?.iso ??
    null;

  useEffect(() => {
    const target = pendingFocusDateRef.current;
    if (!target) return;
    const element = dayRefs.current.get(target);
    if (!element) return;
    pendingFocusDateRef.current = null;
    setFocusedDate(target);
    element.focus();
  }, [month0, year]);

  const moveFocus = useCallback(
    (fromIso: string, delta: number) => {
      const target = shiftIsoByDays(fromIso, delta);
      const el = dayRefs.current.get(target);
      if (el) {
        setFocusedDate(target);
        el.focus();
        return;
      }
      // Target not visible (different month) — page to that month and
      // focus on next render via a useEffect tied to viewYear/Month.
      const [y, m] = target.split("-").map(Number);
      if (!y || !m) return;
      pendingFocusDateRef.current = target;
      if (y < year || (y === year && m - 1 < month0)) {
        onPrevMonth?.();
      } else if (y > year || (y === year && m - 1 > month0)) {
        onNextMonth();
      } else {
        pendingFocusDateRef.current = null;
      }
    },
    [month0, year, onPrevMonth, onNextMonth],
  );

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const fromIso = (e.target as HTMLElement).dataset.date ?? rovingDate;
    if (!fromIso) return;
    let delta = 0;
    switch (e.key) {
      case "ArrowLeft":
        delta = -1;
        break;
      case "ArrowRight":
        delta = 1;
        break;
      case "ArrowUp":
        delta = -7;
        break;
      case "ArrowDown":
        delta = 7;
        break;
      case "Home": {
        const [y, m, d] = fromIso.split("-").map(Number);
        if (!y || !m || !d) return;
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        delta = -dow;
        break;
      }
      case "End": {
        const [y, m, d] = fromIso.split("-").map(Number);
        if (!y || !m || !d) return;
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        delta = 6 - dow;
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    moveFocus(fromIso, delta);
  };

  return (
    <div
      className={`rounded-card overflow-hidden border bg-[rgb(var(--bg-elevated))] p-2 sm:p-5 ${className ?? ""}`}
      style={{
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-md)",
        ...style,
      }}
    >
      <header className="mb-4 flex items-center justify-between">
        {onPrevMonth ? (
          <NavButton onClick={onPrevMonth} label="Previous month">
            <ChevronLeft />
          </NavButton>
        ) : (
          <span className="h-11 w-11 sm:h-9 sm:w-9" aria-hidden />
        )}
        <h2 className="font-syne text-[16px] leading-none font-extrabold tracking-[-0.015em] text-[rgb(var(--fg-default))]">
          {fmtMonthYear(year, month0)}
        </h2>
        <NavButton onClick={onNextMonth} label="Next month">
          <ChevronRight />
        </NavButton>
      </header>

      {!hasAnyAvailability ? (
        <div
          role="status"
          className="mb-4 rounded-[var(--radius-md)] border border-dashed px-3 py-2.5 text-[12.5px] leading-snug"
          style={{
            background: "rgb(var(--bg-overlay))",
            borderColor: "rgb(var(--border-strong))",
            color: "rgb(var(--fg-secondary))",
          }}
        >
          No open slots in this booking window.
          {producerName ? <> Message {producerName} directly.</> : null}
        </div>
      ) : null}

      <div
        role="grid"
        aria-label={fmtMonthYear(year, month0)}
        className="grid grid-cols-7 gap-0 sm:gap-1"
        onKeyDown={onGridKeyDown}
      >
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            role="columnheader"
            className="pb-2 text-center font-mono text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase"
          >
            {w.slice(0, 1)}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell)
            return <div key={`empty-${String(i)}`} role="gridcell" aria-hidden className="h-11" />;
          const day = daysByDate.get(cell.iso);
          const available = dayHasAvailability(day);
          const isToday = cell.iso === today;
          const isSelected = cell.iso === selectedDate;
          const inPast = cell.iso < today;
          const enabled = available && !inPast;
          const isRoving = cell.iso === rovingDate;
          return (
            <DayCell
              key={cell.iso}
              dayNum={cell.day}
              available={enabled}
              isToday={isToday}
              isSelected={isSelected}
              tabIndex={isRoving ? 0 : -1}
              dateISO={cell.iso}
              ariaLabel={fmtDateLong(cell.iso)}
              staggerDelayMs={Math.floor(i / 7) * 25}
              registerRef={(el) => {
                if (el) dayRefs.current.set(cell.iso, el);
                else dayRefs.current.delete(cell.iso);
              }}
              onFocus={() => {
                setFocusedDate(cell.iso);
              }}
              onClick={() => {
                if (enabled) onPickDate(cell.iso);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  dayNum,
  available,
  isToday,
  isSelected,
  tabIndex,
  dateISO,
  ariaLabel,
  staggerDelayMs,
  registerRef,
  onFocus,
  onClick,
}: {
  dayNum: number;
  available: boolean;
  isToday: boolean;
  isSelected: boolean;
  tabIndex: 0 | -1;
  dateISO: string;
  ariaLabel: string;
  staggerDelayMs: number;
  registerRef: (el: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onClick: () => void;
}) {
  const disabled = !available;
  const tone = isSelected
    ? {
        background: "rgb(var(--bg-sidebar))",
        color: "rgb(var(--bg-elevated))",
        boxShadow: "var(--shadow-md)",
      }
    : available
      ? {
          background: "transparent",
          color: "rgb(var(--fg-default))",
        }
      : {
          background: "transparent",
          color: "rgb(var(--fg-faint))",
        };
  // Available days carry a small amber availability dot; today keeps its
  // pulsing dot. Both sit at the same anchor and never show on the
  // selected (solid dark) cell.
  const showAvailableDot = available && !isSelected && !isToday;
  return (
    <button
      ref={registerRef}
      type="button"
      role="gridcell"
      data-date={dateISO}
      aria-disabled={disabled}
      onFocus={onFocus}
      onClick={onClick}
      tabIndex={tabIndex}
      aria-current={isToday ? "date" : undefined}
      aria-selected={isSelected}
      aria-label={ariaLabel}
      className={`book-stagger sk-press relative flex h-11 items-center justify-center rounded-full font-mono text-[13px] font-semibold tabular-nums ${disabled ? "cursor-not-allowed" : ""} ${available ? "book-day-available" : ""}`}
      style={{
        ...tone,
        transition: `background-color 150ms ${EASE_OUT}, color 150ms ${EASE_OUT}, box-shadow 220ms ${EASE_OUT}, transform 180ms ${EASE_OUT}`,
        animationDelay: `${String(staggerDelayMs)}ms`,
      }}
    >
      {dayNum}
      {isToday && !isSelected ? (
        <span
          aria-hidden
          className="book-pulse absolute bottom-1 h-1 w-1 rounded-full"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
      ) : null}
      {showAvailableDot ? (
        <span
          aria-hidden
          className="absolute bottom-1 h-1 w-1 rounded-full"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
      ) : null}
    </button>
  );
}

function NavButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="sk-press flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--bg-overlay))]"
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Legend — available / selected / unavailable key (proto S10).
// ──────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 font-mono text-[10px] font-semibold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-[5px] w-[5px] rounded-full"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
        Available
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: "rgb(var(--bg-sidebar))" }}
        />
        Selected
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-[7px] w-[7px] rounded-full border"
          style={{ borderColor: "rgb(var(--border-strong))" }}
        />
        Unavailable
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Time section — inline chips for the chosen day. Morning / Evening
// groups render as wrap chips directly under the calendar (no side rail).
// ──────────────────────────────────────────────────────────────────────

function TimeSection({
  selectedDate,
  starts,
  chosenStart,
  durationMin,
  onPickStart,
}: {
  selectedDate: string;
  starts: StartOption[];
  chosenStart: number | null;
  durationMin: number;
  onPickStart: (opt: StartOption) => void;
}) {
  const morningStarts = starts.filter((s) => s.block === "morning");
  const eveningStarts = starts.filter((s) => s.block === "evening");

  return (
    <section
      aria-label="Pick a time"
      className="sk-rise space-y-3"
      style={{ animationDelay: "60ms" }}
    >
      <p className="px-1 font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
        {fmtDateShort(selectedDate)} · Available times
      </p>

      {morningStarts.length > 0 ? (
        <TimeGroup
          label="Morning"
          starts={morningStarts}
          chosenStart={chosenStart}
          onPick={onPickStart}
        />
      ) : null}
      {eveningStarts.length > 0 ? (
        <TimeGroup
          label="Evening"
          starts={eveningStarts}
          chosenStart={chosenStart}
          onPick={onPickStart}
        />
      ) : null}
      {starts.length === 0 ? (
        <p className="px-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
          No {formatDurationLabel(durationMin)} starts fit in this day&apos;s window.
        </p>
      ) : null}
    </section>
  );
}

function TimeGroup({
  label,
  starts,
  chosenStart,
  onPick,
}: {
  label: string;
  starts: StartOption[];
  chosenStart: number | null;
  onPick: (opt: StartOption) => void;
}) {
  return (
    <div>
      <p className="mb-2 px-1 font-mono text-[10px] font-semibold tracking-[0.18em] text-[rgb(var(--fg-faint))] uppercase">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {starts.map((s, i) => {
          const sel = s.minutes === chosenStart;
          return (
            <button
              key={s.minutes}
              type="button"
              onClick={() => {
                onPick(s);
              }}
              className="time-pill book-stagger sk-press font-amount flex items-center justify-center rounded-[var(--radius-lg)] border px-5 py-3 text-[14px] font-semibold"
              style={{
                background: sel ? "rgb(var(--brand-primary))" : "rgb(var(--bg-elevated))",
                color: sel ? "rgb(var(--bg-sidebar))" : "rgb(var(--fg-default))",
                borderColor: sel ? "rgb(var(--brand-primary))" : "rgb(var(--border-strong))",
                boxShadow: sel ? "var(--shadow-glow)" : "var(--shadow-sm)",
                transition: `background-color 150ms ${EASE_OUT}, color 150ms ${EASE_OUT}, border-color 150ms ${EASE_OUT}, transform 180ms ${EASE_OUT}, box-shadow 220ms ${EASE_OUT}`,
                animationDelay: `${String(i * 35)}ms`,
              }}
            >
              {fmtClock(s.minutes)}
            </button>
          );
        })}
      </div>
      <style jsx>{`
        @media (hover: hover) and (pointer: fine) {
          .time-pill:not([style*="rgb(var(--brand-primary))"]):hover {
            background-color: rgb(var(--brand-primary) / 0.06) !important;
            border-color: rgb(var(--brand-primary)) !important;
            transform: translateY(-1px);
            box-shadow: 0 6px 18px -6px rgb(var(--brand-primary) / 0.35);
          }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Credits block — "use a prepaid session" toggle, folded inline.
// ──────────────────────────────────────────────────────────────────────

function CreditsBlock({
  packages,
  selectedAllowanceId,
  onPick,
}: {
  packages: ActivePackage[];
  selectedAllowanceId: string | null;
  onPick: (sessionAllowanceId: string) => void;
}) {
  const hasUnlimited = packages.some((pkg) => pkg.unlimitedSessions);
  const totalLeft = packages.reduce((n, p) => n + p.sessionsRemaining, 0);
  return (
    <section
      aria-label="Your prepaid sessions"
      className="sk-rise rounded-card border p-3.5"
      style={{
        background: "rgb(var(--brand-primary) / 0.05)",
        borderColor: "rgb(var(--brand-primary) / 0.25)",
        animationDelay: "40ms",
      }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] font-bold tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
          Choose a purchased session
        </h2>
        <p className="font-amount text-[10.5px] text-[rgb(var(--fg-secondary))]">
          {hasUnlimited ? "Ongoing" : `${String(totalLeft)} left`}
        </p>
      </header>
      <ul className="mt-2.5 space-y-1.5">
        {packages.map((pkg) => {
          const sel = pkg.sessionAllowanceId === selectedAllowanceId;
          const exhausted = !pkg.unlimitedSessions && pkg.sessionsRemaining <= 0;
          return (
            <li key={pkg.sessionAllowanceId}>
              <button
                type="button"
                onClick={() => {
                  onPick(pkg.sessionAllowanceId);
                }}
                disabled={exhausted}
                className="sk-press flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-lg)] border px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: sel ? "rgb(var(--brand-primary))" : "rgb(var(--bg-elevated))",
                  borderColor: sel
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--brand-primary) / 0.25)",
                  color: sel ? "rgb(var(--bg-sidebar))" : "rgb(var(--fg-default))",
                  transition: `background-color 150ms ${EASE_OUT}, border-color 150ms ${EASE_OUT}, color 150ms ${EASE_OUT}`,
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold">
                    {pkg.packageName ?? pkg.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] opacity-75">
                    {pkg.title} · {formatDurationLabel(pkg.durationMin)} ·{" "}
                    {locationLabel(pkg.locationType)}
                  </span>
                </span>
                <span
                  className="font-amount shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-bold"
                  style={{
                    background: sel
                      ? "rgb(var(--bg-sidebar) / 0.15)"
                      : "rgb(var(--brand-primary) / 0.12)",
                    color: sel ? "rgb(var(--bg-sidebar))" : "rgb(var(--brand-primary-dark))",
                  }}
                >
                  {pkg.unlimitedSessions
                    ? "Ongoing"
                    : `${String(pkg.sessionsRemaining)}/${String(pkg.sessionCount)}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selectedAllowanceId === null ? (
        <p className="mt-2 text-[11px] text-[rgb(var(--fg-muted))]">
          Pick one to see dates that fit its duration and booking rules.
        </p>
      ) : null}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Time-zone note — live wall-clock + reminder footnote (polite live
// region preserved from the calendar footer).
// ──────────────────────────────────────────────────────────────────────

function TimeZoneNote({ timeZone }: { timeZone: string }) {
  return (
    <div
      className="flex items-center gap-2 px-1 text-[11.5px] text-[rgb(var(--fg-muted))]"
      aria-live="polite"
    >
      <GlobeIcon />
      <span className="font-amount">{timeZone.replaceAll("_", " ")}</span>
      <span>· Studio time</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Icons — small, stroke-consistent inline SVG that inherits color.
// ──────────────────────────────────────────────────────────────────────

function GlobeIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m10 3-5 5 5 5" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}
