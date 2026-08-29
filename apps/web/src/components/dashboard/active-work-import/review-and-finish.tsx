"use client";

import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Mail,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import { useState, type MouseEvent } from "react";

import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";

import {
  draftPaymentBalance,
  draftTaxBreakdown,
  formatImportMoney,
  IMPORT_NOTICE,
  installmentBalance,
  PAYMENT_NOTICE,
  paymentPlanLabel,
  rowDisplayReasons,
  sessionsLabel,
  STILL_SENDING_NOTICE,
  type ArchivedClientOption,
  type ExistingClientOption,
  type FinishSetupResultView,
  type ImportReasonView,
  type NormalizedImportReview,
  type SetupClientOption,
  type SetupInstallmentOption,
  type SetupOptionsView,
  type WorkspaceImportRow,
} from "./model";

function dateLabel(value: string | null): string {
  if (!value) return "No deadline";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No deadline";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * SK-270: the day the producer answered "When is the first payment due?" with,
 * shown back before they finish. The value is a bare calendar day, so it is
 * formatted in UTC on purpose — that renders the typed day itself, with no
 * time zone able to shift it by one.
 */
function firstPaymentDueLabel(calendarDay: string | null): string {
  if (!calendarDay) return "The day you add this";
  const date = new Date(`${calendarDay}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "The day you add this";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function fileSizeLabel(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${String(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function planLabel(review: NormalizedImportReview): string {
  if (review.plan.kind === "split_50_50") return "50/50";
  if (review.plan.kind === "monthly") {
    return `Monthly · ${String(review.plan.installments)} payments`;
  }
  return "Full payment";
}

function paymentDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function producerPaymentDateLabel(
  savedDraftDate: string | null | undefined,
  normalizedIso: string,
): string {
  const saved = savedDraftDate?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(saved)) {
    const date = new Date(`${saved}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === saved) {
      return paymentDateLabel(saved);
    }
  }
  return paymentDateLabel(normalizedIso);
}

function taxModeLabel(mode: NormalizedImportReview["commercialSnapshot"]["tax"]["mode"]): string {
  if (mode === "tax_included") return "Included in total";
  if (mode === "tax_added") return "Added to subtotal";
  return "Tax-free";
}

function revisionLabel(rule: NormalizedImportReview["commercialSnapshot"]["revisionRule"]): string {
  if (!rule) return "Not specified";
  if (rule.kind === "unlimited") return "Unlimited revisions";
  return `${String(rule.count)} ${rule.count === 1 ? "revision" : "revisions"}`;
}

function invitationReason(client: SetupClientOption): string | null {
  if (client.invitationState === "connected") return "Already connected — no invite needed.";
  if (client.invitationState === "provider_accepted") return "Invitation email already sent.";
  if (client.invitationState === "invalid_email") return "This email cannot receive an invitation.";
  return client.invitationEligible ? null : "Invitation is not available.";
}

function invitationNote(client: SetupClientOption): string | null {
  return client.invitationState === "send_in_progress_or_retryable"
    ? "A previous send is still pending or failed. Select it to check or retry safely."
    : null;
}

function reminderNote(installment: SetupInstallmentOption): string | null {
  if (installment.dueTrigger !== "artist_approval") return null;
  return "Reminder delivery waits for Artist approval. It will not send early.";
}

// What the last Finish setup run said about one client or installment.
function invitationResultNote(
  client: SetupClientOption,
  finishResult: FinishSetupResultView | null,
): string | null {
  const entry = finishResult?.invitations.find(
    (invitation) => invitation.clientContactId === client.id,
  );
  if (!entry) return null;
  if (entry.status === "requested") return STILL_SENDING_NOTICE;
  if (entry.status === "failed") return entry.reason;
  return null;
}

function reminderResultNote(
  installment: SetupInstallmentOption,
  finishResult: FinishSetupResultView | null,
): string | null {
  const entry = finishResult?.reminders.find(
    (reminder) => reminder.installmentId === installment.id,
  );
  return entry?.status === "failed" ? entry.reason : null;
}

function installmentTriggerLabel(
  trigger: NormalizedImportReview["schedule"][number]["trigger"],
): string {
  if (trigger === "artist_approval") return "Due after the Artist approves the final version";
  if (trigger === "monthly_anniversary") return "Due monthly";
  if (trigger === "acceptance") return "Due when accepted";
  return "Due now";
}

function installmentStatusLabel(status: string): string {
  const words = status.replaceAll("_", " ");
  return words.length > 0 ? `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}` : "Unknown";
}

function reviewedInstallmentStatusLabel(
  installment: NormalizedImportReview["schedule"][number],
  payments: NormalizedImportReview["payments"],
): string {
  const historicalPaidCents = payments
    .filter((payment) => payment.installmentPosition === installment.sequence)
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  if (historicalPaidCents >= installment.amountCents) return "Paid";
  if (historicalPaidCents > 0) return "Partially paid";
  return installmentStatusLabel(installment.status);
}

function ReviewCard({ row, asArticle }: { row: WorkspaceImportRow; asArticle: boolean }) {
  if (row.assessment?.state !== "ready") return null;
  const review = row.assessment.normalized;
  const snapshot = review.commercialSnapshot;
  const royalty = royaltyTermsDisplay(snapshot.royaltyTerms);
  const Container = asArticle ? "article" : "div";
  return (
    <Container data-review-ready-details="dense" className="min-w-0 bg-[rgb(var(--bg-elevated))]">
      <h3 className="sr-only">{review.projectTitle}</h3>
      <div className="grid min-w-0 lg:grid-cols-2">
        <section className="min-w-0 px-4 py-3 sm:px-5 lg:border-r lg:border-[rgb(var(--border-subtle))]">
          <div className="grid min-w-0 gap-2 border-b border-[rgb(var(--border-subtle))] pb-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="font-mono text-[9.5px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
                Client
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed font-semibold [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-secondary))]">
                {review.clientName} · {review.clientEmail}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-muted))]">
                {review.existingClientId ? "Reuse existing client" : "New client"}
                {review.clientPhone ? ` · ${review.clientPhone}` : ""}
              </p>
            </div>
            <div className="min-w-0 sm:text-right">
              <p className="font-mono text-[9.5px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
                Deadline
              </p>
              <p className="mt-0.5 font-mono text-[11.5px] font-semibold text-[rgb(var(--fg-secondary))]">
                {dateLabel(review.deadlineAtIso)}
              </p>
            </div>
          </div>

          <div className="min-w-0 border-b border-[rgb(var(--border-subtle))] py-2.5">
            <p className="font-mono text-[9.5px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
              Frozen agreement
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed font-bold [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-default))]">
              {snapshot.productOrOfferName}
            </p>
            {snapshot.service ? (
              <p className="text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-muted))]">
                {snapshot.service}
              </p>
            ) : null}
          </div>

          <dl className="grid min-w-0 gap-x-4 gap-y-2 border-b border-[rgb(var(--border-subtle))] py-2.5 sm:grid-cols-2">
            {[
              ["Total", formatImportMoney(snapshot.totalCents, snapshot.currency)],
              ["Plan", planLabel(review)],
              [
                "Agreed price (subtotal)",
                formatImportMoney(snapshot.subtotalCents, snapshot.currency),
              ],
              ["Tax mode", taxModeLabel(snapshot.tax.mode)],
              ["Tax rate", `${String(snapshot.tax.ratePct)}%`],
              ["Tax amount", formatImportMoney(snapshot.tax.amountCents, snapshot.currency)],
              ["Song spaces", String(snapshot.includedSongSpaces)],
              ["Sessions", sessionsLabel(snapshot.session)],
              ["Revisions", revisionLabel(snapshot.revisionRule)],
              ["Master royalty", royalty.master],
              ["Composition royalty", royalty.composition],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  {label}
                </dt>
                <dd className="mt-0.5 text-[11.5px] leading-relaxed font-semibold [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-secondary))]">
                  {value}
                </dd>
              </div>
            ))}
            {snapshot.royaltyTerms?.notes ? (
              <div className="min-w-0 sm:col-span-2">
                <dt className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  Royalty note
                </dt>
                <dd className="mt-0.5 text-[11.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                  {snapshot.royaltyTerms.notes}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="grid min-w-0 gap-2 border-b border-[rgb(var(--border-subtle))] py-2.5 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Deliverables
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-secondary))]">
                {snapshot.deliverables.join(" · ")}
              </p>
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Agreed rights
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-secondary))]">
                {snapshot.rights.join(" · ")}
              </p>
            </div>
          </div>

          <div className="min-w-0 pt-2.5">
            <p className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
              Exact terms
            </p>
            <p className="mt-1 max-h-24 overflow-y-auto text-[11.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
              {snapshot.agreementText}
            </p>
          </div>
          {review.agreementPdf ? (
            <div className="min-w-0 pt-2.5">
              <p className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                Agreement PDF
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed font-semibold [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-secondary))]">
                {`${review.agreementPdf.fileName} · ${fileSizeLabel(review.agreementPdf.sizeBytes)} · frozen with this agreement`}
              </p>
            </div>
          ) : null}
        </section>

        <section className="min-w-0 border-t border-[rgb(var(--border-subtle))] px-4 py-3 sm:px-5 lg:border-t-0">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] pb-2.5">
            <p className="font-mono text-[9.5px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
              Payment plan
            </p>
            <p className="text-[11.5px] font-semibold text-[rgb(var(--fg-secondary))]">
              {planLabel(review)}
            </p>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] py-2">
            <p className="font-mono text-[9.5px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
              First payment due
            </p>
            <p className="font-mono text-[11.5px] font-semibold text-[rgb(var(--fg-secondary))]">
              {firstPaymentDueLabel(review.firstPaymentDueDate)}
            </p>
          </div>
          <div className="divide-y divide-[rgb(var(--border-subtle))]">
            {review.schedule.map((installment) => (
              <div
                key={installment.sequence}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2"
              >
                <p className="text-[11.5px] font-bold text-[rgb(var(--fg-default))]">
                  Installment {String(installment.sequence)}
                </p>
                <p className="font-amount text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
                  {formatImportMoney(installment.amountCents, snapshot.currency)}
                </p>
                <p className="col-span-2 text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-muted))]">
                  {installmentTriggerLabel(installment.trigger)} ·{" "}
                  {reviewedInstallmentStatusLabel(installment, review.payments)}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-3 border-b border-[rgb(var(--border-subtle))] pb-2 font-mono text-[9.5px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
            Past payments
          </p>
          {review.payments.length > 0 ? (
            <div className="divide-y divide-[rgb(var(--border-subtle))]">
              {review.payments.map((payment, index) => {
                const draftPayment = row.draft.payments.find(
                  (draftPayment) => draftPayment.operationKey === payment.operationKey,
                );
                const proofFileName = draftPayment?.proofFileName;
                return (
                  <article
                    key={payment.operationKey}
                    aria-label={`Historical payment ${String(index + 1)}`}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2"
                  >
                    <p className="text-[11.5px] font-bold text-[rgb(var(--fg-default))]">
                      Installment {String(payment.installmentPosition)}
                    </p>
                    <p className="font-amount text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
                      {formatImportMoney(payment.amountCents, snapshot.currency)}
                    </p>
                    <p className="font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
                      Paid {producerPaymentDateLabel(draftPayment?.paidAt, payment.paidAtIso)}
                    </p>
                    <p className="text-right text-[10.5px] font-semibold text-[rgb(var(--fg-muted))]">
                      {PAYMENT_NOTICE}
                    </p>
                    {payment.note ? (
                      <p className="col-span-2 text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                        {payment.note}
                      </p>
                    ) : null}
                    <p
                      className={`col-span-2 inline-flex min-w-0 items-center gap-1.5 text-[10.5px] leading-relaxed font-semibold [overflow-wrap:anywhere] whitespace-normal ${
                        payment.hasProof
                          ? "text-[rgb(var(--fg-success-text))]"
                          : "text-[rgb(var(--fg-muted))]"
                      }`}
                    >
                      {payment.hasProof ? <Check size={11} strokeWidth={2.3} aria-hidden /> : null}
                      {payment.hasProof
                        ? proofFileName
                          ? `Proof: ${proofFileName}`
                          : "Proof attached"
                        : "No proof attached"}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="py-2 text-[11px] text-[rgb(var(--fg-muted))]">No past payments added.</p>
          )}
        </section>
      </div>

      <footer className="flex items-start gap-2 border-t border-[rgb(var(--border-subtle))] px-4 py-2.5 text-[11px] leading-relaxed text-[rgb(var(--fg-muted))] sm:px-5">
        <ShieldCheck
          size={13}
          strokeWidth={2.1}
          aria-hidden
          className="mt-0.5 shrink-0 text-[rgb(var(--fg-muted))]"
        />
        <span className="[overflow-wrap:anywhere] whitespace-normal">{IMPORT_NOTICE}</span>
      </footer>
      {row.materializeError ? (
        <p
          role="alert"
          className="border-t border-[rgb(var(--fg-danger)/0.2)] bg-[rgb(var(--fg-danger)/0.06)] px-4 py-3 text-[11.5px] text-[rgb(var(--fg-danger-text))] sm:px-5"
        >
          {row.materializeError}
        </p>
      ) : null}
    </Container>
  );
}

type ReviewEntry = Readonly<{
  row: WorkspaceImportRow;
  index: number;
  state: "ready" | "needs_info" | "retry";
  reasons: readonly ImportReasonView[];
}>;

function reviewEntryFacts(entry: ReviewEntry) {
  const ready = entry.row.assessment?.state === "ready" ? entry.row.assessment.normalized : null;
  const currency =
    ready?.commercialSnapshot.currency || entry.row.draft.agreement.currency || "USD";
  const totalCents =
    ready?.commercialSnapshot.totalCents ?? draftTaxBreakdown(entry.row.draft).totalCents;
  const balance = ready
    ? installmentBalance(
        ready.schedule.map((installment) => ({
          position: installment.sequence,
          amountCents: installment.amountCents,
        })),
        ready.payments,
      )
    : draftPaymentBalance(entry.row.draft);
  const { paidCents: importedPaidCents, remainingCents, overpaidCents } = balance;
  const balanceParts = [
    remainingCents === null
      ? "Balance unavailable"
      : `${formatImportMoney(remainingCents, currency)} remaining`,
    ...(overpaidCents > 0 ? [`${formatImportMoney(overpaidCents, currency)} overpaid`] : []),
  ];
  return {
    clientName: ready?.clientName || entry.row.draft.client.name.trim() || "New client",
    projectTitle: ready?.projectTitle || entry.row.draft.project.title.trim() || "Untitled project",
    agreementTotal:
      totalCents === null ? "Agreement incomplete" : formatImportMoney(totalCents, currency),
    agreementPlan: ready ? planLabel(ready) : paymentPlanLabel(entry.row.draft),
    paid: `${formatImportMoney(importedPaidCents, currency)} paid`,
    paymentBalance: balanceParts.join(" · "),
  };
}

function ReviewSummaryTable({
  entries,
  expandedOperationKey,
  needsInfoCount,
  onExpand,
}: {
  entries: readonly ReviewEntry[];
  expandedOperationKey: string | null;
  needsInfoCount: number;
  onExpand: (operationKey: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section
      aria-label={needsInfoCount > 0 ? `Needs info · ${String(needsInfoCount)}` : "Review items"}
      className="overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
    >
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(0,1.2fr)_minmax(7rem,0.82fr)_minmax(7rem,0.82fr)_minmax(6rem,0.62fr)_minmax(8rem,0.8fr)] gap-3 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.72)] px-4 py-2.5 font-mono text-[9.5px] font-bold tracking-[0.09em] text-[rgb(var(--fg-muted))] uppercase lg:grid"
      >
        <span>Client / Project</span>
        <span>Agreement</span>
        <span>Payment</span>
        <span>State</span>
        <span>Details</span>
      </div>
      <div className="divide-y divide-[rgb(var(--border-subtle))]">
        {entries.map((entry) => {
          const facts = reviewEntryFacts(entry);
          const expanded = expandedOperationKey === entry.row.operationKey;
          const statusLabel =
            entry.state === "ready" ? "Ready" : entry.state === "retry" ? "To retry" : "Needs info";
          const statusClass =
            entry.state === "ready"
              ? "text-[rgb(var(--fg-success-text))]"
              : entry.state === "retry"
                ? "text-[rgb(var(--fg-danger-text))]"
                : "text-[rgb(var(--fg-warning-text))]";
          const nextReason = entry.reasons[0]?.message ?? "Exact details ready to create";
          const EntryContainer = entry.state === "needs_info" ? "article" : "div";
          const handleSummaryClick = (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            onExpand(entry.row.operationKey);
          };
          return (
            <EntryContainer
              key={entry.row.operationKey}
              {...(entry.state === "needs_info"
                ? { "aria-label": `Item ${String(entry.index + 1)} needs info` }
                : {})}
            >
              <details open={expanded} className="group min-w-0">
                <summary className="min-h-11 list-none marker:hidden" onClick={handleSummaryClick}>
                  <span
                    className={`sk-press-row grid min-h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-l-[3px] px-3.5 py-3 transition-colors duration-150 motion-reduce:transition-none lg:grid-cols-[minmax(0,1.2fr)_minmax(7rem,0.82fr)_minmax(7rem,0.82fr)_minmax(6rem,0.62fr)_minmax(8rem,0.8fr)] lg:items-center ${
                      expanded
                        ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.055)]"
                        : "border-transparent hover:bg-[rgb(var(--bg-overlay))]"
                    }`}
                  >
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 font-mono text-[9.5px] font-semibold text-[rgb(var(--fg-faint))]">
                        {String(entry.index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] leading-snug font-bold [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-default))] lg:truncate">
                          {facts.clientName}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-snug [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-secondary))] lg:truncate">
                          {facts.projectTitle}
                        </span>
                      </span>
                    </span>
                    <span
                      className={`inline-flex items-center justify-end gap-1.5 text-[11.5px] font-bold lg:order-4 lg:justify-start ${statusClass}`}
                    >
                      {entry.state === "ready" ? (
                        <Check size={13} strokeWidth={2.4} aria-hidden />
                      ) : (
                        <CircleAlert size={13} strokeWidth={2.2} aria-hidden />
                      )}
                      {statusLabel}
                    </span>
                    <span className="min-w-0 pl-7 lg:pl-0">
                      <span className="block truncate text-[12px] font-semibold text-[rgb(var(--fg-secondary))]">
                        {facts.agreementTotal}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[rgb(var(--fg-muted))]">
                        {facts.agreementPlan}
                      </span>
                    </span>
                    <span className="min-w-0 text-right lg:text-left">
                      <span className="block truncate text-[12px] font-semibold text-[rgb(var(--fg-secondary))]">
                        {facts.paid}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[rgb(var(--fg-muted))]">
                        {facts.paymentBalance}
                      </span>
                    </span>
                    <span className="col-span-2 flex min-w-0 items-center justify-between gap-2 border-t border-[rgb(var(--border-subtle))] pt-2 pl-7 text-[11.5px] text-[rgb(var(--fg-muted))] lg:order-5 lg:col-span-1 lg:border-0 lg:pt-0 lg:pl-0">
                      <span className="[overflow-wrap:anywhere] whitespace-normal lg:truncate">
                        {entry.state === "ready" ? "Exact frozen details" : nextReason}
                      </span>
                      <ChevronDown
                        size={14}
                        strokeWidth={2.1}
                        aria-hidden
                        className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
                      />
                    </span>
                  </span>
                </summary>
                {expanded ? (
                  <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.38)]">
                    {entry.row.assessment?.state === "ready" ? (
                      <ReviewCard row={entry.row} asArticle={needsInfoCount === 0} />
                    ) : (
                      <div className="grid min-w-0 gap-4 px-4 py-4 sm:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] sm:px-5">
                        <div className="min-w-0">
                          <p className="font-mono text-[9.5px] font-bold tracking-[0.09em] text-[rgb(var(--fg-muted))] uppercase">
                            Complete before creating
                          </p>
                          <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
                            This item stays saved. Fix every exact point below.
                          </p>
                        </div>
                        <ul className="space-y-2 text-[11.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
                          {entry.reasons.map((reason, reasonIndex) => (
                            <li
                              key={`${reason.code}:${reason.field}:${String(reasonIndex)}`}
                              className="flex items-start gap-2"
                            >
                              <CircleAlert
                                size={13}
                                strokeWidth={2.1}
                                aria-hidden
                                className="mt-0.5 shrink-0 text-[rgb(var(--fg-warning-text))]"
                              />
                              <span className="[overflow-wrap:anywhere] whitespace-normal">
                                {reason.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : null}
              </details>
            </EntryContainer>
          );
        })}
      </div>
    </section>
  );
}

export function ReviewAndFinish({
  stage,
  rows,
  clients,
  archivedClients,
  effectiveReadyOperationKeys,
  retryableFailedOperationKeys,
  canReturnToItems,
  setupAttempted,
  setupOptions,
  loadingSetup,
  creating,
  finishing,
  error,
  finishResult = null,
  selectedClientIds,
  onBack,
  onCreate,
  onReloadSetup,
  onToggleClient,
  onDone,
}: {
  stage: "review" | "setup";
  rows: readonly WorkspaceImportRow[];
  clients: readonly ExistingClientOption[];
  archivedClients: readonly ArchivedClientOption[];
  effectiveReadyOperationKeys: ReadonlySet<string>;
  retryableFailedOperationKeys: ReadonlySet<string>;
  canReturnToItems: boolean;
  setupAttempted: boolean;
  setupOptions: SetupOptionsView | null;
  loadingSetup: boolean;
  creating: boolean;
  finishing: boolean;
  error: string | null;
  finishResult?: FinishSetupResultView | null;
  selectedClientIds: ReadonlySet<string>;
  onBack: () => void;
  onCreate: () => void;
  onReloadSetup: () => void;
  onToggleClient: (id: string, selected: boolean) => void;
  onDone: () => void;
}) {
  const [requestedExpandedOperationKey, setRequestedExpandedOperationKey] = useState<string | null>(
    null,
  );
  const readyRows = rows.filter(
    (row) => !row.materializedAtIso && effectiveReadyOperationKeys.has(row.operationKey),
  );
  const failedRows = rows.filter(
    (row) => !row.materializedAtIso && retryableFailedOperationKeys.has(row.operationKey),
  );
  const createdRows = rows.filter((row) => row.materializedAtIso !== null);
  const reviewEntries = rows.flatMap<ReviewEntry>((row, index) => {
    if (row.materializedAtIso) return [];
    if (effectiveReadyOperationKeys.has(row.operationKey)) {
      return [{ row, index, state: "ready", reasons: [] }];
    }
    if (retryableFailedOperationKeys.has(row.operationKey)) {
      return [
        {
          row,
          index,
          state: "retry",
          reasons: row.materializeError
            ? [{ code: "materialize_failed", field: "row", message: row.materializeError }]
            : [],
        },
      ];
    }
    const reasons = rowDisplayReasons(row.assessment, row.draft, clients, archivedClients);
    const exactReasons = row.materializeError
      ? [
          ...reasons,
          {
            code: "materialize_failed",
            field: "row",
            message: row.materializeError,
          },
        ]
      : reasons;
    return [{ row, index, state: "needs_info", reasons: exactReasons }];
  });
  const needsInfoRows = reviewEntries.filter((entry) => entry.state === "needs_info");
  // Rows start collapsed; one row opens on a deliberate click and closes on the next.
  const expandedOperationKey = reviewEntries.some(
    (entry) => entry.row.operationKey === requestedExpandedOperationKey,
  )
    ? requestedExpandedOperationKey
    : null;
  const unfinishedCount = rows.length - createdRows.length;
  const creatingCount = readyRows.length > 0 ? readyRows.length : failedRows.length;
  const canCreateOrRetry = readyRows.length > 0 || failedRows.length > 0;
  const hasNeedsInfo = needsInfoRows.length > 0;
  const eligibleUnpaidInstallments =
    setupOptions?.installments.filter(
      (installment) =>
        installment.remainingCents > 0 &&
        installment.reminderEligible &&
        !installment.reminderWaitingForDueDate,
    ) ?? [];
  // Also armed by Finish setup, but with no date yet they cannot send. Listed
  // separately so the producer is not told a reminder is live when it is only
  // waiting — the two groups never overlap.
  const undatedUnpaidInstallments =
    setupOptions?.installments.filter((installment) => installment.reminderWaitingForDueDate) ?? [];
  const stillSending =
    finishResult?.invitations.some((invitation) => invitation.status === "requested") ?? false;

  const reviewEyebrow = canCreateOrRetry ? "Silent creation checkpoint" : "Needs info";
  const reviewHeading = canCreateOrRetry ? "Review before creating" : "Review what needs info";
  const reviewDescription = !canCreateOrRetry
    ? "Nothing will be created yet. Review every point below, then go back to the items."
    : hasNeedsInfo
      ? "Ready items can be created now. Needs info items stay saved below. Creating contacts nobody."
      : failedRows.length > 0 && readyRows.length === 0
        ? "These items failed to create before. Check the saved details, then retry. Nobody is contacted."
        : "These exact details will be frozen. Creating them contacts nobody.";

  return (
    <section
      data-review-finish-surface
      className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[70] flex min-w-0 flex-col overflow-hidden bg-[rgb(var(--bg-background))] lg:static lg:h-full lg:max-h-full lg:min-h-0 lg:w-full lg:flex-1 lg:self-stretch lg:rounded-[var(--radius-lg)] lg:border lg:border-[rgb(var(--border-subtle))] lg:bg-[rgb(var(--bg-elevated))] lg:shadow-[var(--shadow-sm)]"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-4 sm:px-6">
        {canReturnToItems ? (
          <button
            type="button"
            onClick={onBack}
            className="sk-press -ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-default))]"
            aria-label="Back to active work items"
          >
            <ArrowLeft size={19} strokeWidth={2.2} aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
            {stage === "review" ? reviewEyebrow : "Active work added"}
          </p>
          <h2 className="mt-1 text-[22px] leading-tight font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] sm:text-[25px]">
            {stage === "review" ? reviewHeading : "Finish setup"}
          </h2>
          <p className="mt-1.5 max-w-[64ch] text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))] sm:text-[13px]">
            {stage === "review"
              ? reviewDescription
              : setupAttempted
                ? "Review the current status. Unpaid payment reminders are required; invitations are still your choice."
                : "Choose any invitation emails. Finish setup turns on reminders for every eligible unpaid imported payment."}
          </p>
        </div>
      </header>

      <div className="sk-native-scroll min-h-0 w-full flex-1 px-4 pt-5 pb-28 sm:px-6 lg:overflow-y-auto lg:pb-5">
        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.065)] p-3.5 text-[12px] leading-relaxed text-[rgb(var(--fg-danger-text))]"
          >
            <CircleAlert size={16} strokeWidth={2.2} aria-hidden className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {stage === "setup" && stillSending ? (
          <p
            role="status"
            className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 text-[12px] leading-relaxed text-[rgb(var(--fg-secondary))]"
          >
            <Mail size={16} strokeWidth={2.1} aria-hidden className="mt-0.5 shrink-0" />
            <span>{STILL_SENDING_NOTICE}</span>
          </p>
        ) : null}

        {stage === "review" ? (
          <>
            <div
              aria-label="Review status"
              className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[rgb(var(--border-subtle))] pb-3 text-[12px] font-semibold text-[rgb(var(--fg-muted))]"
            >
              <span className="text-[rgb(var(--fg-success-text))]">
                {String(readyRows.length)} Ready
              </span>
              <span aria-hidden>·</span>
              <span className="text-[rgb(var(--fg-warning-text))]">
                {String(needsInfoRows.length)} Need info
              </span>
              {failedRows.length > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-[rgb(var(--fg-danger-text))]">
                    {String(failedRows.length)} To retry
                  </span>
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span>{String(createdRows.length)} Created</span>
            </div>
            <ReviewSummaryTable
              entries={reviewEntries}
              expandedOperationKey={expandedOperationKey}
              needsInfoCount={needsInfoRows.length}
              onExpand={(operationKey) => {
                setRequestedExpandedOperationKey((current) =>
                  current === operationKey ? null : operationKey,
                );
              }}
            />
          </>
        ) : loadingSetup ? (
          <div className="flex min-h-72 items-center justify-center text-[12px] text-[rgb(var(--fg-muted))]">
            Loading the safe next steps…
          </div>
        ) : setupOptions ? (
          <div data-setup-content className="mx-auto w-full max-w-4xl space-y-6">
            <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.25)] bg-[rgb(var(--fg-success)/0.07)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
              <Check
                size={20}
                strokeWidth={2.4}
                aria-hidden
                className="mt-0.5 shrink-0 text-[rgb(var(--fg-success-text))]"
              />
              <div>
                <p className="text-[14px] font-bold text-[rgb(var(--fg-success-text))]">
                  {setupOptions.distinctClientCount}{" "}
                  {setupOptions.distinctClientCount === 1 ? "client" : "clients"} ·{" "}
                  {setupOptions.projectPurchaseCount}{" "}
                  {setupOptions.projectPurchaseCount === 1
                    ? "project and agreement"
                    : "projects and agreements"}{" "}
                  added
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
                  {setupAttempted
                    ? "Creating these items contacted nobody. Check the current invitation and reminder status below."
                    : "Creating these items contacted nobody. Your imported work is ready in Skitza."}
                </p>
              </div>
            </div>

            {unfinishedCount > 0 ? (
              <p className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.24)] bg-[rgb(var(--fg-warning)/0.065)] p-3.5 text-[12px] leading-relaxed text-[rgb(var(--fg-warning-text))]">
                {String(unfinishedCount)}{" "}
                {unfinishedCount === 1 ? "draft still needs" : "drafts still need"} attention. It
                stays saved for later.
              </p>
            ) : null}

            <section aria-labelledby="optional-invites-heading">
              <div className="flex items-start gap-2.5">
                <Mail
                  size={17}
                  strokeWidth={2.1}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-[rgb(var(--fg-muted))]"
                />
                <div>
                  <h3
                    id="optional-invites-heading"
                    className="text-[14px] font-bold text-[rgb(var(--fg-default))]"
                  >
                    Invite clients{" "}
                    <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
                  </h3>
                  <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                    {setupAttempted
                      ? "Check the current status below. Only selected invitations are requested by this click."
                      : "All invitations are off. Select only the people you want to contact now."}
                  </p>
                </div>
              </div>
              <div className="mt-3 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
                {setupOptions.clients.map((client) => {
                  const reason = invitationReason(client);
                  const note = invitationNote(client);
                  const resultNote = invitationResultNote(client, finishResult);
                  return (
                    <label
                      key={client.id}
                      className={`flex min-w-0 items-start gap-3 py-3.5 ${
                        reason
                          ? "opacity-60"
                          : "cursor-pointer transition-colors duration-150 hover:bg-[rgb(var(--bg-overlay))] motion-reduce:transition-none"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedClientIds.has(client.id)}
                        disabled={reason !== null}
                        onChange={(event) => {
                          onToggleClient(client.id, event.target.checked);
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand-primary))]"
                      />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] leading-relaxed font-bold [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-default))] sm:truncate">
                          {client.name}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-muted))] sm:truncate">
                          {client.email}
                        </span>
                        {reason ? (
                          <span className="mt-1 block text-[10.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                            {reason}
                          </span>
                        ) : null}
                        {note ? (
                          <span className="mt-1 block text-[10.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                            {note}
                          </span>
                        ) : null}
                        {resultNote ? (
                          <span className="mt-1 block text-[10.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-warning-text))]">
                            {resultNote}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="required-reminders-heading">
              <div className="flex items-start gap-2.5">
                <TimerReset
                  size={17}
                  strokeWidth={2.1}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-[rgb(var(--fg-muted))]"
                />
                <div>
                  <h3
                    id="required-reminders-heading"
                    className="text-[14px] font-bold text-[rgb(var(--fg-default))]"
                  >
                    Payment reminders
                  </h3>
                  <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                    Finish setup turns reminders on for every eligible unpaid imported payment
                    below. There is no extra choice here. Reminders to clients who have not joined
                    yet include your join link.
                  </p>
                </div>
              </div>
              {eligibleUnpaidInstallments.length > 0 ? (
                <div className="mt-3 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
                  {eligibleUnpaidInstallments.map((installment) => {
                    const note = reminderNote(installment);
                    const resultNote = reminderResultNote(installment, finishResult);
                    return (
                      <div key={installment.id} className="flex min-w-0 items-start gap-3 py-3.5">
                        <Check
                          size={16}
                          strokeWidth={2.3}
                          aria-hidden
                          className="mt-0.5 shrink-0 text-[rgb(var(--fg-success-text))]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] leading-relaxed font-bold [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-default))] sm:truncate">
                            {installment.projectTitle} · payment {String(installment.position)}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-muted))]">
                            {formatImportMoney(installment.remainingCents, installment.currency)}{" "}
                            remaining · {installment.agreementName}
                          </span>
                          {note ? (
                            <span className="mt-1 block text-[10.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                              {note}
                            </span>
                          ) : null}
                          {resultNote ? (
                            <span className="mt-1 block text-[10.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-warning-text))]">
                              {resultNote}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-[10.5px] font-bold text-[rgb(var(--fg-success-text))]">
                          {installment.remindersEnabled ? "Already on" : "Will turn on"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 border-y border-[rgb(var(--border-subtle))] py-3 text-[11.5px] text-[rgb(var(--fg-muted))]">
                  No eligible unpaid imported payments need reminders.
                </p>
              )}

              {undatedUnpaidInstallments.length > 0 ? (
                <div className="mt-4">
                  <p className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                    {undatedUnpaidInstallments.length === 1
                      ? "One payment below has no date yet. Its reminder is turned on, but nothing can be sent until the payment has a date."
                      : `${String(undatedUnpaidInstallments.length)} payments below have no date yet. Their reminders are turned on, but nothing can be sent until they have dates.`}
                  </p>
                  <div className="mt-2.5 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
                    {undatedUnpaidInstallments.map((installment) => (
                      <div key={installment.id} className="flex min-w-0 items-start gap-3 py-3.5">
                        <CalendarClock
                          size={16}
                          strokeWidth={2.1}
                          aria-hidden
                          className="mt-0.5 shrink-0 text-[rgb(var(--fg-muted))]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] leading-relaxed font-bold [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-default))] sm:truncate">
                            {installment.projectTitle} · payment {String(installment.position)}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-normal text-[rgb(var(--fg-muted))]">
                            {formatImportMoney(installment.remainingCents, installment.currency)}{" "}
                            remaining · {installment.agreementName}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10.5px] font-bold text-[rgb(var(--fg-muted))]">
                          No date yet
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <p className="border-t border-[rgb(var(--border-subtle))] pt-4 text-center text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
              Finish setup will turn on reminders for every eligible unpaid imported payment.
              {selectedClientIds.size > 0
                ? ` Invitation emails will send only to the ${String(selectedClientIds.size)} selected ${selectedClientIds.size === 1 ? "client" : "clients"}.`
                : " No invitation emails will send."}
            </p>
          </div>
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] p-8 text-center shadow-[var(--shadow-sm)]">
            <p className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
              Could not load the next steps
            </p>
            <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
              Your created work is safe.
            </p>
          </div>
        )}
      </div>

      <footer className="sk-native-action-dock fixed inset-x-0 z-[80] flex shrink-0 flex-col gap-1.5 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.96)] px-4 pt-2.5 backdrop-blur-md lg:static lg:z-auto lg:flex-none lg:flex-row lg:items-center lg:justify-between lg:px-6 lg:py-3">
        {stage === "review" && creating ? (
          <p
            role="status"
            aria-live="polite"
            className="inline-flex min-h-6 items-center gap-2 text-[11.5px] font-semibold text-[rgb(var(--fg-muted))]"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[rgb(var(--brand-primary))] motion-reduce:animate-none"
            />
            {`Creating ${String(creatingCount)} ${creatingCount === 1 ? "item" : "items"}… each one is saved and checked in turn, so this can take a few seconds.`}
          </p>
        ) : stage === "review" ? (
          <p className="inline-flex min-h-6 items-center gap-2 text-[11.5px] font-semibold text-[rgb(var(--fg-muted))]">
            <ShieldCheck
              size={17}
              strokeWidth={2.2}
              aria-hidden
              className="shrink-0 text-[rgb(var(--fg-success-text))]"
            />
            Nothing will be sent
          </p>
        ) : null}
        <div
          data-review-action-row={stage === "review" ? "compact" : undefined}
          className={`grid w-full min-w-0 gap-2 lg:ml-auto lg:flex lg:w-auto lg:items-center lg:justify-end ${
            stage === "review" && canReturnToItems && canCreateOrRetry
              ? "grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
              : "grid-cols-1"
          }`}
        >
          {canReturnToItems ? (
            <button
              type="button"
              onClick={onBack}
              disabled={creating || finishing}
              className={`sk-press min-h-12 min-w-0 rounded-[var(--radius-lg)] px-3 text-[12px] font-bold disabled:opacity-50 lg:px-5 lg:text-[13px] ${
                stage === "review" && !canCreateOrRetry
                  ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))] shadow-[var(--shadow-sm)]"
                  : "text-[rgb(var(--fg-muted))]"
              }`}
            >
              Back to items
            </button>
          ) : null}
          {stage === "review" && canCreateOrRetry ? (
            <button
              type="button"
              onClick={onCreate}
              disabled={creating}
              className="sk-press min-h-12 min-w-0 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[13px] font-bold text-[rgb(var(--fg-on-brand))] shadow-[var(--shadow-sm)] disabled:cursor-not-allowed disabled:opacity-50 lg:px-5 lg:text-[14px]"
            >
              {creating
                ? "Creating…"
                : readyRows.length > 0
                  ? `Create ${String(readyRows.length)} ready ${readyRows.length === 1 ? "item" : "items"}`
                  : `Retry ${String(failedRows.length)} failed ${failedRows.length === 1 ? "item" : "items"}`}
            </button>
          ) : stage === "review" ? null : setupOptions ? (
            <button
              type="button"
              onClick={onDone}
              disabled={finishing}
              className="sk-press min-h-12 min-w-0 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[14px] font-bold text-[rgb(var(--fg-on-brand))] shadow-[var(--shadow-sm)] disabled:cursor-not-allowed disabled:opacity-50 lg:px-7"
            >
              {finishing ? "Finishing…" : "Finish setup"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onReloadSetup}
              disabled={loadingSetup}
              className="sk-press min-h-12 min-w-0 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[14px] font-bold text-[rgb(var(--fg-on-brand))] shadow-[var(--shadow-sm)] disabled:opacity-50"
            >
              {loadingSetup ? "Loading…" : "Try again"}
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
