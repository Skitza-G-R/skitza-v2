import { PAYMENTS_NEEDS_YOU_ANCHOR } from "~/components/payments/producer-payments-dashboard-model";
import type { Stage } from "~/lib/projects/stages";

export const NEEDS_YOU_VISIBLE_LIMIT = 3;

export type FollowUpSource = {
  id: string;
  artistName: string;
  projectTitle: string;
  projectId: string;
  /** Newest finished booking on the project — the one the calendar opens. */
  bookingId: string;
  count?: number;
};

export type FollowUpGroup = {
  projectId: string;
  artistName: string;
  projectTitle: string;
  bookingId: string;
  count: number;
};

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
    | "follow_up"
    | "comment"
    | "urgent_project"
    | "setup";
  title: string;
  meta: string;
  href: string;
  actionLabel: "Review" | "Open" | "Open project" | "Open calendar" | "Finish setup";
  priority: number;
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
  followUps: readonly FollowUpSource[];
  unresolvedItems: readonly {
    id: string;
    kind: "comment";
    title: string;
    subtitle: string;
    href: string;
  }[];
  urgentProjects: readonly {
    id: string;
    title: string;
    clientName: string;
    stage: Stage;
    urgency: "stuck";
  }[];
  showSetupNudge: boolean;
};

/**
 * Collapse every finished session for the same project into one action.
 * Map insertion order preserves the server's newest-first project order.
 */
export function groupFollowUps(followUps: readonly FollowUpSource[]): FollowUpGroup[] {
  const byProject = new Map<string, FollowUpGroup>();
  for (const followUp of followUps) {
    const existing = byProject.get(followUp.projectId);
    if (existing) {
      existing.count += followUp.count ?? 1;
      continue;
    }
    byProject.set(followUp.projectId, {
      projectId: followUp.projectId,
      artistName: followUp.artistName,
      projectTitle: followUp.projectTitle,
      bookingId: followUp.bookingId,
      count: followUp.count ?? 1,
    });
  }
  return [...byProject.values()];
}

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

  for (const group of groupFollowUps(sources.followUps)) {
    items.push({
      id: `follow-up:${group.projectId}`,
      kind: "follow_up",
      title: group.count === 1 ? "Finished session" : `${String(group.count)} finished sessions`,
      meta: `${group.artistName} · ${group.projectTitle}`,
      // The calendar owns Mark completed / No-show, which is what actually
      // clears this row. The project page has no such control, so pointing
      // there left the producer with nothing to do.
      href: `/dashboard/calendar?booking=${group.bookingId}`,
      actionLabel: "Open calendar",
      priority: 30,
    });
  }

  for (const unresolved of sources.unresolvedItems) {
    items.push({
      id: `unresolved:${unresolved.id}`,
      kind: unresolved.kind,
      title: "Artist comment",
      meta: `${unresolved.title} · ${unresolved.subtitle}`,
      href: unresolved.href,
      actionLabel: "Open project",
      priority: 45,
    });
  }

  for (const project of sources.urgentProjects) {
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
