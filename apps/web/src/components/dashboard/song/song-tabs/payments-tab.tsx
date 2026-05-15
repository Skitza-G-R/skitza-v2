"use client";

import {
  PaymentsTab as AlbumPaymentsTab,
  type PaymentMilestone,
} from "~/components/dashboard/project/album-tabs/payments-tab";

// PaymentsTab (Single mode only) — DESIGN.md §4.4 + §5.4.4.
//
// Per the Single-Space rule, when the project has exactly 1 track, the
// project IS the song. The Payments surface in that case is identical
// to the album's Payments tab — same Outstanding card (Total / Paid /
// Balance + Send reminder + Send invoice) and same Milestones list.
//
// Decision: delegate to the album implementation rather than duplicate.
// The props match the album's PaymentsTab one-for-one. If a later phase
// adds song-scoped money lines (e.g. per-version invoices), this thin
// adapter is the place to add the song-scoped accounting before the
// shared shell renders.

export type { PaymentMilestone };

interface SongPaymentsTabProps {
  paidCents: number;
  outstandingCents: number;
  currency: string;
  nextChargeAt: Date | null;
  milestones: PaymentMilestone[];
  onSendReminder?: () => void;
  onSendInvoice?: () => void;
}

export function PaymentsTab(props: SongPaymentsTabProps) {
  return <AlbumPaymentsTab {...props} />;
}
