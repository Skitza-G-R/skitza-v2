"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Ban, CalendarClock, CircleDollarSign, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { cancelProjectPurchaseAction } from "~/app/(producer)/dashboard/clients-projects/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";

export type ProjectPurchaseSourceKind =
  | "store_product"
  | "private_offer"
  | "session_product"
  | "paid_add_on"
  | "no_charge_add_on"
  | "imported_existing_work";

export type ProjectPurchaseLifecycleStatus = "waiting_for_payment" | "active" | "canceled";

export type ProjectPurchaseInstallmentStatus =
  | "not_paid"
  | "awaiting_review"
  | "partially_paid"
  | "confirmed"
  | "overdue"
  | "waived"
  | "canceled";

export interface ProjectPurchaseInstallment {
  id: string;
  /** One-based schedule position from the accepted purchase. */
  position: number;
  amountCents: number;
  currency: string;
  dueAtIso: string | null;
  status: ProjectPurchaseInstallmentStatus;
  /** Amount still unpaid after confirmed payments and waivers. */
  remainingCents: number;
  /** True while an artist proof for this installment waits for review. */
  hasPendingProof: boolean;
  /** True when the ledger lets money land on this installment right now. */
  payableNow: boolean;
}

export interface ProjectPurchaseSummary {
  id: string;
  sourceKind: ProjectPurchaseSourceKind;
  /** Frozen product, offer, session, or add-on name from the purchase snapshot. */
  sourceLabel: string;
  lifecycleStatus: ProjectPurchaseLifecycleStatus;
  totalCents: number;
  currency: string;
  installments: readonly ProjectPurchaseInstallment[];
  reference?: string | null | undefined;
  provenanceNotice?: string | null | undefined;
}

export interface ProjectPurchasesPanelProps {
  projectId: string;
  purchases: readonly ProjectPurchaseSummary[];
  className?: string | undefined;
  onPurchaseCanceled?: ((purchaseId: string) => void) | undefined;
}

const SOURCE_LABELS: Record<ProjectPurchaseSourceKind, string> = {
  store_product: "Store product",
  private_offer: "Private offer",
  session_product: "Session product",
  paid_add_on: "Paid add-on",
  no_charge_add_on: "No-charge add-on",
  imported_existing_work: "Existing agreement",
};

const PURCHASE_STATUS_LABELS: Record<ProjectPurchaseLifecycleStatus, string> = {
  waiting_for_payment: "Waiting for payment",
  active: "Active",
  canceled: "Canceled",
};

const INSTALLMENT_STATUS_LABELS: Record<ProjectPurchaseInstallmentStatus, string> = {
  not_paid: "Not paid",
  awaiting_review: "Awaiting review",
  partially_paid: "Partially paid",
  confirmed: "Paid",
  overdue: "Overdue",
  waived: "Waived",
  canceled: "Canceled",
};

export function ProjectPurchasesPanel({
  projectId,
  purchases,
  className,
  onPurchaseCanceled,
}: ProjectPurchasesPanelProps) {
  const [selectedPurchase, setSelectedPurchase] = useState<ProjectPurchaseSummary | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setSelectedPurchase(null);
  }, [projectId]);

  return (
    <section
      aria-labelledby={`project-purchases-title-${projectId}`}
      className={[
        "rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 sm:p-4",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default)/0.055)] text-[rgb(var(--fg-default))]"
        >
          <CircleDollarSign size={19} strokeWidth={2.1} />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={`project-purchases-title-${projectId}`}
            className="font-display text-[16px] font-extrabold tracking-[-0.015em] text-[rgb(var(--fg-default))]"
          >
            Purchases &amp; add-ons
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
            Cancel one purchase without canceling the whole project.
          </p>
        </div>
      </div>

      {purchases.length === 0 ? (
        <div className="mt-4 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] px-3 py-5 text-center text-[12.5px] text-[rgb(var(--fg-muted))]">
          No purchases or add-ons yet.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {purchases.map((purchase) => {
            const canceled = purchase.lifecycleStatus === "canceled";
            const addOn =
              purchase.sourceKind === "paid_add_on" || purchase.sourceKind === "no_charge_add_on";

            return (
              <li
                key={purchase.id}
                className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <h3 className="min-w-0 text-[14px] font-bold break-words text-[rgb(var(--fg-default))]">
                        {purchase.sourceLabel}
                      </h3>
                      <PurchaseStatus status={purchase.lifecycleStatus} />
                    </div>
                    <p className="mt-1 text-[11.5px] text-[rgb(var(--fg-muted))]">
                      {SOURCE_LABELS[purchase.sourceKind]}
                      {purchase.reference ? ` · ${purchase.reference}` : ""}
                    </p>
                    {purchase.provenanceNotice ? (
                      <p className="mt-2 max-w-[52ch] rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.07)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
                        {purchase.provenanceNotice}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-2">
                    <div className="text-right">
                      <span className="font-mono text-[13px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
                        {formatMoney(purchase.totalCents, purchase.currency)}
                      </span>
                      <span className="ml-1 font-mono text-[9.5px] font-bold tracking-wide text-[rgb(var(--fg-muted))] uppercase">
                        {purchase.currency.toUpperCase()}
                      </span>
                    </div>
                    {!canceled ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          returnFocusRef.current = event.currentTarget;
                          setSelectedPurchase(purchase);
                        }}
                        className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.24)] bg-[rgb(var(--fg-danger)/0.055)] px-3 text-[12.5px] font-semibold text-[rgb(var(--fg-danger-text))] hover:bg-[rgb(var(--fg-danger)/0.1)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                      >
                        <Ban size={13} strokeWidth={2.2} aria-hidden />
                        Cancel {addOn ? "add-on" : "purchase"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <InstallmentList installments={purchase.installments} />
              </li>
            );
          })}
        </ul>
      )}

      {selectedPurchase ? (
        <CancelPurchaseDialog
          open
          onClose={() => {
            setSelectedPurchase(null);
          }}
          projectId={projectId}
          purchase={selectedPurchase}
          onCanceled={onPurchaseCanceled}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
    </section>
  );
}

function InstallmentList({
  installments,
}: {
  installments: readonly ProjectPurchaseInstallment[];
}) {
  if (installments.length === 0) {
    return (
      <p className="mt-3 border-t border-[rgb(var(--border-subtle))] pt-3 text-[12px] text-[rgb(var(--fg-muted))]">
        No installment schedule.
      </p>
    );
  }

  const ordered = [...installments].sort((left, right) => left.position - right.position);
  return (
    <div className="mt-3 border-t border-[rgb(var(--border-subtle))] pt-3">
      <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        Installments
      </p>
      <ul className="space-y-1.5">
        {ordered.map((installment) => (
          <li
            key={installment.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default)/0.03)] px-2.5 py-2"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                Installment {installment.position}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[rgb(var(--fg-muted))]">
                <CalendarClock size={11} strokeWidth={2} aria-hidden />
                {installment.dueAtIso ? formatDueDate(installment.dueAtIso) : "No due date"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono text-[11.5px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
                {formatMoney(installment.amountCents, installment.currency)}
              </span>
              <InstallmentStatus status={installment.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PurchaseStatus({ status }: { status: ProjectPurchaseLifecycleStatus }) {
  const tone =
    status === "active"
      ? "border-[rgb(var(--fg-success)/0.2)] bg-[rgb(var(--fg-success)/0.08)] text-[rgb(var(--fg-success-text))]"
      : status === "canceled"
        ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--fg-default)/0.04)] text-[rgb(var(--fg-muted))]"
        : "border-[rgb(var(--brand-primary)/0.25)] bg-[rgb(var(--brand-primary)/0.09)] text-[rgb(var(--brand-primary-dark))]";
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-[var(--radius-lg)] border px-2 text-[10.5px] font-bold ${tone}`}
    >
      {PURCHASE_STATUS_LABELS[status]}
    </span>
  );
}

function InstallmentStatus({ status }: { status: ProjectPurchaseInstallmentStatus }) {
  const tone =
    status === "confirmed"
      ? "bg-[rgb(var(--fg-success)/0.09)] text-[rgb(var(--fg-success-text))]"
      : status === "overdue"
        ? "bg-[rgb(var(--fg-danger)/0.09)] text-[rgb(var(--fg-danger-text))]"
        : status === "awaiting_review" || status === "partially_paid"
          ? "bg-[rgb(var(--brand-primary)/0.1)] text-[rgb(var(--brand-primary-dark))]"
          : "bg-[rgb(var(--fg-default)/0.05)] text-[rgb(var(--fg-muted))]";
  return (
    <span
      className={`inline-flex min-h-5 items-center rounded-[var(--radius-lg)] px-1.5 text-[9.5px] font-bold ${tone}`}
    >
      {INSTALLMENT_STATUS_LABELS[status]}
    </span>
  );
}

interface CancelPurchaseDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  purchase: ProjectPurchaseSummary;
  onCanceled?: ((purchaseId: string) => void) | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}

function CancelPurchaseDialog({
  open,
  onClose,
  projectId,
  purchase,
  onCanceled,
  returnFocusRef,
}: CancelPurchaseDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, startTransition] = useTransition();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const addOn = purchase.sourceKind === "paid_add_on" || purchase.sourceKind === "no_charge_add_on";
  const cleanReason = reason.trim();

  useEffect(() => {
    if (!open) return;
    setReason("");
    setTouched(false);
  }, [open, purchase.id]);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!cleanReason) {
      reasonRef.current?.focus();
      return;
    }
    if (!online) {
      toast("Reconnect to cancel this purchase.", "error");
      return;
    }

    startTransition(async () => {
      try {
        const result = await cancelProjectPurchaseAction({
          projectId,
          purchaseId: purchase.id,
          reason: cleanReason,
        });
        if (!result.ok) {
          toast(result.error, "error");
          return;
        }

        toast(`${purchase.sourceLabel} canceled`, "success");
        onCanceled?.(purchase.id);
        router.refresh();
        onClose();
      } catch {
        toast("Could not cancel this purchase. Try again.", "error");
      }
    });
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            reasonRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[500px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.1)] text-[rgb(var(--fg-danger))]"
            >
              <Ban size={19} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                Cancel {purchase.sourceLabel}?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                This cancels only this {addOn ? "add-on" : "purchase"}. The project status does not
                change.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={pending}
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                <X size={16} strokeWidth={2.2} aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.18)] bg-[rgb(var(--fg-danger)/0.055)] p-3.5 text-[12.5px] leading-relaxed text-[rgb(var(--fg-danger-text))]">
            <ul className="space-y-1.5">
              <li>Only future installments are canceled.</li>
              <li>Due and overdue amounts remain unless explicitly waived.</li>
              <li>Paid amounts and history remain.</li>
              <li>No refund, credit, or money movement happens automatically.</li>
              <li>Any unused session allowance tied to this purchase closes permanently.</li>
            </ul>
          </div>

          <form onSubmit={handleSubmit} className="mt-4">
            <label
              htmlFor={`cancel-purchase-reason-${purchase.id}`}
              className="text-[12px] font-semibold text-[rgb(var(--fg-default))]"
            >
              Cancellation reason
            </label>
            <textarea
              ref={reasonRef}
              id={`cancel-purchase-reason-${purchase.id}`}
              required
              rows={3}
              maxLength={500}
              value={reason}
              aria-invalid={touched && !cleanReason}
              placeholder="Record why this purchase is being canceled"
              onChange={(event) => {
                setReason(event.target.value);
              }}
              onBlur={() => {
                setTouched(true);
              }}
              className="mt-1.5 w-full resize-y rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 text-[16px] leading-relaxed text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:text-[14px]"
            />
            {touched && !cleanReason ? (
              <p className="mt-1 text-[12px] text-[rgb(var(--fg-danger-text))]">
                Enter a cancellation reason.
              </p>
            ) : (
              <p className="mt-1 text-[11.5px] text-[rgb(var(--fg-muted))]">
                Saved in the project history.
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
              >
                Keep purchase
              </button>
              <button
                type="submit"
                disabled={pending || !cleanReason}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-4 text-[13px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--fg-danger)/0.5)] disabled:opacity-45 disabled:shadow-none"
              >
                {pending ? "Canceling…" : `Cancel ${addOn ? "add-on" : "purchase"}`}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

function formatDueDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Due date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
