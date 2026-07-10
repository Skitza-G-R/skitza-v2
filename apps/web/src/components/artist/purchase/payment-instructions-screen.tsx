"use client";

// S8 — Payment instructions (artist purchase funnel · Pay).
//
// Payment in v1 is OFF-APP. After the producer approves (Gate 1) and the
// artist picks a plan (S7), this screen shows what's due now and exactly how
// to pay it — bank transfer or Bit — then sends them to upload their proof
// (S9). Money never moves inside the app; Skitza only keeps the record.
//
// Card pay is v2 (Tranzila), shown here as a greyed, inert "coming soon" row.
//
// Data-only props come from the locked request and the producer's real
// payment settings. Navigation + clipboard copy live here.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import { Eyebrow, FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { formatShekels } from "./pay-data";

// The producer's off-app payment details. Absent → "will send details".
export type PaymentDetails = {
  bankTransfer?: string | undefined;
  bitPhone?: string | undefined;
  note?: string | undefined;
};

// Inline copy glyph — kept local so the shared icon set stays untouched
// (mirrors UploadGlyph in upload-proof-screen.tsx).
function CopyGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15H4.5A1.5 1.5 0 013 13.5v-9A1.5 1.5 0 014.5 3h9A1.5 1.5 0 0115 4.5V5" />
    </svg>
  );
}

// Small inline copy control — writes one value to the clipboard and flips to a
// brief "Copied" confirmation. Kept inline (not a shared atom) per the brief.
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  function copyWithSelection(): boolean {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    // Deprecated but still the only broadly supported fallback when the
    // async Clipboard API is denied inside an embedded mobile browser.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }

  async function copy() {
    let copied = false;
    try {
      // Some embedded browsers expose the API but leave its promise pending.
      // Bound the wait so the selection fallback always gets a chance.
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Clipboard timed out"));
          }, 600);
        }),
      ]);
      copied = true;
    } catch {
      copied = copyWithSelection();
    }
    setCopyState(copied ? "copied" : "failed");
    setTimeout(() => {
      setCopyState("idle");
    }, 1800);
  }

  return (
    <button
      type="button"
      onClick={() => {
        void copy();
      }}
      aria-label={`Copy ${label}`}
      className="sk-press inline-flex min-h-11 shrink-0 items-center gap-[5px] rounded-full px-3 font-mono text-[10.5px] font-bold tracking-[0.08em] uppercase transition-colors"
      style={
        copyState === "copied"
          ? {
              background: "rgb(var(--fg-success) / 0.14)",
              color: "rgb(var(--fg-success))",
            }
          : copyState === "failed"
            ? {
                background: "rgb(var(--fg-danger) / 0.1)",
                color: "rgb(var(--fg-danger))",
              }
            : {
                /* amber-tinted pill (proto-s8) */
                background: "rgb(var(--brand-primary) / 0.14)",
                color: "rgb(var(--brand-primary-dark))",
              }
      }
    >
      {copyState === "copied" ? (
        <>
          <Check width={11} height={11} />
          Copied
        </>
      ) : copyState === "failed" ? (
        <>Copy manually</>
      ) : (
        <>
          <CopyGlyph />
          Copy
        </>
      )}
    </button>
  );
}

// One label/value row inside the bank card, with its own copy control.
function PaymentDetailBlock({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9.5px] tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
          {label}
        </div>
        <div className="mt-1 font-mono text-[13.5px] leading-relaxed font-semibold break-words whitespace-pre-wrap text-[rgb(var(--fg-default))] tabular-nums">
          {value}
        </div>
      </div>
      <CopyButton value={value} label={copyLabel} />
    </div>
  );
}

export function PaymentInstructionsScreen({
  productId,
  purchaseRequestId,
  producerName,
  amountDueNowCents,
  paymentDetails,
  productName,
  planLabel,
  previewProofHref,
}: {
  productId: string;
  purchaseRequestId: string;
  producerName: string;
  amountDueNowCents: number;
  /** The producer's details, or null → they'll send them directly. */
  paymentDetails: PaymentDetails | null;
  /** Recap row in the dark amount card: "{productName} · {planLabel}". */
  productName?: string | undefined;
  /** Human label of the chosen plan (e.g. "Split 50 / 50"). */
  planLabel?: string | undefined;
  /** Dev-gallery navigation only; production routes derive S9 from the request id. */
  previewProofHref?: string | undefined;
}) {
  const router = useRouter();
  const hasPaymentDetails = Boolean(
    paymentDetails?.bankTransfer?.trim() || paymentDetails?.bitPhone?.trim(),
  );

  const goToProof = () => {
    if (previewProofHref) {
      router.push(previewProofHref);
      return;
    }
    router.push(`/artist/purchase/${productId}/pay/proof?req=${purchaseRequestId}`);
  };

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        <FunnelTopBar
          title="Payment"
          sub="OFF-APP · BANK OR BIT"
          onBack={() => {
            router.back();
          }}
        />

        <div className="flex-1 px-5 pt-3.5 pb-[184px]">
          <h1 className="sr-only">Payment instructions</h1>

          {/* amount due now — dark hero card (matches the prototype) */}
          <div
            className="sk-rise rounded-card px-[18px] pt-[15px] pb-[18px]"
            style={{
              background: "rgb(var(--bg-sidebar))",
              color: "rgb(var(--fg-inverse))",
              boxShadow: "0 18px 40px -16px rgb(17 16 9 / 0.45)",
            }}
          >
            <div className="font-mono text-[9.5px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary))] uppercase">
              Amount due now
            </div>
            <div className="font-amount mt-1.5 text-[42px] leading-none font-bold tracking-[-0.04em] text-white">
              {formatShekels(amountDueNowCents)}
            </div>
            {/* chosen-plan recap (proto-s8): "{product} · {plan}" */}
            {(productName ?? planLabel) ? (
              <div className="mt-2 truncate text-[12.5px] font-medium text-white/80">
                {[productName, planLabel].filter(Boolean).join(" · ")}
              </div>
            ) : null}
            <p className="mt-2 text-[12.5px] leading-snug text-white/55">
              Pay using your bank or Bit, then upload your proof.
            </p>
          </div>

          {hasPaymentDetails && paymentDetails ? (
            /* method — bank transfer + Bit, each value copyable */
            <div className="sk-rise mt-[18px]" style={{ animationDelay: "80ms" }}>
              <Eyebrow className="mb-[9px]">Bank transfer</Eyebrow>
              <div
                className="rounded-card px-[18px]"
                style={{
                  background: "rgb(var(--bg-elevated))",
                  border: "1px solid rgb(var(--border-subtle))",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                {paymentDetails.bankTransfer ? (
                  <PaymentDetailBlock
                    label="Transfer details"
                    value={paymentDetails.bankTransfer}
                    copyLabel="bank transfer details"
                  />
                ) : (
                  <div className="py-4 text-[13px] text-[rgb(var(--fg-muted))]">
                    Ask {producerName} for their bank transfer details.
                  </div>
                )}
              </div>

              {paymentDetails.bitPhone ? (
                <>
                  <Eyebrow className="mt-[18px] mb-[9px]">Bit</Eyebrow>
                  <div
                    className="rounded-card px-[18px]"
                    style={{
                      background: "rgb(var(--bg-elevated))",
                      border: "1px solid rgb(var(--border-subtle))",
                      boxShadow: "var(--shadow-sm)",
                    }}
                  >
                    <PaymentDetailBlock
                      label="Bit number"
                      value={paymentDetails.bitPhone}
                      copyLabel="Bit number"
                    />
                  </div>
                </>
              ) : null}

              {paymentDetails.note ? (
                <p className="mt-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-muted))]">
                  {paymentDetails.note}
                </p>
              ) : null}
            </div>
          ) : (
            /* fallback — producer hasn't shared details yet */
            <div
              className="sk-rise rounded-card mt-[18px] flex items-start gap-3 px-4 py-4"
              style={{
                animationDelay: "80ms",
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <span
                className="mt-px flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]"
                style={{
                  background: "rgb(var(--brand-primary) / 0.14)",
                  color: "rgb(var(--brand-primary-dark))",
                }}
              >
                <ShieldIcon width={16} height={16} />
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                  {producerName} will send payment details
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                  They&apos;ll share their bank or Bit details with you directly. Once you&apos;ve
                  paid, come back and upload your proof.
                </p>
              </div>
            </div>
          )}

          {/* card pay — v2, greyed + inert. Faint text + washed row so it
              never reads as tappable. */}
          <div
            className="sk-rise rounded-card mt-3 flex items-center justify-between gap-3 px-4 py-3.5"
            aria-disabled="true"
            style={{
              animationDelay: "140ms",
              background: "rgb(var(--bg-background))",
              border: "1px dashed rgb(var(--border-strong))",
              opacity: 0.45,
            }}
          >
            <div className="text-[14px] font-medium text-[rgb(var(--fg-muted))]">Pay by card</div>
            <div className="font-mono text-[9.5px] tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              Coming soon
            </div>
          </div>

          {/* reassurance — the app is the record-keeper, not the processor */}
          <div className="mt-3.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
            <span className="mt-px">
              <ShieldIcon />
            </span>
            <span>
              Money is paid directly to {producerName}. Skitza keeps the record — we never hold or
              move your money.
            </span>
          </div>
        </div>

        {/* pinned action */}
        <div
          className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pt-3.5 pb-3.5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
          }}
        >
          <PrimaryCta onClick={goToProof} sub="Upload a screenshot of your transfer">
            I&apos;ve paid — upload proof <ArrowRight />
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
