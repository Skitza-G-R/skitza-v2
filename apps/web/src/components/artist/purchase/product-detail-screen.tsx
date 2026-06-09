"use client";

// S3 — Product detail + "Request to book" (artist purchase funnel · ENTRY).
//
// The funnel's front door. The artist lands here from the store, reads what
// the offer covers, sees the price (which LOCKS the moment they request), and
// kicks off the purchase. The primary action routes to S4 (Review & agree),
// where the request actually fires Gate 1. No payment happens here — this is
// just the considered "yes, this is the offer I want" beat.
//
// Funnel chrome: full-screen overlay, back arrow → the producer's store, no
// tab bar, the primary action pinned low and thumb-reachable.
//
// Data-only props (serializable from the server page). Navigation lives here
// so the mock can be swapped for the BE-1 product snapshot without touching
// the route. When the artist already has a request in review, the CTA is
// disabled — they can browse, but can't start a second purchase (Gate 1).

import { useRouter } from "next/navigation";

import { ArrowRight, Check, LockIcon, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import { Eyebrow, FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import {
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

        <div className="flex-1 px-5 pb-[184px] pt-3.5">
          {/* product name + locked price */}
          <h1 className="reveal-up font-syne text-[30px] font-extrabold leading-[1.06] tracking-[-0.04em] text-[rgb(var(--fg-default))]">
            {product.name}
          </h1>
          <p className="reveal-up reveal-up-delay-1 mt-1.5 text-[13.5px] text-[rgb(var(--fg-muted))]">
            {product.durationLabel}
          </p>

          <div className="reveal-up reveal-up-delay-1 mt-4 flex items-end gap-3">
            <span className="font-syne text-[40px] font-extrabold leading-none tracking-[-0.045em] text-[rgb(var(--fg-default))]">
              {formatShekels(product.priceCents)}
            </span>
            <span className="mb-1 inline-flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--brand-primary-dark))]">
              <LockIcon />
              PRICE LOCKS WHEN YOU REQUEST
            </span>
          </div>

          {/* what's included */}
          <div className="reveal-up reveal-up-delay-2 mt-7">
            <Eyebrow className="mb-[11px]">What&apos;s included</Eyebrow>
            <div
              className="rounded-[var(--radius-lg)] px-[18px] py-[7px]"
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

          {/* producer mini-row */}
          <div className="reveal-up reveal-up-delay-3 mt-[18px]">
            <Eyebrow className="mb-[11px]">Your producer</Eyebrow>
            <div
              className="flex items-center gap-[13px] rounded-[var(--radius-lg)] px-4 py-3.5"
              style={{
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
            </div>
          </div>

          {/* payment-plan hint */}
          <div className="reveal-up reveal-up-delay-4 mt-[14px] flex items-center gap-2 text-[12.5px] text-[rgb(var(--fg-muted))]">
            <ShieldIcon />
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
          <PrimaryCta
            onClick={() => {
              router.push(`/artist/purchase/${productId}/agree`);
            }}
            disabled={pendingRequest}
            glow={!pendingRequest}
            sub={
              pendingRequest
                ? "You have a request in review — finish that first."
                : `Sends a request — no payment yet. ${producer.name} reviews within 24h.`
            }
          >
            Request to book <ArrowRight />
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
