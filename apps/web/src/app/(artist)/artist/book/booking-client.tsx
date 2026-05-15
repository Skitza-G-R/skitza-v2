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

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SLOT_INCREMENT_MIN = 60;
const DEFAULT_DURATION_MIN = 120;

// 12-hour clock with AM/PM, e.g. "8:00 AM". Paired with tabular-nums
// in the consuming buttons so columns of times line up neatly.
function fmtClock(minutes: number): string {
  const ref = new Date(2000, 0, 1, 0, 0, 0, 0);
  ref.setMinutes(minutes);
  return ref.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// "Apr 19" — UTC-anchored so weekday math matches the router.
function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
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

function isToday(iso: string): boolean {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  return iso === `${String(y)}-${m}-${d}`;
}

type Selection = {
  date: string;
  block: "morning" | "evening";
  blockShape: BlockShape;
};

export function BookingClient({
  activeStudioId,
  availability,
  products,
  studios,
  activePackages,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [chosenStart, setChosenStart] = useState<number | null>(null);
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

  const startOptions = useMemo(() => {
    if (!selected) return [];
    const out: number[] = [];
    const latest = selected.blockShape.endMin - DEFAULT_DURATION_MIN;
    for (
      let t = selected.blockShape.startMin;
      t <= latest;
      t += SLOT_INCREMENT_MIN
    ) {
      out.push(t);
    }
    return out;
  }, [selected]);

  // Surface a single "earliest open slot" caption above the calendar
  // so first-time users see actionable context, not just a grid.
  const nextFree = useMemo(() => {
    for (const d of availability.days) {
      if (d.morning?.available) return { day: d, block: "morning" as const };
      if (d.evening?.available) return { day: d, block: "evening" as const };
    }
    return null;
  }, [availability.days]);

  const totalOpenSlots = useMemo(() => {
    let n = 0;
    for (const d of availability.days) {
      if (d.morning?.available) n++;
      if (d.evening?.available) n++;
    }
    return n;
  }, [availability.days]);

  // Which step the user is on (drives the stepper). Pure derivation
  // from the form state — no extra state needed.
  const step: 1 | 2 | 3 =
    !selected || chosenStart == null
      ? 1
      : !usingCredit && !selectedProductId
        ? 2
        : 3;

  const resetFlow = () => {
    setSelected(null);
    setChosenStart(null);
    setSelectedProductId(null);
    setResult(null);
  };

  const handleSwitchStudio = (id: string) => {
    resetFlow();
    setSelectedPackageProjectId(null);
    router.push(`/artist/book?studio=${id}`);
  };

  const handleSelectBlock = (day: Day, block: "morning" | "evening") => {
    const shape = block === "morning" ? day.morning : day.evening;
    if (!shape?.available) return;
    setSelected({ date: day.date, block, blockShape: shape });
    // Leave chosenStart null so step 1 (Time) is the first explicit
    // pick — gives the stepper a real beat instead of jumping past it.
    setChosenStart(null);
    setResult(null);
  };

  const handleConfirm = () => {
    if (!selected || chosenStart == null) return;
    startTransition(async () => {
      const res = await confirmBookingAction({
        producerId: activeStudioId,
        date: selected.date,
        block: selected.block,
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

  const handlePickPackage = (projectId: string) => {
    setSelectedPackageProjectId(projectId);
    setSelectedProductId(null);
    setResult(null);
  };

  const handleBookNewPackage = () => {
    setSelectedPackageProjectId(null);
    setResult(null);
  };

  const renderBody = (sel: Selection) => (
    <ConfirmBody
      selected={sel}
      chosenStart={chosenStart}
      onPickStart={setChosenStart}
      startOptions={startOptions}
      products={products}
      selectedProductId={selectedProductId}
      onPickProduct={setSelectedProductId}
      usingCredit={usingCredit}
      selectedPackage={selectedPackage}
      step={step}
      activeStudio={activeStudio ?? null}
      isPending={isPending}
      result={result}
      onConfirm={handleConfirm}
    />
  );

  return (
    <div className="space-y-6">
      {studios.length > 1 ? (
        <ProducerPicker
          studios={studios}
          activeId={activeStudioId}
          onSelect={handleSwitchStudio}
        />
      ) : null}

      {activePackages.length > 0 ? (
        <CreditsPanel
          packages={activePackages}
          selectedProjectId={selectedPackageProjectId}
          onPick={handlePickPackage}
          onClear={handleBookNewPackage}
        />
      ) : null}

      <section aria-label="Pick a session window" className="space-y-3">
        <header className="flex items-baseline justify-between gap-3 px-1">
          <h2 className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Next 14 days
          </h2>
          {totalOpenSlots > 0 ? (
            <p className="text-[11.5px] text-[rgb(var(--fg-secondary))]">
              <span className="font-semibold text-[rgb(var(--fg-default))]">
                {totalOpenSlots}
              </span>{" "}
              open {totalOpenSlots === 1 ? "slot" : "slots"}
              {nextFree
                ? ` · earliest ${fmtDateShort(nextFree.day.date)}`
                : ""}
            </p>
          ) : (
            <p className="text-[11.5px] text-[rgb(var(--fg-muted))]">
              No open slots in this window.
            </p>
          )}
        </header>

        {/* Mobile: snap-scroll horizontal strip. */}
        <div className="sk-scroll-x -mx-4 overflow-x-auto px-4 pb-2 lg:hidden">
          <ul className="flex snap-x snap-mandatory gap-3">
            {availability.days.map((day) => (
              <li key={day.date} className="w-36 shrink-0 snap-start">
                <DayCard
                  day={day}
                  selected={selected}
                  onSelectBlock={handleSelectBlock}
                />
              </li>
            ))}
          </ul>
        </div>

        {/* Desktop: 7-col grid (two rows for the 14-day window). */}
        <ul className="hidden lg:grid lg:grid-cols-7 lg:gap-3 xl:gap-4">
          {availability.days.map((day) => (
            <li key={day.date}>
              <DayCard
                day={day}
                selected={selected}
                onSelectBlock={handleSelectBlock}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* Desktop: inline configuration panel. */}
      {selected ? (
        <section
          aria-label="Confirm booking"
          className="reveal-up hidden lg:block"
        >
          <div
            className="overflow-hidden rounded-[var(--radius-xl)] border bg-[rgb(var(--bg-elevated))]"
            style={{
              borderColor: "rgb(var(--border-subtle))",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <ConfirmHeader
              selected={selected}
              activeStudio={activeStudio ?? null}
              step={step}
              onClose={resetFlow}
            />
            <div className="px-6 pb-6 pt-2">{renderBody(selected)}</div>
          </div>
        </section>
      ) : null}

      {/* Mobile: bottom sheet. */}
      {selected ? (
        <section
          role="dialog"
          aria-label="Confirm booking"
          aria-modal="true"
          className="slide-up-modal fixed inset-x-0 bottom-0 z-40 border-t bg-[rgb(var(--bg-elevated))] lg:hidden"
          style={{
            borderColor: "rgb(var(--border-subtle))",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            boxShadow: "0 -12px 40px rgb(17 16 9 / 0.18)",
            maxHeight: "85dvh",
            overflowY: "auto",
          }}
        >
          <div className="mx-auto max-w-2xl px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
            <div
              aria-hidden
              className="mx-auto h-1 w-10 rounded-full"
              style={{ background: "rgb(var(--border-strong))" }}
            />
            <ConfirmHeader
              selected={selected}
              activeStudio={activeStudio ?? null}
              step={step}
              onClose={resetFlow}
              compact
            />
            <div className="mt-2">{renderBody(selected)}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Day card
// ──────────────────────────────────────────────────────────────────────

function DayCard({
  day,
  selected,
  onSelectBlock,
}: {
  day: Day;
  selected: Selection | null;
  onSelectBlock: (day: Day, block: "morning" | "evening") => void;
}) {
  const today = isToday(day.date);
  // Derive once so the JSX below can compare to a flat enum instead
  // of optional-chaining `selected` repeatedly (which lint rejects).
  const selectedBlock =
    selected !== null && selected.date === day.date ? selected.block : null;
  const isSelectedDay = selectedBlock !== null;
  const hasAnyAvail = !!day.morning?.available || !!day.evening?.available;
  return (
    <div
      className="flex h-full flex-col rounded-[var(--radius-lg)] border p-3 transition-colors"
      style={{
        background: isSelectedDay
          ? "rgb(var(--brand-primary) / 0.08)"
          : "rgb(var(--bg-elevated))",
        borderColor: isSelectedDay
          ? "rgb(var(--brand-primary) / 0.5)"
          : "rgb(var(--border-subtle))",
        boxShadow: isSelectedDay
          ? "0 0 0 1px rgb(var(--brand-primary) / 0.25)"
          : "var(--shadow-sm)",
      }}
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{
              color: hasAnyAvail
                ? "rgb(var(--brand-primary))"
                : "rgb(var(--fg-muted))",
            }}
          >
            {WEEKDAY_SHORT[day.weekday]}
          </span>
          {today ? (
            <span
              className="rounded-full px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider"
              style={{
                background: "rgb(var(--brand-primary) / 0.12)",
                color: "rgb(var(--brand-primary))",
              }}
            >
              Today
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-0.5 font-display text-[22px] font-extrabold leading-none tracking-[-0.02em] text-[rgb(var(--fg-default))]">
        {fmtDateShort(day.date)}
      </div>

      <div className="mt-3 space-y-1.5">
        <BlockRow
          label="Morning"
          block={day.morning}
          selected={selectedBlock === "morning"}
          onClick={() => {
            onSelectBlock(day, "morning");
          }}
        />
        <BlockRow
          label="Evening"
          block={day.evening}
          selected={selectedBlock === "evening"}
          onClick={() => {
            onSelectBlock(day, "evening");
          }}
        />
      </div>
    </div>
  );
}

function BlockRow({
  label,
  block,
  selected,
  onClick,
}: {
  label: string;
  block: BlockShape | null;
  selected: boolean;
  onClick: () => void;
}) {
  if (!block) {
    return (
      <div
        className="flex items-center justify-between rounded-[var(--radius-md)] border border-dashed px-2 py-1.5"
        style={{ borderColor: "rgb(var(--border-subtle))" }}
      >
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-[rgb(var(--fg-faint))]">
          {label}
        </span>
        <span className="text-[11px] text-[rgb(var(--fg-faint))]">—</span>
      </div>
    );
  }
  const disabled = !block.available;
  const tone = selected
    ? {
        background: "rgb(var(--brand-primary))",
        color: "rgb(var(--bg-sidebar))",
        borderColor: "rgb(var(--brand-primary))",
      }
    : disabled
      ? {
          background: "transparent",
          color: "rgb(var(--fg-faint))",
          borderColor: "rgb(var(--border-subtle))",
        }
      : {
          background: "rgb(var(--bg-overlay))",
          color: "rgb(var(--fg-default))",
          borderColor: "rgb(var(--border-subtle))",
        };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="sk-press group flex w-full items-center justify-between rounded-[var(--radius-md)] border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed"
      style={tone}
    >
      <span
        className="text-[10.5px] font-semibold uppercase tracking-wider"
        style={{
          color: selected
            ? "rgb(var(--bg-sidebar) / 0.75)"
            : disabled
              ? "rgb(var(--fg-faint))"
              : "rgb(var(--fg-muted))",
        }}
      >
        {label}
      </span>
      <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums">
        <span>
          {fmtClock(block.startMin)}–{fmtClock(block.endMin)}
        </span>
        {block.available && !selected ? (
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "rgb(var(--fg-success))" }}
          />
        ) : null}
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Confirm header (stepper) + body (shared between sheet and inline)
// ──────────────────────────────────────────────────────────────────────

function ConfirmHeader({
  selected,
  activeStudio,
  step,
  onClose,
  compact,
}: {
  selected: Selection;
  activeStudio: Studio | null;
  step: 1 | 2 | 3;
  onClose: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "flex items-start justify-between gap-3 pt-3"
          : "flex items-start justify-between gap-4 border-b px-6 py-4"
      }
      style={
        compact ? undefined : { borderColor: "rgb(var(--border-subtle))" }
      }
    >
      <div className="min-w-0">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          {selected.block === "morning" ? "Morning" : "Evening"}
          {activeStudio ? ` · ${activeStudio.name}` : ""}
        </p>
        <h2 className="mt-1 font-display text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          {fmtDateShort(selected.date)}
          <span className="text-[rgb(var(--fg-muted))]">
            {" "}
            · {fmtClock(selected.blockShape.startMin)}–
            {fmtClock(selected.blockShape.endMin)}
          </span>
        </h2>
      </div>
      <div className="flex items-center gap-3">
        <Stepper step={step} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="sk-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] leading-none text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))]"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Time", "Service", "Confirm"] as const;
  return (
    <ol
      aria-label="Booking progress"
      className="hidden items-center gap-1.5 sm:flex"
    >
      {labels.map((label, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const done = idx < step;
        const active = idx === step;
        return (
          <li key={label} className="flex items-center gap-1.5">
            <span
              className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] font-bold tracking-tight transition-colors"
              style={{
                background: active
                  ? "rgb(var(--brand-primary))"
                  : done
                    ? "rgb(var(--brand-primary) / 0.18)"
                    : "rgb(var(--bg-overlay))",
                color: active
                  ? "rgb(var(--bg-sidebar))"
                  : done
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--fg-muted))",
              }}
            >
              {done ? "✓" : idx}
            </span>
            <span
              className="font-mono text-[10px] font-semibold uppercase tracking-wider"
              style={{
                color: active
                  ? "rgb(var(--fg-default))"
                  : "rgb(var(--fg-muted))",
              }}
            >
              {label}
            </span>
            {i < 2 ? (
              <span
                aria-hidden
                className="mx-1 h-px w-4"
                style={{ background: "rgb(var(--border-strong))" }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ConfirmBody({
  selected,
  chosenStart,
  onPickStart,
  startOptions,
  products,
  selectedProductId,
  onPickProduct,
  usingCredit,
  selectedPackage,
  step,
  activeStudio,
  isPending,
  result,
  onConfirm,
}: {
  selected: Selection;
  chosenStart: number | null;
  onPickStart: (m: number) => void;
  startOptions: number[];
  products: Product[];
  selectedProductId: string | null;
  onPickProduct: (id: string) => void;
  usingCredit: boolean;
  selectedPackage: ActivePackage | null;
  step: 1 | 2 | 3;
  activeStudio: Studio | null;
  isPending: boolean;
  result: { ok: true } | { ok: false; error: string } | null;
  onConfirm: () => void;
}) {
  const hours = DEFAULT_DURATION_MIN / 60;
  return (
    <div className="space-y-4 pt-3">
      {/* Step 1 — start time */}
      <div>
        <Eyebrow active={step === 1}>Start time · {hours}h session</Eyebrow>
        <div className="mt-2 flex flex-wrap gap-2">
          {startOptions.length === 0 ? (
            <p className="text-[12.5px] text-[rgb(var(--fg-muted))]">
              No {hours}-hour starts fit in this window.
            </p>
          ) : (
            startOptions.map((t) => {
              const sel = t === chosenStart;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    onPickStart(t);
                  }}
                  className="sk-press rounded-full border px-3 py-1.5 font-mono text-[12.5px] font-semibold tabular-nums transition-colors"
                  style={
                    sel
                      ? {
                          background: "rgb(var(--brand-primary))",
                          color: "rgb(var(--bg-sidebar))",
                          borderColor: "rgb(var(--brand-primary))",
                        }
                      : {
                          background: "transparent",
                          color: "rgb(var(--fg-default))",
                          borderColor: "rgb(var(--border-strong))",
                        }
                  }
                >
                  {fmtClock(t)}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Step 2 — service (skipped when using a credit) */}
      {chosenStart != null && !usingCredit ? (
        <div>
          <Eyebrow active={step === 2}>Service</Eyebrow>
          {products.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-[rgb(var(--fg-secondary))]">
              {activeStudio?.name ?? "This producer"} has no active services
              yet. Reach out directly to lock this slot in.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {products.map((p) => {
                const sel = p.id === selectedProductId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPickProduct(p.id);
                      }}
                      className="sk-press flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors"
                      style={{
                        background: sel
                          ? "rgb(var(--brand-primary) / 0.06)"
                          : "rgb(var(--bg-elevated))",
                        borderColor: sel
                          ? "rgb(var(--brand-primary))"
                          : "rgb(var(--border-subtle))",
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                          {p.name}
                        </span>
                        {p.sessionCount && p.sessionCount > 1 ? (
                          <span className="text-[11.5px] text-[rgb(var(--fg-muted))]">
                            {p.sessionCount} sessions
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-[12.5px] font-semibold tabular-nums text-[rgb(var(--fg-default))]">
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

      {/* Confirmation summary */}
      {chosenStart != null ? (
        <div
          className="rounded-[var(--radius-md)] border bg-[rgb(var(--bg-overlay))] px-3 py-2.5"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
        >
          <p className="text-[12.5px] leading-snug text-[rgb(var(--fg-secondary))]">
            {usingCredit ? (
              <>
                Use 1 session from{" "}
                <span className="font-semibold text-[rgb(var(--fg-default))]">
                  {selectedPackage?.packageName ?? selectedPackage?.title ?? ""}
                </span>
                {" · "}
                {hours}h at{" "}
                <span className="font-mono tabular-nums">
                  {fmtClock(chosenStart)}
                </span>
                {" · "}
                {fmtDateShort(selected.date)}
              </>
            ) : (
              <>
                Book a {hours}h session at{" "}
                <span className="font-mono tabular-nums">
                  {fmtClock(chosenStart)}
                </span>{" "}
                on {fmtDateShort(selected.date)}
                {activeStudio ? <> with {activeStudio.name}</> : null}
              </>
            )}
          </p>
        </div>
      ) : null}

      {result && !result.ok ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px]"
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
          className="rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px] font-semibold"
          style={{
            background: "rgb(var(--fg-success) / 0.1)",
            color: "rgb(var(--fg-success))",
          }}
        >
          Booked. The producer will confirm next.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onConfirm}
        disabled={
          isPending ||
          chosenStart == null ||
          result?.ok ||
          (!usingCredit && !selectedProductId)
        }
        className="sk-press w-full rounded-[var(--radius-md)] px-4 py-3 text-[13.5px] font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
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
    </div>
  );
}

function Eyebrow({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
      style={{
        color: active ? "rgb(var(--brand-primary))" : "rgb(var(--fg-muted))",
      }}
    >
      {children}
    </p>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Credits panel — replaces the prior ⚡ banner.
// ──────────────────────────────────────────────────────────────────────

function CreditsPanel({
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
      className="rounded-[var(--radius-lg)] border p-4"
      style={{
        background: "rgb(var(--brand-primary) / 0.06)",
        borderColor: "rgb(var(--brand-primary) / 0.28)",
      }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          Your sessions
        </h2>
        <p className="font-mono text-[11px] tabular-nums text-[rgb(var(--fg-secondary))]">
          {totalLeft} prepaid
        </p>
      </header>
      <ul className="mt-3 flex flex-wrap gap-2">
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
                className="sk-press flex max-w-[280px] items-center gap-2 rounded-full border px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: sel
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--bg-elevated))",
                  borderColor: sel
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--brand-primary) / 0.3)",
                  color: sel
                    ? "rgb(var(--bg-sidebar))"
                    : "rgb(var(--fg-default))",
                }}
              >
                <span className="truncate text-[12.5px] font-semibold">
                  {pkg.packageName ?? pkg.title}
                </span>
                <span
                  className="rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums"
                  style={{
                    background: sel
                      ? "rgb(var(--bg-sidebar) / 0.18)"
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
        className="sk-press mt-3 text-[11.5px] underline decoration-dotted underline-offset-2 transition-colors"
        style={{
          color:
            selectedProjectId === null
              ? "rgb(var(--brand-primary))"
              : "rgb(var(--fg-muted))",
        }}
      >
        {selectedProjectId === null
          ? "Booking a new session →"
          : "Pay for a new session instead"}
      </button>
    </section>
  );
}
