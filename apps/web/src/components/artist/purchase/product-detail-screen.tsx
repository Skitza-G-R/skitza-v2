"use client";

// S3 — Product detail + "Request to book" (artist purchase funnel · ENTRY).
//
// Handoff-4 TICKET layout (docs/design/handoff-4/skitza-screens.jsx,
// S3HeadTicket — the chosen default): a slim 138px producer-hued cover band
// (SKU/producer eyebrow only), then on cream — Syne title + tagline, the
// receipt-ticket price card ("LOCKS AT REQUEST" mono eyebrow, 36px Syne
// price, sessions/deposit column), producer mini row, bare-row includes
// with a duration/revisions meta line, the payment-plan hint card with
// per-plan chips, and the dark price-lock note. A collapsing StickyNav
// catches the status bar; the amber CTA is pinned low and thumb-reachable.
//
// Data-only props (serializable from the server page). When the artist
// already has a request in review, the CTA is disabled — one open purchase
// per studio (Gate 1).

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, ClockIcon, LockIcon } from "~/components/artist/funnel/funnel-icons";
import { Eyebrow, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { StickyNav } from "~/components/artist/sticky-nav";
import {
  coverGradient,
  formatPurchaseMoney,
  type Producer,
  type PurchaseProduct,
  swatchGradient,
} from "./purchase-data";
import { planKey } from "~/components/checkout/plan-picker-helpers";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import type { PaymentPlan } from "@skitza/db";

const PLAN_CHIP_LABELS: Record<
  PaymentPlan["kind"],
  (plan: PaymentPlan, priceCents: number, currency: string) => string
> = {
  full: (_plan, price, currency) =>
    `Full · ${formatPurchaseMoney(price, currency)}`,
  split_50_50: (_plan, price, currency) =>
    `50/50 · ${formatPurchaseMoney(Math.ceil(price / 2), currency)} first`,
  monthly: (plan) =>
    plan.kind === "monthly" ? `${String(plan.installments)} monthly payments` : "Monthly",
};

function PlanChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-[var(--radius-sm)] border px-2.5 py-[5px] font-mono text-[10px] font-semibold tracking-[0.06em]"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-control))",
        color: "rgb(var(--fg-secondary))",
      }}
    >
      {children}
    </span>
  );
}

export function ProductDetailScreen({
  product,
  producer,
  productId,
  pendingRequest = false,
  previewAgreeHref,
}: {
  product: PurchaseProduct;
  producer: Producer;
  productId: string;
  pendingRequest?: boolean;
  /** Dev-gallery navigation only; real routes derive this from productId. */
  previewAgreeHref?: string | undefined;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const royalty = royaltyTermsDisplay(product.royaltyTerms);

  return (
    <div
      ref={scrollRef}
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <StickyNav
        title={product.name}
        sub={producer.name || undefined}
        onBack={() => {
          router.push("/artist/store");
        }}
        scrollContainerRef={scrollRef}
        className="max-w-[440px]"
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        {/* slim cover band — producer-hued sleeve fading into the canvas */}
        <div
          className="relative h-[138px] overflow-hidden"
          style={{ background: coverGradient(producer.hue) }}
        >
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgb(17 16 9 / 0.18), transparent 50%, rgb(var(--bg-background)) 100%)",
            }}
          />
          <span className="label-eyebrow absolute bottom-3 left-[18px] text-white/80">
            {(producer.name || "Producer").toUpperCase()}
          </span>
        </div>

        {/* active-purchase banner — the slot stays occupied until paid in full */}
        {pendingRequest ? (
          <div
            className="sk-rise mx-5 mt-3.5 flex items-start gap-2.5 rounded-[14px] border px-3.5 py-3"
            style={{
              background: "rgb(var(--brand-primary) / 0.1)",
              borderColor: "rgb(var(--brand-primary) / 0.26)",
            }}
          >
            <span className="mt-px text-[rgb(var(--brand-primary-text))]">
              <ClockIcon />
            </span>
            <span className="text-[12.5px] leading-normal text-[rgb(var(--brand-primary-text))]">
              You already have an active purchase with {producer.name || "this studio"}. You can
              start another once it is fully paid.
            </span>
          </div>
        ) : null}

        {/* ticket head — title + tagline + receipt price card */}
        <div className="px-5 pt-[18px]">
          <h1 className="sk-rise break-words font-syne text-[26px] leading-[1.1] font-extrabold tracking-[-0.035em] [overflow-wrap:anywhere] [text-wrap:pretty] text-[rgb(var(--fg-default))]">
            {product.name}
          </h1>
          {product.tagline ? (
            <p
              className="sk-rise mt-2.5 text-[14px] leading-normal text-[rgb(var(--fg-secondary))]"
              style={{ animationDelay: "40ms" }}
            >
              {product.tagline}
            </p>
          ) : null}
          <div
            className="sk-rise mt-4 flex items-center justify-between rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] px-[18px] py-4"
            style={{
              animationDelay: "70ms",
              borderColor: "rgb(var(--border-subtle))",
              boxShadow: "0 10px 28px -18px rgb(17 16 9 / 0.25)",
            }}
          >
            <div>
              <span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
                <LockIcon />
                Locks at request
              </span>
              <div className="font-syne mt-1.5 text-[36px] leading-none font-extrabold tracking-[-0.04em] text-[rgb(var(--fg-default))]">
                {formatPurchaseMoney(product.priceCents, product.currency)}
              </div>
            </div>
            <div className="text-right font-mono text-[10px] leading-[1.7] text-[rgb(var(--fg-muted))]">
              <div>
                {product.sessions > 1 ? `${String(product.sessions)} sessions` : "1 project"}
              </div>
              <div>{product.durationLabel}</div>
            </div>
          </div>
        </div>

        {/* producer mini row */}
        <div className="px-5 pt-[18px]">
          <div
            className="sk-rise flex items-center gap-3 rounded-[14px] border bg-[rgb(var(--bg-elevated))] px-3.5 py-3"
            style={{
              animationDelay: "100ms",
              borderColor: "rgb(var(--border-subtle))",
            }}
          >
            <span
              className="font-syne flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[13px] font-extrabold text-white"
              style={{ background: swatchGradient(producer.hue) }}
            >
              {producer.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                {producer.name}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
                Reviews every request personally
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                router.push("/artist/store");
              }}
              className="sk-press-row -my-3 inline-flex min-h-11 shrink-0 items-center px-2 text-[12.5px] font-semibold text-[rgb(var(--brand-primary-text))]"
            >
              Store
            </button>
          </div>
        </div>

        {/* what's included — bare amber-check rows + meta line */}
        {product.includes.length > 0 ? (
          <div className="sk-rise px-5 pt-5" style={{ animationDelay: "140ms" }}>
            <h2 className="mb-3">
              <Eyebrow>What&apos;s included</Eyebrow>
            </h2>
            <ul className="flex list-none flex-col gap-[11px]">
              {product.includes.map((line) => (
                <li key={line} className="flex items-start gap-[11px]">
                  <span
                    className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: "rgb(var(--brand-primary) / 0.14)",
                      color: "rgb(var(--brand-primary-text))",
                    }}
                  >
                    <Check width={12} height={12} />
                  </span>
                  <span className="text-[14px] leading-normal text-[rgb(var(--fg-secondary))]">
                    {line}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-[18px] text-[12.5px] text-[rgb(var(--fg-muted))]">
              <span className="inline-flex items-center gap-1.5">
                <ClockIcon />
                {product.durationLabel}
              </span>
              {product.revisions > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check width={13} height={13} />
                  {String(product.revisions)} revisions
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* concise product-level headline terms, visible before request */}
        <section className="sk-rise px-5 pt-5" style={{ animationDelay: "165ms" }}>
          <h2>
            <Eyebrow>Rights & royalties</Eyebrow>
          </h2>
          <dl className="mt-2.5 grid gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-4 py-3.5 text-[13px]">
            <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
              <dt className="font-semibold text-[rgb(var(--fg-muted))]">Master</dt>
              <dd className="min-w-0 break-words text-pretty text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">
                {royalty.master}
              </dd>
            </div>
            <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
              <dt className="font-semibold text-[rgb(var(--fg-muted))]">Composition</dt>
              <dd className="min-w-0 break-words text-pretty text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">
                {royalty.composition}
              </dd>
            </div>
          </dl>
          {product.royaltyTerms?.notes ? (
            <p className="mt-2 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))] [overflow-wrap:anywhere]">
              {product.royaltyTerms.notes}
            </p>
          ) : null}
        </section>

        {/* payment-plan hint card with chips */}
        <div className="sk-rise px-5 pt-5" style={{ animationDelay: "180ms" }}>
          <div
            className="rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] p-4"
            style={{ borderColor: "rgb(var(--border-subtle))" }}
          >
            <div className="flex items-center justify-between">
              <h2>
                <Eyebrow>Payment</Eyebrow>
              </h2>
              <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2 py-1 font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                Pick after approval
              </span>
            </div>
            <p className="mt-2.5 text-[13.5px] leading-normal text-[rgb(var(--fg-secondary))]">
              These are the payment choices offered with this product. The artist picks after
              approval; Skitza freezes this list when the request is sent.
            </p>
            <ul className="mt-3 flex list-none flex-wrap gap-[7px]">
              {product.paymentPlans.map((plan) => (
                <li key={planKey(plan)}>
                  <PlanChip>
                    {PLAN_CHIP_LABELS[plan.kind](
                      plan,
                      product.priceCents,
                      product.currency,
                    )}
                  </PlanChip>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* dark price-lock note */}
        <div className="sk-rise px-5 pt-3.5" style={{ animationDelay: "220ms" }}>
          <div
            className="flex items-start gap-[11px] rounded-[var(--radius-lg)] px-[15px] py-[13px]"
            style={{
              background: "rgb(var(--bg-sidebar))",
              color: "rgb(var(--fg-onsidebar))",
            }}
          >
            <span className="mt-px text-[rgb(var(--brand-primary))]">
              <LockIcon />
            </span>
            <span className="text-[12.5px] leading-[1.55]">
              Your price locks now —{" "}
              <b className="font-bold text-white">
                {formatPurchaseMoney(product.priceCents, product.currency)}
              </b>{" "}
              stays
              fixed once you request. No money moves yet; this just sends a request to{" "}
              {producer.name || "the producer"}.
            </span>
          </div>
        </div>

        <div className="flex-1 pb-[170px]" />

        {/* pinned action — cream fade over a solid backdrop */}
        <div className="sticky bottom-0 z-10">
          <div
            aria-hidden
            className="pointer-events-none h-7"
            style={{
              background:
                "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background)) 100%)",
            }}
          />
          <div
            className="sk-safe-bottom px-[18px] pb-3.5"
            style={{ background: "rgb(var(--bg-background))" }}
          >
            <PrimaryCta
              onClick={() => {
                router.push(previewAgreeHref ?? `/artist/purchase/${productId}/agree`);
              }}
              disabled={pendingRequest}
              glow={!pendingRequest}
              sub={
                pendingRequest
                  ? "You have an active purchase — finish paying that first."
                  : "Price locks now · no payment yet"
              }
            >
              Request to book <ArrowRight />
            </PrimaryCta>
          </div>
        </div>
      </div>
    </div>
  );
}
