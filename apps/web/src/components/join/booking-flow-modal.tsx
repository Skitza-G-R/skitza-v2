"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  fetchPublicProducts,
  fetchPublicSlots,
  requestPublicBooking,
  type BookingProduct,
} from "./booking-actions";

// Booking flow modal — `/join/<slug>` inline 3-step wizard.
//
// Replaces the old "Book a session" → /sign-up redirect with an
// in-place wizard:
//   • Step 1 — Pick a slot (14-day calendar grid + open times)
//   • Step 2 — Pick a product (active products list)
//   • Step 3 — Confirm + send (name, email, optional message)
//   • Success state — "we'll let the producer know"
//
// Per design: the slot picker leads (matches booking-flow.html). Step
// 2 (session details / product) follows after a slot is chosen. Step
// 3 is review + confirm. The modal commits a `pending` booking via
// booking.publicRequest — Stripe / payment is Phase H, not in this
// slice.
//
// Public route — ENGLISH ONLY, LTR ONLY per CLAUDE.md i18n scope.
// All visible strings are inline English.
//
// Interaction:
// - Click outside / Esc → close (asks for confirmation if step ≥ 2
//   has data the user typed).
// - Slide-up animation via Radix Dialog (.sk-dialog-enter handles
//   the bottom-sheet entrance, reduce-motion gated in globals.css).
// - Focus trap inherited from Radix Dialog.
//
// State: useState only — wizard state is intentionally not persisted
// across reloads. An interrupted session restarts.

interface BookingFlowModalProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  slug: string;
  producerName: string;
}

type Step = 1 | 2 | 3 | 4; // 4 = success

// Group an ISO slot list by `YYYY-MM-DD` (in browser-local time, since
// the producer's TZ is intentionally not exposed publicly — we render
// times in the visitor's local TZ per booking.publicSlots' contract).
function groupSlotsByDay(slots: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const iso of slots) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = out.get(key) ?? [];
    list.push(iso);
    out.set(key, list);
  }
  return out;
}

function formatDayLabel(d: Date): { weekday: string; dayNum: number; month: string } {
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    dayNum: d.getDate(),
    month: d.toLocaleDateString("en-US", { month: "short" }),
  };
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPrice(cents: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  return symbol ? `${symbol}${(cents / 100).toFixed(0)}` : `${(cents / 100).toFixed(0)} ${currency}`;
}

export function BookingFlowModal({
  open,
  onOpenChange,
  slug,
  producerName,
}: BookingFlowModalProps) {
  const [step, setStep] = useState<Step>(1);

  // Step 1 — Slot picker.
  const [products, setProducts] = useState<BookingProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);

  // Slot-picker uses a "lead product" — the first active product —
  // to seed the 14-day availability grid. Producers' grids are the
  // same regardless of product duration in this slice (we'd refine
  // per-product later if/when products have wildly different
  // durations on the same producer).
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  // Step 2 — Product picker.
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // Step 3 — Confirm form.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Selected day in the calendar grid (ISO date string YYYY-MM-DD).
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const initialFocusRef = useRef<HTMLButtonElement | null>(null);

  // Reset everything when modal closes.
  const reset = useCallback(() => {
    setStep(1);
    setSelectedSlot(null);
    setSelectedProductId(null);
    setName("");
    setEmail("");
    setMessage("");
    setSubmitError(null);
    setSelectedDayKey(null);
  }, []);

  // Fetch products + slots on first open. We always need products
  // (even on Step 1) because the "lead product" feeds the slot grid.
  useEffect(() => {
    if (!open) return;
    // Closure flag for cancellation. Boxed in a small object so the
    // closure captures the field by reference + an `isCancelled()`
    // accessor sidesteps eslint's `no-unnecessary-condition` flow
    // narrowing (which sees the literal `false` initialiser and
    // claims any subsequent `state.cancelled` check is dead).
    const state = { cancelled: false };
    const isCancelled = (): boolean => state.cancelled;
    void (async () => {
      setProductsLoading(true);
      setProductsError(null);
      try {
        const res = await fetchPublicProducts({ slug });
        if (isCancelled()) return;
        setProducts(res.data.products);
        if (res.data.products.length === 0) {
          setProductsLoading(false);
          return;
        }
        // Fire slot fetch using the lead product. If the producer has
        // multiple active products with different durations, the grid
        // optimistically uses the first one's duration — selecting a
        // different product on Step 2 doesn't re-fetch in this slice.
        const lead = res.data.products[0];
        if (!lead) {
          setProductsLoading(false);
          return;
        }
        setSlotsLoading(true);
        const slotsRes = await fetchPublicSlots({
          slug,
          productId: lead.id,
          days: 14,
        });
        if (isCancelled()) return;
        setSlots(slotsRes.data.slots);
        // Default-pick the first day with availability.
        const grouped = groupSlotsByDay(slotsRes.data.slots);
        const firstDay = grouped.keys().next().value;
        if (firstDay) setSelectedDayKey(firstDay);
      } catch (err) {
        if (isCancelled()) return;
        console.error("[booking-modal] fetch failed", err);
        setProductsError("Couldn't load this producer's schedule. Try again.");
      } finally {
        if (!isCancelled()) {
          setProductsLoading(false);
          setSlotsLoading(false);
        }
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, [open, slug]);

  // Build the 14-day strip — ALWAYS 14 entries even on the empty
  // state, so the visual stays stable.
  const calendarStrip = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const key = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { key, date: d };
    });
  }, []);

  const groupedSlots = useMemo(() => groupSlotsByDay(slots), [slots]);

  const slotsForSelectedDay = useMemo(() => {
    if (!selectedDayKey) return [];
    return groupedSlots.get(selectedDayKey) ?? [];
  }, [groupedSlots, selectedDayKey]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const noAvailability = !slotsLoading && slots.length === 0 && products.length > 0;
  const noProducts = !productsLoading && products.length === 0 && !productsError;

  // Close handler — confirms unsaved data on Step 2/3 only.
  const hasInProgressData = step >= 2 && (selectedSlot || name || email || message);
  const handleOpenChange = (next: boolean) => {
    if (!next && hasInProgressData) {
      const ok = window.confirm("Leave this booking? Your details won't be saved.");
      if (!ok) return;
    }
    onOpenChange(next);
    if (!next) {
      // Reset on a tiny delay so closing animation doesn't flash empty UI.
      setTimeout(reset, 200);
    }
  };

  const handleSubmit = async () => {
    if (!selectedProductId || !selectedSlot || !name.trim() || !email.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await requestPublicBooking({
        slug,
        productId: selectedProductId,
        artistName: name.trim(),
        artistEmail: email.trim(),
        startsAtIso: selectedSlot,
        ...(message.trim() ? { notes: message.trim() } : {}),
      });
      if (!result.ok) {
        setSubmitError(result.error);
        // If the slot was just taken, kick the user back to Step 1.
        if (result.code === "CONFLICT") {
          setStep(1);
          setSelectedSlot(null);
          // Re-fetch slots so the conflicting one disappears from the grid.
          if (products[0]) {
            try {
              const refreshed = await fetchPublicSlots({
                slug,
                productId: products[0].id,
                days: 14,
              });
              setSlots(refreshed.data.slots);
            } catch {
              /* swallow — outer error is already shown */
            }
          }
        }
        return;
      }
      setStep(4);
    } catch (err) {
      console.error("[booking-modal] submit failed", err);
      setSubmitError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg p-0 overflow-hidden"
        onInteractOutside={(e) => {
          if (hasInProgressData) {
            e.preventDefault();
            const ok = window.confirm("Leave this booking? Your details won't be saved.");
            if (ok) onOpenChange(false);
          }
        }}
      >
        <DialogTitle className="sr-only">
          Book a session with {producerName}
        </DialogTitle>
        <DialogDescription className="sr-only">
          A 3-step inline wizard: pick a slot, pick a service, confirm your details.
        </DialogDescription>

        {/* Header — progress + step title. Hidden on success. */}
        {step !== 4 ? (
          <div className="border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-5 pb-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                Step {step} of 3
              </p>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                {producerName}
              </p>
            </div>
            <h2
              className="mt-2 text-2xl font-extrabold leading-tight tracking-tight text-[rgb(var(--fg-primary))] sm:text-3xl"
              style={{ fontFamily: "var(--font-head), var(--font-display)" }}
            >
              {step === 1
                ? "Pick a slot"
                : step === 2
                  ? "Pick a service"
                  : "Confirm details"}
            </h2>
            <div className="mt-4 flex gap-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-[3px] flex-1 rounded-full"
                  style={{
                    background:
                      i <= step
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--border-subtle))",
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-5">
          {/* ── Step 1 — Slot picker ─────────────────────────────── */}
          {step === 1 ? (
            <>
              {productsLoading || slotsLoading ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-[rgb(var(--fg-muted))]">Loading availability...</p>
                </div>
              ) : productsError ? (
                <ErrorBlock message={productsError} />
              ) : noProducts ? (
                <EmptyState
                  title="No services live right now"
                  body={`${producerName} hasn't published any services yet. Check back soon.`}
                />
              ) : noAvailability ? (
                <EmptyState
                  title="Fully booked for the next 2 weeks"
                  body={`${producerName} doesn't have any open slots in the next 14 days. Try again in a few days.`}
                />
              ) : (
                <>
                  {/* Day strip — horizontal scroll, 14 days */}
                  <div className="-mx-5 overflow-x-auto px-5 pb-2">
                    <div className="flex gap-2">
                      {calendarStrip.map(({ key, date }, idx) => {
                        const label = formatDayLabel(date);
                        const dayHasSlots = (groupedSlots.get(key)?.length ?? 0) > 0;
                        const isSelected = selectedDayKey === key;
                        const isToday = idx === 0;
                        return (
                          <button
                            key={key}
                            type="button"
                            ref={isSelected ? initialFocusRef : undefined}
                            disabled={!dayHasSlots}
                            onClick={() => { setSelectedDayKey(key); }}
                            className="relative flex h-[76px] w-[60px] flex-shrink-0 flex-col items-center justify-center gap-[3px] rounded-[var(--radius-md)] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--bg-base))] disabled:cursor-not-allowed disabled:opacity-40"
                            style={{
                              background: isSelected
                                ? "rgb(var(--brand-primary)/0.10)"
                                : "rgb(var(--bg-elevated))",
                              borderColor: isSelected
                                ? "rgb(var(--brand-primary))"
                                : "rgb(var(--border-subtle))",
                              color: dayHasSlots
                                ? "rgb(var(--fg-primary))"
                                : "rgb(var(--fg-muted))",
                            }}
                            aria-pressed={isSelected}
                            aria-label={`${label.weekday} ${label.month} ${String(label.dayNum)}${dayHasSlots ? "" : " — no slots"}`}
                          >
                            {isToday ? (
                              <span
                                aria-hidden
                                className="absolute -top-[6px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[3px] px-[6px] py-[2px] font-mono text-[0.5rem] font-extrabold uppercase tracking-[0.08em] text-[rgb(var(--bg-base))]"
                                style={{ background: "rgb(var(--brand-primary))" }}
                              >
                                Today
                              </span>
                            ) : null}
                            <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]">
                              {label.weekday}
                            </span>
                            <span
                              className="text-2xl font-extrabold leading-none tracking-tight"
                              style={{ fontFamily: "var(--font-head), var(--font-display)" }}
                            >
                              {label.dayNum}
                            </span>
                            {dayHasSlots ? (
                              <span
                                aria-hidden
                                className="h-1 w-1 rounded-full"
                                style={{
                                  background: "rgb(var(--brand-primary))",
                                  opacity: isSelected ? 1 : 0.55,
                                }}
                              />
                            ) : (
                              <span aria-hidden className="text-[10px] leading-none text-[rgb(var(--fg-muted))]/40">—</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Time list for selected day */}
                  <div className="mt-4">
                    <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                      Open times
                    </p>
                    {slotsForSelectedDay.length === 0 ? (
                      <p className="mt-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-6 text-center text-sm text-[rgb(var(--fg-muted))]">
                        No openings on this day. Try another date.
                      </p>
                    ) : (
                      <div className="mt-3 flex flex-col gap-2">
                        {slotsForSelectedDay.map((iso) => {
                          const isSelected = selectedSlot === iso;
                          return (
                            <button
                              key={iso}
                              type="button"
                              onClick={() => {
                                setSelectedSlot(iso);
                                setStep(2);
                              }}
                              className="flex min-h-[44px] items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-left transition-colors hover:border-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--bg-base))]"
                              style={
                                isSelected
                                  ? { borderColor: "rgb(var(--brand-primary))" }
                                  : undefined
                              }
                            >
                              <span className="text-base font-semibold text-[rgb(var(--fg-primary))]">
                                {formatSlotTime(iso)}
                              </span>
                              <span className="ml-auto text-[rgb(var(--fg-muted))]" aria-hidden>
                                →
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : null}

          {/* ── Step 2 — Product picker ──────────────────────────── */}
          {step === 2 ? (
            <>
              {/* Slot summary card */}
              {selectedSlot ? (
                <div className="mb-5 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
                      {new Date(selectedSlot).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      {" · "}
                      {formatSlotTime(selectedSlot)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setStep(1); }}
                    className="text-xs font-semibold text-[rgb(var(--brand-primary))] hover:underline focus-visible:outline-none focus-visible:underline"
                  >
                    Change
                  </button>
                </div>
              ) : null}

              <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                What kind of session?
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {products.map((p) => {
                  const isSelected = selectedProductId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSelectedProductId(p.id); }}
                      className="flex min-h-[44px] items-center gap-3 rounded-[var(--radius-md)] border bg-[rgb(var(--bg-elevated))] px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--bg-base))]"
                      style={{
                        borderColor: isSelected
                          ? "rgb(var(--brand-primary))"
                          : "rgb(var(--border-subtle))",
                        boxShadow: isSelected
                          ? "0 0 0 3px rgb(var(--brand-primary)/0.10)"
                          : undefined,
                      }}
                      aria-pressed={isSelected}
                    >
                      <span
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-[1.5px]"
                        style={{
                          borderColor: isSelected
                            ? "rgb(var(--brand-primary))"
                            : "rgb(var(--fg-muted)/0.5)",
                        }}
                        aria-hidden
                      >
                        {isSelected ? (
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: "rgb(var(--brand-primary))" }}
                          />
                        ) : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
                          {p.name}
                        </p>
                        {p.durationMin > 0 ? (
                          <p className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]">
                            {p.durationMin} min session
                          </p>
                        ) : null}
                      </div>
                      <span className="font-mono text-sm font-bold text-[rgb(var(--fg-primary))]">
                        {formatPrice(p.priceCents, p.currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {/* ── Step 3 — Confirm ─────────────────────────────────── */}
          {step === 3 ? (
            <>
              {selectedSlot && selectedProduct ? (
                <div className="mb-5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
                  <SummaryRow
                    label="When"
                    value={`${new Date(selectedSlot).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })} at ${formatSlotTime(selectedSlot)}`}
                  />
                  <SummaryRow
                    label="Service"
                    value={`${selectedProduct.name} · ${formatPrice(selectedProduct.priceCents, selectedProduct.currency)}`}
                  />
                  {selectedProduct.durationMin > 0 ? (
                    <SummaryRow
                      label="Length"
                      value={`${String(selectedProduct.durationMin)} min`}
                      isLast
                    />
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col gap-4">
                <label className="block">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                    Your name
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); }}
                    className="mt-2 block w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 text-sm text-[rgb(var(--fg-primary))] focus-visible:border-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-0"
                    placeholder="Jane Artist"
                    required
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                    Email
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); }}
                    className="mt-2 block w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 text-sm text-[rgb(var(--fg-primary))] focus-visible:border-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-0"
                    placeholder="you@example.com"
                    required
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                    Notes (optional)
                  </span>
                  <textarea
                    value={message}
                    onChange={(e) => { setMessage(e.target.value); }}
                    rows={4}
                    maxLength={1000}
                    className="mt-2 block w-full resize-none rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 text-sm text-[rgb(var(--fg-primary))] focus-visible:border-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-0"
                    placeholder="Anything the producer should know? Reference tracks, what to focus on..."
                  />
                </label>
              </div>

              <p className="mt-4 rounded-[var(--radius-md)] bg-[rgb(var(--fg-primary)/0.04)] px-4 py-3 text-xs leading-relaxed text-[rgb(var(--fg-secondary))]">
                Payment will be requested after the producer confirms your slot.
                You won't be charged yet.
              </p>

              {submitError ? <ErrorBlock message={submitError} /> : null}
            </>
          ) : null}

          {/* ── Step 4 — Success ─────────────────────────────────── */}
          {step === 4 ? (
            <div className="py-8 text-center">
              <div
                className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full"
                style={{
                  background: "rgb(var(--brand-primary))",
                  boxShadow: "0 8px 24px rgb(var(--brand-primary)/0.3)",
                }}
                aria-hidden
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" className="h-8 w-8 text-[rgb(var(--bg-base))]">
                  <path d="M5 12l4 4 10-11" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3
                className="text-2xl font-extrabold tracking-tight text-[rgb(var(--fg-primary))]"
                style={{ fontFamily: "var(--font-head), var(--font-display)" }}
              >
                Booking sent
              </h3>
              <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                We sent {producerName} your request. They&apos;ll confirm shortly — keep an eye on your inbox at{" "}
                <span className="font-semibold text-[rgb(var(--fg-primary))]">{email}</span>.
              </p>
              <button
                type="button"
                onClick={() => { onOpenChange(false); }}
                className="mt-6 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--fg-primary))] px-5 py-2.5 text-sm font-bold text-[rgb(var(--bg-base))] hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
              >
                Done
              </button>
            </div>
          ) : null}
        </div>

        {/* Footer — sticky CTA per step. Hidden on success. */}
        {step !== 4 ? (
          <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-4">
            <div className="flex items-center gap-3">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => { setStep((step - 1) as Step); }}
                  className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] px-4 py-2 text-sm font-semibold text-[rgb(var(--fg-primary))] transition-colors hover:bg-[rgb(var(--bg-base))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
                >
                  Back
                </button>
              ) : null}
              {step === 2 ? (
                <button
                  type="button"
                  disabled={!selectedProductId}
                  onClick={() => { setStep(3); }}
                  className="ml-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--fg-primary))] px-5 py-2 text-sm font-bold text-[rgb(var(--bg-base))] transition-transform hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  Continue
                </button>
              ) : null}
              {step === 3 ? (
                <button
                  type="button"
                  disabled={
                    submitting ||
                    !name.trim() ||
                    !email.trim() ||
                    !selectedProductId ||
                    !selectedSlot
                  }
                  onClick={() => void handleSubmit()}
                  className="ml-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--fg-primary))] px-5 py-2 text-sm font-bold text-[rgb(var(--bg-base))] transition-transform hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {submitting ? "Sending..." : "Send booking request"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-8 text-center">
      <p className="text-base font-semibold text-[rgb(var(--fg-primary))]">{title}</p>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">{body}</p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-[var(--radius-md)] border px-4 py-3 text-sm"
      style={{
        background: "rgb(var(--fg-danger)/0.08)",
        borderColor: "rgb(var(--fg-danger)/0.30)",
        color: "rgb(var(--fg-danger))",
      }}
    >
      {message}
    </div>
  );
}

function SummaryRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <div
      className="flex items-start gap-4 px-4 py-3"
      style={isLast ? undefined : { borderBottom: "1px solid rgb(var(--border-subtle))" }}
    >
      <span className="w-16 flex-shrink-0 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        {label}
      </span>
      <span className="flex-1 text-sm font-semibold text-[rgb(var(--fg-primary))]">{value}</span>
    </div>
  );
}
