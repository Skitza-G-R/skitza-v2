import type { Stage } from "~/lib/projects/stages";

export const NEEDS_YOU_VISIBLE_LIMIT = 3;

export type FollowUpSource = {
  id: string;
  artistName: string;
  projectTitle: string;
  projectId: string;
  count?: number;
};

export type FollowUpGroup = {
  projectId: string;
  artistName: string;
  projectTitle: string;
  count: number;
};

export type PaymentSource = {
  id: string;
  artistName: string;
  packageNameSnapshot: string | null;
  unitPriceCents: number | null;
  songQty: number | null;
  projectId: string | null;
  projectName: string;
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
    | "invoice"
    | "comment"
    | "urgent_project"
    | "payment_received"
    | "setup";
  title: string;
  meta: string;
  href: string;
  actionLabel: "Review" | "Open" | "Open project" | "Finish setup";
  priority: number;
  payment?: PaymentSource;
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
    kind: "comment" | "invoice";
    title: string;
    subtitle: string;
    href: string;
  }[];
  urgentProjects: readonly {
    id: string;
    title: string;
    clientName: string;
    stage: Stage;
    urgency: "overdue" | "deposit_due" | "stuck";
  }[];
  payments: readonly PaymentSource[];
  showSetupNudge: boolean;
};

/**
 * Collapse every finished session for the same project into one action.
 * Map insertion order preserves the server's newest-first project order.
 */
export function groupFollowUps(
  followUps: readonly FollowUpSource[],
): FollowUpGroup[] {
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
      count: followUp.count ?? 1,
    });
  }
  return [...byProject.values()];
}

/**
 * Build one deterministic unresolved-work queue. This is deliberately
 * separate from notification read/unread state: these rows stay until the
 * underlying job is resolved or, for a received payment, acknowledged.
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
      href: "/dashboard/payments#payment-history-due-overdue",
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
      title:
        group.count === 1
          ? "Finished session"
          : `${String(group.count)} finished sessions`,
      meta: `${group.artistName} · ${group.projectTitle}`,
      href: `/dashboard/clients-projects/${group.projectId}`,
      actionLabel: "Open project",
      priority: 30,
    });
  }

  for (const unresolved of sources.unresolvedItems) {
    items.push({
      id: `unresolved:${unresolved.id}`,
      kind: unresolved.kind,
      title: unresolved.kind === "invoice" ? "Payment due" : "Artist comment",
      meta: `${unresolved.title} · ${unresolved.subtitle}`,
      href: unresolved.href,
      actionLabel: "Open project",
      priority: unresolved.kind === "invoice" ? 40 : 45,
    });
  }

  // An invoice already pointing at an overdue/deposit-due project is the
  // more specific version of that same payment action. Other project work
  // (comments and finished-session follow-ups) is not equivalent: on mobile
  // the Needs You queue is the only place the separate urgency is visible.
  const invoiceProjectHrefs = new Set(
    items
      .filter(
        (item) =>
          item.kind === "invoice" &&
          item.href.startsWith("/dashboard/clients-projects/"),
      )
      .map((item) => item.href.split("?")[0]),
  );
  for (const project of sources.urgentProjects) {
    const href = `/dashboard/clients-projects/${project.id}`;
    if (
      invoiceProjectHrefs.has(href) &&
      (project.urgency === "overdue" || project.urgency === "deposit_due")
    ) {
      continue;
    }
    items.push({
      id: `urgent:${project.id}`,
      kind: "urgent_project",
      title:
        project.urgency === "overdue"
          ? "Overdue payment"
          : project.urgency === "deposit_due"
            ? "Deposit due"
            : "Project needs movement",
      meta: `${project.clientName || "Client"} · ${project.title}`,
      href,
      actionLabel: "Open project",
      priority: 50,
    });
  }

  for (const payment of sources.payments) {
    items.push({
      id: `payment:${payment.id}`,
      kind: "payment_received",
      title: "Payment received",
      meta: `${payment.artistName} · ${payment.projectName}`,
      href: payment.projectId
        ? `/dashboard/clients-projects/${payment.projectId}`
        : "/dashboard/clients-projects",
      actionLabel: "Open project",
      priority: 60,
      payment,
    });
  }

  if (sources.showSetupNudge) {
    items.push({
      id: "setup",
      kind: "setup",
      title: "Finish studio setup",
      meta: "Add a service and your available hours",
      href: "/dashboard/onboarding",
      actionLabel: "Finish setup",
      priority: 70,
    });
  }

  // Array#sort is stable in the supported Node/browser runtimes, so rows
  // with the same priority retain the newest-first order supplied by their
  // server query instead of being shuffled by UUID text.
  return items.sort((a, b) => a.priority - b.priority);
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
