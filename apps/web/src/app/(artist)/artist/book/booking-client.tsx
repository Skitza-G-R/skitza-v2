"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { ProducerPicker } from "~/components/artist/producer-picker";

import { confirmBookingAction } from "./actions";

type BlockShape = { startMin: number; endMin: number; available: boolean };
type Day = {
  date: string;
  weekday: number;
  morning: BlockShape | null;
  evening: BlockShape | null;
};
type Availability = { days: Day[] };
type Studio = {
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};
type Product = {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  sessionCount: number | null;
};
type ActivePackage = {
  projectId: string;
  title: string;
  packageName: string | null;
  sessionCount: number;
  sessionsUsed: number;
  sessionsRemaining: number;
};
type Props = {
  activeStudioId: string;
  availability: Availability;
  products: Product[];
  studios: Studio[];
  activePackages: ActivePackage[];
};

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SLOT_INCREMENT_MIN = 60;
const DEFAULT_DURATION_MIN = 120;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

// ──────────────────────────────────────────────────────────────────────
// Formatters & date math
// ──────────────────────────────────────────────────────────────────────

// 12-hour clock, e.g. "8:00 AM". Pair with `tabular-nums` so columns
// of times line up. Locale-aware so non-US users see what they expect.
function fmtClock(minutes: number): string {
  const ref = new Date(2000, 0, 1, 0, 0, 0, 0);
  ref.setMinutes(minutes);
  return ref.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

// "Monday, May 18" — anchored to UTC to match the router's day math.
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

function fmtMonthYear(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Today as "YYYY-MM-DD" in UTC terms — keeps the calendar grid's
// "today" highlight in sync with the server-side availability keying.
function todayISO(): string {
  const t = new Date();
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  return `${String(y)}-${m}-${d}`;
}

function isoForCell(year: number, month0: number, day: number): string {
  const m = String(month0 + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${String(year)}-${m}-${d}`;
}

// Time zone label for the calendar footer. Best-effort: derives from
// the browser; falls back gracefully if Intl can't resolve.
function timeZoneLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date().toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
    return `${tz.replace(/_/g, " ")} · ${now}`;
  } catch {
    return "Local time";
  }
}

// Hourly start-time options inside a block, capped so the session
// still fits before the block closes.
function startsForBlock(block: BlockShape): number[] {
  const out: number[] = [];
  const latest = block.endMin - DEFAULT_DURATION_MIN;
  for (let t = block.startMin; t <= latest; t += SLOT_INCREMENT_MIN) {
    out.push(t);
  }
  return out;
}

type StartOption = { minutes: number; block: "morning" | "evening" };

// ──────────────────────────────────────────────────────────────────────
// Main client
// ──────────────────────────────────────────────────────────────────────

export function BookingClient({
  activeStudioId,
  availability,
  products,
  studios,
  activePackages,
}: Props) {
  const router = useRouter();
  const today = todayISO();

  // Quick lookup so the month grid doesn't scan 14 entries per cell.
  const daysByDate = useMemo(() => {
    const m = new Map<string, Day>();
    for (const d of availability.days) m.set(d.date, d);
    return m;
  }, [availability.days]);

  // Default the month view to the month containing today. Allow
  // navigation forward (the 14-day window can spill into next month)
  // and back to today's month — never further (no booking the past).
  const initialYear = Number(today.slice(0, 4));
  const initialMonth = Number(today.slice(5, 7)) - 1;
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [chosenStart, setChosenStart] = useState<number | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<
    "morning" | "evening" | null
  >(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [selectedPackageProjectId, setSelectedPackageProjectId] = useState<
    string | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);

  const usingCredit = selectedPackageProjectId !== null;
  const selectedPackage =
    activePackages.find((p) => p.projectId === selectedPackageProjectId) ??
    null;
  const activeStudio = studios.find((s) => s.producerId === activeStudioId);

  // Flat list of selectable starts for the chosen day — morning first,
  // then evening — each tagged so the confirm action knows the block.
  const startsForSelected: StartOption[] = useMemo(() => {
    if (!selectedDate) return [];
    const day = daysByDate.get(selectedDate);
    if (!day) return [];
    const out: StartOption[] = [];
    if (day.morning?.available) {
      for (const m of startsForBlock(day.morning)) {
        out.push({ minutes: m, block: "morning" });
      }
    }
    if (day.evening?.available) {
      for (const m of startsForBlock(day.evening)) {
        out.push({ minutes: m, block: "evening" });
      }
    }
    return out;
  }, [selectedDate, daysByDate]);

  const resetSelection = () => {
    setSelectedDate(null);
    setChosenStart(null);
    setSelectedBlock(null);
    setSelectedProductId(null);
    setResult(null);
  };

  const handleSwitchStudio = (id: string) => {
    resetSelection();
    setSelectedPackageProjectId(null);
    router.push(`/artist/book?studio=${id}`);
  };

  const handlePickDate = (date: string) => {
    setSelectedDate(date);
    setChosenStart(null);
    setSelectedBlock(null);
    setResult(null);
  };

  const handlePickStart = (opt: StartOption) => {
    setChosenStart(opt.minutes);
    setSelectedBlock(opt.block);
    setResult(null);
  };

  const handleConfirm = () => {
    if (!selectedDate || chosenStart == null || !selectedBlock) return;
    startTransition(async () => {
      const res = await confirmBookingAction({
        producerId: activeStudioId,
        date: selectedDate,
        block: selectedBlock,
        startMin: chosenStart,
        durationMin: DEFAULT_DURATION_MIN,
        projectId: null,
        productId: usingCredit ? null : selectedProductId,
        ...(selectedPackageProjectId
          ? { existingProjectId: selectedPackageProjectId }
          : {}),
      });
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  const canGoBack =
    viewYear > initialYear ||
    (viewYear === initialYear && viewMonth > initialMonth);

  return (
    <div className="space-y-4">
      {studios.length > 1 ? (
        <ProducerPicker
          studios={studios}
          activeId={activeStudioId}
          onSelect={handleSwitchStudio}
        />
      ) : null}

      <article
        className="reveal-up overflow-hidden rounded-[var(--radius-2xl)] border bg-[rgb(var(--bg-elevated))]"
        style={{
          borderColor: "rgb(var(--border-subtle))",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div className="grid lg:grid-cols-[minmax(280px,340px)_1fr]">
          <LeftContext
            activeStudio={activeStudio ?? null}
            packages={activePackages}
            selectedProjectId={selectedPackageProjectId}
            onPickPackage={(id) => {
              setSelectedPackageProjectId(id);
              setSelectedProductId(null);
              setResult(null);
            }}
            onClearPackage={() => {
              setSelectedPackageProjectId(null);
              setResult(null);
            }}
          />

          <div className="grid border-t border-[rgb(var(--border-subtle))] lg:grid-cols-[1fr_auto] lg:border-l lg:border-t-0">
            <CalendarColumn
              year={viewYear}
              month0={viewMonth}
              daysByDate={daysByDate}
              today={today}
              selectedDate={selectedDate}
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

            {selectedDate ? (
              <TimeColumn
                key={selectedDate}
                selectedDate={selectedDate}
                starts={startsForSelected}
                chosenStart={chosenStart}
                onPickStart={handlePickStart}
                products={products}
                selectedProductId={selectedProductId}
                onPickProduct={(id) => {
                  setSelectedProductId(id);
                  setResult(null);
                }}
                usingCredit={usingCredit}
                selectedPackage={selectedPackage}
                activeStudio={activeStudio ?? null}
                isPending={isPending}
                result={result}
                onConfirm={handleConfirm}
                onClose={resetSelection}
              />
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Left context — producer + session meta + credits (persistent)
// ──────────────────────────────────────────────────────────────────────

function LeftContext({
  activeStudio,
  packages,
  selectedProjectId,
  onPickPackage,
  onClearPackage,
}: {
  activeStudio: Studio | null;
  packages: ActivePackage[];
  selectedProjectId: string | null;
  onPickPackage: (projectId: string) => void;
  onClearPackage: () => void;
}) {
  const initial = (activeStudio?.name ?? "S").charAt(0).toUpperCase();
  return (
    <div className="flex flex-col gap-5 p-6 lg:p-7">
      <header className="flex items-start gap-3">
        {activeStudio?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activeStudio.logoUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover"
            style={{
              boxShadow: "0 0 0 2px rgb(var(--brand-primary) / 0.3)",
            }}
          />
        ) : (
          <div
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-[18px] font-extrabold text-[rgb(var(--bg-sidebar))]"
            style={{
              background:
                "linear-gradient(140deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))",
            }}
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 pt-0.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Studio
          </p>
          <p className="mt-0.5 truncate font-display text-[16px] font-extrabold leading-tight tracking-[-0.015em] text-[rgb(var(--fg-default))]">
            {activeStudio?.name ?? "Studio session"}
          </p>
        </div>
      </header>

      <h1 className="font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-[rgb(var(--fg-default))]">
        Studio session
        <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>

      <ul className="space-y-2.5 text-[13.5px] text-[rgb(var(--fg-secondary))]">
        <li className="flex items-center gap-2.5">
          <ClockIcon />
          <span>
            <span className="font-semibold text-[rgb(var(--fg-default))]">
              {DEFAULT_DURATION_MIN / 60} hours
            </span>{" "}
            per session
          </span>
        </li>
        <li className="flex items-center gap-2.5">
          <BoltIcon />
          <span>Producer confirms within 24h</span>
        </li>
      </ul>

      <p className="text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
        Pick any open window in the next 14 days. The producer reviews your
        request and locks it in.
      </p>

      {packages.length > 0 ? (
        <CreditsBlock
          packages={packages}
          selectedProjectId={selectedProjectId}
          onPick={onPickPackage}
          onClear={onClearPackage}
        />
      ) : null}
    </div>
  );
}

function CreditsBlock({
  packages,
  selectedProjectId,
  onPick,
  onClear,
}: {
  packages: ActivePackage[];
  selectedProjectId: string | null;
  onPick: (projectId: string) => void;
  onClear: () => void;
}) {
  const totalLeft = packages.reduce((n, p) => n + p.sessionsRemaining, 0);
  return (
    <section
      aria-label="Your prepaid sessions"
      className="rounded-[var(--radius-lg)] border p-3"
      style={{
        background: "rgb(var(--brand-primary) / 0.05)",
        borderColor: "rgb(var(--brand-primary) / 0.25)",
      }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          Your sessions
        </h2>
        <p className="font-mono text-[10.5px] tabular-nums text-[rgb(var(--fg-secondary))]">
          {totalLeft} left
        </p>
      </header>
      <ul className="mt-2.5 space-y-1.5">
        {packages.map((pkg) => {
          const sel = pkg.projectId === selectedProjectId;
          const exhausted = pkg.sessionsRemaining <= 0;
          return (
            <li key={pkg.projectId}>
              <button
                type="button"
                onClick={() => {
                  onPick(pkg.projectId);
                }}
                disabled={exhausted}
                className="sk-press flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: sel
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--bg-elevated))",
                  borderColor: sel
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--brand-primary) / 0.25)",
                  color: sel
                    ? "rgb(var(--bg-sidebar))"
                    : "rgb(var(--fg-default))",
                  transition: `background-color 150ms ${EASE_OUT}, border-color 150ms ${EASE_OUT}, color 150ms ${EASE_OUT}`,
                }}
              >
                <span className="truncate text-[12.5px] font-semibold">
                  {pkg.packageName ?? pkg.title}
                </span>
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums"
                  style={{
                    background: sel
                      ? "rgb(var(--bg-sidebar) / 0.15)"
                      : "rgb(var(--brand-primary) / 0.12)",
                    color: sel
                      ? "rgb(var(--bg-sidebar))"
                      : "rgb(var(--brand-primary))",
                  }}
                >
                  {pkg.sessionsRemaining}/{pkg.sessionCount}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onClear}
        className="sk-press mt-2 text-[11px] underline decoration-dotted underline-offset-2"
        style={{
          color:
            selectedProjectId === null
              ? "rgb(var(--brand-primary))"
              : "rgb(var(--fg-muted))",
        }}
      >
        {selectedProjectId === null
          ? "Paying for a new session"
          : "Pay for a new session instead"}
      </button>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Calendar column — month grid + timezone footer
// ──────────────────────────────────────────────────────────────────────

function CalendarColumn({
  year,
  month0,
  daysByDate,
  today,
  selectedDate,
  onPickDate,
  onPrevMonth,
  onNextMonth,
}: {
  year: number;
  month0: number;
  daysByDate: Map<string, Day>;
  today: string;
  selectedDate: string | null;
  onPickDate: (date: string) => void;
  onPrevMonth: (() => void) | null;
  onNextMonth: () => void;
}) {
  // 7-col × 5-or-6-row grid. Empty cells before day 1 + after last day
  // stay visually blank (Calendly-style) so focal weight stays on
  // real days only.
  const firstWeekday = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: ({ day: number; iso: string } | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) {
    cells.push({ day: d, iso: isoForCell(year, month0, d) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="p-6 lg:min-w-[360px] lg:p-7">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[17px] font-extrabold leading-none tracking-[-0.015em] text-[rgb(var(--fg-default))]">
          {fmtMonthYear(year, month0)}
        </h2>
        <div className="flex items-center gap-1">
          <NavButton onClick={onPrevMonth} label="Previous month">
            <ChevronLeft />
          </NavButton>
          <NavButton onClick={onNextMonth} label="Next month">
            <ChevronRight />
          </NavButton>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            className="pb-2 text-center font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-faint))]"
          >
            {w.slice(0, 3)}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${String(i)}`} className="h-10" />;
          const day = daysByDate.get(cell.iso);
          const available =
            !!day && (!!day.morning?.available || !!day.evening?.available);
          const isToday = cell.iso === today;
          const isSelected = cell.iso === selectedDate;
          const inPast = cell.iso < today;
          return (
            <DayCell
              key={cell.iso}
              dayNum={cell.day}
              available={available && !inPast}
              isToday={isToday}
              isSelected={isSelected}
              onClick={() => {
                if (available && !inPast) onPickDate(cell.iso);
              }}
            />
          );
        })}
      </div>

      <footer className="mt-5 flex items-center gap-2 text-[11.5px] text-[rgb(var(--fg-muted))]">
        <GlobeIcon />
        <span className="font-mono tabular-nums">{timeZoneLabel()}</span>
      </footer>
    </div>
  );
}

function DayCell({
  dayNum,
  available,
  isToday,
  isSelected,
  onClick,
}: {
  dayNum: number;
  available: boolean;
  isToday: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const disabled = !available;
  const tone = isSelected
    ? {
        background: "rgb(var(--brand-primary))",
        color: "rgb(var(--bg-sidebar))",
      }
    : available
      ? {
          background: "rgb(var(--brand-primary) / 0.1)",
          color: "rgb(var(--fg-default))",
        }
      : {
          background: "transparent",
          color: "rgb(var(--fg-faint))",
        };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={isToday ? "date" : undefined}
      aria-pressed={isSelected}
      className="sk-press relative flex h-10 items-center justify-center rounded-full font-mono text-[13px] font-semibold tabular-nums disabled:cursor-not-allowed"
      style={{
        ...tone,
        transition: `background-color 150ms ${EASE_OUT}, color 150ms ${EASE_OUT}`,
      }}
    >
      {dayNum}
      {isToday && !isSelected ? (
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
  onClick: (() => void) | null;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick ?? undefined}
      aria-label={label}
      className="sk-press flex h-8 w-8 items-center justify-center rounded-full text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--bg-overlay))] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Time column — appears beside the calendar when a date is selected
// ──────────────────────────────────────────────────────────────────────

function TimeColumn({
  selectedDate,
  starts,
  chosenStart,
  onPickStart,
  products,
  selectedProductId,
  onPickProduct,
  usingCredit,
  selectedPackage,
  activeStudio,
  isPending,
  result,
  onConfirm,
  onClose,
}: {
  selectedDate: string;
  starts: StartOption[];
  chosenStart: number | null;
  onPickStart: (opt: StartOption) => void;
  products: Product[];
  selectedProductId: string | null;
  onPickProduct: (id: string) => void;
  usingCredit: boolean;
  selectedPackage: ActivePackage | null;
  activeStudio: Studio | null;
  isPending: boolean;
  result: { ok: true } | { ok: false; error: string } | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const morningStarts = starts.filter((s) => s.block === "morning");
  const eveningStarts = starts.filter((s) => s.block === "evening");
  const showServices = chosenStart != null && !usingCredit;
  const showConfirm =
    chosenStart != null && (usingCredit || selectedProductId !== null);
  const hours = DEFAULT_DURATION_MIN / 60;

  return (
    <section
      aria-label="Pick a time"
      className="time-column flex w-full flex-col border-t border-[rgb(var(--border-subtle))] p-6 lg:w-[300px] lg:border-l lg:border-t-0 lg:p-7"
      style={{
        animation: `time-column-in 200ms ${EASE_OUT} both`,
      }}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <h3 className="font-display text-[15px] font-extrabold leading-tight tracking-[-0.01em] text-[rgb(var(--fg-default))]">
          {fmtDateLong(selectedDate)}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="sk-press -mr-2 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[15px] leading-none text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))]"
        >
          ×
        </button>
      </header>

      <div className="flex flex-col gap-4 overflow-y-auto lg:max-h-[480px]">
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
          <p className="text-[12.5px] text-[rgb(var(--fg-muted))]">
            No {hours}-hour starts fit in this day&apos;s window.
          </p>
        ) : null}

        {showServices ? (
          <div className="mt-1 border-t border-[rgb(var(--border-subtle))] pt-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
              Service
            </p>
            {products.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-[rgb(var(--fg-secondary))]">
                {activeStudio?.name ?? "This producer"} hasn&apos;t listed
                services yet. Reach out directly to lock this slot.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {products.map((p) => {
                  const sel = p.id === selectedProductId;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onPickProduct(p.id);
                        }}
                        className="sk-press flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 text-left"
                        style={{
                          background: sel
                            ? "rgb(var(--brand-primary) / 0.06)"
                            : "rgb(var(--bg-elevated))",
                          borderColor: sel
                            ? "rgb(var(--brand-primary))"
                            : "rgb(var(--border-subtle))",
                          transition: `background-color 150ms ${EASE_OUT}, border-color 150ms ${EASE_OUT}`,
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                            {p.name}
                          </span>
                          {p.sessionCount && p.sessionCount > 1 ? (
                            <span className="text-[11px] text-[rgb(var(--fg-muted))]">
                              {p.sessionCount} sessions
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-[rgb(var(--fg-default))]">
                          {fmtPrice(p.priceCents, p.currency)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {result && !result.ok ? (
        <p
          role="alert"
          className="mt-3 rounded-[var(--radius-sm)] px-3 py-2 text-[12px]"
          style={{
            background: "rgb(var(--fg-danger) / 0.08)",
            color: "rgb(var(--fg-danger))",
          }}
        >
          {result.error}
        </p>
      ) : null}
      {result?.ok ? (
        <p
          role="status"
          className="mt-3 rounded-[var(--radius-sm)] px-3 py-2 text-[12px] font-semibold"
          style={{
            background: "rgb(var(--fg-success) / 0.1)",
            color: "rgb(var(--fg-success))",
          }}
        >
          Booked. The producer will confirm next.
        </p>
      ) : null}

      {showConfirm ? (
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending || result?.ok}
          className="sk-press mt-4 w-full rounded-[var(--radius-md)] px-4 py-2.5 text-[13.5px] font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: "rgb(var(--brand-primary))",
            color: "rgb(var(--bg-sidebar))",
          }}
        >
          {isPending
            ? "Sending…"
            : result?.ok
              ? "Sent"
              : usingCredit
                ? `Use credit · ${String(selectedPackage?.sessionsRemaining ?? 0)} left`
                : "Send booking request"}
        </button>
      ) : null}

      <style jsx>{`
        @keyframes time-column-in {
          from {
            opacity: 0;
            transform: translateX(-8px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .time-column {
            animation: none !important;
          }
        }
      `}</style>
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
      <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <ul className="flex flex-col gap-1.5">
        {starts.map((s) => {
          const sel = s.minutes === chosenStart;
          return (
            <li key={s.minutes}>
              <button
                type="button"
                onClick={() => {
                  onPick(s);
                }}
                className="sk-press flex w-full items-center justify-center rounded-[var(--radius-md)] border px-3 py-2.5 font-mono text-[13px] font-semibold tabular-nums"
                style={{
                  background: sel
                    ? "rgb(var(--brand-primary))"
                    : "transparent",
                  color: sel
                    ? "rgb(var(--bg-sidebar))"
                    : "rgb(var(--brand-primary))",
                  borderColor: sel
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--brand-primary) / 0.35)",
                  transition: `background-color 150ms ${EASE_OUT}, color 150ms ${EASE_OUT}, border-color 150ms ${EASE_OUT}`,
                }}
              >
                {fmtClock(s.minutes)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Icons — small, stroke-consistent inline SVG that inherits color.
// ──────────────────────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "rgb(var(--brand-primary))" }}
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.25 1.5" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "rgb(var(--brand-primary))" }}
    >
      <path d="M9 1.5 3 9h4l-1 5.5L13 7H9l1-5.5z" />
    </svg>
  );
}

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
