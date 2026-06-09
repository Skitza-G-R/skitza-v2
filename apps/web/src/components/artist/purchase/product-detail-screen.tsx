"use client";

// S3 — Product detail + "Request to book" (artist purchase funnel · ENTRY).
//
// The funnel's front door. The artist lands here from the store, reads what
// the offer covers, sees the price (which LOCKS the moment they request), and
// kicks off the purchase. The primary action routes to S4 (Review & agree),
// where the request actually fires Gate 1. No payment happens here — this is
// just the considered "yes, this is the offer I want" beat.
//
// Editorial layout (matches proto-s3): a warm producer-hued cover band tops
// the screen with the "Featured" eyebrow + Syne title + blurb sitting on it;
// the cream canvas below carries the big ₪ price (JetBrains Mono), the
// producer card with a "Booked" badge, and the amber-check WHAT'S INCLUDED
// list on an 18px card. The amber action is pinned low and thumb-reachable.
//
// Data-only props (serializable from the server page). Navigation lives here
// so the mock can be swapped for the BE-1 product snapshot without touching
// the route. When the artist already has a request in review, the CTA is
// disabled — they can browse, but can't start a second purchase (Gate 1).

import { useRouter } from "next/navigation";

import { ArrowRight, Check, LockIcon } from "~/components/artist/funnel/funnel-icons";
import { Eyebrow, FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import {
  coverGradient,
  formatShekels,
  type Producer,
  type PurchaseProduct,
  swatchGradient,
} from "./purchase-data";

export function ProductDetailScreen({
  product,
  producer,
  productId,
  pendingRequest = false,
}: {
  product: PurchaseProduct;
  producer: Producer;
  productId: string;
  pendingRequest?: boolean;
}) {
  const router = useRouter();

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        <FunnelTopBar
          title={producer.name || "Book a session"}
          sub="THE OFFER"
          onBack={() => {
            router.push("/artist/store");
          }}
        />

        {/* warm producer-hued cover band — "Featured" eyebrow + Syne title sit on it */}
        <div
          className="relative px-5 pb-[26px] pt-5"
          style={{ background: coverGradient(producer.hue) }}
        >
          <span
            className="sk-rise inline-flex items-center rounded-full px-2.5 py-[5px] font-mono text-[9.5px] font-bold uppercase tracking-[0.16em]"
            style={{
              background: "rgb(255 255 255 / 0.82)",
              color: "rgb(var(--brand-primary-dark))",
              boxShadow: "0 2px 8px rgb(17 16 9 / 0.12)",
            }}
          >
            Featured
          </span>
          <h1
            className="sk-rise mt-3 font-syne text-[30px] font-extrabold leading-[1.06] tracking-[-0.04em] text-white"
            style={{ animationDelay: "40ms", textShadow: "0 1px 14px rgb(17 16 9 / 0.22)" }}
          >
            {product.name}
          </h1>
          <p
            className="sk-rise mt-2 max-w-[300px] text-[13.5px] leading-snug text-white/85"
            style={{ animationDelay: "70ms" }}
          >
            What this booking covers, start to finish — set with {producer.name}.
          </p>
        </div>

        <div className="flex-1 px-5 pb-[200px] pt-5">
          {/* locked price — JetBrains Mono amount */}
          <div className="sk-rise" style={{ animationDelay: "100ms" }}>
            <span className="inline-flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--brand-primary-dark))]">
              <LockIcon />
              PRICE LOCKS WHEN YOU REQUEST
            </span>
            <div className="mt-1.5 flex items-end gap-3">
              <span className="font-amount text-[42px] font-extrabold leading-none tracking-[-0.04em] text-[rgb(var(--fg-default))]">
                {formatShekels(product.priceCents)}
              </span>
              <span className="mb-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
                {product.durationLabel}
              </span>
            </div>
          </div>

          {/* producer card with "Booked" badge */}
          <div
            className="sk-rise mt-6 flex items-center gap-[13px] rounded-card px-4 py-3.5"
            style={{
              animationDelay: "140ms",
              background: "rgb(var(--bg-elevated))",
              border: "1px solid rgb(var(--border-subtle))",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <span
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full font-syne text-[14px] font-extrabold text-white"
              style={{ background: swatchGradient(producer.hue) }}
            >
              {producer.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-syne text-[15.5px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                {producer.name}
              </div>
              <div className="mt-px text-[12.5px] text-[rgb(var(--fg-muted))]">
                Reviews every request personally
              </div>
            </div>
            <span
              className="shrink-0 rounded-full px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]"
              style={{
                background: "rgb(var(--brand-primary) / 0.14)",
                color: "rgb(var(--brand-primary-dark))",
              }}
            >
              Booked
            </span>
          </div>

          {/* what's included — amber-check list on an 18px card. Hidden when
              the producer hasn't filled deliverables (real BE-1 data). */}
          {product.includes.length > 0 ? (
          <div className="sk-rise mt-6" style={{ animationDelay: "180ms" }}>
            <Eyebrow className="mb-[11px]">What&apos;s included</Eyebrow>
            <div
              className="rounded-card px-[18px] py-[7px]"
              style={{
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              {product.includes.map((item, i) => (
                <div
                  key={item}
                  className="flex items-start gap-[11px] py-3"
                  style={{
                    borderBottom:
                      i === product.includes.length - 1
                        ? "none"
                        : "1px solid rgb(var(--border-subtle))",
                  }}
                >
                  <span
                    className="mt-px flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: "rgb(var(--brand-primary) / 0.14)",
                      color: "rgb(var(--brand-primary-dark))",
                    }}
                  >
                    <Check width={12} height={12} />
                  </span>
                  <span className="text-[14px] leading-snug text-[rgb(var(--fg-secondary))]">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
          ) : null}

          {/* payment-plan hint */}
          <div
            className="sk-rise mt-[18px] flex items-center gap-2 text-[12.5px] text-[rgb(var(--fg-muted))]"
            style={{ animationDelay: "220ms" }}
          >
            <LockIcon />
            <span>Full, or a plan — set after approval.</span>
          </div>
        </div>

        {/* pinned action — fades the scrolling content beneath it */}
        <div
          className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pb-3.5 pt-3.5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
          }}
        >
          <div className="mb-2.5 flex items-center justify-between px-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            <span>Payment</span>
            <span>Set after approval</span>
          </div>
          <PrimaryCta
            onClick={() => {
              router.push(`/artist/purchase/${productId}/agree`);
            }}
            disabled={pendingRequest}
            glow={!pendingRequest}
            sub={
              pendingRequest
                ? "You have a request in review — finish that first."
                : "Price locks — no payment yet."
            }
          >
            Request to book <ArrowRight />
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
