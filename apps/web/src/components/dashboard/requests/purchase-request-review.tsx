"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";

import {
  approvePurchaseRequest,
  correctPurchaseTarget,
  declinePurchaseRequest,
} from "~/app/(producer)/dashboard/requests/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

export type PurchaseRequestStatus = "pending" | "approved" | "declined" | "converted";

type TargetProject = {
  id: string;
  title: string;
  lifecycleStatus: "waiting_for_payment" | "active";
  workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
  updatedAtIso: string;
};

const NOTE_PREVIEW_LENGTH = 180;

export function PurchaseRequestReview({
  id,
  initialStatus,
  initialProjectId,
  targetProjects,
  canApprove = true,
  artistName,
  artistEmail,
  productName,
  total,
  totalCaption,
  submittedAt,
  reference,
  brief,
  onPreviewDecision,
  children,
}: {
  id: string;
  initialStatus: PurchaseRequestStatus;
  initialProjectId: string | null;
  targetProjects: TargetProject[];
  canApprove?: boolean;
  artistName: string;
  artistEmail: string;
  productName: string;
  total: string | null;
  totalCaption: string;
  submittedAt: string;
  reference: string;
  brief: string | null;
  /**
   * Development gallery and the onboarding simulation only: takes the decision
   * instead of the server action, so the screen shows its own decided state
   * without creating or changing anything. Mirrors `PaymentProofReview`.
   */
  onPreviewDecision?: ((decision: "approve" | "decline") => void) | undefined;
  children: ReactNode;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const confirmationCancelRef = useRef<HTMLButtonElement>(null);
  const projectCancelRef = useRef<HTMLButtonElement>(null);
  const dialogReturnFocusRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState(initialStatus);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? "");
  const [projectChooserOpen, setProjectChooserOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<"approve" | "decline" | null>(null);
  const [fullNoteOpen, setFullNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  useEffect(() => {
    setStatus(initialStatus);
    setProjectId(initialProjectId);
    setSelectedProjectId(initialProjectId ?? "");
  }, [initialProjectId, initialStatus]);

  const projectLabel =
    projectId === null
      ? "Start a new project"
      : (targetProjects.find((project) => project.id === projectId)?.title ?? "Existing project");
  const normalizedBrief = brief?.trim() ?? "";
  const noteIsLong = normalizedBrief.length > NOTE_PREVIEW_LENGTH;
  const notePreview = noteIsLong
    ? `${normalizedBrief.slice(0, NOTE_PREVIEW_LENGTH).trimEnd()}…`
    : normalizedBrief;

  const showActionError = (message = "Something went wrong. Please try again.") => {
    setError(message);
    toast(message, "error");
  };

  const restoreDialogTrigger = (event: Event) => {
    event.preventDefault();
    dialogReturnFocusRef.current?.focus();
  };

  const runApprove = () => {
    if (!canApprove) return;
    setError(null);
    if (!online) {
      showActionError("Reconnect to approve this request.");
      return;
    }
    if (onPreviewDecision) {
      setStatus("approved");
      setConfirmation(null);
      onPreviewDecision("approve");
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
        setConfirmation(null);
        toast("Request approved.", "success");
        router.push("/dashboard");
      } catch {
        showActionError();
      }
    });
  };

  const runDecline = () => {
    setError(null);
    if (!online) {
      showActionError("Reconnect to decline this request.");
      return;
    }
    if (onPreviewDecision) {
      setStatus("declined");
      setConfirmation(null);
      onPreviewDecision("decline");
      return;
    }
    startTransition(async () => {
      try {
        const result = await declinePurchaseRequest({ id });
        if (!result.ok) {
          showActionError(result.error);
          return;
        }

        setStatus("declined");
        setConfirmation(null);
        toast("Request declined.", "success");
        router.push("/dashboard");
      } catch {
        showActionError();
      }
    });
  };

  const openConfirmation = (decision: "approve" | "decline") => {
    // The onboarding simulation renders this screen inside its own full-screen
    // overlay. A nested dialog would open beneath that overlay and could not be
    // reached, and the story is one tap per frame anyway, so the preview seam
    // decides straight away instead of asking twice.
    if (onPreviewDecision) {
      if (decision === "approve") runApprove();
      else runDecline();
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      dialogReturnFocusRef.current = document.activeElement;
    }
    setError(null);
    setConfirmation(decision);
  };

  const runTargetCorrection = () => {
    const nextProjectId = selectedProjectId || null;
    if (nextProjectId === projectId) {
      setProjectChooserOpen(false);
      return;
    }
    setError(null);
    if (!online) {
      showActionError("Reconnect to update the project.");
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
        setProjectChooserOpen(false);
        toast("Project updated.", "success");
        router.refresh();
      } catch {
        showActionError();
      }
    });
  };

  return (
    <>
      <div
        className={[
          "mt-5 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8",
          status === "pending" ? "pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-0" : "",
        ].join(" ")}
      >
        <div className="min-w-0">
          <section
            aria-labelledby="request-summary-heading"
            className="overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
          >
            <div className="border-b border-[rgb(var(--border-subtle))] px-5 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[rgb(var(--brand-primary-text))] uppercase">
                  Purchase request
                </p>
                <RequestStatus status={status} />
              </div>
              <p className="mt-5 text-xs font-semibold text-[rgb(var(--fg-muted))]">Product</p>
              <h1
                id="request-summary-heading"
                className="font-display mt-1 text-[clamp(1.65rem,4vw,2.35rem)] leading-[1.05] font-extrabold tracking-[-0.035em] [overflow-wrap:anywhere] text-[rgb(var(--fg-default))]"
              >
                {productName}
              </h1>
              {total ? (
                <p className="font-display mt-5 text-3xl font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] tabular-nums">
                  {total}
                </p>
              ) : (
                <p className="mt-5 text-sm font-semibold text-[rgb(var(--fg-warning-text))]">
                  Total unavailable
                </p>
              )}
              <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">{totalCaption}</p>
            </div>

            <dl className="grid min-w-0 divide-y divide-[rgb(var(--border-subtle))] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <SummaryFact label="Artist">
                <span className="block font-semibold text-[rgb(var(--fg-default))]">
                  {artistName}
                </span>
                <span className="mt-0.5 block text-xs break-all text-[rgb(var(--fg-muted))]">
                  {artistEmail}
                </span>
              </SummaryFact>
              <SummaryFact label="Submitted">{submittedAt}</SummaryFact>
              <SummaryFact label="Reference">
                <span className="font-mono tracking-[0.06em]">{reference}</span>
              </SummaryFact>
            </dl>

            {notePreview ? (
              <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-4 sm:px-6">
                <p className="text-xs font-semibold text-[rgb(var(--fg-default))]">Artist note</p>
                <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                  {notePreview}
                </p>
                {noteIsLong ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (document.activeElement instanceof HTMLElement) {
                        dialogReturnFocusRef.current = document.activeElement;
                      }
                      setFullNoteOpen(true);
                    }}
                    className="sk-press mt-2 inline-flex min-h-9 items-center rounded-[var(--radius-md)] text-sm font-semibold text-[rgb(var(--brand-primary-text))] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                  >
                    Read full note
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section
            aria-labelledby="request-project-heading"
            className="mt-4 flex min-w-0 items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5"
          >
            <div className="min-w-0">
              <h2
                id="request-project-heading"
                className="text-xs font-semibold text-[rgb(var(--fg-muted))]"
              >
                Project
              </h2>
              <p className="mt-0.5 truncate text-sm font-semibold text-[rgb(var(--fg-default))]">
                {projectLabel}
              </p>
            </div>
            {status === "pending" && targetProjects.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  if (document.activeElement instanceof HTMLElement) {
                    dialogReturnFocusRef.current = document.activeElement;
                  }
                  setError(null);
                  setSelectedProjectId(projectId ?? "");
                  setProjectChooserOpen(true);
                }}
                disabled={isSaving}
                className="sk-press inline-flex min-h-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] px-3 text-sm font-semibold text-[rgb(var(--brand-primary-text))] hover:bg-[rgb(var(--brand-primary)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
              >
                Change
              </button>
            ) : null}
          </section>

          <div className="mt-7">{children}</div>
        </div>

        <aside className="sticky top-6 hidden lg:block" aria-label="Request decision">
          <div className="rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-md)]">
            <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[rgb(var(--brand-primary-text))] uppercase">
              Your decision
            </p>
            <h2 className="font-display mt-2 text-xl font-bold text-[rgb(var(--fg-default))]">
              {reviewTitle(status, canApprove)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
              {reviewDescription(status, canApprove)}
            </p>

            {status === "pending" ? (
              <div className="mt-5 grid gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    openConfirmation("approve");
                  }}
                  disabled={isSaving || !canApprove || !online}
                  className="sk-press inline-flex h-12 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-on-brand))] transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openConfirmation("decline");
                  }}
                  disabled={isSaving || !online}
                  className="sk-press inline-flex h-12 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--fg-danger)/0.4)] hover:text-[rgb(var(--fg-danger))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            ) : null}

            <ActionError error={error} />
          </div>
        </aside>
      </div>

      {status === "pending" ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.96)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_32px_-20px_rgb(0_0_0/0.38)] backdrop-blur-md lg:hidden">
          <div className="mx-auto flex w-full max-w-lg gap-2.5">
            <button
              type="button"
              onClick={() => {
                openConfirmation("decline");
              }}
              disabled={isSaving || !online}
              className="sk-press inline-flex h-12 flex-1 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] px-3 text-sm font-semibold text-[rgb(var(--fg-secondary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => {
                openConfirmation("approve");
              }}
              disabled={isSaving || !canApprove || !online}
              className="sk-press inline-flex h-12 flex-[1.35] items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-sm font-bold text-[rgb(var(--fg-on-brand))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
      ) : null}

      <Dialog open={projectChooserOpen} onOpenChange={setProjectChooserOpen}>
        <DialogContent
          className="sm:max-w-md"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            projectCancelRef.current?.focus();
          }}
          onCloseAutoFocus={restoreDialogTrigger}
        >
          <DialogHeader>
            <DialogTitle>Choose a project</DialogTitle>
            <DialogDescription>
              Start new by default, or add this purchase to one of {artistName}&rsquo;s projects.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            <legend className="sr-only">Project</legend>
            <ProjectChoice
              checked={selectedProjectId === ""}
              title="Start a new project"
              context="Default"
              onChange={() => {
                setSelectedProjectId("");
              }}
            />
            {targetProjects.map((project) => (
              <ProjectChoice
                key={project.id}
                checked={selectedProjectId === project.id}
                title={project.title}
                context={projectChoiceContext(project)}
                onChange={() => {
                  setSelectedProjectId(project.id);
                }}
              />
            ))}
          </fieldset>

          <ActionError error={error} />
          <DialogFooter>
            <DialogClose asChild>
              <button
                ref={projectCancelRef}
                type="button"
                disabled={isSaving}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-sm font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={runTargetCorrection}
              disabled={isSaving || !online}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-on-brand))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Use this project"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            confirmationCancelRef.current?.focus();
          }}
          onCloseAutoFocus={restoreDialogTrigger}
        >
          <DialogHeader>
            <DialogTitle>
              {confirmation === "approve" ? "Approve this request?" : "Decline this request?"}
            </DialogTitle>
            <DialogDescription>
              {confirmation === "approve"
                ? `${artistName} can continue to payment-plan selection and agreement acceptance. No payment happens yet.`
                : `${artistName} receives a simple decline message. This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>

          {confirmation === "approve" ? (
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-4 py-3">
              <p className="text-xs font-semibold text-[rgb(var(--fg-muted))]">Project</p>
              <p className="mt-1 text-sm font-semibold break-words text-[rgb(var(--fg-default))]">
                {projectLabel}
              </p>
            </div>
          ) : null}

          <ActionError error={error} />
          <DialogFooter>
            <DialogClose asChild>
              <button
                ref={confirmationCancelRef}
                type="button"
                disabled={isSaving}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-sm font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={confirmation === "approve" ? runApprove : runDecline}
              disabled={isSaving || !online || (confirmation === "approve" && !canApprove)}
              className={[
                "sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-sm font-bold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50",
                confirmation === "approve"
                  ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]"
                  : "border border-[rgb(var(--fg-danger)/0.42)] text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.07)]",
              ].join(" ")}
            >
              {isSaving
                ? confirmation === "approve"
                  ? "Approving…"
                  : "Declining…"
                : confirmation === "approve"
                  ? "Approve request"
                  : "Decline request"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fullNoteOpen} onOpenChange={setFullNoteOpen}>
        <DialogContent className="sm:max-w-lg" onCloseAutoFocus={restoreDialogTrigger}>
          <DialogHeader>
            <DialogTitle>Artist note</DialogTitle>
            <DialogDescription>Submitted with this purchase request.</DialogDescription>
          </DialogHeader>
          <p className="max-h-[56vh] overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
            {normalizedBrief}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SummaryFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4 sm:px-4">
      <dt className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">{label}</dt>
      <dd className="mt-1 text-sm break-words text-[rgb(var(--fg-secondary))]">{children}</dd>
    </div>
  );
}

function RequestStatus({ status }: { status: PurchaseRequestStatus }) {
  const label =
    status === "converted" ? "Accepted" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className="rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--fg-secondary))]">
      {label}
    </span>
  );
}

function ProjectChoice({
  checked,
  title,
  context,
  onChange,
}: {
  checked: boolean;
  title: string;
  context: string;
  onChange: () => void;
}) {
  return (
    <label
      className={[
        "flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-lg)] border px-3 py-2.5 transition-colors",
        checked
          ? "border-[rgb(var(--brand-primary)/0.65)] bg-[rgb(var(--brand-primary)/0.08)]"
          : "border-[rgb(var(--border-subtle))] hover:bg-[rgb(var(--bg-sunken))]",
      ].join(" ")}
    >
      <input
        type="radio"
        name="purchase-project"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-[rgb(var(--brand-primary))]"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[rgb(var(--fg-default))]">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-[rgb(var(--fg-muted))]">{context}</span>
      </span>
    </label>
  );
}

function ActionError({ error }: { error: string | null }) {
  return (
    <p
      role={error ? "alert" : undefined}
      aria-live="polite"
      className={error ? "mt-3 text-sm text-[rgb(var(--fg-danger))]" : "sr-only"}
    >
      {error ?? ""}
    </p>
  );
}

function projectChoiceContext(project: TargetProject): string {
  const lifecycle =
    project.lifecycleStatus === "waiting_for_payment" ? "Waiting for payment" : "Active";
  const stage = project.workflowStage.charAt(0).toUpperCase() + project.workflowStage.slice(1);
  return `${lifecycle} · ${stage}`;
}

function reviewTitle(status: PurchaseRequestStatus, canApprove: boolean): string {
  if (status === "pending") return canApprove ? "Approve or decline" : "Terms need attention";
  if (status === "approved") return "Request approved";
  if (status === "converted") return "Agreement accepted";
  return "Request declined";
}

function reviewDescription(status: PurchaseRequestStatus, canApprove: boolean): string {
  if (status === "pending") {
    return canApprove
      ? "Approve when the work and terms look right. No payment happens on this screen."
      : "The current Store terms are unavailable, so approval is disabled. You can still decline the request.";
  }
  if (status === "approved") {
    return canApprove
      ? "The Artist can choose a payment plan and accept the full agreement. No payment happened at approval."
      : "The request is approved, but the Artist cannot continue while the current Store terms are unavailable.";
  }
  if (status === "converted") {
    return "The Artist accepted the agreement. This request is now a read-only record.";
  }
  return "The Artist received a simple decline message. This request is now read-only.";
}
