"use client";

// S4 — Review and send a pre-acceptance request.
//
// The artist reads the proposed commercial terms and optional agreement link,
// confirms they reviewed the proposal, and sends the request. Final acceptance
// happens later at the Purchase boundary. Funnel chrome: full-screen overlay,
// back arrow, no tab bar, the primary action pinned low and thumb-reachable.
//
// Data-only props (serializable from the server page). Navigation + the
// request call live here so the mock can be swapped for the BE-1
// `artist.purchase.request` mutation without touching the route.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ArrowRight,
  Check,
  DocIcon,
  LockIcon,
  ShieldIcon,
} from "~/components/artist/funnel/funnel-icons";
import {
  AgreeCheck,
  Eyebrow,
  FunnelTopBar,
  PrimaryCta,
} from "~/components/artist/funnel/funnel-ui";
import { requestToBookAction } from "./actions";
import { planKey, requestPlanLabel } from "~/components/checkout/plan-picker-helpers";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import {
  type AgreementTerm,
  formatPurchaseMoney,
  type Producer,
  type PurchaseProduct,
  swatchGradient,
} from "./purchase-data";

export function ReviewAgreeScreen({
  product,
  producer,
  terms,
  previewSentHref,
}: {
  product: PurchaseProduct;
  producer: Producer;
  terms: AgreementTerm[];
  /** Dev-gallery navigation only; production always creates the request first. */
  previewSentHref?: string | undefined;
}) {
  const router = useRouter();
  const [reviewed, setReviewed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationKeyRef = useRef<string | null>(null);
  const royalty = royaltyTermsDisplay(product.royaltyTerms);

  async function send() {
    if (!reviewed || sending) return;
    setSending(true);
    setError(null);
    if (previewSentHref) {
      router.push(previewSentHref);
      return;
    }
    try {
      const operationKey = operationKeyRef.current ?? crypto.randomUUID();
      operationKeyRef.current = operationKey;
      // `artist.purchase.request` stores intent only and returns the ref shown on S5.
      const res = await requestToBookAction({
        productId: product.id,
        operationKey,
      });
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
          title="Review request"
          sub="BOOKING TERMS"
          onBack={() => {
            router.push(`/artist/purchase/${product.id}`);
          }}
        />

        <div className="flex-1 px-5 pt-3.5 pb-[184px]">
          {/* heading */}
          <h1 className="reveal-up font-syne text-[26px] leading-[1.1] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            Before we send&nbsp;it
          </h1>
          <p className="reveal-up reveal-up-delay-1 mt-2 text-[14px] leading-relaxed text-pretty text-[rgb(var(--fg-muted))]">
            {producer.agreement
              ? `Review the proposed commercial terms below, including ${producer.name}'s agreement link.`
              : `Here's the current proposal for working with ${producer.name}.`}
          </p>

          {/* Current proposal summary. Final terms are accepted later. */}
          <div
            className="reveal-up reveal-up-delay-1 rounded-card mt-4 flex items-center gap-[13px] px-4 py-3.5"
            style={{ background: "rgb(var(--bg-sidebar))", color: "rgb(var(--fg-onsidebar))" }}
          >
            <span
              className="font-syne flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] text-[14px] font-extrabold text-white"
              style={{ background: swatchGradient(producer.hue) }}
            >
              {producer.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold [overflow-wrap:anywhere] break-words text-white">
                {product.name}
              </div>
              <div className="mt-px text-[12px] text-white/70">
                with {producer.name} · {product.durationLabel}
              </div>
            </div>
            <div className="text-right">
              <div className="font-amount text-[19px] font-extrabold tracking-[-0.03em] text-[rgb(var(--brand-primary))]">
                {formatPurchaseMoney(product.priceCents, product.currency)}
              </div>
              <div className="font-mono text-[8.5px] tracking-[0.08em] text-white/55">PROPOSAL</div>
            </div>
          </div>

          {/* Live pre-acceptance payment and royalty proposal. */}
          <section
            className="reveal-up reveal-up-delay-2 mt-4"
            aria-labelledby="commercial-terms-heading"
          >
            <h2 id="commercial-terms-heading" className="mb-[9px]">
              <Eyebrow>Rights & royalties</Eyebrow>
            </h2>
            <dl className="rounded-card bg-[rgb(var(--bg-elevated))] px-4 py-1 ring-1 shadow-[var(--shadow-sm)] ring-[rgb(var(--border-subtle))]">
              <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-b border-[rgb(var(--border-subtle))] py-3">
                <dt className="text-[12px] font-semibold text-[rgb(var(--fg-muted))]">Master</dt>
                <dd className="min-w-0 text-[13px] text-pretty [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                  {royalty.master}
                </dd>
              </div>
              <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-3">
                <dt className="text-[12px] font-semibold text-[rgb(var(--fg-muted))]">
                  Composition
                </dt>
                <dd className="min-w-0 text-[13px] text-pretty [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                  {royalty.composition}
                </dd>
              </div>
            </dl>
            {product.royaltyTerms?.notes ? (
              <p className="mt-2 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-4 py-3 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                {product.royaltyTerms.notes}
              </p>
            ) : null}
          </section>

          <section
            className="reveal-up reveal-up-delay-2 mt-4"
            aria-labelledby="payment-options-heading"
          >
            <h2 id="payment-options-heading" className="mb-[9px]">
              <Eyebrow>Payment choices</Eyebrow>
            </h2>
            <ul className="rounded-card list-none divide-y divide-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 ring-1 shadow-[var(--shadow-sm)] ring-[rgb(var(--border-subtle))]">
              {product.paymentPlans.map((plan) => (
                <li
                  key={planKey(plan)}
                  className="py-3 text-[13px] leading-snug text-[rgb(var(--fg-secondary))]"
                >
                  {requestPlanLabel(plan, product.priceCents, (cents) =>
                    formatPurchaseMoney(cents, product.currency),
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
              You choose one after the producer approves this request.
            </p>
          </section>

          {product.agreementText ? (
            <section
              className="reveal-up reveal-up-delay-2 mt-4"
              aria-labelledby="inline-agreement-heading"
            >
              <h2 id="inline-agreement-heading" className="mb-[9px]">
                <Eyebrow>Producer agreement</Eyebrow>
              </h2>
              <div className="rounded-card bg-[rgb(var(--bg-elevated))] px-4 py-3.5 ring-1 shadow-[var(--shadow-sm)] ring-[rgb(var(--border-subtle))]">
                <p className="text-[13px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                  {product.agreementText}
                </p>
              </div>
            </section>
          ) : null}

          {/* Producer-authored agreement link — may be a PDF or web page. */}
          {producer.agreement ? (
            <div className="reveal-up reveal-up-delay-2 mt-4">
              <h2 className="mb-[9px]">
                <Eyebrow>
                  <DocIcon aria-hidden="true" />
                  {producer.name}&apos;s agreement link
                </Eyebrow>
              </h2>
              <div
                className="rounded-card flex w-full items-center gap-3.5 px-4 py-3.5"
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
                    color: "rgb(var(--brand-primary-text))",
                  }}
                >
                  <DocIcon width={22} height={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                    {producer.agreement.filename}
                  </div>
                  <div className="mt-[3px] font-mono text-[10.5px] tracking-[0.02em] text-[rgb(var(--fg-muted))]">
                    {producer.agreement.kind === "pdf" ? "PDF" : "LINK"} · provided by{" "}
                    {producer.name}
                  </div>
                </div>
                {producer.agreement.url ? (
                  /* open affordance — near-black pill, amber "View" (proto-s4) */
                  <a
                    href={producer.agreement.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sk-press inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-lg)] px-[18px] py-2 text-[13.5px] font-bold"
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
                <span>
                  Open this reference and review it together with the exact terms on this page.
                </span>
              </div>
            </div>
          ) : null}

          {/* plain-language terms — one natural page scroll on mobile */}
          <div className="reveal-up reveal-up-delay-3 mt-[18px]">
            <h2 className="mb-[9px]">
              <Eyebrow>Plain-language summary</Eyebrow>
            </h2>
            <div
              className="rounded-card relative"
              style={{
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <ol className="list-none px-[18px] pt-1 pb-2">
                {terms.map((term, i) => (
                  <li
                    key={term.heading}
                    className="sk-rise py-3.5"
                    style={{
                      animationDelay: `${String(40 + i * 45)}ms`,
                      borderBottom:
                        i === terms.length - 1 ? "none" : "1px solid rgb(var(--border-subtle))",
                    }}
                  >
                    <div className="flex items-center gap-[9px]">
                      <span className="font-mono text-[10px] font-bold text-[rgb(var(--brand-primary-text))]">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className="font-syne text-[14.5px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                        {term.heading}
                      </h3>
                    </div>
                    <p className="mt-[7px] text-[13px] leading-relaxed text-pretty text-[rgb(var(--fg-secondary))]">
                      {term.body}
                    </p>
                    {term.points ? (
                      <ul className="mt-[9px] flex list-none flex-col gap-1.5">
                        {term.points.map((point) => (
                          <li key={point} className="flex items-start gap-2">
                            <span
                              className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                              style={{
                                background: "rgb(var(--brand-primary) / 0.14)",
                                color: "rgb(var(--brand-primary-text))",
                              }}
                            >
                              <Check width={11} height={11} />
                            </span>
                            <span className="text-[12.5px] leading-snug text-[rgb(var(--fg-secondary))]">
                              {point}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-[9px] flex items-center gap-1.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
              <LockIcon />
              <span>Final terms are accepted and frozen only when a Purchase is created.</span>
            </div>
          </div>

          {/* review acknowledgement; this is not final commercial acceptance */}
          <div className="reveal-up reveal-up-delay-4 mt-4">
            <AgreeCheck
              checked={reviewed}
              onToggle={() => {
                setReviewed((value) => !value);
              }}
            >
              I&apos;ve reviewed the proposed price, payment choices, rights, and agreement terms.
            </AgreeCheck>
          </div>
        </div>

        {/* pinned action — fades the scrolling content beneath it */}
        <div
          className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pt-3.5 pb-3.5"
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
                color: "rgb(var(--fg-danger-text))",
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
            disabled={!reviewed || sending}
            glow={reviewed && !sending}
            ariaBusy={sending}
            sub={reviewed ? "Sends request to " + producer.name : "Review above to continue"}
          >
            {sending ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 motion-reduce:animate-none"
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
