"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { ProducerAvatar } from "~/components/artist/producer-avatar";
import { ProducerPicker } from "~/components/artist/producer-picker";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "~/components/ui/dialog";

import { confirmBookingAction } from "./actions";

// Booking flow — locked design system (Phase 5).
//
// State-machine PRESERVED from prior implementation. No URL changes
// per step; all state lives client-side. Only the chrome is redesigned.
//
// Modal architecture: we use the responsive Dialog primitive (bottom
// sheet <640px, centered modal ≥640px). The brief mentioned a Sheet
// (mobile) + Dialog (desktop) pair, but Sheet's drag-handle pattern
// implies a persistent surface, while booking is an action-and-dismiss
// flow — Dialog's responsive behavior is the natural fit and avoids
// dual-mount focus-trap conflicts. Documented in phase-5-handoff.md.
//
// Mobile layout: hero + producer picker + free-booking banner
// (when applicable) + 14-day horizontal strip of morning/evening
// blocks. Tap any block to open the Dialog with start-time chips,
// product picker (if not a free session), and a confirm CTA.

// ─── Types ───────────────────────────────────────────────────────────

type BlockShape = { startMin: number; endMin: number; available: boolean };
type Day = {
  date: string;
  weekday: number;
  morning: BlockShape | null;
  evening: BlockShape | null;
};
type Availability = {
  days: Day[];
  freeBookingProjectId: string | null;
  freeBookingProjectTitle: string | null;
};
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
type Props = {
  activeStudioId: string;
  availability: Availability;
  products: Product[];
  studios: Studio[];
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SLOT_INCREMENT_MIN = 60;
const DEFAULT_DURATION_MIN = 120;

// ─── Component ───────────────────────────────────────────────────────

export function BookingClient({
  activeStudioId,
  availability,
  products,
  studios,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<{
    date: string;
    block: "morning" | "evening";
    blockShape: BlockShape;
  } | null>(null);
  const [chosenStart, setChosenStart] = useState<number | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);

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

  const handleSwitchStudio = (id: string) => {
    setSelected(null);
    setChosenStart(null);
    setSelectedProductId(null);
    setResult(null);
    router.push(`/artist/book?studio=${id}`);
  };

  const handleSelectBlock = (day: Day, block: "morning" | "evening") => {
    const shape = block === "morning" ? day.morning : day.evening;
    if (!shape || !shape.available) return;
    setSelected({ date: day.date, block, blockShape: shape });
    setChosenStart(shape.startMin);
    setSelectedProductId(null);
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
        projectId: availability.freeBookingProjectId,
        productId: selectedProductId,
      });
      setResult(res);
      if (res.ok) {
        router.refresh();
      }
    });
  };

  const handleDismiss = () => {
    setSelected(null);
    setChosenStart(null);
    setSelectedProductId(null);
    setResult(null);
  };

  const isFreeBooking = !!availability.freeBookingProjectId;
  const hasAnyAvailability = availability.days.some(
    (d) => d.morning?.available || d.evening?.available,
  );

  const stepCount = isFreeBooking ? 2 : 3;
  const currentStep = !chosenStart
    ? 1
    : !isFreeBooking && !selectedProductId
      ? 2
      : stepCount;

  return (
    <div className="space-y-6 lg:space-y-8">
      <header className="reveal-up">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight lg:text-[44px] lg:leading-none">
          Book<span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
        <p className="mt-1.5 flex items-center gap-2 text-sm text-[rgb(var(--fg-muted))] lg:mt-2">
          {activeStudio ? (
            <>
              <ProducerAvatar name={activeStudio.name} size={18} />
              <span>
                Pick a window with{" "}
                <span className="font-bold text-[rgb(var(--fg-default))]">
                  {activeStudio.name}
                </span>
              </span>
            </>
          ) : (
            <span>Pick a producer to see their availability.</span>
          )}
        </p>
      </header>

      <ProducerPicker
        studios={studios}
        activeId={activeStudioId}
        onSelect={handleSwitchStudio}
      />

      {availability.freeBookingProjectTitle ? (
        <div className="rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-3.5">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]">
            On the house
          </p>
          <p className="mt-1 text-sm text-[rgb(var(--fg-default))]">
            This session is included in your{" "}
            <span className="font-bold">
              {availability.freeBookingProjectTitle}
            </span>
            .
          </p>
        </div>
      ) : null}

      {!hasAnyAvailability ? (
        <NoAvailabilityCard producerName={activeStudio?.name ?? "this producer"} />
      ) : (
        <SlotStrip
          days={availability.days}
          onSelectBlock={handleSelectBlock}
        />
      )}

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) handleDismiss();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="sr-only">Confirm booking</DialogTitle>
          {selected ? (
            <BookingPanel
              activeStudio={activeStudio ?? null}
              selected={selected}
              startOptions={startOptions}
              chosenStart={chosenStart}
              onChooseStart={setChosenStart}
              isFreeBooking={isFreeBooking}
              freeBookingProjectTitle={availability.freeBookingProjectTitle}
              products={products}
              selectedProductId={selectedProductId}
              onSelectProduct={setSelectedProductId}
              onConfirm={handleConfirm}
              isPending={isPending}
              result={result}
              currentStep={currentStep}
              stepCount={stepCount}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 14-day horizontal slot strip ────────────────────────────────────

function SlotStrip({
  days,
  onSelectBlock,
}: {
  days: Day[];
  onSelectBlock: (day: Day, block: "morning" | "evening") => void;
}) {
  return (
    <section aria-label="Available slots">
      <p className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        Next 14 days
      </p>
      <div className="sk-scroll-x -mx-4 overflow-x-auto px-4 pb-1 lg:-mx-0 lg:px-0">
        <ul className="flex gap-3">
          {days.map((day) => (
            <li
              key={day.date}
              className="flex w-28 shrink-0 flex-col gap-2 lg:w-32"
            >
              <DayHeader day={day} />
              <BlockCard
                label="Morning"
                block={day.morning}
                onClick={() => {
                  onSelectBlock(day, "morning");
                }}
              />
              <BlockCard
                label="Evening"
                block={day.evening}
                onClick={() => {
                  onSelectBlock(day, "evening");
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function DayHeader({ day }: { day: Day }) {
  const [y, m, d] = day.date.split("-").map(Number);
  const isValid = !!(y && m && d);
  const dt = isValid ? new Date(Date.UTC(y, m - 1, d)) : null;
  return (
    <div className="flex items-center justify-between rounded-[var(--radius-sm)] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-center">
      <div className="flex w-full flex-col">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          {WEEKDAY_SHORT[day.weekday]}
        </span>
        <span className="font-display text-[18px] font-extrabold leading-none tracking-tight">
          {dt ? dt.getUTCDate() : "—"}
        </span>
      </div>
    </div>
  );
}

function BlockCard({
  label,
  block,
  onClick,
}: {
  label: string;
  block: BlockShape | null;
  onClick: () => void;
}) {
  if (!block) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--border-subtle))] px-2 py-2.5 text-center">
        <p className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          {label}
        </p>
        <p className="text-xs text-[rgb(var(--fg-muted))]">—</p>
      </div>
    );
  }
  const disabled = !block.available;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        disabled
          ? "rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-2.5 text-center opacity-50"
          : "sk-press rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-2.5 text-center hover:border-[rgb(var(--brand-primary))]"
      }
    >
      <p className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p className="font-mono text-[11px] font-bold text-[rgb(var(--fg-default))]">
        {fmtTime(block.startMin)}–{fmtTime(block.endMin)}
      </p>
    </button>
  );
}

function NoAvailabilityCard({ producerName }: { producerName: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-12 text-center">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        Fully booked
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[rgb(var(--fg-muted))]">
        {producerName} doesn&rsquo;t have any open windows in the next 14
        days. Try again later or message them directly.
      </p>
    </div>
  );
}

// ─── Booking panel (rendered inside Dialog) ──────────────────────────

function BookingPanel({
  activeStudio,
  selected,
  startOptions,
  chosenStart,
  onChooseStart,
  isFreeBooking,
  freeBookingProjectTitle,
  products,
  selectedProductId,
  onSelectProduct,
  onConfirm,
  isPending,
  result,
  currentStep,
  stepCount,
}: {
  activeStudio: Studio | null;
  selected: {
    date: string;
    block: "morning" | "evening";
    blockShape: BlockShape;
  };
  startOptions: number[];
  chosenStart: number | null;
  onChooseStart: (t: number) => void;
  isFreeBooking: boolean;
  freeBookingProjectTitle: string | null;
  products: Product[];
  selectedProductId: string | null;
  onSelectProduct: (id: string) => void;
  onConfirm: () => void;
  isPending: boolean;
  result: { ok: true } | { ok: false; error: string } | null;
  currentStep: number;
  stepCount: number;
}) {
  const dateLabel = fmtDateLong(selected.date);
  const blockLabel = selected.block === "morning" ? "Morning" : "Evening";
  const canConfirm =
    chosenStart != null && (isFreeBooking || selectedProductId != null);

  return (
    <div className="flex flex-col gap-4">
      {/* Progress bar */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: stepCount }, (_, i) => i + 1).map((step) => (
          <span
            key={step}
            className={
              step <= currentStep
                ? "h-1 flex-1 rounded-full bg-[rgb(var(--brand-primary))]"
                : "h-1 flex-1 rounded-full bg-[rgb(var(--border-subtle))]"
            }
          />
        ))}
      </div>

      {/* Header — producer + selected window */}
      <div className="flex items-start gap-3">
        {activeStudio ? (
          <ProducerAvatar name={activeStudio.name} size={40} />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Step {String(currentStep)} of {String(stepCount)}
          </p>
          <p className="mt-0.5 font-display text-[18px] font-extrabold tracking-tight">
            {dateLabel} · {blockLabel}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[rgb(var(--fg-muted))]">
            Window {fmtTime(selected.blockShape.startMin)}–
            {fmtTime(selected.blockShape.endMin)} ·{" "}
            {String(DEFAULT_DURATION_MIN / 60)}h session
          </p>
        </div>
      </div>

      {/* Start-time chips */}
      <section>
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          Start time
        </p>
        <div className="flex flex-wrap gap-2">
          {startOptions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onChooseStart(t);
              }}
              className={
                t === chosenStart
                  ? "sk-press rounded-full bg-[rgb(var(--bg-sidebar))] px-3.5 py-1.5 font-mono text-[12px] font-bold text-[rgb(var(--fg-inverse))]"
                  : "sk-press rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-1.5 font-mono text-[12px] font-bold text-[rgb(var(--fg-default))]"
              }
            >
              {fmtTime(t)}
            </button>
          ))}
        </div>
      </section>

      {/* Product picker — skipped when this is a free session */}
      {!isFreeBooking && chosenStart != null ? (
        <section>
          <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Service
          </p>
          {products.length === 0 ? (
            <p className="text-sm text-[rgb(var(--fg-muted))]">
              No active services. Contact this producer directly.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {products.map((product) => {
                const active = product.id === selectedProductId;
                const sessionsLabel =
                  product.sessionCount && product.sessionCount > 1
                    ? `${String(product.sessionCount)} sessions`
                    : "1 session";
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectProduct(product.id);
                      }}
                      className={
                        active
                          ? "sk-press flex w-full items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)] px-3.5 py-3 text-left"
                          : "sk-press flex w-full items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 text-left hover:border-[rgb(var(--border-strong))]"
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-bold leading-tight text-[rgb(var(--fg-default))]">
                          {product.name}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                          {sessionsLabel}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-[14px] font-extrabold tracking-tight">
                        {fmtMoney(product.priceCents, product.currency)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {isFreeBooking && freeBookingProjectTitle ? (
        <p className="rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--brand-primary)/0.08)] px-3.5 py-2.5 text-[13px] text-[rgb(var(--fg-default))]">
          <span className="font-bold text-[rgb(var(--brand-primary))]">
            On the house —{" "}
          </span>
          included in your {freeBookingProjectTitle}.
        </p>
      ) : null}

      {result && !result.ok ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] px-3.5 py-2.5 text-[13px] text-[rgb(var(--fg-danger))]"
        >
          {result.error}
        </p>
      ) : null}
      {result?.ok ? (
        <p
          role="status"
          className="rounded-[var(--radius-md)] border border-[rgb(var(--fg-success)/0.3)] bg-[rgb(var(--fg-success)/0.08)] px-3.5 py-2.5 text-[13px] text-[rgb(var(--fg-success))]"
        >
          Booked. Your producer will see the request and confirm shortly.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onConfirm}
        disabled={isPending || !canConfirm || result?.ok}
        className="sk-press flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] text-[14px] font-bold text-[rgb(var(--bg-sidebar))] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending
          ? "Booking…"
          : result?.ok
            ? "Booked"
            : isFreeBooking
              ? "Confirm free session"
              : "Send booking request"}
        {!isPending && !result?.ok ? <ArrowRightIcon size={14} /> : null}
      </button>
    </div>
  );
}

function ArrowRightIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

function fmtMoney(cents: number, currency: string): string {
  const prefix = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const major = (cents / 100).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  return `${prefix}${major}`;
}
