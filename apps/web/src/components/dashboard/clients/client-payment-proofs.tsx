import { ExternalLink, ReceiptText } from "lucide-react";
import Link from "next/link";

import { formatMoney } from "~/lib/format/money";

export type ClientPaymentProof = {
  proofId: string;
  purchaseId: string;
  refNumber: string;
  productNameSnapshot: string;
  amountCents: number;
  currency: string;
  originalFileName: string | null;
  status: "pending" | "confirmed" | "rejected";
  rejectionNote: string | null;
  createdAt: Date;
};

const STATUS_LABEL: Record<ClientPaymentProof["status"], string> = {
  pending: "Needs review",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

const STATUS_CLASSES: Record<ClientPaymentProof["status"], string> = {
  pending:
    "border-[rgb(var(--brand-primary)/0.38)] bg-[rgb(var(--brand-primary)/0.1)] text-[rgb(var(--brand-primary))]",
  confirmed:
    "border-[rgb(var(--fg-success)/0.32)] bg-[rgb(var(--fg-success)/0.1)] text-[rgb(var(--fg-success))]",
  rejected:
    "border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] text-[rgb(var(--fg-danger))]",
};

function formatUploadedAt(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function ClientPaymentProofs({ proofs }: { proofs: readonly ClientPaymentProof[] }) {
  return (
    <section
      aria-labelledby="client-payment-proofs-title"
      className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[rgb(var(--border-subtle))] px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
          >
            <ReceiptText size={18} />
          </span>
          <div className="min-w-0">
            <h2
              id="client-payment-proofs-title"
              className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
            >
              Payment proofs
            </h2>
            <p className="text-xs text-[rgb(var(--fg-muted))]">Private uploads from this client</p>
          </div>
        </div>
        {proofs.length > 0 ? (
          <span className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--fg-muted))] uppercase">
            {proofs.length} {proofs.length === 1 ? "upload" : "uploads"}
          </span>
        ) : null}
      </div>

      {proofs.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[rgb(var(--fg-muted))] sm:px-5">
          No payment proofs uploaded yet.
        </p>
      ) : (
        <ul className="divide-y divide-[rgb(var(--border-subtle))]">
          {proofs.map((proof) => (
            <li key={proof.proofId}>
              <Link
                href={`/dashboard/payments/${proof.proofId}`}
                className="sk-press group grid min-h-[92px] gap-3 px-4 py-4 transition-colors hover:bg-[rgb(var(--bg-overlay))] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                      {proof.originalFileName ?? "Payment proof"}
                    </p>
                    <span
                      className={`inline-flex shrink-0 rounded-[var(--radius-lg)] border px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase ${STATUS_CLASSES[proof.status]}`}
                    >
                      {STATUS_LABEL[proof.status]}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-[rgb(var(--fg-secondary))]">
                    {proof.productNameSnapshot} · {proof.refNumber}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                    Uploaded {formatUploadedAt(proof.createdAt)}
                  </p>
                  {proof.status === "rejected" && proof.rejectionNote ? (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[rgb(var(--fg-danger))]">
                      {proof.rejectionNote}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
                  <p className="font-display text-lg font-extrabold text-[rgb(var(--fg-default))]">
                    {formatMoney(proof.amountCents, proof.currency, {
                      withCents: proof.amountCents % 100 !== 0,
                    })}
                  </p>
                  <span className="mt-1 inline-flex min-h-11 items-center gap-1 font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary))] uppercase group-hover:underline sm:min-h-0">
                    View proof
                    <ExternalLink size={12} aria-hidden />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
