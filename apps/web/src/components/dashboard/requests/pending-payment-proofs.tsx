import { ReceiptText } from "lucide-react";
import Link from "next/link";

import { formatMoney } from "~/lib/format/money";

export type PendingPaymentProof = {
  proofId: string;
  purchaseRequestId: string;
  refNumber: string;
  artistName: string;
  productNameSnapshot: string;
  amountCents: number;
  totalCents: number;
  currency: string;
  originalFileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  proofNote: string | null;
  createdAt: Date;
};

export function PendingPaymentProofs({
  proofs,
  className = "",
}: {
  proofs: readonly PendingPaymentProof[];
  className?: string;
}) {
  if (proofs.length === 0) return null;

  return (
    <section
      aria-labelledby="pending-payment-proofs"
      className={`overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.42)] bg-[rgb(var(--bg-elevated))] shadow-[0_12px_40px_rgb(var(--brand-primary)/0.08)] ${className}`}
    >
      <div className="flex flex-col gap-3 border-b border-[rgb(var(--brand-primary)/0.22)] bg-[rgb(var(--brand-primary)/0.07)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]"
          >
            <ReceiptText size={19} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary))] uppercase">
              Gate 2 · private payment evidence
            </p>
            <h2
              id="pending-payment-proofs"
              className="font-display mt-1 text-xl font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
            >
              Payment proof needs review
            </h2>
          </div>
        </div>
        <span className="pill pill-brand w-fit">
          {proofs.length} {proofs.length === 1 ? "proof" : "proofs"}
        </span>
      </div>

      <ul className="divide-y divide-[rgb(var(--border-subtle))]">
        {proofs.map((proof) => (
          <li key={proof.proofId}>
            <Link
              href={`/dashboard/requests/${proof.purchaseRequestId}?proof=${proof.proofId}#payment-proof`}
              className="sk-press group grid min-h-[116px] gap-3 px-4 py-4 transition-colors hover:bg-[rgb(var(--bg-overlay))] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-[15px] font-bold break-words text-[rgb(var(--fg-default))]">
                    {proof.artistName}
                  </p>
                  <span className="font-mono text-[10px] tracking-wide text-[rgb(var(--fg-muted))] uppercase">
                    {proof.refNumber}
                  </span>
                </div>
                <p className="mt-1 text-sm break-words text-[rgb(var(--fg-secondary))]">
                  {proof.productNameSnapshot}
                </p>
                <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
                  <span className="max-w-full truncate" title={proof.originalFileName ?? undefined}>
                    {proof.originalFileName ?? "Payment proof"}
                  </span>
                  <span>{formatFileSize(proof.sizeBytes)}</span>
                  <span>{formatUploadedAt(proof.createdAt)}</span>
                </div>
                {proof.proofNote ? (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-muted))]">
                    “{proof.proofNote}”
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
                <div>
                  <p className="font-display text-xl font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
                    {formatMoney(proof.amountCents, proof.currency)}
                  </p>
                  {proof.amountCents !== proof.totalCents ? (
                    <p className="mt-0.5 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                      of {formatMoney(proof.totalCents, proof.currency)}
                    </p>
                  ) : null}
                </div>
                <span className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary))] uppercase group-hover:underline sm:mt-2 sm:inline-block">
                  Open proof →
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function formatUploadedAt(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "Size unavailable";
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
