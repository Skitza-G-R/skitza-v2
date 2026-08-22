import type { PaymentReadModel } from "~/server/domain/purchase-ledger/read-model";

import { toPaymentHistoryViewData } from "./payment-history-adapter";
import type {
  PaymentWorkspaceBucket,
  PaymentWorkspaceBucketId,
} from "./producer-payment-workspace-model";

const BUCKETS: readonly Readonly<{
  id: PaymentWorkspaceBucketId;
  label: string;
}>[] = [
  { id: "needs_review", label: "Needs review" },
  { id: "due_or_overdue", label: "Due now" },
  { id: "upcoming", label: "Upcoming" },
  { id: "history", label: "History" },
];

/**
 * Adapts the domain-owned producer buckets once for the compact workspace.
 * The workspace only changes presentation: bucket assignment, status, amounts,
 * project ownership, and available actions still come from the shared ledger.
 */
export function toProducerPaymentWorkspaceBuckets(
  buckets: PaymentReadModel["producerBuckets"],
): readonly PaymentWorkspaceBucket[] {
  return BUCKETS.map(({ id, label }) => ({
    id,
    label,
    projects: toPaymentHistoryViewData(
      buckets[id],
      {
        id: `workspace-${id.replaceAll("_", "-")}`,
        eyebrow: "Payments",
        title: label,
        description: "",
        emptyTitle: "No payment records",
        emptyDescription: "Agreements will appear here.",
      },
      "producer",
    ).projects,
  }));
}
