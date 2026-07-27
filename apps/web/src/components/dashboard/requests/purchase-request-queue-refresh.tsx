"use client";

import { QueueVersionRefresh } from "~/components/runtime-state/queue-version-refresh";

const PURCHASE_REQUEST_REFRESH_MS = 5_000;

/** Keep an already-open new-work queue in sync with artist submissions. */
export function PurchaseRequestQueueRefresh({ initialVersion }: { initialVersion: string }) {
  return (
    <QueueVersionRefresh
      endpoint="/api/runtime/queue-version?kind=purchase-requests"
      initialVersion={initialVersion}
      intervalMs={PURCHASE_REQUEST_REFRESH_MS}
      refreshOnFocus
      refreshOnPageShow
      refreshOnVisibilityChange
    />
  );
}
