"use client";

import { useRouter } from "next/navigation";
import { type SyntheticEvent, useEffect, useState, useTransition } from "react";

import {
  approvePurchaseRequest,
  declinePurchaseRequest,
  undoPurchaseApproval,
} from "~/app/(producer)/dashboard/requests/actions";
import { useToast } from "~/components/ui/toast";
import { isApprovalUndoAvailable } from "~/lib/purchase/approval-undo";

export type PurchaseRequestStatus = "pending" | "approved" | "verifying" | "paid" | "declined";

export function PurchaseRequestReview({
  id,
  initialStatus,
  initialUndoableUntilIso,
}: {
  id: string;
  initialStatus: PurchaseRequestStatus;
  initialUndoableUntilIso: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState(initialStatus);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [undoableUntilIso, setUndoableUntilIso] = useState<string | null>(initialUndoableUntilIso);
  const [isPending, startTransition] = useTransition();
  const canUndo = status === "approved" && isApprovalUndoAvailable(undoableUntilIso);

  useEffect(() => {
    setStatus(initialStatus);
    setUndoableUntilIso(initialStatus === "approved" ? initialUndoableUntilIso : null);
  }, [initialStatus, initialUndoableUntilIso]);

  useEffect(() => {
    if (!undoableUntilIso) return;

    const remainingMs = Date.parse(undoableUntilIso) - Date.now();
    const timer = window.setTimeout(
      () => {
        setUndoableUntilIso(null);
      },
      Math.max(0, remainingMs),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [undoableUntilIso]);

  const showActionError = (message = "Something went wrong. Please try again.") => {
    setError(message);
    toast(message, "error");
  };

  const runApprove = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await approvePurchaseRequest({ id });
        if (!result.ok) {
          showActionError(result.error);
          return;
        }
        if (result.status !== "approved") {
          showActionError("This request changed. Refresh and try again.");
          return;
        }

        setStatus("approved");
        setUndoableUntilIso(result.undoableUntilIso);
        setShowDecline(false);
        toast("Request approved. The artist can continue to payment.", "success");
        router.refresh();
      } catch {
        showActionError();
      }
    });
  };

  const runUndo = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await undoPurchaseApproval({ id });
        if (!result.ok) {
          showActionError(result.error);
          return;
        }

        setStatus("pending");
        setUndoableUntilIso(null);
        toast("Approval undone. The request is pending again.", "info");
        router.refresh();
      } catch {
        showActionError();
      }
    });
  };

  const runDecline = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const reason = declineReason.trim();
        const result = await declinePurchaseRequest({
          id,
          ...(reason ? { reason } : {}),
        });
        if (!result.ok) {
          showActionError(result.error);
          return;
        }

        setStatus("declined");
        toast("Request declined. The artist received a generic update.", "success");
        router.push("/dashboard/requests");
      } catch {
        showActionError();
      }
    });
  };

  return (
    <section
      aria-labelledby="request-review-heading"
      className="border-b border-[rgb(var(--border-subtle))] py-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md">
          <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
            Gate 1 review
          </p>
          <h2
            id="request-review-heading"
            className="font-display mt-1 text-lg font-bold text-[rgb(var(--fg-default))]"
          >
            {reviewTitle(status)}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
            {reviewDescription(status, canUndo)}
          </p>
        </div>

        {status === "pending" ? (
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setShowDecline((visible) => !visible);
              }}
              disabled={isPending}
              aria-expanded={showDecline}
              aria-controls="decline-request-form"
              className="sk-press inline-flex h-10 flex-1 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--fg-danger)/0.45)] hover:text-[rgb(var(--fg-danger))] disabled:cursor-wait disabled:opacity-50 sm:flex-none"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={runApprove}
              disabled={isPending}
              className="sk-press inline-flex h-10 flex-[1.35] items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--bg-sidebar))] transition-[filter] hover:brightness-105 disabled:cursor-wait disabled:opacity-55 sm:flex-none"
            >
              {isPending ? "Saving…" : "Approve request"}
            </button>
          </div>
        ) : canUndo ? (
          <button
            type="button"
            onClick={runUndo}
            disabled={isPending}
            className="sk-press inline-flex h-10 w-full shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--brand-primary)/0.55)] hover:text-[rgb(var(--brand-primary-text))] disabled:cursor-wait disabled:opacity-50 sm:w-auto"
          >
            {isPending ? "Undoing…" : "Undo recent approval"}
          </button>
        ) : null}
      </div>

      {showDecline && status === "pending" ? (
        <form
          id="decline-request-form"
          onSubmit={runDecline}
          className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.22)] bg-[rgb(var(--fg-danger)/0.04)] p-3"
        >
          <label
            htmlFor="decline-reason"
            className="block text-xs font-semibold text-[rgb(var(--fg-default))]"
          >
            Private note (optional)
          </label>
          <p
            id="decline-reason-help"
            className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]"
          >
            Only you see this note. The artist receives a generic update.
          </p>
          <textarea
            id="decline-reason"
            aria-describedby="decline-reason-help"
            value={declineReason}
            onChange={(event) => {
              setDeclineReason(event.target.value);
            }}
            maxLength={2000}
            rows={3}
            autoFocus
            className="mt-3 w-full resize-y rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-base text-[rgb(var(--fg-default))] transition-shadow outline-none placeholder:text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.55)] sm:text-sm"
            placeholder="Add context for your records"
          />
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setShowDecline(false);
                setDeclineReason("");
                setError(null);
              }}
              disabled={isPending}
              className="sk-press inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="sk-press inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.4)] px-4 text-sm font-semibold text-[rgb(var(--fg-danger))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)] disabled:cursor-wait disabled:opacity-50"
            >
              {isPending ? "Declining…" : "Confirm decline"}
            </button>
          </div>
        </form>
      ) : null}

      <p
        role={error ? "alert" : undefined}
        aria-live="polite"
        className={error ? "mt-3 text-sm text-[rgb(var(--fg-danger))]" : "sr-only"}
      >
        {error ?? ""}
      </p>
    </section>
  );
}

function reviewTitle(status: PurchaseRequestStatus): string {
  if (status === "pending") return "Ready for your decision";
  if (status === "approved") return "Request approved";
  if (status === "verifying") return "Payment is being verified";
  if (status === "paid") return "Payment received";
  return "Request declined";
}

function reviewDescription(status: PurchaseRequestStatus, canUndo: boolean): string {
  if (status === "pending") {
    return "Approving lets the artist choose from the frozen payment options below. No payment is taken here.";
  }
  if (status === "approved") {
    return canUndo
      ? "The artist can continue to payment. You can undo this approval while the five-minute safety window remains open."
      : "The artist can continue to payment. Approval changes are limited to a short safety window.";
  }
  if (status === "verifying") {
    return "The artist submitted payment proof and this request can no longer be changed here.";
  }
  if (status === "paid") {
    return "Payment has been confirmed and this request can no longer be changed here.";
  }
  return "The artist sees a generic update. Your private note is never shared with them.";
}
