"use client";

import { ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  confirmPaymentProofAction,
  rejectPaymentProofAction,
} from "~/app/(producer)/dashboard/payments/proof-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { formatMoney } from "~/lib/format/money";
import type { ProducerPaymentProofReview } from "~/server/domain/payment-proofs/service";

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function statusLabel(status: "pending" | "confirmed" | "rejected"): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "rejected") return "Rejected";
  return "Needs review";
}

function formatProofMoney(cents: number, currency: string): string {
  return formatMoney(cents, currency, { withCents: cents % 100 !== 0 });
}

export type PreviewPaymentProofDecision =
  | Readonly<{ kind: "confirm" }>
  | Readonly<{ kind: "reject"; note: string }>;

export function PaymentProofReview({
  review,
  onPreviewDecision,
}: {
  review: ProducerPaymentProofReview;
  /** Development gallery only: avoids real mutations while exercising the review UI. */
  onPreviewDecision?: ((decision: PreviewPaymentProofDecision) => void) | undefined;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { proof } = review;
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  function runConfirm() {
    setMessage(null);
    if (!online) {
      setMessage({ tone: "error", text: "Reconnect to confirm this payment." });
      return;
    }
    startTransition(async () => {
      if (onPreviewDecision) {
        onPreviewDecision({ kind: "confirm" });
        setMessage({ tone: "success", text: "Payment confirmed and recorded once." });
        setShowConfirm(false);
        return;
      }
      try {
        const result = await confirmPaymentProofAction({ proofId: proof.proofId });
        if (!result.ok) {
          setMessage({ tone: "error", text: result.error });
          return;
        }
        setMessage({ tone: "success", text: "Payment confirmed and recorded once." });
        setShowConfirm(false);
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: "Could not confirm this payment. Please try again." });
      }
    });
  }

  function runReject(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = rejectionNote.trim();
    if (!note) return;
    setMessage(null);
    if (!online) {
      setMessage({ tone: "error", text: "Reconnect to reject this proof." });
      return;
    }
    startTransition(async () => {
      if (onPreviewDecision) {
        onPreviewDecision({ kind: "reject", note });
        setMessage({
          tone: "success",
          text: "Proof rejected. The artist can see your note and replace it.",
        });
        setShowReject(false);
        return;
      }
      try {
        const result = await rejectPaymentProofAction({ proofId: proof.proofId, note });
        if (!result.ok) {
          setMessage({ tone: "error", text: result.error });
          return;
        }
        setMessage({
          tone: "success",
          text: "Proof rejected. The artist can see your note and replace it.",
        });
        setShowReject(false);
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: "Could not reject this proof. Please try again." });
      }
    });
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--bg-elevated))]">
        <header className="border-b border-[rgb(var(--brand-primary)/0.22)] bg-[rgb(var(--brand-primary)/0.07)] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary-text))] uppercase">
                Private payment evidence · {statusLabel(proof.status)}
              </p>
              <h1 className="font-display mt-1 text-[clamp(1.6rem,5vw,2.25rem)] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
                {proof.artistName}
              </h1>
              <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
                {proof.projectTitle} · {proof.productNameSnapshot}
              </p>
            </div>
            <div className="shrink-0 sm:text-right">
              <p className="font-display text-2xl font-extrabold text-[rgb(var(--fg-default))]">
                {formatProofMoney(proof.amountCents, proof.currency)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                Artist-stated amount
              </p>
            </div>
          </div>
        </header>

        <dl className="grid gap-px bg-[rgb(var(--border-subtle))] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Purchase", proof.refNumber],
            [
              "Installment",
              `${String(proof.installmentPosition)} · ${formatProofMoney(proof.installmentAmountCents, proof.currency)}`,
            ],
            ["Uploaded", formatDate(proof.createdAt)],
            ["File", proof.originalFileName],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 bg-[rgb(var(--bg-elevated))] px-4 py-3">
              <dt className="font-mono text-[9px] font-bold tracking-widest text-[rgb(var(--fg-muted))] uppercase">
                {label}
              </dt>
              <dd className="mt-1 text-sm font-semibold break-words text-[rgb(var(--fg-default))]">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
          <div className="min-w-0">
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))]">
              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-3 py-2.5 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <FileCheck2
                    size={16}
                    aria-hidden
                    className="shrink-0 text-[rgb(var(--brand-primary-text))]"
                  />
                  <span
                    className="truncate text-xs font-semibold text-[rgb(var(--fg-default))]"
                    title={proof.originalFileName}
                  >
                    {proof.originalFileName}
                  </span>
                </div>
                <a
                  href={review.evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-xs font-bold text-[rgb(var(--brand-primary-text))]"
                >
                  Open <ExternalLink size={13} aria-hidden />
                </a>
              </div>
              {proof.contentType === "application/pdf" ? (
                <iframe
                  src={review.evidenceUrl}
                  title={`Payment proof from ${proof.artistName}`}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  className="h-[min(68vh,46rem)] min-h-[28rem] w-full bg-white"
                />
              ) : proof.contentType.startsWith("image/") ? (
                // Same-origin authorization proxy; the R2 identity never enters this source.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={review.evidenceUrl}
                  alt={`Payment evidence uploaded by ${proof.artistName}`}
                  referrerPolicy="no-referrer"
                  className="mx-auto max-h-[min(72vh,52rem)] w-full object-contain"
                />
              ) : (
                <div className="flex min-h-72 items-center justify-center p-8 text-center text-sm text-[rgb(var(--fg-muted))]">
                  Open the private evidence to inspect this file.
                </div>
              )}
            </div>
            <p className="mt-2 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
              This viewer link expires in {String(Math.round(review.evidenceExpiresInSeconds / 60))}{" "}
              minutes.
            </p>
            {proof.proofNote ? (
              <div className="mt-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-3.5">
                <p className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--fg-muted))] uppercase">
                  Artist note
                </p>
                <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                  {proof.proofNote}
                </p>
              </div>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-4">
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] p-4">
              <div className="flex gap-2.5">
                <ShieldCheck
                  size={18}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-[rgb(var(--fg-success-text))]"
                />
                <div>
                  <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
                    Private, authorized delivery
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                    No public URL or storage key is exposed. Confirm exactly the amount the artist
                    stated, or reject the whole proof with a note.
                  </p>
                </div>
              </div>
            </div>

            {proof.status === "confirmed" ? (
              <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.3)] bg-[rgb(var(--fg-success)/0.08)] p-4">
                <p className="text-sm font-bold text-[rgb(var(--fg-success-text))]">
                  Payment confirmed
                </p>
                <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
                  {proof.confirmedAt ? formatDate(proof.confirmedAt) : "This proof is immutable."}
                </p>
              </div>
            ) : null}
            {proof.status === "rejected" ? (
              <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.07)] p-4">
                <p className="text-sm font-bold text-[rgb(var(--fg-danger-text))]">
                  Proof rejected
                </p>
                <p className="mt-2 text-xs leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                  {proof.rejectionNote}
                </p>
              </div>
            ) : null}

            {proof.status === "pending" && !showConfirm && !showReject ? (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirm(true);
                  }}
                  disabled={isPending || !online}
                  className="min-h-12 w-full rounded-[var(--radius-lg)] bg-[rgb(var(--fg-success))] px-4 text-sm font-bold text-white disabled:opacity-60"
                >
                  Confirm {formatProofMoney(proof.amountCents, proof.currency)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowReject(true);
                  }}
                  disabled={isPending || !online}
                  className="min-h-12 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.38)] px-4 text-sm font-bold text-[rgb(var(--fg-danger-text))] disabled:opacity-60"
                >
                  Reject proof
                </button>
              </div>
            ) : null}

            {proof.status === "pending" && showConfirm ? (
              <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.35)] bg-[rgb(var(--fg-success)/0.07)] p-4">
                <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
                  Record one immutable payment?
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  This accepts {formatProofMoney(proof.amountCents, proof.currency)}. A retry cannot
                  create another payment.
                </p>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => {
                      setShowConfirm(false);
                    }}
                    disabled={isPending}
                    className="min-h-11 flex-1 rounded-[var(--radius-lg)] px-3 text-sm font-semibold text-[rgb(var(--fg-muted))]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={runConfirm}
                    disabled={isPending || !online}
                    className="min-h-11 flex-1 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-success))] px-3 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {isPending ? "Confirming…" : "Confirm payment"}
                  </button>
                </div>
              </div>
            ) : null}

            {proof.status === "pending" && showReject ? (
              <form
                onSubmit={runReject}
                className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.32)] bg-[rgb(var(--fg-danger)/0.05)] p-4"
              >
                <label
                  htmlFor="proof-rejection-note"
                  className="text-sm font-bold text-[rgb(var(--fg-default))]"
                >
                  Message shown to the artist
                </label>
                <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  Explain what needs fixing. The rejected record remains in history.
                </p>
                <textarea
                  id="proof-rejection-note"
                  required
                  maxLength={2000}
                  rows={4}
                  value={rejectionNote}
                  onChange={(event) => {
                    setRejectionNote(event.target.value);
                  }}
                  autoFocus
                  className="mt-3 w-full resize-y rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 text-base text-[rgb(var(--fg-default))] outline-none focus:ring-2 focus:ring-[rgb(var(--focus-ring))]"
                />
                <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => {
                      setShowReject(false);
                    }}
                    disabled={isPending}
                    className="min-h-11 flex-1 rounded-[var(--radius-lg)] px-3 text-sm font-semibold text-[rgb(var(--fg-muted))]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending || !rejectionNote.trim() || !online}
                    className="min-h-11 flex-1 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-3 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {isPending ? "Rejecting…" : "Send note & reject"}
                  </button>
                </div>
              </form>
            ) : null}

            {message ? (
              <p
                role={message.tone === "error" ? "alert" : "status"}
                className={`rounded-[var(--radius-lg)] p-3 text-xs font-semibold ${message.tone === "error" ? "bg-[rgb(var(--fg-danger)/0.08)] text-[rgb(var(--fg-danger-text))]" : "bg-[rgb(var(--fg-success)/0.08)] text-[rgb(var(--fg-success-text))]"}`}
              >
                {message.text}
              </p>
            ) : null}
          </aside>
        </div>
      </section>

      <section
        aria-labelledby="proof-history-title"
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
      >
        <h2
          id="proof-history-title"
          className="font-display text-xl font-extrabold text-[rgb(var(--fg-default))]"
        >
          Immutable proof history
        </h2>
        <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
          Rejected and replaced evidence stays visible for this purchase.
        </p>
        <ol className="mt-4 space-y-2">
          {review.history.map((item) => (
            <li
              key={item.proofId}
              className={`rounded-[var(--radius-lg)] border p-3 ${item.proofId === proof.proofId ? "border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.06)]" : "border-[rgb(var(--border-subtle))]"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
                    Installment {String(item.installmentPosition)} ·{" "}
                    {formatProofMoney(item.amountCents, item.currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
                    {item.originalFileName} · {formatDate(item.createdAt)}
                  </p>
                </div>
                <a
                  href={`/dashboard/payments/${encodeURIComponent(item.proofId)}`}
                  className="inline-flex min-h-11 items-center text-xs font-bold text-[rgb(var(--brand-primary-text))]"
                >
                  {statusLabel(item.status)} →
                </a>
              </div>
              {item.rejectionNote ? (
                <p className="mt-2 text-xs whitespace-pre-wrap text-[rgb(var(--fg-danger-text))]">
                  {item.rejectionNote}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
