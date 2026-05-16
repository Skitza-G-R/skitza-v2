"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

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

function fmtMonthYear(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

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

function shiftIsoByDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return isoForCell(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
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
// Live wall-clock for the time-zone footer. Returns null during SSR
// so hydration matches; first client render fills it in and we tick
// once a minute thereafter.
// ──────────────────────────────────────────────────────────────────────

function useLiveTimeZoneLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = new Date().toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          hour12: false,
        });
        setLabel(`${tz.replace(/_/g, " ")} · ${now}`);
      } catch {
        setLabel("Local time");
      }
    };
    update();
    const id = window.setInterval(update, 60_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return label;
}

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

  const daysByDate = useMemo(() => {
    const m = new Map<string, Day>();
    for (const d of availability.days) m.set(d.date, d);
    return m;
  }, [availability.days]);

  const hasAnyAvailability = useMemo(() => {
    for (const d of availability.days) {
      if (d.morning?.available || d.evening?.available) return true;
    }
    return false;
  }, [availability.days]);

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

  // Mobile swap: when a date is picked, hide LeftContext + Calendar at
  // <lg so the TimeColumn gets the full card width. Desktop keeps the
  // 3-column layout regardless.
  const mobileHidden = selectedDate ? "hidden lg:block" : "block";

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
        className="overflow-hidden rounded-[var(--radius-2xl)] border bg-[rgb(var(--bg-elevated))]"
        style={{
          borderColor: "rgb(var(--border-subtle))",
          boxShadow: "var(--shadow-md)",
        }}
      >
        {/* One flat grid: LeftContext | Calendar | TimeColumn.
            Third column is `auto` → 0 when no date is picked, so the
            card sits at 2-column width and only expands sideways when
            the TimeColumn mounts. */}
        <div className="lg:grid lg:grid-cols-[260px_minmax(360px,1fr)_auto]">
          <LeftContext
            className={`${mobileHidden} lg:border-r lg:border-[rgb(var(--border-subtle))]`}
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

          <CalendarColumn
            className={`${mobileHidden} border-t border-[rgb(var(--border-subtle))] lg:border-t-0`}
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
              onBack={resetSelection}
            />
          ) : null}
        </div>
      </article>

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
        .book-pulse-slow {
          animation: book-pulse-soft 3.2s ease-in-out infinite;
          transform-origin: center;
          will-change: transform, opacity;
        }
        .book-avatar-pop {
          animation: book-avatar-pop 360ms cubic-bezier(0.23, 1, 0.32, 1)
            both;
        }
        .book-cta-lift {
          transition:
            transform 180ms cubic-bezier(0.23, 1, 0.32, 1),
            box-shadow 220ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .book-cta-lift:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 8px 24px -6px rgb(var(--brand-primary) / 0.45);
          }
          .book-cta-lift:active:not(:disabled) {
            transform: translateY(0);
          }
          .book-day-available:hover:not([aria-selected="true"]) {
            transform: scale(1.04);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .book-stagger,
          .book-pulse,
          .book-pulse-slow,
          .book-avatar-pop {
            animation: none !important;
          }
          .book-cta-lift {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Left context — producer + session meta + credits
// ──────────────────────────────────────────────────────────────────────

function LeftContext({
  className,
  activeStudio,
  packages,
  selectedProjectId,
  onPickPackage,
  onClearPackage,
}: {
  className?: string;
  activeStudio: Studio | null;
  packages: ActivePackage[];
  selectedProjectId: string | null;
  onPickPackage: (projectId: string) => void;
  onClearPackage: () => void;
}) {
  const initial = (activeStudio?.name ?? "S").charAt(0).toUpperCase();
  return (
    <div className={`flex flex-col gap-5 p-6 lg:p-7 ${className ?? ""}`}>
      <header className="flex items-center gap-3">
        {activeStudio?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activeStudio.logoUrl}
            alt=""
            className="book-avatar-pop h-10 w-10 shrink-0 rounded-full object-cover"
            style={{ boxShadow: "0 0 0 2px rgb(var(--brand-primary) / 0.3)" }}
          />
        ) : (
          <div
            aria-hidden
            className="book-avatar-pop flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[16px] font-extrabold text-[rgb(var(--bg-sidebar))]"
            style={{
              background:
                "linear-gradient(140deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))",
            }}
          >
            {initial}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-tight text-[rgb(var(--fg-default))]">
            {activeStudio?.name ?? "Studio session"}
          </p>
          {activeStudio?.slug ? (
            <p className="truncate font-mono text-[11px] text-[rgb(var(--fg-muted))]">
              @{activeStudio.slug}
            </p>
          ) : null}
        </div>
      </header>

      <h1 className="font-display text-[22px] font-extrabold leading-[1.05] tracking-[-0.025em] text-[rgb(var(--fg-default))] text-balance">
        Studio session
        <span
          className="book-pulse-slow inline-block"
          style={{ color: "rgb(var(--brand-primary))" }}
        >
          .
        </span>
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
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
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
                  className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums"
                  style={{
                    background: sel
                      ? "rgb(var(--bg-sidebar) / 0.15)"
                      : "rgb(var(--brand-primary) / 0.12)",
                    color: sel
                      ? "rgb(var(--bg-sidebar))"
                      : "rgb(var(--brand-primary-dark))",
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
              ? "rgb(var(--brand-primary-dark))"
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
// Calendar column — month grid + timezone footer + keyboard nav
// ──────────────────────────────────────────────────────────────────────

function CalendarColumn({
  className,
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
  const firstAvailableInView = useMemo(() => {
    for (const c of cells) {
      if (!c) continue;
      if (c.iso < today) continue;
      const d = daysByDate.get(c.iso);
      if (d && (d.morning?.available || d.evening?.available)) return c.iso;
    }
    return null;
  }, [cells, daysByDate, today]);
  const rovingDate =
    selectedDate ?? (cells.some((c) => c?.iso === today) ? today : firstAvailableInView);

  const moveFocus = useCallback(
    (fromIso: string, delta: number) => {
      const target = shiftIsoByDays(fromIso, delta);
      const el = dayRefs.current.get(target);
      if (el && !el.disabled) {
        el.focus();
        return;
      }
      // Target not visible (different month) — page to that month and
      // focus on next render via a useEffect tied to viewYear/Month.
      const [y, m] = target.split("-").map(Number);
      if (!y || !m) return;
      if (m - 1 < month0 || (m - 1 === month0 && y < year)) {
        onPrevMonth?.();
      } else if (m - 1 > month0 || (m - 1 === month0 && y > year)) {
        onNextMonth();
      }
    },
    [month0, year, onPrevMonth, onNextMonth],
  );

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!rovingDate) return;
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
        const [y, m, d] = rovingDate.split("-").map(Number);
        if (!y || !m || !d) return;
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        delta = -dow;
        break;
      }
      case "End": {
        const [y, m, d] = rovingDate.split("-").map(Number);
        if (!y || !m || !d) return;
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        delta = 6 - dow;
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    moveFocus(rovingDate, delta);
  };

  const tzLabel = useLiveTimeZoneLabel();

  return (
    <div className={`p-6 lg:p-7 ${className ?? ""}`}>
      <header className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[17px] font-extrabold leading-none tracking-[-0.015em] text-[rgb(var(--fg-default))]">
          {fmtMonthYear(year, month0)}
        </h2>
        <div className="flex items-center gap-1">
          {onPrevMonth ? (
            <NavButton onClick={onPrevMonth} label="Previous month">
              <ChevronLeft />
            </NavButton>
          ) : (
            <span className="h-8 w-8" aria-hidden />
          )}
          <NavButton onClick={onNextMonth} label="Next month">
            <ChevronRight />
          </NavButton>
        </div>
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
          No open slots in the next 14 days.
          {producerName ? <> Message {producerName} directly.</> : null}
        </div>
      ) : null}

      <div
        role="grid"
        aria-label={fmtMonthYear(year, month0)}
        className="grid grid-cols-7 gap-1.5"
        onKeyDown={onGridKeyDown}
      >
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            role="columnheader"
            className="pb-2 text-center font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-faint))]"
          >
            {w.slice(0, 3)}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell)
            return (
              <div
                key={`empty-${String(i)}`}
                role="gridcell"
                aria-hidden
                className="h-10"
              />
            );
          const day = daysByDate.get(cell.iso);
          const available =
            !!day && (!!day.morning?.available || !!day.evening?.available);
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
              ariaLabel={fmtDateLong(cell.iso)}
              staggerDelayMs={Math.floor(i / 7) * 25}
              registerRef={(el) => {
                if (el) dayRefs.current.set(cell.iso, el);
                else dayRefs.current.delete(cell.iso);
              }}
              onClick={() => {
                if (enabled) onPickDate(cell.iso);
              }}
            />
          );
        })}
      </div>

      <footer
        className="mt-5 flex h-[18px] items-center gap-2 text-[11.5px] text-[rgb(var(--fg-muted))]"
        aria-live="polite"
      >
        {tzLabel ? (
          <>
            <GlobeIcon />
            <span className="font-mono tabular-nums">{tzLabel}</span>
          </>
        ) : null}
      </footer>
    </div>
  );
}

function DayCell({
  dayNum,
  available,
  isToday,
  isSelected,
  tabIndex,
  ariaLabel,
  staggerDelayMs,
  registerRef,
  onClick,
}: {
  dayNum: number;
  available: boolean;
  isToday: boolean;
  isSelected: boolean;
  tabIndex: 0 | -1;
  ariaLabel: string;
  staggerDelayMs: number;
  registerRef: (el: HTMLButtonElement | null) => void;
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
      ref={registerRef}
      type="button"
      role="gridcell"
      disabled={disabled}
      onClick={onClick}
      tabIndex={tabIndex}
      aria-current={isToday ? "date" : undefined}
      aria-selected={isSelected}
      aria-label={ariaLabel}
      className={`book-stagger sk-press relative flex h-10 items-center justify-center rounded-full font-mono text-[13px] font-semibold tabular-nums disabled:cursor-not-allowed ${available ? "book-day-available" : ""}`}
      style={{
        ...tone,
        transition: `background-color 150ms ${EASE_OUT}, color 150ms ${EASE_OUT}, transform 180ms ${EASE_OUT}`,
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
      className="sk-press flex h-8 w-8 items-center justify-center rounded-full text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--bg-overlay))]"
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
  onBack,
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
  onBack: () => void;
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
      className="time-column col-span-full flex w-full flex-col border-t border-[rgb(var(--border-subtle))] p-6 lg:col-span-1 lg:w-[300px] lg:border-l lg:border-t-0 lg:p-7"
    >
      {/* Mobile-only back to calendar. Desktop uses the column's own
          context (calendar still visible to the left). */}
      <button
        type="button"
        onClick={onBack}
        className="sk-press mb-3 flex items-center gap-1.5 self-start font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-default))] lg:hidden"
        aria-label="Back to calendar"
      >
        <ChevronLeft />
        <span>{fmtDateShort(selectedDate)}</span>
      </button>

      <header className="mb-4 flex items-start justify-between gap-3">
        <h3 className="font-display text-[15px] font-extrabold leading-tight tracking-[-0.01em] text-[rgb(var(--fg-default))]">
          {fmtDateLong(selectedDate)}
        </h3>
        <button
          type="button"
          onClick={onBack}
          aria-label="Close"
          className="sk-press hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] lg:flex"
        >
          <XIcon />
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
          <div className="service-reveal mt-1 border-t border-[rgb(var(--border-subtle))] pt-4">
            <p
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: "rgb(var(--brand-primary-dark))" }}
            >
              Service
            </p>
            {products.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-[rgb(var(--fg-secondary))]">
                {activeStudio?.name ?? "This producer"} hasn&apos;t listed
                services yet. Reach out directly to lock this slot.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {products.map((p, i) => {
                  const sel = p.id === selectedProductId;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onPickProduct(p.id);
                        }}
                        className="book-stagger sk-press flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 text-left"
                        style={{
                          background: sel
                            ? "rgb(var(--brand-primary) / 0.06)"
                            : "rgb(var(--bg-elevated))",
                          borderColor: sel
                            ? "rgb(var(--brand-primary))"
                            : "rgb(var(--border-subtle))",
                          transition: `background-color 150ms ${EASE_OUT}, border-color 150ms ${EASE_OUT}`,
                          animationDelay: `${String(i * 35)}ms`,
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
          className="book-cta-lift sk-press mt-4 w-full rounded-[var(--radius-md)] px-4 py-2.5 text-[13.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
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
        @keyframes time-column-in-desktop {
          from {
            opacity: 0;
            transform: translateX(-8px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes time-column-in-mobile {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes service-reveal-in {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .time-column {
          animation: time-column-in-mobile 200ms ${EASE_OUT} both;
        }
        @media (min-width: 1024px) {
          .time-column {
            animation: time-column-in-desktop 200ms ${EASE_OUT} both;
          }
        }
        .service-reveal {
          animation: service-reveal-in 180ms ${EASE_OUT} both;
        }
        @media (prefers-reduced-motion: reduce) {
          .time-column,
          .service-reveal {
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
        {starts.map((s, i) => {
          const sel = s.minutes === chosenStart;
          return (
            <li key={s.minutes}>
              <button
                type="button"
                onClick={() => {
                  onPick(s);
                }}
                className="time-pill book-stagger sk-press flex w-full items-center justify-center rounded-[var(--radius-md)] border px-3 py-2.5 font-mono text-[13px] font-semibold tabular-nums"
                style={{
                  background: sel
                    ? "rgb(var(--brand-primary))"
                    : "transparent",
                  color: sel
                    ? "rgb(var(--bg-sidebar))"
                    : "rgb(var(--fg-default))",
                  borderColor: sel
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--border-strong))",
                  transition: `background-color 150ms ${EASE_OUT}, color 150ms ${EASE_OUT}, border-color 150ms ${EASE_OUT}, transform 180ms ${EASE_OUT}, box-shadow 220ms ${EASE_OUT}`,
                  animationDelay: `${String(i * 35)}ms`,
                }}
              >
                {fmtClock(s.minutes)}
              </button>
            </li>
          );
        })}
      </ul>
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
      style={{ color: "rgb(var(--brand-primary-dark))" }}
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
      style={{ color: "rgb(var(--brand-primary-dark))" }}
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

function XIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
