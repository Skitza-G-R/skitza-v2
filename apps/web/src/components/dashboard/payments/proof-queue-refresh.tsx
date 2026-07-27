"use client";

import { QueueVersionRefresh } from "~/components/runtime-state/queue-version-refresh";

const PROOF_QUEUE_REFRESH_MS = 5_000;

type ProofQueueRefreshProps =
  | Readonly<{
      kind: "dashboard" | "payment-proofs";
      initialVersion: string;
      enabled?: boolean;
    }>
  | Readonly<{
      kind: "payment-proof";
      proofId: string;
      initialVersion: string;
      enabled?: boolean;
    }>;

export function ProofQueueRefresh(props: ProofQueueRefreshProps) {
  const endpoint =
    props.kind === "payment-proof"
      ? `/api/runtime/queue-version?kind=payment-proof&proofId=${encodeURIComponent(props.proofId)}`
      : `/api/runtime/queue-version?kind=${props.kind}`;

  return (
    <QueueVersionRefresh
      enabled={props.enabled ?? true}
      endpoint={endpoint}
      initialVersion={props.initialVersion}
      intervalMs={PROOF_QUEUE_REFRESH_MS}
      refreshOnFocus
      refreshOnVisibilityChange
    />
  );
}
