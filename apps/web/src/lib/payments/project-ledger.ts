export type ProjectInvoiceLedgerRow = {
  amountCents: number;
  currency: string;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
};

export type ProjectMoneySummary = {
  lifetimeCents: number;
  outstandingCents: number;
  paidThisMonthCents: number;
};

function isSameUtcMonth(value: Date, now: Date): boolean {
  return (
    value.getUTCFullYear() === now.getUTCFullYear() && value.getUTCMonth() === now.getUTCMonth()
  );
}

/**
 * Keep Clients & Projects money aligned with the invoice ledger used by the
 * project Payments tab. Legacy projects without any invoice rows retain the
 * old finalPaid/price fallback; once a ledger exists, paid invoice rows are the
 * source of truth.
 */
export function summarizeProjectMoney(input: {
  currency: string;
  expectedTotalCents: number;
  finalPaid: boolean;
  isArchived: boolean;
  legacyPaidAt: Date | null;
  invoices: readonly ProjectInvoiceLedgerRow[];
  now?: Date;
}): ProjectMoneySummary {
  const now = input.now ?? new Date();
  const ledger = input.invoices.filter((invoice) => invoice.currency === input.currency);

  let paidCents = 0;
  let invoiceOutstandingCents = 0;
  let paidThisMonthCents = 0;

  for (const invoice of ledger) {
    if (invoice.status === "paid") {
      paidCents += invoice.amountCents;
      if (isSameUtcMonth(invoice.paidAt ?? invoice.createdAt, now)) {
        paidThisMonthCents += invoice.amountCents;
      }
    } else if (
      invoice.status === "draft" ||
      invoice.status === "sent" ||
      invoice.status === "uncollectible"
    ) {
      invoiceOutstandingCents += invoice.amountCents;
    }
  }

  const hasLedger = ledger.length > 0;
  const lifetimeCents = hasLedger ? paidCents : input.finalPaid ? input.expectedTotalCents : 0;

  const paidThisMonth = hasLedger
    ? paidThisMonthCents
    : input.finalPaid && input.legacyPaidAt && isSameUtcMonth(input.legacyPaidAt, now)
      ? input.expectedTotalCents
      : 0;

  const outstandingCents =
    input.isArchived || input.finalPaid
      ? 0
      : Math.max(invoiceOutstandingCents, Math.max(0, input.expectedTotalCents - lifetimeCents));

  return {
    lifetimeCents,
    outstandingCents,
    paidThisMonthCents: paidThisMonth,
  };
}
