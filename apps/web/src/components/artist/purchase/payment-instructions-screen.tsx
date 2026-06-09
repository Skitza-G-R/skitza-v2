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
// Data-only props (serializable from the server page). Navigation + the
// clipboard copy live here. When BE-2 (SK-38) lands the producer's real bank
// details, the page swaps the mock for the caller — the screen is unchanged.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import {
  Eyebrow,
  FunnelTopBar,
  PrimaryCta,
} from "~/components/artist/funnel/funnel-ui";
import { formatShekels } from "./pay-data";

// The producer's off-app payment details. Absent → "will send details".
export type BankDetails = {
  bank: string;
  branch: string;
  account: string;
  bit: string;
};

// Small inline copy control — writes one value to the clipboard and flips to a
// brief "Copied" confirmation. Kept inline (not a shared atom) per the brief.
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      // Clipboard blocked (insecure context / denied) — stay silent; the value
      // is still visible to read off manually.
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        void copy();
      }}
      aria-label={`Copy ${label}`}
      className="sk-press inline-flex shrink-0 items-center gap-[5px] rounded-[10px] px-2.5 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] transition-colors"
      style={
        copied
          ? {
              background: "rgb(var(--brand-primary) / 0.14)",
              color: "rgb(var(--brand-primary-dark))",
            }
          : {
              background: "rgb(var(--bg-background))",
              color: "rgb(var(--fg-secondary))",
              border: "1px solid rgb(var(--border-subtle))",
            }
      }
    >
      {copied ? (
        <>
          <Check width={11} height={11} />
          Copied
        </>
      ) : (
        "Copy"
      )}
    </button>
  );
}

// One label/value row inside the bank card, with its own copy control.
function DetailRow({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
          {label}
        </div>
        <div className="mt-0.5 truncate font-mono text-[14.5px] font-semibold tabular-nums text-[rgb(var(--fg-default))]">
          {value}
        </div>
      </div>
      <CopyButton value={value} label={copyLabel} />
    </div>
  );
}

export function PaymentInstructionsScreen({
  productId,
  producerName,
  amountDueNowCents,
  bank,
  planParam,
}: {
  productId: string;
  producerName: string;
  amountDueNowCents: number;
  /** The producer's details, or null → they'll send them after approval. */
  bank: BankDetails | null;
  /** Selected plan, carried through to the proof screen. */
  planParam: string | undefined;
}) {
  const router = useRouter();

  const goToProof = () => {
    const qs = planParam ? `?plan=${encodeURIComponent(planParam)}` : "";
    router.push(`/artist/purchase/${productId}/pay/proof${qs}`);
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

        <div className="flex-1 px-5 pb-[184px] pt-3.5">
          {/* amount due now — dark hero card (matches the prototype) */}
          <div
            className="sk-rise rounded-card px-[18px] pb-[18px] pt-[15px]"
            style={{
              background: "rgb(var(--bg-sidebar))",
              color: "rgb(var(--fg-inverse))",
              boxShadow: "0 18px 40px -16px rgb(17 16 9 / 0.45)",
            }}
          >
            <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--brand-primary))]">
              Amount due now
            </div>
            <div className="mt-1.5 font-amount text-[42px] font-bold leading-none tracking-[-0.04em] text-white">
              {formatShekels(amountDueNowCents)}
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-white/55">
              Pay using your bank or Bit, then upload your proof.
            </p>
          </div>

          {bank ? (
            /* method — bank transfer + Bit, each value copyable */
            <div
              className="sk-rise mt-[18px]"
              style={{ animationDelay: "80ms" }}
            >
              <Eyebrow className="mb-[9px]">Bank transfer</Eyebrow>
              <div
                className="rounded-card px-[18px]"
                style={{
                  background: "rgb(var(--bg-elevated))",
                  border: "1px solid rgb(var(--border-subtle))",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <DetailRow label="Bank" value={bank.bank} copyLabel="bank name" />
                <div style={{ borderTop: "1px solid rgb(var(--border-subtle))" }} />
                <DetailRow label="Branch" value={bank.branch} copyLabel="branch number" />
                <div style={{ borderTop: "1px solid rgb(var(--border-subtle))" }} />
                <DetailRow label="Account" value={bank.account} copyLabel="account number" />
              </div>

              <Eyebrow className="mb-[9px] mt-[18px]">Bit</Eyebrow>
              <div
                className="rounded-card px-[18px]"
                style={{
                  background: "rgb(var(--bg-elevated))",
                  border: "1px solid rgb(var(--border-subtle))",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <DetailRow label="Bit number" value={bank.bit} copyLabel="Bit number" />
              </div>
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

          {/* card pay — v2, greyed + inert */}
          <div
            className="sk-rise rounded-card mt-3 flex items-center justify-between gap-3 px-4 py-3.5"
            aria-disabled="true"
            style={{
              animationDelay: "140ms",
              background: "rgb(var(--bg-background))",
              border: "1px dashed rgb(var(--border-strong))",
              opacity: 0.6,
            }}
          >
            <div className="text-[14px] font-semibold text-[rgb(var(--fg-muted))]">
              Pay by card
            </div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
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
          className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pb-3.5 pt-3.5"
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
