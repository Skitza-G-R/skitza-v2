"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { FunnelTopBar } from "~/components/artist/funnel/funnel-ui";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";

import { formatPurchaseMoney } from "./pay-data";

export type PaymentDetails = {
  bankTransfer?: string | undefined;
  bitPhone?: string | undefined;
  note?: string | undefined;
};

type PaymentMethod = "bank" | "bit";

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
  const methods = useMemo(
    () =>
      [
        paymentDetails?.bankTransfer?.trim()
          ? ({ id: "bank", label: "Bank transfer", value: paymentDetails.bankTransfer.trim() } as const)
          : null,
        paymentDetails?.bitPhone?.trim()
          ? ({ id: "bit", label: "Bit", value: paymentDetails.bitPhone.trim() } as const)
          : null,
      ].filter((method): method is NonNullable<typeof method> => method !== null),
    [paymentDetails?.bankTransfer, paymentDetails?.bitPhone],
  );
  const [selected, setSelected] = useState<PaymentMethod>(methods[0]?.id ?? "bank");
  const method = methods.find((candidate) => candidate.id === selected) ?? methods[0] ?? null;
  const canUpload = Boolean(method && proofUploadsAvailable && (proofHref || previewProofHref));

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-background))]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
        <FunnelTopBar
          title="Payment instructions"
          sub="PAID DIRECTLY TO THE STUDIO"
          onBack={() => {
            router.push(
              summaryHref ??
                withArtistStudio(
                  purchaseId ? `/artist/payments/${purchaseId}` : "/artist",
                  studioId,
                ),
            );
          }}
        />

        <main className="flex-1 px-4 pt-4 pb-32 min-[390px]:px-5">
          <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
            <p className="font-mono text-[9px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
              Amount due now
            </p>
            <p className="mt-1 font-mono text-[34px] leading-none font-bold tracking-[-0.04em] text-[rgb(var(--fg-default))] tabular-nums">
              {formatPurchaseMoney(amountDueNowCents, currency)}
            </p>
            {(productName ?? planLabel) ? (
              <p className="mt-2 text-[12.5px] text-[rgb(var(--fg-muted))]">
                {[productName, planLabel].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </section>

          {methods.length > 0 ? (
            <section className="mt-4" aria-labelledby="payment-method-heading">
              <h1
                id="payment-method-heading"
                className="font-display text-[21px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
              >
                Choose a payment method
              </h1>
              {methods.length > 1 ? (
                <div className="mt-3 grid grid-cols-2 gap-2" role="tablist">
                  {methods.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      role="tab"
                      aria-selected={candidate.id === method?.id}
                      onClick={() => {
                        setSelected(candidate.id);
                      }}
                      className="min-h-11 rounded-[var(--radius-lg)] border px-3 text-[12.5px] font-semibold"
                      style={{
                        background:
                          candidate.id === method?.id
                            ? "rgb(var(--bg-sidebar))"
                            : "rgb(var(--bg-elevated))",
                        borderColor: "rgb(var(--border-control))",
                        color:
                          candidate.id === method?.id
                            ? "rgb(var(--fg-onsidebar))"
                            : "rgb(var(--fg-default))",
                      }}
                    >
                      {candidate.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {method ? (
                <div className="mt-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
                  <p className="font-mono text-[9px] font-semibold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
                    {method.label}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed font-semibold text-[rgb(var(--fg-default))]">
                    {method.value}
                  </p>
                  <CopyButton value={method.value} label={method.label} />
                </div>
              ) : null}
              {paymentDetails?.note?.trim() ? (
                <p className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-4 py-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                  {paymentDetails.note.trim()}
                </p>
              ) : null}
            </section>
          ) : (
            <section className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
              <h1 className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                {producerName} has not added payment instructions yet.
              </h1>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                The studio will share its Bank or Bit details directly. Proof upload becomes
                available only after a real payment method is shown.
              </p>
            </section>
          )}

          <p className="mt-4 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Skitza records your proof. It does not process, hold, or move money.
          </p>
        </main>

        {canUpload ? (
          <div className="sticky bottom-0 px-4 pt-4 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] min-[390px]:px-5">
            <button
              type="button"
              disabled={!online}
              onClick={() => {
                const destination = previewProofHref ?? proofHref;
                if (destination) router.push(destination);
              }}
              className="sk-press min-h-12 w-full rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[14px] font-bold text-[rgb(var(--fg-onsidebar))] disabled:opacity-50"
            >
              {online ? "I’ve paid — upload proof" : "Reconnect to continue"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.setTimeout(() => {
        setCopyState("idle");
      }, 1_800);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void copyValue();
        }}
        className="sk-press mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] px-3 text-[11px] font-bold text-[rgb(var(--fg-default))]"
        aria-label={`Copy ${label}`}
      >
        {copyState === "copied" ? (
          <Check size={14} aria-hidden />
        ) : (
          <Copy size={14} aria-hidden />
        )}
        {copyState === "copied" ? "Copied" : "Copy"}
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
