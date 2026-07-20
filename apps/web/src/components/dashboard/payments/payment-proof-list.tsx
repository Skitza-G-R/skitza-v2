import { CheckCircle2, Clock3, ReceiptText, XCircle } from "lucide-react";
import Link from "next/link";

import { formatMoney } from "~/lib/format/money";
import type {
  ProducerPaymentProofHistory,
  ProducerPendingPaymentProof,
} from "~/server/domain/payment-proofs/service";

function formatUploadedAt(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatProofMoney(cents: number, currency: string): string {
  return formatMoney(cents, currency, { withCents: cents % 100 !== 0 });
}

function ProofRow({ proof }: { proof: ProducerPaymentProofHistory | ProducerPendingPaymentProof }) {
  const status = "status" in proof ? proof.status : "pending";
  const statusCopy =
    status === "confirmed"
      ? { label: "Confirmed", icon: CheckCircle2, className: "text-[rgb(var(--fg-success-text))]" }
      : status === "rejected"
        ? { label: "Rejected", icon: XCircle, className: "text-[rgb(var(--fg-danger-text))]" }
        : {
            label: "Needs review",
            icon: Clock3,
            className: "text-[rgb(var(--brand-primary-text))]",
          };
  const StatusIcon = statusCopy.icon;
  return (
    <li>
      <Link
        href={`/dashboard/payments/${encodeURIComponent(proof.proofId)}`}
        className="group grid min-h-[116px] min-w-0 gap-3 px-4 py-4 transition-colors hover:bg-[rgb(var(--bg-overlay))] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
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
            {proof.projectTitle} · {proof.productNameSnapshot}
          </p>
          <p className="mt-1 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
            Installment {String(proof.installmentPosition)} ·{" "}
            {formatProofMoney(proof.installmentAmountCents, proof.currency)}
          </p>
          <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
            <span className="max-w-full truncate" title={proof.originalFileName}>
              {proof.originalFileName}
            </span>
            <span>{formatFileSize(proof.sizeBytes)}</span>
            <span>{formatUploadedAt(proof.createdAt)}</span>
          </div>
          {proof.proofNote ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-muted))]">
              “{proof.proofNote}”
            </p>
          ) : null}
        </div>
        <div className="flex items-end justify-between gap-4 sm:block sm:text-right">
          <div>
            <p className="font-display text-xl font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
              {formatProofMoney(proof.amountCents, proof.currency)}
            </p>
            <span
              className={`mt-1 inline-flex items-center gap-1 font-mono text-[10px] font-bold tracking-wider uppercase ${statusCopy.className}`}
            >
              <StatusIcon size={12} aria-hidden />
              {statusCopy.label}
            </span>
          </div>
          <span className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary-text))] uppercase group-hover:underline sm:mt-2 sm:inline-block">
            Open →
          </span>
        </div>
      </Link>
    </li>
  );
}

export function PaymentProofList({
  title,
  eyebrow,
  proofs,
  emptyCopy,
}: {
  title: string;
  eyebrow: string;
  proofs: readonly (ProducerPaymentProofHistory | ProducerPendingPaymentProof)[];
  emptyCopy: string;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      <header className="flex items-start gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-4 sm:px-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-text))]">
          <ReceiptText size={19} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary-text))] uppercase">
            {eyebrow}
          </p>
          <h2 className="font-display mt-1 text-xl font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
            {title}
          </h2>
        </div>
      </header>
      {proofs.length > 0 ? (
        <ul className="divide-y divide-[rgb(var(--border-subtle))]">
          {proofs.map((proof) => (
            <ProofRow key={proof.proofId} proof={proof} />
          ))}
        </ul>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-[rgb(var(--fg-muted))]">{emptyCopy}</p>
      )}
    </section>
  );
}
