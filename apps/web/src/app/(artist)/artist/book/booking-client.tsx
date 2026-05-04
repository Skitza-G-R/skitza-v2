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
const SLOT_INCREMENT_MIN = 60; // 1h cadence for start-time chips

// Format a minute-of-day offset as "HH:MM" 24-hour.
function fmtTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Short month+day label for a "YYYY-MM-DD" date, e.g. "Apr 19".
function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // new Date(Date.UTC()) so the weekday/day here lines up with the
  // router's UTC-midnight day math — no off-by-one at TZ boundaries.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

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
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: true } | { ok: false; error: string } | null>(null);

  const activeStudio = studios.find((s) => s.producerId === activeStudioId);

  // Default session length — matches the producer's most-common slot
  // (2h). When the producer-config plumbing lands we'll derive this
  // per-product; for MVP 2h is the safe default.
  const DEFAULT_DURATION_MIN = 120;

  // Derive the list of start-time options once per selected block. The
  // UI renders chips at hourly cadence from block.startMin up to the
  // latest start that still fits the duration inside the block.
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
    setResult(null);
    router.push(`/artist/book?studio=${id}`);
  };

  const handleSelectBlock = (day: Day, block: "morning" | "evening") => {
    const shape = block === "morning" ? day.morning : day.evening;
    if (!shape || !shape.available) return;
    setSelected({ date: day.date, block, blockShape: shape });
    setChosenStart(shape.startMin);
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

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Book</h1>

      <ProducerPicker
        studios={studios}
        activeId={activeStudioId}
        onSelect={handleSwitchStudio}
      />

      {availability.freeBookingProjectTitle ? (
        <div className="rounded-lg border border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))]/5 p-3 text-sm">
          <strong className="text-[rgb(var(--brand-primary))]">
            On the house —{" "}
          </strong>
          included in your {availability.freeBookingProjectTitle}
        </div>
      ) : null}

      {/* 14-day horizontal strip. Each day shows up to two cards
          (morning + evening). Greyed-out cards are unavailable. Tap a
          card to open the bottom sheet with start-time chips.
          `sk-scroll-x` gives iOS momentum so the 14-day swipe feels
          native. */}
      <div className="sk-scroll-x -mx-4 overflow-x-auto px-4 pb-1">
        <ul className="flex gap-3">
          {availability.days.map((day) => (
            <li key={day.date} className="shrink-0 w-28 space-y-2">
              <div className="text-center">
                <div className="text-[0.7rem] font-mono uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  {WEEKDAY_SHORT[day.weekday]}
                </div>
                <div className="text-sm font-medium text-[rgb(var(--fg-primary))]">
                  {fmtDateShort(day.date)}
                </div>
              </div>

              <BlockCard
                label="Morning"
                block={day.morning}
                onClick={() => {
                  handleSelectBlock(day, "morning");
                }}
              />
              <BlockCard
                label="Evening"
                block={day.evening}
                onClick={() => {
                  handleSelectBlock(day, "evening");
                }}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom sheet — picks start-time, then confirms. Using a plain
          absolute-positioned section instead of a portalled modal so
          the whole page stays SSR-friendly and doesn't need a global
          shell dependency. */}
      {selected ? (
        <section
          role="dialog"
          aria-label="Confirm booking"
          className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-4 shadow-2xl"
        >
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  {fmtDateShort(selected.date)} ·{" "}
                  {selected.block === "morning" ? "Morning" : "Evening"}
                </h2>
                <p className="text-xs text-[rgb(var(--fg-muted))]">
                  {fmtTime(selected.blockShape.startMin)}–
                  {fmtTime(selected.blockShape.endMin)} window ·{" "}
                  {activeStudio?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-xl leading-none text-[rgb(var(--fg-muted))]"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {startOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setChosenStart(t);
                  }}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    t === chosenStart
                      ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-white"
                      : "border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-secondary))]"
                  }`}
                >
                  {fmtTime(t)}
                </button>
              ))}
            </div>

            {chosenStart != null && !availability.freeBookingProjectId ? (
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-[rgb(var(--fg-muted))] mb-2">
                  Select a service
                </p>
                {products.length === 0 ? (
                  <p className="text-sm text-[rgb(var(--fg-secondary))]">
                    No active services. Contact this producer directly.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {products.map((product) => (
                      <li key={product.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProductId(product.id);
                          }}
                          className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                            product.id === selectedProductId
                              ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))]/5"
                              : "border-[rgb(var(--border-subtle))] hover:border-[rgb(var(--fg-muted))]"
                          }`}
                        >
                          <span className="font-medium">{product.name}</span>
                          {product.sessionCount && product.sessionCount > 1 ? (
                            <span className="ml-2 text-xs text-[rgb(var(--fg-muted))]">
                              {product.sessionCount} sessions
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {chosenStart != null ? (
              <p className="text-sm text-[rgb(var(--fg-secondary))]">
                Book {DEFAULT_DURATION_MIN / 60}h at {fmtTime(chosenStart)} on{" "}
                {fmtDateShort(selected.date)}
                {activeStudio ? ` with ${activeStudio.name}` : ""}
              </p>
            ) : null}

            {result && !result.ok ? (
              <p
                role="alert"
                className="text-sm text-[rgb(var(--danger))]"
              >
                {result.error}
              </p>
            ) : null}
            {result?.ok ? (
              <p
                role="status"
                className="text-sm text-[rgb(var(--success))]"
              >
                Booked.
              </p>
            ) : null}

            <button
              type="button"
              onClick={handleConfirm}
              disabled={
                isPending ||
                chosenStart == null ||
                result?.ok ||
                (!availability.freeBookingProjectId && !selectedProductId)
              }
              className="w-full rounded-lg bg-[rgb(var(--brand-primary))] px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending
                ? "Booking…"
                : result?.ok
                  ? "Booked"
                  : availability.freeBookingProjectId
                    ? "Confirm (free session)"
                    : "Confirm booking"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// Single morning/evening card. Greyed when null or unavailable. Uses
// a button element so screen readers / keyboard users can interact.
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
      <div className="rounded-lg border border-dashed border-[rgb(var(--border-subtle))] p-2 text-center">
        <div className="text-[0.7rem] font-mono uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {label}
        </div>
        <div className="text-xs text-[rgb(var(--fg-muted))]">—</div>
      </div>
    );
  }
  const disabled = !block.available;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-lg border p-2 text-center transition-colors ${
        disabled
          ? "border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-muted))] opacity-50"
          : "border-[rgb(var(--border-subtle))] hover:border-[rgb(var(--brand-primary))]"
      }`}
    >
      <div className="text-[0.7rem] font-mono uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </div>
      <div className="text-xs text-[rgb(var(--fg-secondary))]">
        {fmtTime(block.startMin)}–{fmtTime(block.endMin)}
      </div>
    </button>
  );
}
