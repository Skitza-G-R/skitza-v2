"use client";

// S7 — Choose a payment plan (artist purchase funnel · Pay).
//
// After Gate 1 (the producer approves the request), the artist picks how to
// pay from the plans THIS product allows — pay in full, 50/50, or milestones.
// Each card shows what's due today and the full schedule with amounts. One
// plan is selected at a time (amber ring); Continue carries it to the payment
// instructions (S8). Funnel chrome: full-screen overlay, back arrow, no tab
// bar, the primary action pinned low and thumb-reachable.
//
// Data-only props come from the request's frozen server snapshot. The choice
// is persisted before navigation, so refresh/back never silently changes it.

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import { FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { choosePaymentPlanAction } from "./actions";
import { formatShekels, nextPlanIndex, type LivePlanOption } from "./pay-data";

export function ChoosePlanScreen({
  productId,
  productName,
  producerName,
  purchaseRequestId,
  options,
  previewNextHref,
}: {
  productId: string;
  productName: string;
  producerName: string;
  purchaseRequestId: string;
  options: LivePlanOption[];
  /** Dev-gallery navigation only; real routes always persist through the action. */
  previewNextHref?: string | undefined;
}) {
  const router = useRouter();
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Pre-select when the product allows only one plan — there's nothing to
  // choose, so the artist can go straight to Continue.
  const [selected, setSelected] = useState<string | null>(
    options.length === 1 ? (options[0]?.id ?? null) : null,
  );
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.id === selected);
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function selectPlan(index: number) {
    const option = options[index];
    if (!option) return;
    setSelected(option.id);
    setError(null);
  }

  function handlePlanKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      selectPlan(index);
      return;
    }

    const nextIndex = nextPlanIndex(index, options.length, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    selectPlan(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  }

  function go() {
    const option = options.find((item) => item.id === selected);
    if (!option || isSaving) return;
    if (previewNextHref) {
      router.push(previewNextHref);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await choosePaymentPlanAction({
        purchaseRequestId,
        paymentPlan: option.choice,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/artist/purchase/${productId}/pay/instructions?req=${purchaseRequestId}`);
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        <FunnelTopBar
          title="Choose a plan"
          sub={producerName}
          onBack={() => {
            router.push("/artist");
          }}
        />

        <div className="flex-1 px-5 pt-3.5 pb-[152px]">
          {/* heading */}
          <h1 className="reveal-up font-syne text-[26px] leading-[1.1] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            How would you like to pay?
          </h1>
          <p className="reveal-up reveal-up-delay-1 mt-2 text-[14px] leading-relaxed text-pretty text-[rgb(var(--fg-muted))]">
            {`${producerName} accepts ${
              options.length === 1 ? "this plan" : "these plans"
            } for ${productName}. Pick one — you'll pay the first part off-app, then upload your proof.`}
          </p>

          {/* plan cards */}
          <div className="mt-5 flex flex-col gap-3" role="radiogroup" aria-label="Payment plan">
            {options.map((opt, i) => {
              const isSelected = opt.id === selected;
              return (
                <button
                  key={opt.id}
                  ref={(node) => {
                    optionRefs.current[i] = node;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={tabStopIndex === i ? 0 : -1}
                  onClick={() => {
                    selectPlan(i);
                  }}
                  onKeyDown={(event) => {
                    handlePlanKeyDown(event, i);
                  }}
                  className="sk-press sk-rise rounded-card relative w-full px-[18px] pt-4 pb-4 text-left transition-colors"
                  style={{
                    animationDelay: `${String(140 + i * 60)}ms`,
                    background: isSelected
                      ? "rgb(var(--brand-primary) / 0.06)"
                      : "rgb(var(--bg-elevated))",
                    border: `1.5px solid ${
                      isSelected ? "rgb(var(--brand-primary))" : "rgb(var(--border-subtle))"
                    }`,
                    boxShadow: isSelected ? "var(--shadow-glow)" : "var(--shadow-sm)",
                  }}
                >
                  {/* title row + selection dot */}
                  <div className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 min-[350px]:grid-cols-[22px_minmax(0,1fr)_auto]">
                    <span
                      className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-all"
                      style={{
                        background: isSelected
                          ? "rgb(var(--brand-primary))"
                          : "rgb(var(--bg-elevated))",
                        border: `2px solid ${
                          isSelected ? "rgb(var(--brand-primary))" : "rgb(var(--border-strong))"
                        }`,
                        color: "rgb(var(--bg-sidebar))",
                      }}
                    >
                      {isSelected ? <Check /> : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-syne text-[16px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                        {opt.title}
                      </div>
                      <p className="mt-[3px] text-[12.5px] leading-snug text-pretty text-[rgb(var(--fg-muted))]">
                        {opt.blurb}
                      </p>
                    </div>
                    {/* mono eyebrow ABOVE the price; amber price only on the
                        selected card — unselected stays neutral (proto-s7) */}
                    <div className="col-start-2 row-start-2 text-left min-[350px]:col-start-3 min-[350px]:row-start-1 min-[350px]:text-right">
                      <div className="font-mono text-[8.5px] tracking-[0.08em] text-[rgb(var(--fg-muted))]">
                        DUE TODAY
                      </div>
                      <div
                        className="font-amount mt-px text-[19px] font-bold tracking-[-0.03em]"
                        style={{
                          color: isSelected
                            ? "rgb(var(--brand-primary-dark))"
                            : "rgb(var(--fg-default))",
                        }}
                      >
                        {formatShekels(opt.dueNowCents)}
                      </div>
                    </div>
                  </div>

                  {/* schedule */}
                  <div
                    className="mt-3 rounded-[12px] px-3.5 py-2"
                    style={{
                      background: isSelected
                        ? "rgb(var(--bg-elevated))"
                        : "rgb(var(--bg-background))",
                      border: "1px solid rgb(var(--border-subtle))",
                    }}
                  >
                    {opt.schedule.map((row, i) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between py-[5px]"
                        style={{
                          borderTop: i === 0 ? "none" : "1px solid rgb(var(--border-subtle))",
                        }}
                      >
                        <span className="flex items-center gap-2 text-[12.5px] text-[rgb(var(--fg-secondary))]">
                          {/* small dot bullet — amber for today's payment */}
                          <span
                            aria-hidden
                            className="h-[5px] w-[5px] shrink-0 rounded-full"
                            style={{
                              background:
                                i === 0
                                  ? "rgb(var(--brand-primary))"
                                  : "rgb(var(--fg-default) / 0.22)",
                            }}
                          />
                          {row.label}
                        </span>
                        <span className="font-amount text-[12.5px] font-medium text-[rgb(var(--fg-default))]">
                          {formatShekels(row.amountCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {/* deposit footnote (proto-s7) */}
          <div
            className="sk-rise mt-4 flex items-start gap-1.5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]"
            style={{ animationDelay: `${String(140 + options.length * 60)}ms` }}
          >
            <span className="mt-px">
              <ShieldIcon />
            </span>
            <span>
              The deposit secures your slot and is usually final once {producerName} begins.
              Sessions can run on a deposit — downloads unlock at full payment.
            </span>
          </div>

          <div
            className="sk-rise mt-3"
            style={{ animationDelay: `${String(200 + options.length * 60)}ms` }}
          >
            <div className="max-w-full font-mono text-[9.5px] leading-relaxed font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
              Money is handled off-app — Skitza keeps the record.
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-[12px] border border-[rgb(var(--fg-danger)/0.24)] bg-[rgb(var(--fg-danger)/0.08)] px-3.5 py-3 text-[12.5px] font-medium text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}
        </div>

        {/* pinned action */}
        <div
          className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pt-3.5 pb-3.5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
          }}
        >
          <PrimaryCta
            onClick={go}
            disabled={!selected || isSaving}
            glow={!!selected && !isSaving}
            sub={
              isSaving
                ? "Saving your plan"
                : selected
                  ? "Next: how to pay"
                  : "Pick a plan to continue"
            }
          >
            {isSaving ? "Saving…" : "Continue"} <ArrowRight />
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
