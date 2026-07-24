"use client";

import type { PaymentPlan, PurchaseCommercialSnapshot } from "@skitza/db";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  acceptPrivateOfferAction,
  rejectPrivateOfferAction,
} from "~/app/(artist)/artist/offers/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";
import {
  createInstallmentSchedule,
  purchaseInstallmentDueLabel,
  purchaseInstallmentTriggerLabel,
} from "~/server/domain/purchases/ledger";

type ResultState =
  | { kind: "accepted"; lifecycleStatus: "waiting_for_payment" | "active" }
  | { kind: "rejected" }
  | null;

function planKey(plan: PaymentPlan): string {
  return plan.kind === "monthly" ? `monthly:${String(plan.installments)}` : plan.kind;
}

function planLabel(plan: PaymentPlan): string {
  if (plan.kind === "full") return "Pay in full";
  if (plan.kind === "split_50_50") return "50% now, 50% on final approval";
  return `${String(plan.installments)} monthly payments`;
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function PrivateOfferResponse({
  offerId,
  studioId,
  updatedAt,
  targetProjectTitle,
  snapshot,
}: {
  offerId: string;
  studioId: string;
  updatedAt: Date;
  targetProjectTitle: string | null;
  snapshot: PurchaseCommercialSnapshot;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const firstPlan = snapshot.offeredPaymentPlans[0] ?? null;
  const [selectedKey, setSelectedKey] = useState(firstPlan ? planKey(firstPlan) : "");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResultState>(null);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectedPlan =
    snapshot.offeredPaymentPlans.find((plan) => planKey(plan) === selectedKey) ?? null;
  const schedule = useMemo(
    () => (selectedPlan ? createInstallmentSchedule(selectedPlan, snapshot.totalCents) : []),
    [selectedPlan, snapshot.totalCents],
  );

  if (result) {
    return (
      <section
        role="status"
        className="rounded-[var(--radius-lg)] border p-5"
        style={{
          borderColor: "rgb(var(--border-subtle))",
          background: "rgb(var(--bg-elevated))",
        }}
      >
        <h2 className="font-display text-xl font-extrabold text-[rgb(var(--fg-default))]">
          {result.kind === "rejected"
            ? "Offer rejected"
            : result.lifecycleStatus === "active"
              ? "Accepted — your project is active"
              : "Accepted — waiting for payment"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          {result.kind === "rejected"
            ? "The producer can see your response in their offer history."
            : result.lifecycleStatus === "active"
              ? "No payment was due. Skitza activated this purchase exactly once."
              : "Your exact terms are locked. Your producer will share the next payment step."}
        </p>
        <Link
          href={withArtistStudio("/artist", studioId)}
          className="sk-press mt-4 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-semibold text-[rgb(var(--fg-on-brand))]"
        >
          Back to Artist Home
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="offer-response-title"
      className="rounded-[var(--radius-lg)] border p-4 sm:p-5"
      style={{
        borderColor: "rgb(var(--border-subtle))",
        background: "rgb(var(--bg-elevated))",
      }}
    >
      <h2
        id="offer-response-title"
        className="font-display text-lg font-extrabold text-[rgb(var(--fg-default))]"
      >
        Respond to this offer
      </h2>

      {snapshot.totalCents > 0 ? (
        <fieldset className="mt-4 space-y-2">
          <legend className="text-xs font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
            Choose a payment plan
          </legend>
          {snapshot.offeredPaymentPlans.map((plan) => {
            const key = planKey(plan);
            return (
              <label
                key={key}
                className="sk-press flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-lg)] border px-3 py-2 text-sm"
                style={{
                  borderColor:
                    selectedKey === key ? "rgb(var(--brand-primary))" : "rgb(var(--border-subtle))",
                }}
              >
                <input
                  type="radio"
                  name="private-offer-plan"
                  value={key}
                  checked={selectedKey === key}
                  onChange={() => {
                    setSelectedKey(key);
                  }}
                />
                <span className="font-semibold text-[rgb(var(--fg-default))]">
                  {planLabel(plan)}
                </span>
              </label>
            );
          })}
          {selectedPlan ? (
            <ol className="rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] p-3 text-xs text-[rgb(var(--fg-secondary))]">
              {schedule.map((installment) => (
                <li
                  key={`${selectedKey}-${String(installment.sequence)}`}
                  className="flex items-start justify-between gap-3 py-1"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-[rgb(var(--fg-default))]">
                      {purchaseInstallmentDueLabel(selectedPlan, installment.sequence)}
                    </span>
                    <span className="block text-[rgb(var(--fg-muted))]">
                      {purchaseInstallmentTriggerLabel(installment.trigger)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono font-bold">
                    {money(installment.amountCents, snapshot.currency)}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </fieldset>
      ) : (
        <p className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] p-3 text-sm font-semibold text-[rgb(var(--fg-default))]">
          No cash payment is due. Accepting activates the project immediately.
        </p>
      )}

      <label className="sk-press mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] py-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
        <input
          type="checkbox"
          className="mt-1"
          checked={agreed}
          onChange={(event) => {
            setAgreed(event.target.checked);
          }}
        />
        <span>I reviewed and agree to the exact offer, project target, and selected schedule.</span>
      </label>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger-text))]">
          {error}
        </p>
      ) : null}

      {!online ? (
        <p
          role="status"
          className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-3 py-2.5 text-sm text-[rgb(var(--fg-secondary))]"
        >
          Reconnect to accept or reject this offer. Nothing changes while offline.
        </p>
      ) : null}

      {confirmingReject ? (
        <div
          role="group"
          aria-labelledby="reject-offer-confirm-title"
          className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.06)] p-4"
        >
          <p
            id="reject-offer-confirm-title"
            className="text-sm font-bold text-[rgb(var(--fg-default))]"
          >
            Reject this offer?
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
            The producer will see that you rejected it. You cannot accept this offer afterward.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              autoFocus
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirmingReject(false);
              }}
              className="sk-press min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-default))] disabled:opacity-50"
            >
              Keep offer
            </button>
            <button
              type="button"
              disabled={pending || !online}
              onClick={() => {
                setError("");
                startTransition(async () => {
                  try {
                    const response = await rejectPrivateOfferAction(offerId);
                    if (!response.ok) {
                      setError(response.error);
                      return;
                    }
                    setResult({ kind: "rejected" });
                  } catch {
                    setError("Couldn’t reject this offer. Check your connection and try again.");
                  }
                });
              }}
              className="sk-press min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.4)] px-4 text-sm font-bold text-[rgb(var(--fg-danger))] disabled:opacity-50"
            >
              {pending ? "Rejecting…" : "Confirm rejection"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError("");
              setConfirmingReject(true);
            }}
            className="sk-press min-h-11 rounded-[var(--radius-lg)] border px-4 text-sm font-semibold text-[rgb(var(--fg-default))] disabled:opacity-50"
            style={{ borderColor: "rgb(var(--border-subtle))" }}
          >
            Reject offer
          </button>
          <button
            type="button"
            disabled={
              pending || !online || !agreed || (snapshot.totalCents > 0 && selectedPlan === null)
            }
            onClick={() => {
              setError("");
              startTransition(async () => {
                try {
                  const response = await acceptPrivateOfferAction({
                    offerId,
                    expectedUpdatedAt: updatedAt.toISOString(),
                    expectedTargetProjectTitle: targetProjectTitle,
                    selectedPaymentPlan: snapshot.totalCents === 0 ? null : selectedPlan,
                    agreementAccepted: true,
                  });
                  if (!response.ok) {
                    setError(response.error);
                    return;
                  }
                  if (response.lifecycleStatus === "waiting_for_payment") {
                    router.push(
                      withArtistStudio(
                        `/artist/payments/${encodeURIComponent(response.purchaseId)}`,
                        studioId,
                      ),
                    );
                    return;
                  }
                  setResult({ kind: "accepted", lifecycleStatus: response.lifecycleStatus });
                } catch {
                  setError("Couldn’t accept this offer. Check your connection and try again.");
                }
              });
            }}
            className="sk-press min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-on-brand))] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Accept offer"}
          </button>
        </div>
      )}
    </section>
  );
}
