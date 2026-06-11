"use client";

// S4 — Review & agree (artist purchase funnel · Commit).
//
// The artist reads the plain-language booking terms (the binding PDF is
// linked above the summary), ticks a single "I've read & agree" box, and
// sends the request. Sending fires Gate 1 (the producer reviews) and routes
// to S5. Funnel chrome: full-screen overlay, back arrow, no tab bar, the
// primary action pinned low and thumb-reachable.
//
// Data-only props (serializable from the server page). Navigation + the
// request call live here so the mock can be swapped for the BE-1
// `artist.purchase.request` mutation without touching the route.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, DocIcon, LockIcon, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import {
  AgreeCheck,
  Eyebrow,
  FunnelTopBar,
  PrimaryCta,
} from "~/components/artist/funnel/funnel-ui";
import { requestToBookAction } from "./actions";
import {
  type AgreementTerm,
  formatShekels,
  type Producer,
  type PurchaseProduct,
  swatchGradient,
} from "./purchase-data";

export function ReviewAgreeScreen({
  product,
  producer,
  terms,
}: {
  product: PurchaseProduct;
  producer: Producer;
  terms: AgreementTerm[];
}) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!agreed || sending) return;
    setSending(true);
    setError(null);
    try {
      // BE-1's `artist.purchase.request` (via server action). Locks the
      // price, creates the pending request, returns the ref shown on S5.
      const res = await requestToBookAction({ productId: product.id });
      if (res.ok) {
        router.push(`/artist/purchase/${product.id}/sent?req=${res.purchaseRequestId}`);
        return;
      }
      setSending(false);
      setError(res.error);
    } catch {
      setSending(false);
      setError("Couldn't send your request. Check your connection and try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        <FunnelTopBar
          title="Review & agree"
          sub="BOOKING TERMS"
          onBack={() => {
            router.push(`/artist/purchase/${product.id}`);
          }}
        />

        <div className="flex-1 px-5 pb-[184px] pt-3.5">
          {/* heading */}
          <h1 className="reveal-up font-syne text-[26px] font-extrabold leading-[1.1] tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            Before we send&nbsp;it
          </h1>
          <p className="reveal-up reveal-up-delay-1 mt-2 text-pretty text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {producer.agreement
              ? `Here's the plain-language version of your booking terms. ${producer.name}'s full signed agreement is attached as a PDF below.`
              : `Here's the plain-language version of your booking terms with ${producer.name}.`}
          </p>

          {/* what you're agreeing to — dark price-locked summary */}
          <div
            className="reveal-up reveal-up-delay-1 mt-4 flex items-center gap-[13px] rounded-card px-4 py-3.5"
            style={{ background: "rgb(var(--bg-sidebar))", color: "rgb(var(--fg-inverse))" }}
          >
            <span
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] font-syne text-[14px] font-extrabold text-white"
              style={{ background: swatchGradient(producer.hue) }}
            >
              {producer.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold text-white">{product.name}</div>
              <div className="mt-px text-[12px] text-white/70">
                with {producer.name} · {product.durationLabel}
              </div>
            </div>
            <div className="text-right">
              <div className="font-amount text-[19px] font-extrabold tracking-[-0.03em] text-[rgb(var(--brand-primary))]">
                {formatShekels(product.priceCents)}
              </div>
              <div className="font-mono text-[8.5px] tracking-[0.08em] text-white/55">LOCKS NOW</div>
            </div>
          </div>

          {/* producer-uploaded binding PDF — hidden when none is uploaded */}
          {producer.agreement ? (
            <div className="reveal-up reveal-up-delay-2 mt-4">
              <Eyebrow className="mb-[9px]">
                <DocIcon />
                {producer.name}&apos;s full agreement
              </Eyebrow>
              <div
                className="flex w-full items-center gap-3.5 rounded-card px-4 py-3.5"
                style={{
                  background: "rgb(var(--bg-elevated))",
                  border: "1px solid rgb(var(--border-subtle))",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <span
                  className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[12px]"
                  style={{
                    background: "rgb(var(--brand-primary) / 0.14)",
                    color: "rgb(var(--brand-primary-dark))",
                  }}
                >
                  <DocIcon width={22} height={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                    {producer.agreement.filename}
                  </div>
                  <div className="mt-[3px] font-mono text-[10.5px] tracking-[0.02em] text-[rgb(var(--fg-muted))]">
                    PDF · uploaded by {producer.name}
                  </div>
                </div>
                {producer.agreement.url ? (
                  /* open affordance — near-black pill, amber "View" (proto-s4) */
                  <a
                    href={producer.agreement.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sk-press inline-flex shrink-0 items-center rounded-full px-[18px] py-2 text-[13.5px] font-bold"
                    style={{
                      background: "rgb(var(--bg-sidebar))",
                      color: "rgb(var(--brand-primary))",
                    }}
                  >
                    View
                  </a>
                ) : null}
              </div>
              <div className="mt-[9px] flex items-start gap-1.5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                <span className="mt-px">
                  <ShieldIcon />
                </span>
                <span>The PDF is the binding document. The summary below is for easy reading.</span>
              </div>
            </div>
          ) : null}

          {/* scrollable plain-language terms */}
          <div className="reveal-up reveal-up-delay-3 mt-[18px]">
            <Eyebrow className="mb-[9px]">Plain-language summary</Eyebrow>
            <div
              className="relative rounded-card"
              style={{
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div className="max-h-[256px] overflow-y-auto px-[18px] pb-2 pt-1">
                {terms.map((term, i) => (
                  <div
                    key={term.heading}
                    className="sk-rise py-3.5"
                    style={{
                      animationDelay: `${String(40 + i * 45)}ms`,
                      borderBottom:
                        i === terms.length - 1
                          ? "none"
                          : "1px solid rgb(var(--border-subtle))",
                    }}
                  >
                    <div className="flex items-center gap-[9px]">
                      <span className="font-mono text-[10px] font-bold text-[rgb(var(--brand-primary-dark))]">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-syne text-[14.5px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                        {term.heading}
                      </span>
                    </div>
                    <p className="mt-[7px] text-pretty text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
                      {term.body}
                    </p>
                    {term.points ? (
                      <div className="mt-[9px] flex flex-col gap-1.5">
                        {term.points.map((point) => (
                          <div key={point} className="flex items-start gap-2">
                            <span
                              className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                              style={{
                                background: "rgb(var(--brand-primary) / 0.14)",
                                color: "rgb(var(--brand-primary-dark))",
                              }}
                            >
                              <Check width={11} height={11} />
                            </span>
                            <span className="text-[12.5px] leading-snug text-[rgb(var(--fg-secondary))]">
                              {point}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              {/* fade hint that the card scrolls */}
              <div
                className="pointer-events-none absolute inset-x-px bottom-px h-7 rounded-b-[17px]"
                style={{
                  background:
                    "linear-gradient(180deg, rgb(var(--bg-elevated) / 0), rgb(var(--bg-elevated) / 0.95))",
                }}
              />
            </div>
            <div className="mt-[9px] flex items-center gap-1.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
              <LockIcon />
              <span>Saved with a timestamp once you agree.</span>
            </div>
          </div>

          {/* agree */}
          <div className="reveal-up reveal-up-delay-4 mt-4">
            <AgreeCheck
              checked={agreed}
              onToggle={() => {
                setAgreed((v) => !v);
              }}
            >
              {producer.agreement
                ? "I've read the agreement (PDF) and agree to these terms."
                : "I've read and agree to these terms."}
            </AgreeCheck>
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
          {error ? (
            <p
              className="mb-2.5 rounded-[12px] px-3.5 py-2.5 text-center text-[12.5px] font-medium"
              style={{
                background: "rgb(var(--fg-danger) / 0.1)",
                color: "rgb(var(--fg-danger))",
              }}
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <PrimaryCta
            onClick={() => {
              void send();
            }}
            disabled={!agreed || sending}
            glow={agreed && !sending}
            sub={agreed ? "Locks your price · sends to " + producer.name : "Agree above to continue"}
          >
            {sending ? (
              <>
                <span
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2"
                  style={{
                    borderColor: "rgb(var(--bg-sidebar) / 0.3)",
                    borderTopColor: "rgb(var(--bg-sidebar))",
                  }}
                />
                Sending…
              </>
            ) : (
              <>
                Send request <ArrowRight />
              </>
            )}
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
