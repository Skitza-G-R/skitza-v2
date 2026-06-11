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
// Data-only props (serializable from the server page). Navigation lives here
// so the mock options can be swapped for BE-2's per-product plans without
// touching the route.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import { Eyebrow, FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import {
  formatShekels,
  type PaymentPlan,
  type PlanOption,
  type Producer,
  type PurchaseProduct,
} from "./pay-data";

export function ChoosePlanScreen({
  product,
  producer,
  options,
}: {
  product: PurchaseProduct;
  producer: Producer;
  options: PlanOption[];
}) {
  const router = useRouter();
  const productId = product.id;

  // Pre-select when the product allows only one plan — there's nothing to
  // choose, so the artist can go straight to Continue.
  const [selected, setSelected] = useState<PaymentPlan | null>(
    options.length === 1 ? (options[0]?.plan ?? null) : null,
  );

  function go() {
    if (!selected) return;
    router.push(`/artist/purchase/${productId}/pay/instructions?plan=${selected}`);
  }

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        <FunnelTopBar
          title="Choose a plan"
          sub={producer.name}
          onBack={() => {
            router.push(`/artist/purchase/${productId}`);
          }}
        />

        <div className="flex-1 px-5 pb-[152px] pt-3.5">
          {/* heading */}
          <h1 className="reveal-up font-syne text-[26px] font-extrabold leading-[1.1] tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            How would you like to pay?
          </h1>
          <p className="reveal-up reveal-up-delay-1 mt-2 text-pretty text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {`${producer.name} accepts ${
              options.length === 1 ? "this plan" : "these plans"
            } for ${product.name}. Pick one — you'll pay the first part off-app, then upload your proof.`}
          </p>

          {/* plan cards */}
          <div className="mt-5 flex flex-col gap-3">
            {options.map((opt, i) => {
              const isSelected = opt.plan === selected;
              return (
                <button
                  key={opt.plan}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => {
                    setSelected(opt.plan);
                  }}
                  className="sk-press sk-rise rounded-card relative w-full px-[18px] pb-4 pt-4 text-left transition-colors"
                  style={{
                    animationDelay: `${String(140 + i * 60)}ms`,
                    background: isSelected
                      ? "rgb(var(--brand-primary) / 0.06)"
                      : "rgb(var(--bg-elevated))",
                    border: `1.5px solid ${
                      isSelected
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--border-subtle))"
                    }`,
                    boxShadow: isSelected ? "var(--shadow-glow)" : "var(--shadow-sm)",
                  }}
                >
                  {/* title row + selection dot */}
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-all"
                      style={{
                        background: isSelected
                          ? "rgb(var(--brand-primary))"
                          : "rgb(var(--bg-elevated))",
                        border: `2px solid ${
                          isSelected
                            ? "rgb(var(--brand-primary))"
                            : "rgb(var(--border-strong))"
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
                      <p className="mt-[3px] text-pretty text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
                        {opt.blurb}
                      </p>
                    </div>
                    {/* mono eyebrow ABOVE the price; amber price only on the
                        selected card — unselected stays neutral (proto-s7) */}
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[8.5px] tracking-[0.08em] text-[rgb(var(--fg-muted))]">
                        DUE TODAY
                      </div>
                      <div
                        className="mt-px font-amount text-[19px] font-bold tracking-[-0.03em]"
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
                          borderTop:
                            i === 0
                              ? "none"
                              : "1px solid rgb(var(--border-subtle))",
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
              The deposit secures your slot and is usually final once {producer.name} begins.
              Sessions can run on a deposit — downloads unlock at full payment.
            </span>
          </div>

          <div
            className="sk-rise mt-3"
            style={{ animationDelay: `${String(200 + options.length * 60)}ms` }}
          >
            <Eyebrow>Money is handled off-app — Skitza keeps the record.</Eyebrow>
          </div>
        </div>

        {/* pinned action */}
        <div
          className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pb-3.5 pt-3.5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
          }}
        >
          <PrimaryCta
            onClick={go}
            disabled={!selected}
            glow={!!selected}
            sub={selected ? "Next: how to pay" : "Pick a plan to continue"}
          >
            Continue <ArrowRight />
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
