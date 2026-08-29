"use client";

import { HandCoins, ImageUp } from "lucide-react";
import { type DragEvent, useMemo, useRef, useState } from "react";

import { RecordPaymentDialog } from "~/components/dashboard/payments/record-payment-dialog";
import { RequestFinalPaymentCard } from "~/components/dashboard/payments/request-final-payment-card";
import {
  formatMoney,
  isFileDrag,
  listRecordablePayments,
  summarizeRecordable,
  validateReceiptFile,
} from "~/components/dashboard/payments/record-payment-model";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { ProjectPurchasesPanel } from "~/components/dashboard/projects/project-purchases-panel";
import {
  PaymentHistoryView,
  type PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";
import { useToast } from "~/components/ui/toast";

export interface ProjectPaymentsTabData {
  needsReview: PaymentHistoryViewData;
  dueOrOverdue: PaymentHistoryViewData;
  history: PaymentHistoryViewData;
}

interface PaymentsTabProps {
  projectId: string;
  payments: ProjectPaymentsTabData;
  purchases: readonly ProjectPurchaseSummary[];
}

function hasPurchases(data: PaymentHistoryViewData): boolean {
  return data.projects.some((project) => project.purchases.length > 0);
}

export function PaymentsTab({ projectId, payments, purchases }: PaymentsTabProps) {
  const hasNeedsReview = hasPurchases(payments.needsReview);
  const hasDueOrOverdue = hasPurchases(payments.dueOrOverdue);
  const hasHistory = hasPurchases(payments.history);

  const { toast } = useToast();
  const recordable = useMemo(() => listRecordablePayments(purchases), [purchases]);
  const summary = useMemo(() => summarizeRecordable(recordable), [recordable]);
  const canRecord = summary.openCount > 0;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  const openDialog = (file: File | null) => {
    setDroppedFile(file);
    setDialogOpen(true);
  };

  // SK-260 — the whole tab is a drop target on desktop. Enter/leave fire for
  // every child, so a depth counter keeps the overlay steady while dragging
  // across nested elements.
  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!canRecord || dialogOpen || !isFileDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!canRecord || dialogOpen || !isFileDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!dragActive) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!dragActive) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const checked = validateReceiptFile(file);
    if (!checked.ok) {
      toast(checked.error, "error");
      return;
    }
    openDialog(file);
  };

  return (
    <section
      role="tabpanel"
      id="panel-payments"
      aria-labelledby="tab-payments"
      className="relative space-y-4"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-drop-active={dragActive || undefined}
    >
      {/* SK-269 — imported work whose last payment is still waiting for an
          approval that will never arrive. Offering this above "Record a
          payment" matches the order of the producer's own steps. */}
      {purchases.map((purchase) =>
        purchase.finalPaymentRequest ? (
          <RequestFinalPaymentCard
            key={purchase.id}
            projectId={projectId}
            purchase={purchase}
            request={purchase.finalPaymentRequest}
          />
        ) : null,
      )}

      {purchases.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
              {canRecord
                ? `${String(summary.openCount)} payment${summary.openCount === 1 ? "" : "s"} open`
                : "Nothing is waiting for payment"}
            </p>
            <p className="mt-0.5 text-[12px] text-[rgb(var(--fg-muted))]">
              {canRecord ? (
                <>
                  {summary.remainingByCurrency
                    .map((total) => formatMoney(total.cents, total.currency))
                    .join(" + ")}{" "}
                  left on this project.
                  <span className="hidden md:inline">
                    {" "}
                    Drop a receipt anywhere here to record one.
                  </span>
                </>
              ) : (
                "Got paid outside Skitza? Record it here once a payment is due."
              )}
            </p>
          </div>
          {canRecord ? (
            <button
              ref={returnFocusRef}
              type="button"
              onClick={() => {
                openDialog(null);
              }}
              className="sk-press inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[14px] font-bold text-[rgb(var(--fg-on-brand))] shadow-[0_8px_20px_-8px_rgb(var(--brand-primary)/0.7)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              <HandCoins size={17} strokeWidth={2.2} aria-hidden />
              Record a payment
            </button>
          ) : null}
        </div>
      ) : null}

      {hasNeedsReview ? <PaymentHistoryView role="producer" data={payments.needsReview} /> : null}
      {hasDueOrOverdue ? <PaymentHistoryView role="producer" data={payments.dueOrOverdue} /> : null}

      {!hasNeedsReview && !hasDueOrOverdue ? (
        <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.18)] bg-[rgb(var(--fg-success)/0.06)] px-4 py-3">
          <p className="text-[13px] font-bold text-[rgb(var(--fg-success-text))]">
            No payments need attention.
          </p>
          <p className="mt-0.5 text-[12px] text-[rgb(var(--fg-muted))]">
            Purchases and completed records remain available below.
          </p>
        </div>
      ) : null}

      <ProjectPurchasesPanel projectId={projectId} purchases={purchases} />

      {hasHistory ? (
        <details className="group rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <summary className="sk-press flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-lg)] px-4 text-[13px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            Completed payment history
            <span
              aria-hidden
              className="text-[18px] leading-none text-[rgb(var(--fg-muted))] transition-transform group-open:rotate-45 motion-reduce:transition-none"
            >
              +
            </span>
          </summary>
          <div className="border-t border-[rgb(var(--border-subtle))] p-3 sm:p-4">
            <PaymentHistoryView role="producer" data={payments.history} />
          </div>
        </details>
      ) : null}

      {dragActive ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-2 z-20 flex items-start justify-center rounded-[var(--radius-xl)] border-2 border-dashed border-[rgb(var(--brand-primary))] bg-[rgb(var(--bg-background)/0.82)] backdrop-blur-[2px]"
        >
          {/* Sticky so the message stays in view however tall the tab is. */}
          <div className="sticky top-[40vh] mt-6 flex items-center gap-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-elevated))] px-5 py-4 shadow-[0_20px_50px_-20px_rgba(17,16,9,0.4)]">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.16)] text-[rgb(var(--brand-primary-dark))]">
              <ImageUp size={20} strokeWidth={2.2} />
            </span>
            <span>
              <span className="block text-[14px] font-bold text-[rgb(var(--fg-default))]">
                Drop the receipt to record a payment
              </span>
              <span className="mt-0.5 block text-[12px] text-[rgb(var(--fg-muted))]">
                Photo or PDF · we&apos;ll open the form with it attached
              </span>
            </span>
          </div>
        </div>
      ) : null}

      {dialogOpen ? (
        <RecordPaymentDialog
          open
          onClose={() => {
            setDialogOpen(false);
            setDroppedFile(null);
          }}
          projectId={projectId}
          purchases={purchases}
          initialFile={droppedFile}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
    </section>
  );
}
