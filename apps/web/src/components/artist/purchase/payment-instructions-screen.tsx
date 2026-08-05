"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import { Eyebrow, FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";

import { formatPurchaseMoney } from "./pay-data";

export type PaymentDetails = {
  bankTransfer?: string | undefined;
  bitPhone?: string | undefined;
  note?: string | undefined;
};

export function PaymentInstructionsScreen({
  studioId,
  purchaseId,
  producerName,
  amountDueNowCents,
  currency,
  paymentDetails,
  productName,
  planLabel,
  proofUploadsAvailable = true,
  proofHref,
  previewProofHref,
  summaryHref,
}: {
  productId: string;
  studioId?: string | undefined;
  purchaseId?: string | undefined;
  installmentId?: string | undefined;
  producerName: string;
  amountDueNowCents: number;
  currency: string;
  paymentDetails: PaymentDetails | null;
  productName?: string | undefined;
  planLabel?: string | undefined;
  proofUploadsAvailable?: boolean | undefined;
  proofHref?: string | undefined;
  previewProofHref?: string | undefined;
  summaryHref?: string | undefined;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const bankTransfer = paymentDetails?.bankTransfer?.trim() ?? "";
  const bitPhone = paymentDetails?.bitPhone?.trim() ?? "";
  const paymentNote = paymentDetails?.note?.trim() ?? "";
  const hasPaymentMethod = Boolean(bankTransfer || bitPhone);
  const liveProofRoute = Boolean(proofHref && !previewProofHref);
  const canUpload = proofUploadsAvailable && Boolean(proofHref || previewProofHref);
  const uploadDisabled = !canUpload || (!online && liveProofRoute);

  function openProofUpload() {
    if (uploadDisabled) return;
    const destination = previewProofHref ?? proofHref;
    if (destination) router.push(destination);
  }

  return (
    <div className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[60] flex flex-col overflow-hidden bg-[rgb(var(--bg-background))]">
      <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col overflow-hidden">
        <FunnelTopBar
          title="Payment instructions"
          sub="PAID DIRECTLY TO THE STUDIO"
          onBack={() => {
            router.push(
              summaryHref ??
                withArtistStudio(
                  purchaseId ? `/artist/payments/${encodeURIComponent(purchaseId)}` : "/artist",
                  studioId,
                ),
            );
          }}
        />

        <main className="sk-native-scroll min-h-0 flex-1 px-4 pt-4 pb-6 min-[390px]:px-5">
          <h1 className="sr-only">Payment instructions</h1>

          <section
            aria-labelledby="amount-due-heading"
            className="sk-rise rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-[18px] pt-4 pb-[18px] text-[rgb(var(--fg-onsidebar))] shadow-[0_18px_40px_-16px_rgb(17_16_9/0.45)]"
          >
            <p
              id="amount-due-heading"
              className="font-mono text-[9.5px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary))] uppercase"
            >
              Amount due now
            </p>
            <p className="font-amount mt-1.5 text-[42px] leading-none font-bold tracking-[-0.04em] text-white tabular-nums">
              {formatPurchaseMoney(amountDueNowCents, currency)}
            </p>
            {productName || planLabel ? (
              <p className="mt-2 text-[12.5px] leading-snug font-medium [overflow-wrap:anywhere] text-white/80">
                {[productName, planLabel].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <p className="mt-2 text-[12.5px] leading-snug text-white/55">
              {proofUploadsAvailable
                ? "Pay the producer outside Skitza, then upload your receipt here."
                : "Pay the producer outside Skitza and keep your receipt."}
            </p>
          </section>

          {hasPaymentMethod ? (
            <section
              aria-labelledby="payment-methods-heading"
              className="sk-rise mt-[18px]"
              style={{ animationDelay: "80ms" }}
            >
              <h2 id="payment-methods-heading" className="sr-only">
                Producer payment methods
              </h2>
              {bankTransfer ? (
                <PaymentMethodCard
                  title="Bank transfer"
                  label="Transfer details"
                  value={bankTransfer}
                  copyLabel="bank transfer details"
                />
              ) : null}
              {bitPhone ? (
                <PaymentMethodCard
                  title="Bit"
                  label="Bit number"
                  value={bitPhone}
                  copyLabel="Bit number"
                  className={bankTransfer ? "mt-[18px]" : undefined}
                />
              ) : null}
            </section>
          ) : (
            <section
              className="sk-rise mt-[18px] flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-4 shadow-[var(--shadow-sm)]"
              style={{ animationDelay: "80ms" }}
              aria-labelledby="direct-details-heading"
            >
              <span className="mt-px flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-text))]">
                <ShieldIcon width={16} height={16} />
              </span>
              <div className="min-w-0">
                <h2
                  id="direct-details-heading"
                  className="text-[14px] font-semibold text-[rgb(var(--fg-default))]"
                >
                  {producerName} will send payment details directly
                </h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                  They will share their Bank or Bit details with you directly. Once you have paid,
                  come back here and upload your proof.
                </p>
              </div>
            </section>
          )}

          {paymentNote ? (
            <section className="mt-[18px]" aria-labelledby="payment-note-heading">
              <h2 id="payment-note-heading" className="mb-[9px]">
                <Eyebrow>Payment note</Eyebrow>
              </h2>
              <p className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-[18px] py-4 text-[13px] leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-default))] shadow-[var(--shadow-sm)]">
                {paymentNote}
              </p>
            </section>
          ) : null}

          <p className="mt-3.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
            <span className="mt-px shrink-0">
              <ShieldIcon />
            </span>
            <span>
              Money is paid directly to {producerName}. Skitza records your proof. It does not
              process, hold, or move money.
            </span>
          </p>

          {!online && liveProofRoute ? (
            <p
              role="status"
              className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-3.5 py-3 text-[12.5px] text-[rgb(var(--fg-secondary))]"
            >
              Reconnect before opening the proof form.
            </p>
          ) : null}
        </main>

        {proofHref || previewProofHref ? (
          <div
            className="z-10 shrink-0 px-4 pt-5 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] min-[390px]:px-5"
            style={{
              background:
                "linear-gradient(180deg, rgb(var(--bg-background)/0), rgb(var(--bg-background)) 24%)",
            }}
          >
            <PrimaryCta
              onClick={openProofUpload}
              disabled={uploadDisabled}
              glow={!uploadDisabled}
              sub={
                !proofUploadsAvailable
                  ? "Private proof upload is temporarily unavailable"
                  : !online && liveProofRoute
                    ? "Reconnect to continue"
                    : "Upload a photo or file of your transfer"
              }
            >
              {proofUploadsAvailable ? (
                <>
                  I’ve paid — upload proof <ArrowRight />
                </>
              ) : (
                "Proof upload temporarily unavailable"
              )}
            </PrimaryCta>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PaymentMethodCard({
  title,
  label,
  value,
  copyLabel,
  className,
}: {
  title: string;
  label: string;
  value: string;
  copyLabel: string;
  className?: string | undefined;
}) {
  return (
    <div className={className}>
      <h3 className="mb-[9px]">
        <Eyebrow>{title}</Eyebrow>
      </h3>
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-[18px] shadow-[var(--shadow-sm)]">
        <div className="flex items-start justify-between gap-3 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9.5px] tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              {label}
            </p>
            <p className="mt-1 font-mono text-[13.5px] leading-relaxed font-semibold break-words whitespace-pre-wrap text-[rgb(var(--fg-default))] tabular-nums">
              {value}
            </p>
          </div>
          <CopyButton value={value} label={copyLabel} />
        </div>
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  function copyWithSelection(): boolean {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const copied = document.execCommand("copy");
    field.remove();
    buttonRef.current?.focus();
    return copied;
  }

  async function copyValue() {
    let copied = false;
    try {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error("Clipboard timed out"));
          }, 600);
        }),
      ]);
      copied = true;
    } catch {
      copied = copyWithSelection();
    }
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => {
      setCopyState("idle");
    }, 1_800);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          void copyValue();
        }}
        className="sk-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary-text)/0.55)] bg-[rgb(var(--brand-primary)/0.14)] px-3 font-mono text-[10.5px] font-bold tracking-[0.08em] text-[rgb(var(--brand-primary-text))] uppercase"
        aria-label={`Copy ${label}`}
      >
        {copyState === "copied" ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy manually" : "Copy"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copyState === "copied"
          ? `${label} copied`
          : copyState === "failed"
            ? `Could not copy ${label}. Select the details above to copy manually.`
            : ""}
      </span>
    </>
  );
}
