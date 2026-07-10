"use client";

import type { PaymentPlan } from "@skitza/db";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SyntheticEvent, useState, useTransition } from "react";

import { useToast } from "~/components/ui/toast";
import { formatMoney } from "~/lib/format/money";

import {
  approvePurchaseRequest,
  declinePurchaseRequest,
  undoPurchaseApproval,
} from "~/app/(producer)/dashboard/requests/actions";

type PurchaseRequestStatus = "pending" | "approved" | "verifying" | "paid" | "declined";

export type PurchaseRequestDetailData = {
  request: {
    id: string;
    refNumber: string;
    status: PurchaseRequestStatus;
    approvedAt: Date | null;
    declinedAt: Date | null;
    createdAt: Date;
    artistName: string;
    artistEmail: string;
    productNameSnapshot: string;
    priceCents: number;
    currency: string;
    songQty: number | null;
    unitPriceCents: number | null;
    paymentPlanSnapshot: PaymentPlan;
    paymentPlanOptionsSnapshot: PaymentPlan[];
    paymentPlanChosenAt: Date | null;
    undoableUntil: Date | null;
    contractUrlSnapshot: string | null;
  };
  agreement: {
    acceptedAt: Date | null;
    agreementUrl: string | null;
  };
};

export function PurchaseRequestDetail({ detail }: { detail: PurchaseRequestDetailData }) {
  const { request, agreement } = detail;
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const runApprove = () => {
    startTransition(async () => {
      const result = await approvePurchaseRequest({ id: request.id });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast("Purchase request approved — the artist can choose a payment plan.", "success");
      router.refresh();
    });
  };

  const runUndo = () => {
    startTransition(async () => {
      const result = await undoPurchaseApproval({ id: request.id });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast("Approval undone. This request is pending again.", "info");
      router.refresh();
    });
  };

  const runDecline = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await declinePurchaseRequest({
        id: request.id,
        ...(declineReason.trim() ? { reason: declineReason.trim() } : {}),
      });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast("Purchase request declined. The artist will receive a generic update.", "success");
      router.push("/dashboard/requests");
    });
  };

  const canDecide = request.status === "pending";
  const canUndo = request.undoableUntil !== null;

  return (
    <div className="sk-page-enter mx-auto w-full max-w-[1040px] px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-10">
      <Link
        href="/dashboard/requests"
        className="inline-flex min-h-[44px] items-center font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--brand-primary))] lg:min-h-0"
      >
        ← Back to requests
      </Link>

      <header className="mt-4 flex flex-col gap-4 border-b border-[rgb(var(--border-subtle))] pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]">
            Gate 1 · {request.refNumber}
          </p>
          <h1 className="mt-2 truncate font-display text-3xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))] sm:text-4xl">
            {request.artistName}
          </h1>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            Submitted {formatDate(request.createdAt)}
          </p>
        </div>
        <StatusPill status={request.status} />
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
        <div className="space-y-5">
          <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
            <SectionLabel>Artist</SectionLabel>
            <h2 className="mt-2 text-lg font-bold text-[rgb(var(--fg-default))]">
              {request.artistName}
            </h2>
            <a
              href={`mailto:${request.artistEmail}`}
              className="mt-1 inline-block break-all text-sm text-[rgb(var(--brand-primary))] hover:underline"
            >
              {request.artistEmail}
            </a>
          </section>

          <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
            <SectionLabel>Locked purchase</SectionLabel>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-lg font-bold text-[rgb(var(--fg-default))]">
                  {request.productNameSnapshot}
                </h2>
                {request.songQty !== null && request.unitPriceCents !== null ? (
                  <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
                    {request.songQty} {request.songQty === 1 ? "song" : "songs"} × {formatMoney(request.unitPriceCents, request.currency)}
                  </p>
                ) : null}
              </div>
              <p className="font-display text-2xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
                {formatMoney(request.priceCents, request.currency)}
              </p>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
              This is the price snapshot the artist saw when they submitted the request.
            </p>
          </section>

          <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
            <SectionLabel>Agreement</SectionLabel>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-[rgb(var(--fg-default))]">
                  {agreement.acceptedAt ? "Accepted by the artist" : "Acceptance record unavailable"}
                </h2>
                <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
                  {agreement.acceptedAt
                    ? `Recorded ${formatDate(agreement.acceptedAt)}`
                    : "No agreement timestamp was recorded for this request."}
                </p>
              </div>
              {agreement.agreementUrl ? (
                <a
                  href={agreement.agreementUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="sk-press inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-default))] hover:border-[rgb(var(--brand-primary)/0.6)]"
                >
                  View agreement ↗
                </a>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
            <SectionLabel>Payment options</SectionLabel>
            <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
              After approval, the artist chooses from the options locked with this request.
            </p>
            <ul className="mt-4 space-y-2">
              {request.paymentPlanOptionsSnapshot.map((plan) => (
                <li
                  key={planKey(plan)}
                  className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] px-3 py-2.5 text-sm font-medium text-[rgb(var(--fg-default))]"
                >
                  {formatPlan(plan)}
                </li>
              ))}
            </ul>
            {request.paymentPlanChosenAt ? (
              <p className="mt-3 text-xs text-[rgb(var(--fg-muted))]">
                Artist selected a plan {formatDate(request.paymentPlanChosenAt)}.
              </p>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
            <SectionLabel>Decision</SectionLabel>
            {canDecide ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
                  Approving unlocks payment-plan selection for the artist. No payment is taken here.
                </p>
                <button
                  type="button"
                  onClick={runApprove}
                  disabled={isPending}
                  className="sk-press flex min-h-[48px] w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-inverse))] disabled:cursor-wait disabled:opacity-60"
                >
                  {isPending ? "Saving…" : "Approve request"}
                </button>
                {!showDecline ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDecline(true);
                    }}
                    disabled={isPending}
                    className="sk-press flex min-h-[44px] w-full items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-danger))] disabled:opacity-60"
                  >
                    Decline request
                  </button>
                ) : (
                  <form onSubmit={runDecline} className="space-y-3 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.05)] p-3">
                    <label htmlFor="decline-reason" className="block text-xs font-semibold text-[rgb(var(--fg-default))]">
                      Private note (optional)
                    </label>
                    <textarea
                      id="decline-reason"
                      value={declineReason}
                      onChange={(event) => {
                        setDeclineReason(event.target.value);
                      }}
                      maxLength={2000}
                      rows={3}
                      placeholder="Only you see this. The artist receives a generic update."
                      className="w-full resize-y rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-base text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.55)] sm:text-sm"
                    />
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDecline(false);
                          setDeclineReason("");
                        }}
                        disabled={isPending}
                        className="sk-press min-h-[44px] rounded-[var(--radius-lg)] px-3 text-sm font-semibold text-[rgb(var(--fg-muted))] disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isPending}
                        className="sk-press min-h-[44px] rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-3 text-sm font-bold text-white disabled:opacity-60"
                      >
                        {isPending ? "Declining…" : "Confirm decline"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : canUndo ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
                  Approved {formatDate(request.approvedAt)}. You can undo this while the five-minute window remains open.
                </p>
                <button
                  type="button"
                  onClick={runUndo}
                  disabled={isPending}
                  className="sk-press flex min-h-[46px] w-full items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.55)] px-4 text-sm font-bold text-[rgb(var(--brand-primary))] disabled:opacity-60"
                >
                  {isPending ? "Undoing…" : "Undo approval"}
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
                {decisionDescription(request.status, request.declinedAt)}
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
      {children}
    </p>
  );
}

function StatusPill({ status }: { status: PurchaseRequestStatus }) {
  const classes: Record<PurchaseRequestStatus, string> = {
    pending: "border-[rgb(var(--brand-primary)/0.45)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]",
    approved: "border-[rgb(var(--fg-success)/0.4)] bg-[rgb(var(--fg-success)/0.1)] text-[rgb(var(--fg-success))]",
    verifying: "border-[rgb(var(--brand-primary)/0.45)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]",
    paid: "border-[rgb(var(--fg-success)/0.4)] bg-[rgb(var(--fg-success)/0.1)] text-[rgb(var(--fg-success))]",
    declined: "border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.08)] text-[rgb(var(--fg-danger))]",
  };
  return (
    <span className={`inline-flex w-fit rounded-[var(--radius-lg)] border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest ${classes[status]}`}>
      {statusLabel(status)}
    </span>
  );
}

function statusLabel(status: PurchaseRequestStatus): string {
  if (status === "pending") return "Awaiting decision";
  if (status === "approved") return "Approved";
  if (status === "verifying") return "Payment verifying";
  if (status === "paid") return "Payment received";
  return "Declined";
}

function decisionDescription(status: PurchaseRequestStatus, declinedAt: Date | null): string {
  if (status === "declined") {
    return `Declined${declinedAt ? ` ${formatDate(declinedAt)}` : ""}. The artist sees only a generic update.`;
  }
  if (status === "verifying") return "The artist submitted payment proof. Review it in the payment verification queue.";
  if (status === "paid") return "A payment has been received for this request.";
  return "This request cannot be changed from its current state.";
}

function formatPlan(plan: PaymentPlan): string {
  if (plan.kind === "full") return "Pay in full";
  if (plan.kind === "split_50_50") return "50% now · 50% later";
  if (plan.kind === "monthly") return `${String(plan.installments)} monthly installments`;
  return "Milestone payments";
}

function planKey(plan: PaymentPlan): string {
  return plan.kind === "monthly" ? `${plan.kind}-${String(plan.installments)}` : plan.kind;
}

function formatDate(value: Date | null): string {
  if (!value) return "just now";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
