"use client";

import { useRouter } from "next/navigation";
import { type SyntheticEvent, useEffect, useState, useTransition } from "react";

import {
  approvePurchaseRequest,
  correctPurchaseTarget,
  declinePurchaseRequest,
  undoPurchaseApproval,
} from "~/app/(producer)/dashboard/requests/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { isApprovalUndoAvailable } from "~/lib/purchase/approval-undo";

export type PurchaseRequestStatus = "pending" | "approved" | "verifying" | "paid" | "declined";

export function PurchaseRequestReview({
  id,
  initialStatus,
  initialUndoableUntilIso,
  initialProjectId,
  targetProjects,
  canApprove = true,
}: {
  id: string;
  initialStatus: PurchaseRequestStatus;
  initialUndoableUntilIso: string | null;
  initialProjectId: string | null;
  targetProjects: Array<{
    id: string;
    title: string;
    lifecycleStatus: "waiting_for_payment" | "active";
    workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
    updatedAtIso: string;
  }>;
  canApprove?: boolean;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const [status, setStatus] = useState(initialStatus);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [undoableUntilIso, setUndoableUntilIso] = useState<string | null>(initialUndoableUntilIso);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? "");
  const [isPending, startTransition] = useTransition();
  const canUndo = status === "approved" && isApprovalUndoAvailable(undoableUntilIso);

  useEffect(() => {
    setStatus(initialStatus);
    setUndoableUntilIso(initialStatus === "approved" ? initialUndoableUntilIso : null);
    setProjectId(initialProjectId);
    setSelectedProjectId(initialProjectId ?? "");
  }, [initialProjectId, initialStatus, initialUndoableUntilIso]);

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
    if (!canApprove) return;
    setError(null);
    if (!online) {
      showActionError("Reconnect to approve this request.");
      return;
    }
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
        toast(
          "Request approved. The artist can choose a plan, review the exact agreement, and accept.",
          "success",
        );
        router.refresh();
      } catch {
        showActionError();
      }
    });
  };

  const runTargetCorrection = () => {
    const nextProjectId = selectedProjectId || null;
    if (nextProjectId === projectId) return;
    setError(null);
    if (!online) {
      showActionError("Reconnect to update the purchase target.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await correctPurchaseTarget({
          purchaseRequestId: id,
          projectId: nextProjectId,
        });
        if (!result.ok) {
          showActionError(result.error);
          return;
        }
        setProjectId(result.projectId);
        toast("Purchase target updated.", "success");
        router.refresh();
      } catch {
        showActionError();
      }
    });
  };

  const runUndo = () => {
    setError(null);
    if (!online) {
      showActionError("Reconnect to undo this approval.");
      return;
    }
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
    if (!online) {
      showActionError("Reconnect to decline this request.");
      return;
    }
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
            {reviewTitle(status, canApprove)}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
            {reviewDescription(status, canUndo, canApprove)}
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
              className="sk-press inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--fg-danger)/0.45)] hover:text-[rgb(var(--fg-danger))] disabled:cursor-wait disabled:opacity-50 sm:flex-none"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={runApprove}
              disabled={isPending || !canApprove || !online}
              className="sk-press inline-flex min-h-11 flex-[1.35] items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--bg-sidebar))] transition-[filter] hover:brightness-105 disabled:cursor-wait disabled:opacity-55 sm:flex-none"
            >
              {isPending ? "Saving…" : "Approve request"}
            </button>
          </div>
        ) : canUndo ? (
          <button
            type="button"
            onClick={runUndo}
            disabled={isPending || !online}
            className="sk-press inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--brand-primary)/0.55)] hover:text-[rgb(var(--brand-primary-text))] disabled:cursor-wait disabled:opacity-50 sm:w-auto"
          >
            {isPending ? "Undoing…" : "Undo recent approval"}
          </button>
        ) : null}
      </div>

      {(status === "pending" || status === "approved") &&
      (projectId !== null || targetProjects.length > 0) ? (
        <div className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3">
          <label
            htmlFor="purchase-project-target"
            className="block text-xs font-semibold text-[rgb(var(--fg-default))]"
          >
            Project target
          </label>
          <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
            {projectId
              ? "You may correct this to another project for the same artist until they accept."
              : "A new project will be created by default. Choose an existing project only when this purchase belongs there."}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select
              id="purchase-project-target"
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
              }}
              disabled={isPending}
              className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base text-[rgb(var(--fg-default))] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.55)] disabled:opacity-50 sm:text-sm"
            >
              <option value="">Start a new project (default)</option>
              {targetProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title} · {project.lifecycleStatus.replaceAll("_", " ")} ·{" "}
                  {project.workflowStage} · updated {new Date(project.updatedAtIso).toLocaleDateString()}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={runTargetCorrection}
              disabled={isPending || (selectedProjectId || null) === projectId || !online}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--brand-primary)/0.55)] hover:text-[rgb(var(--brand-primary-text))] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isPending ? "Saving…" : "Save target"}
            </button>
          </div>
        </div>
      ) : null}

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
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !online}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.4)] px-4 text-sm font-semibold text-[rgb(var(--fg-danger))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)] disabled:cursor-wait disabled:opacity-50"
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

function reviewTitle(status: PurchaseRequestStatus, canApprove: boolean): string {
  if (status === "pending") return canApprove ? "Ready for your decision" : "Terms need attention";
  if (status === "approved") return "Request approved";
  if (status === "verifying") return "Payment is being verified";
  if (status === "paid") return "Payment received";
  return "Request declined";
}

function reviewDescription(
  status: PurchaseRequestStatus,
  canUndo: boolean,
  canApprove: boolean,
): string {
  if (status === "pending") {
    if (!canApprove) {
      return "The current Store terms are invalid, so approval is unavailable. You can still decline this request with a private note.";
    }
    return "Approving lets the artist review the current terms and choose an enabled payment plan. Nothing is frozen until final acceptance, and no payment is taken here.";
  }
  if (status === "approved") {
    if (!canApprove) {
      return "This request remains approved, but the artist cannot continue while the Store product is hidden, archived, or invalid. Restore valid published terms before they choose a plan and accept.";
    }
    return canUndo
      ? "The artist can now choose an enabled plan, review the exact agreement, and accept it before receiving external payment instructions. You can undo this approval while the five-minute safety window remains open."
      : "The artist can now choose an enabled plan, review the exact agreement, and accept it before receiving external payment instructions. Approval changes are limited to a short safety window.";
  }
  if (status === "verifying") {
    return "This accepted purchase can no longer be changed in Requests. Payment follow-up belongs in Payments.";
  }
  if (status === "paid") {
    return "Payment has been confirmed and this request can no longer be changed here.";
  }
  return "The artist sees a generic update. Your private note is never shared with them.";
}
