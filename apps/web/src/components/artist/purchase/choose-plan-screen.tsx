"use client";

// S7 — Choose a payment plan (artist purchase funnel · Pay).
//
// After Gate 1 (the producer approves the request), the artist picks how to
// pay from the plans THIS purchase allows — full, 50/50, or monthly.
// Each card shows what's due at acceptance and the full schedule with amounts. One
// plan is selected at a time (amber ring); Continue carries it to the payment
// instructions (S8). Funnel chrome: full-screen overlay, back arrow, no tab
// bar, the primary action pinned low and thumb-reachable.
//
// Data-only props come from the approved request. Choosing a card does not
// persist anything: Continue carries the choice to one final exact-agreement
// preview, where plan and terms are accepted atomically.

import { useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import { FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";
import {
  formatPurchaseMoney,
  nextPlanIndex,
  paymentPlanAgreementHref,
  type LivePlanOption,
} from "./pay-data";

export function ChoosePlanScreen({
  productId,
  studioId,
  productName,
  producerName,
  purchaseRequestId,
  options,
  currency = "ILS",
  previewNextHref,
}: {
  productId: string;
  studioId?: string | undefined;
  productName: string;
  producerName: string;
  purchaseRequestId: string;
  options: LivePlanOption[];
  currency?: string;
  /** Dev-gallery navigation only. */
  previewNextHref?: string | undefined;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const requiresLivePreview = !previewNextHref;
  const enabledOptions = options.filter(
    (option) =>
      option.choice.kind !== "monthly" ||
      (option.choice.installments >= 2 && option.choice.installments <= 12),
  );

  // Pre-select when the product allows only one plan — there's nothing to
  // choose, so the artist can go straight to Continue.
  const [selected, setSelected] = useState<string | null>(
    enabledOptions.length === 1 ? (enabledOptions[0]?.id ?? null) : null,
  );
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const selectedIndex = enabledOptions.findIndex((option) => option.id === selected);
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function selectPlan(index: number) {
    const option = enabledOptions[index];
    if (!option) return;
    setSelected(option.id);
  }

  function handlePlanKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      selectPlan(index);
      return;
    }

    const nextIndex = nextPlanIndex(index, enabledOptions.length, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    selectPlan(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  }

  function go() {
    const option = enabledOptions.find((item) => item.id === selected);
    if (!option) return;
    if (!online && requiresLivePreview) return;
    if (previewNextHref) {
      router.push(previewNextHref);
      return;
    }
    router.push(
      paymentPlanAgreementHref({
        productId,
        purchaseRequestId,
        choice: option.choice,
        studioId,
      }),
    );
  }

  return (
    <div
      className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[60] flex flex-col overflow-hidden"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-0 w-full max-w-[440px] flex-1 flex-col overflow-hidden">
        <FunnelTopBar
          title="Choose a plan"
          sub={producerName}
          onBack={() => {
            router.push(withArtistStudio("/artist", studioId));
          }}
        />

        <div className="sk-native-scroll min-h-0 flex-1 px-5 pt-3.5 pb-6">
          {/* heading */}
          <h1 className="reveal-up font-syne text-[26px] leading-[1.1] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            How would you like to pay?
          </h1>
          <p className="reveal-up reveal-up-delay-1 mt-2 text-[14px] leading-relaxed text-pretty text-[rgb(var(--fg-muted))]">
            {`${producerName} accepts ${
              enabledOptions.length === 1 ? "this plan" : "these plans"
            } for ${productName}. Pick one, then review and accept the exact agreement before anything is frozen.`}
          </p>

          {/* plan cards */}
          <div className="mt-5 flex flex-col gap-3" role="radiogroup" aria-label="Payment plan">
            {enabledOptions.map((opt, i) => {
              const isSelected = opt.id === selected;
              return (
                <div
                  key={opt.id}
                  ref={(node) => {
                    optionRefs.current[i] = node;
                  }}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={tabStopIndex === i ? 0 : -1}
                  onClick={() => {
                    selectPlan(i);
                  }}
                  onKeyDown={(event) => {
                    handlePlanKeyDown(event, i);
                  }}
                  className="sk-press sk-rise rounded-card relative w-full cursor-pointer px-[18px] pt-4 pb-4 text-left transition-colors"
                  style={{
                    animationDelay: `${String(140 + i * 60)}ms`,
                    background: isSelected
                      ? "rgb(var(--brand-primary) / 0.06)"
                      : "rgb(var(--bg-elevated))",
                    border: `1.5px solid ${
                      isSelected ? "rgb(var(--focus-ring))" : "rgb(var(--border-control))"
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
                          isSelected ? "rgb(var(--focus-ring))" : "rgb(var(--border-control))"
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
                        DUE AT ACCEPTANCE
                      </div>
                      <div
                        className="font-amount mt-px text-[19px] font-bold tracking-[-0.03em]"
                        style={{
                          color: isSelected
                            ? "rgb(var(--brand-primary-text))"
                            : "rgb(var(--fg-default))",
                        }}
                      >
                        {formatPurchaseMoney(opt.dueNowCents, currency)}
                      </div>
                    </div>
                  </div>

                  {/* schedule */}
                  <ol
                    className="mt-3 list-none rounded-[12px] px-3.5 py-2"
                    style={{
                      background: isSelected
                        ? "rgb(var(--bg-elevated))"
                        : "rgb(var(--bg-background))",
                      border: "1px solid rgb(var(--border-subtle))",
                    }}
                  >
                    {opt.schedule.map((row, i) => (
                      <li
                        key={row.label}
                        className="flex items-center justify-between py-[5px]"
                        style={{
                          borderTop: i === 0 ? "none" : "1px solid rgb(var(--border-subtle))",
                        }}
                      >
                        <span className="flex items-center gap-2 text-[12.5px] text-[rgb(var(--fg-secondary))]">
                          {/* small dot bullet — amber for the acceptance payment */}
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
                          {formatPurchaseMoney(row.amountCents, currency)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>

          {/* External-payment truth for the exact server-authored schedule. */}
          <div
            className="sk-rise mt-4 flex items-start gap-1.5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]"
            style={{ animationDelay: `${String(140 + enabledOptions.length * 60)}ms` }}
          >
            <span className="mt-px">
              <ShieldIcon />
            </span>
            <span>
              Your first installment follows {producerName}&apos;s external payment instructions.
              The project activates only after that complete installment is confirmed.
            </span>
          </div>

          <div
            className="sk-rise mt-3"
            style={{ animationDelay: `${String(200 + enabledOptions.length * 60)}ms` }}
          >
            <div className="max-w-full font-mono text-[9.5px] leading-relaxed font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
              Money is handled off-app — Skitza keeps the record.
            </div>
          </div>

          {enabledOptions.length === 0 ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-[12.5px] text-[rgb(var(--fg-danger-text))]"
            >
              No enabled payment plan is available for this request.
            </p>
          ) : null}
          {!online && requiresLivePreview ? (
            <p
              role="status"
              className="mt-4 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-4 py-3 text-[12.5px] text-[rgb(var(--fg-secondary))]"
            >
              Reconnect to load the exact agreement for this plan.
            </p>
          ) : null}
        </div>

        {/* pinned action */}
        <div
          className="sk-safe-bottom z-10 shrink-0 px-[18px] pt-3.5 pb-3.5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
          }}
        >
          <PrimaryCta
            onClick={go}
            disabled={!selected || (!online && requiresLivePreview)}
            glow={Boolean(selected) && (online || !requiresLivePreview)}
            sub={
              !online && requiresLivePreview
                ? "Reconnect to continue"
                : selected
                  ? "Next: review the exact agreement"
                  : "Pick a plan to continue"
            }
          >
            Continue to agreement <ArrowRight />
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
