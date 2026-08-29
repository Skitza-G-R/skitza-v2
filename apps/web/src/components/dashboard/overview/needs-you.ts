import { PAYMENTS_NEEDS_YOU_ANCHOR } from "~/components/payments/producer-payments-dashboard-model";
import type { Stage } from "~/lib/projects/stages";

export const NEEDS_YOU_VISIBLE_LIMIT = 3;

/**
 * The only rows a producer may hide. Money and time-boxed decisions are
 * deliberately absent: a payment proof, a due balance, a purchase request and
 * a session request all either cost money or expire on a clock, so hiding one
 * would turn "Nothing needs you right now" into a lie. The DB CHECK on
 * producer_attention_dismissals.item_kind still names "follow_up" as well; the
 * finished-session row it belonged to is gone, so those leftover rows are read
 * and ignored rather than migrated away.
 */
export const DISMISSIBLE_KINDS = ["comment", "urgent_project"] as const;

export type DismissibleKind = (typeof DISMISSIBLE_KINDS)[number];

export type AttentionDismissal = {
  itemKind: DismissibleKind;
  subjectId: string;
  dismissedAt: Date;
};

/**
 * "Hide until it changes." A dismissal is a timestamp, not a flag, so a row is
 * hidden only while the producer's click is at least as new as the last real
 * change to its subject. When the subject moves again — another session ends,
 * a new upload lands, the artist writes again — `changedAt` overtakes the
 * dismissal and the row returns on its own. Nothing has to clear it.
 */
export function isDismissed(
  dismissals: readonly AttentionDismissal[],
  kind: DismissibleKind,
  subjectId: string,
  changedAt: Date,
): boolean {
  const hit = dismissals.find(
    (dismissal) => dismissal.itemKind === kind && dismissal.subjectId === subjectId,
  );
  if (!hit) return false;
  return hit.dismissedAt.getTime() >= changedAt.getTime();
}

export type PaymentProofSource = {
  proofId: string;
  artistName: string;
  productNameSnapshot: string;
};

export type PaymentBalanceSource = {
  purchaseId: string;
  projectId: string;
  projectTitle: string;
  clientName: string;
  purchaseTitle: string;
};

export type NeedsYouItem = {
  id: string;
  kind:
    | "payment_proof"
    | "payment_due"
    | "purchase_request"
    | "session_approval"
    | "comment"
    | "urgent_project"
    | "setup";
  title: string;
  meta: string;
  href: string;
  actionLabel: "Review" | "Open" | "Open project" | "Finish setup";
  priority: number;
  /** Present only on rows the producer is allowed to hide. */
  dismiss?: { kind: DismissibleKind; subjectId: string };
};

export type NeedsYouSources = {
  paymentProofs: readonly PaymentProofSource[];
  paymentBalances: readonly PaymentBalanceSource[];
  purchaseRequests: readonly {
    id: string;
    artistName: string;
    productNameSnapshot: string;
  }[];
  pendingApprovals: readonly {
    id: string;
    artistName: string;
    packageNameSnapshot: string | null;
  }[];
  unresolvedItems: readonly {
    id: string;
    /** Bare comment id — the dismissal key, without the "comment:" prefix. */
    commentId: string;
    kind: "comment";
    title: string;
    subtitle: string;
    href: string;
    /** When the comment was written; a newer one is simply a different row. */
    occurredAt: Date;
  }[];
  urgentProjects: readonly {
    id: string;
    title: string;
    clientName: string;
    stage: Stage;
    urgency: "stuck";
    /** Newest upload, else the project's own updatedAt — the staleness clock. */
    lastActivityAt: Date;
  }[];
  dismissals: readonly AttentionDismissal[];
  showSetupNudge: boolean;
};

/**
 * Build one deterministic unresolved-work queue. This is deliberately
 * separate from notification read/unread state: a row stays until the
 * underlying job is resolved, and every row's action link points at the
 * screen that can actually resolve it.
 */
export function buildNeedsYouQueue(sources: NeedsYouSources): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  for (const proof of sources.paymentProofs) {
    items.push({
      id: `payment-proof:${proof.proofId}`,
      kind: "payment_proof",
      title: "Payment proof",
      meta: `${proof.artistName} · ${proof.productNameSnapshot}`,
      href: `/dashboard/payments/${proof.proofId}`,
      actionLabel: "Review",
      priority: 5,
    });
  }

  for (const balance of sources.paymentBalances) {
    items.push({
      id: `payment-due:${balance.purchaseId}`,
      kind: "payment_due",
      title: "Payment due",
      meta: `${balance.clientName} · ${balance.projectTitle} · ${balance.purchaseTitle}`,
      href: `/dashboard/payments#${PAYMENTS_NEEDS_YOU_ANCHOR}`,
      actionLabel: "Open",
      priority: 8,
    });
  }

  for (const request of sources.purchaseRequests) {
    items.push({
      id: `purchase:${request.id}`,
      kind: "purchase_request",
      title: "Purchase request",
      meta: `${request.artistName} · ${request.productNameSnapshot}`,
      href: `/dashboard/requests/${request.id}`,
      actionLabel: "Review",
      priority: 10,
    });
  }

  for (const approval of sources.pendingApprovals) {
    items.push({
      id: `session-approval:${approval.id}`,
      kind: "session_approval",
      title: "Session request",
      meta: `${approval.artistName} · ${approval.packageNameSnapshot ?? "Session"}`,
      href: `/dashboard/calendar?booking=${approval.id}`,
      actionLabel: "Review",
      priority: 20,
    });
  }

  for (const unresolved of sources.unresolvedItems) {
    if (
      isDismissed(sources.dismissals, "comment", unresolved.commentId, unresolved.occurredAt)
    ) {
      continue;
    }
    items.push({
      id: `unresolved:${unresolved.id}`,
      kind: unresolved.kind,
      title: "Artist comment",
      meta: `${unresolved.title} · ${unresolved.subtitle}`,
      href: unresolved.href,
      actionLabel: "Open project",
      priority: 45,
      dismiss: { kind: "comment", subjectId: unresolved.commentId },
    });
  }

  for (const project of sources.urgentProjects) {
    if (isDismissed(sources.dismissals, "urgent_project", project.id, project.lastActivityAt)) {
      continue;
    }
    items.push({
      id: `urgent:${project.id}`,
      // `classifyUrgency` only ever returns "stuck" — the money-flavoured
      // titles this branch used to carry were unreachable.
      kind: "urgent_project",
      title: "Project needs movement",
      meta: `${project.clientName || "Client"} · ${project.title}`,
      href: `/dashboard/clients-projects/${project.id}`,
      actionLabel: "Open project",
      priority: 50,
      dismiss: { kind: "urgent_project", subjectId: project.id },
    });
  }

  if (sources.showSetupNudge) {
    items.push({
      id: "setup",
      kind: "setup",
      title: "Finish studio setup",
      meta: "Add a service and your available hours",
      href: "/onboarding",
      actionLabel: "Finish setup",
      priority: 70,
    });
  }

  // Array#sort is stable in the supported Node/browser runtimes, so rows
  // with the same priority retain the newest-first order supplied by their
  // server query instead of being shuffled by UUID text.
  return items.sort((a, b) => a.priority - b.priority);
}

/**
 * Phone label for a row's action button. The button is `min-w-[76px]` with
 * `px-3` at 360px, so a two-word action has to collapse to fit beside the
 * icon and the truncating title.
 */
export function shortActionLabel(actionLabel: NeedsYouItem["actionLabel"]): string {
  return actionLabel.startsWith("Open ") ? "Open" : actionLabel;
}

export function capNeedsYouQueue(
  items: readonly NeedsYouItem[],
  showAll: boolean,
  limit = NEEDS_YOU_VISIBLE_LIMIT,
): { visible: readonly NeedsYouItem[]; hiddenCount: number } {
  if (showAll) return { visible: items, hiddenCount: 0 };
  const visible = items.slice(0, limit);
  return { visible, hiddenCount: Math.max(0, items.length - visible.length) };
}
