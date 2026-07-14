"use client";

import { ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SyntheticEvent, useRef, useState, useTransition } from "react";

import {
  confirmPaymentProof,
  rejectPaymentProof,
} from "~/app/(producer)/dashboard/requests/proof-actions";
import { useToast } from "~/components/ui/toast";
import { formatMoney } from "~/lib/format/money";

import { type PendingPaymentProof, formatUploadedAt } from "./pending-payment-proofs";

export type PaymentProofReviewData = PendingPaymentProof & {
  status: "pending" | "confirmed" | "rejected";
  rejectionNote: string | null;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  signedUrl: string;
  expiresInSeconds: number;
};

export function PaymentProofReview({ proof }: { proof: PaymentProofReviewData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);
  const rejectTriggerRef = useRef<HTMLButtonElement>(null);
  const proofTitle =
    proof.status === "pending"
      ? "Verify this payment"
      : proof.status === "confirmed"
        ? "Confirmed payment proof"
        : "Rejected payment proof";
  const proofDescription =
    proof.status === "pending"
      ? "Confirm only after the amount and evidence match the transfer you received."
      : proof.status === "confirmed"
        ? "This evidence was confirmed and added to the paid invoice ledger."
        : "This evidence was rejected and kept here as part of the client’s payment history.";

  const closeConfirm = () => {
    setShowConfirm(false);
    window.requestAnimationFrame(() => {
      confirmTriggerRef.current?.focus();
    });
  };

  const closeReject = () => {
    setShowReject(false);
    setRejectionNote("");
    window.requestAnimationFrame(() => {
      rejectTriggerRef.current?.focus();
    });
  };

  const returnToRequest = () => {
    router.replace(`/dashboard/requests/${proof.purchaseRequestId}#payment-proof`);
    router.refresh();
  };

  const runConfirm = () => {
    startTransition(async () => {
      const result = await confirmPaymentProof({
        proofId: proof.proofId,
      });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast(
        result.finalPaid
          ? "Payment confirmed. The purchase is paid in full."
          : "Payment confirmed. The paid invoice and artist access are updated.",
        "success",
      );
      returnToRequest();
    });
  };

  const runReject = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const note = rejectionNote.trim();
    if (!note) return;
    startTransition(async () => {
      const result = await rejectPaymentProof({
        proofId: proof.proofId,
        note,
      });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast("Proof rejected. The artist can see your message and upload again.", "success");
      returnToRequest();
    });
  };

  return (
    <section
      id="payment-proof"
      aria-labelledby="payment-proof-title"
      className="scroll-mt-24 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.48)] bg-[rgb(var(--bg-elevated))] shadow-[0_18px_60px_rgb(var(--brand-primary)/0.1)]"
    >
      <div className="border-b border-[rgb(var(--brand-primary)/0.24)] bg-[rgb(var(--brand-primary)/0.07)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary))] uppercase">
              Gate 2 · private payment evidence
            </p>
            <h2
              id="payment-proof-title"
              className="font-display mt-1 text-2xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]"
            >
              {proofTitle}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
              {proofDescription}
            </p>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="font-display text-2xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
              {formatMoney(proof.amountCents, proof.currency)}
            </p>
            {proof.amountCents !== proof.totalCents ? (
              <p className="mt-0.5 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                Purchase total {formatMoney(proof.totalCents, proof.currency)}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <div className="min-w-0">
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))]">
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-3 py-2.5 sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <FileCheck2
                  size={16}
                  aria-hidden
                  className="shrink-0 text-[rgb(var(--brand-primary))]"
                />
                <span
                  className="truncate text-xs font-semibold text-[rgb(var(--fg-default))]"
                  title={proof.originalFileName ?? undefined}
                >
                  {proof.originalFileName ?? "Payment proof"}
                </span>
              </div>
              <a
                href={proof.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider text-[rgb(var(--brand-primary))] uppercase hover:underline lg:min-h-0"
              >
                Open original
                <ExternalLink size={12} aria-hidden />
              </a>
            </div>

            {proof.contentType === "application/pdf" ? (
              <iframe
                src={proof.signedUrl}
                title={`Payment proof: ${proof.originalFileName ?? proof.refNumber}`}
                sandbox=""
                referrerPolicy="no-referrer"
                className="h-[min(68vh,46rem)] min-h-[28rem] w-full bg-white"
              />
            ) : proof.contentType === "image/heic" ? (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center">
                <FileCheck2 size={34} aria-hidden className="text-[rgb(var(--brand-primary))]" />
                <p className="mt-3 text-sm font-bold text-[rgb(var(--fg-default))]">
                  HEIC preview depends on your browser
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  Open the private original above if the image does not appear here.
                </p>
                {/* A browser that supports HEIC can still render the source. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={proof.signedUrl}
                  alt={`Payment evidence uploaded by ${proof.artistName}`}
                  referrerPolicy="no-referrer"
                  className="mt-4 max-h-[46rem] max-w-full rounded-[var(--radius-md)] object-contain"
                />
              </div>
            ) : proof.contentType?.startsWith("image/") ? (
              // A presigned R2 URL has a dynamic host, so next/image cannot
              // safely optimize it. Magic-byte validation happens before the
              // final object is accepted; the producer gets only this 5-min URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proof.signedUrl}
                alt={`Payment evidence uploaded by ${proof.artistName}`}
                referrerPolicy="no-referrer"
                className="mx-auto max-h-[min(72vh,52rem)] w-full object-contain"
              />
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center">
                <FileCheck2 size={34} aria-hidden className="text-[rgb(var(--brand-primary))]" />
                <p className="mt-3 text-sm font-bold text-[rgb(var(--fg-default))]">
                  Preview unavailable
                </p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  Open the private original above to inspect this evidence.
                </p>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
            <span>Uploaded {formatUploadedAt(proof.createdAt)}</span>
            <span>{proof.refNumber}</span>
            <span>Link expires in {Math.round(proof.expiresInSeconds / 60)} minutes</span>
          </div>
          {proof.proofNote ? (
            <div className="mt-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-3.5">
              <p className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--fg-muted))] uppercase">
                Artist note
              </p>
              <p className="mt-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                {proof.proofNote}
              </p>
            </div>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] p-4">
            <div className="flex items-start gap-2.5">
              <ShieldCheck
                size={18}
                aria-hidden
                className="mt-0.5 shrink-0 text-[rgb(var(--fg-success))]"
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
                  Private producer review
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  This evidence link is owned by your studio and lasts five minutes. It is not an
                  artist-facing public URL.
                </p>
              </div>
            </div>
          </div>

          {proof.status === "confirmed" ? (
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.32)] bg-[rgb(var(--fg-success)/0.08)] p-4">
              <p className="text-sm font-bold text-[rgb(var(--fg-success))]">Payment confirmed</p>
              <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                {proof.confirmedAt
                  ? `Confirmed ${formatUploadedAt(proof.confirmedAt)}. This proof is read-only.`
                  : "This proof is confirmed and read-only."}
              </p>
            </div>
          ) : proof.status === "rejected" ? (
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.06)] p-4">
              <p className="text-sm font-bold text-[rgb(var(--fg-danger))]">Proof rejected</p>
              {proof.rejectionNote ? (
                <p className="mt-2 text-xs leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                  {proof.rejectionNote}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-[rgb(var(--fg-muted))]">
                {proof.rejectedAt
                  ? `Rejected ${formatUploadedAt(proof.rejectedAt)}. This proof is read-only.`
                  : "This proof is rejected and read-only."}
              </p>
            </div>
          ) : null}

          {proof.status === "pending" && !showConfirm && !showReject ? (
            <div className="space-y-2.5">
              <button
                ref={confirmTriggerRef}
                type="button"
                onClick={() => {
                  setShowConfirm(true);
                }}
                disabled={isPending}
                aria-expanded={showConfirm}
                aria-controls="confirm-payment-proof-panel"
                className="sk-press flex min-h-[48px] w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-success))] px-4 text-sm font-bold text-white disabled:opacity-60"
              >
                Confirm payment
              </button>
              <button
                ref={rejectTriggerRef}
                type="button"
                onClick={() => {
                  setShowReject(true);
                }}
                disabled={isPending}
                aria-expanded={showReject}
                aria-controls="reject-payment-proof-form"
                className="sk-press flex min-h-[46px] w-full items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.38)] px-4 text-sm font-bold text-[rgb(var(--fg-danger))] disabled:opacity-60"
              >
                Reject proof
              </button>
            </div>
          ) : null}

          {proof.status === "pending" && showConfirm ? (
            <div
              id="confirm-payment-proof-panel"
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.35)] bg-[rgb(var(--fg-success)/0.07)] p-4"
            >
              <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
                Create the paid invoice?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                This confirms {formatMoney(proof.amountCents, proof.currency)} and updates the
                artist’s payment access.
              </p>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end lg:flex-col-reverse xl:flex-row">
                <button
                  type="button"
                  onClick={closeConfirm}
                  disabled={isPending}
                  className="sk-press min-h-[44px] rounded-[var(--radius-lg)] px-3 text-sm font-semibold text-[rgb(var(--fg-muted))] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={runConfirm}
                  disabled={isPending}
                  autoFocus
                  className="sk-press min-h-[44px] rounded-[var(--radius-lg)] bg-[rgb(var(--fg-success))] px-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {isPending ? "Confirming…" : "Confirm payment"}
                </button>
              </div>
            </div>
          ) : null}

          {proof.status === "pending" && showReject ? (
            <form
              id="reject-payment-proof-form"
              onSubmit={runReject}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.32)] bg-[rgb(var(--fg-danger)/0.05)] p-4"
            >
              <label
                htmlFor="proof-rejection-note"
                className="block text-sm font-bold text-[rgb(var(--fg-default))]"
              >
                Message shown to the artist
              </label>
              <p
                id="proof-rejection-help"
                className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]"
              >
                Explain what needs fixing. The artist sees this message on their payment screen and
                can upload again.
              </p>
              <textarea
                id="proof-rejection-note"
                aria-describedby="proof-rejection-help"
                required
                minLength={1}
                maxLength={2000}
                rows={4}
                value={rejectionNote}
                autoFocus
                onChange={(event) => {
                  setRejectionNote(event.target.value);
                }}
                placeholder="For example: The transfer amount is cut off in this image. Please upload the full receipt."
                className="mt-3 w-full resize-y rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 text-base text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.55)] focus:outline-none sm:text-sm"
              />
              <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end lg:flex-col-reverse xl:flex-row">
                <button
                  type="button"
                  onClick={closeReject}
                  disabled={isPending}
                  className="sk-press min-h-[44px] rounded-[var(--radius-lg)] px-3 text-sm font-semibold text-[rgb(var(--fg-muted))] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !rejectionNote.trim()}
                  className="sk-press min-h-[44px] rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {isPending ? "Rejecting…" : "Reject and request re-upload"}
                </button>
              </div>
            </form>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
