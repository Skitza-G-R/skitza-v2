import { describe, expect, it } from "vitest";

import {
  buildNeedsYouQueue,
  capNeedsYouQueue,
  groupFollowUps,
  type NeedsYouSources,
} from "../needs-you";

const EMPTY: NeedsYouSources = {
  paymentProofs: [],
  paymentBalances: [],
  purchaseRequests: [],
  pendingApprovals: [],
  followUps: [],
  unresolvedItems: [],
  urgentProjects: [],
  payments: [],
  showSetupNudge: false,
};

describe("groupFollowUps", () => {
  it("renders one follow-up per project and preserves the session count", () => {
    const groups = groupFollowUps([
      { id: "s-1", artistName: "Maya", projectTitle: "EP", projectId: "p-1" },
      { id: "s-2", artistName: "Maya", projectTitle: "EP", projectId: "p-1" },
      { id: "s-3", artistName: "Lior", projectTitle: "Single", projectId: "p-2" },
    ]);

    expect(groups).toEqual([
      { projectId: "p-1", artistName: "Maya", projectTitle: "EP", count: 2 },
      { projectId: "p-2", artistName: "Lior", projectTitle: "Single", count: 1 },
    ]);
  });

  it("adds server-grouped counts if the same project appears more than once", () => {
    const groups = groupFollowUps([
      {
        id: "p-1:first",
        artistName: "Maya",
        projectTitle: "EP",
        projectId: "p-1",
        count: 3,
      },
      {
        id: "p-1:second",
        artistName: "Maya",
        projectTitle: "EP",
        projectId: "p-1",
        count: 2,
      },
    ]);

    expect(groups[0]?.count).toBe(5);
  });
});

describe("buildNeedsYouQueue", () => {
  it("puts pending payment proofs in the unified queue with their exact review link", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      paymentProofs: [
        {
          proofId: "proof-1",
          artistName: "Maya",
          productNameSnapshot: "Mix & Master",
        },
      ],
    });

    expect(queue).toEqual([
      expect.objectContaining({
        id: "payment-proof:proof-1",
        kind: "payment_proof",
        title: "Payment proof",
        href: "/dashboard/payments/proof-1",
        actionLabel: "Review",
      }),
    ]);
  });

  it("keeps due balances separate from proof, purchase, and session decisions", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      paymentBalances: [
        {
          purchaseId: "purchase-1",
          projectId: "project-1",
          projectTitle: "Debut EP",
          clientName: "Maya",
          purchaseTitle: "EP production",
        },
      ],
      paymentProofs: [{ proofId: "proof-1", artistName: "Noa", productNameSnapshot: "Single" }],
      purchaseRequests: [{ id: "request-1", artistName: "Ari", productNameSnapshot: "Mix" }],
      pendingApprovals: [{ id: "session-1", artistName: "Dana", packageNameSnapshot: "Session" }],
    });

    expect(queue.map((item) => item.kind)).toEqual([
      "payment_proof",
      "payment_due",
      "purchase_request",
      "session_approval",
    ]);
    expect(queue[1]?.href).toBe("/dashboard/payments#payment-history-due-overdue");
  });

  it("keeps unresolved work separate from notification read state and orders real decisions first", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      paymentProofs: [
        {
          proofId: "proof-1",
          artistName: "Ari",
          productNameSnapshot: "Production",
        },
      ],
      purchaseRequests: [{ id: "r-1", artistName: "Maya", productNameSnapshot: "Mix & Master" }],
      pendingApprovals: [{ id: "b-1", artistName: "Dana", packageNameSnapshot: "Session" }],
      followUps: [{ id: "s-1", artistName: "NeedJuice", projectTitle: "Album", projectId: "p-1" }],
      unresolvedItems: [
        {
          id: "invoice:i-1",
          kind: "invoice",
          title: "Lior",
          subtitle: "₪1,500 outstanding",
          href: "/dashboard/clients-projects/p-2",
        },
      ],
      payments: [
        {
          id: "paid-1",
          artistName: "Noa",
          packageNameSnapshot: null,
          unitPriceCents: 100_00,
          songQty: null,
          projectId: "p-3",
          projectName: "Single",
        },
      ],
      showSetupNudge: true,
    });

    expect(queue.map((item) => item.kind)).toEqual([
      "payment_proof",
      "purchase_request",
      "session_approval",
      "follow_up",
      "invoice",
      "payment_received",
      "setup",
    ]);
    expect(queue[0]?.href).toBe("/dashboard/payments/proof-1");
    expect(queue[1]?.href).toBe("/dashboard/requests/r-1");
    expect(queue[2]?.href).toBe("/dashboard/calendar?booking=b-1");
  });

  it("deduplicates a generic urgent-project action when a specific unresolved row opens the same project", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      unresolvedItems: [
        {
          id: "invoice:i-1",
          kind: "invoice",
          title: "Lior",
          subtitle: "₪1,500 outstanding",
          href: "/dashboard/clients-projects/p-2",
        },
      ],
      urgentProjects: [
        {
          id: "p-2",
          title: "Single",
          clientName: "Lior",
          stage: "in_production",
          urgency: "overdue",
        },
      ],
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]?.kind).toBe("invoice");
  });

  it("keeps a distinct urgent signal beside a follow-up for the same project", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      followUps: [
        {
          id: "session-1",
          artistName: "Lior",
          projectTitle: "Single",
          projectId: "p-2",
        },
      ],
      urgentProjects: [
        {
          id: "p-2",
          title: "Single",
          clientName: "Lior",
          stage: "in_production",
          urgency: "stuck",
        },
      ],
    });

    expect(queue.map((item) => item.kind)).toEqual(["follow_up", "urgent_project"]);
  });

  it("does not let an unrelated invoice hide a stuck-project signal", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      unresolvedItems: [
        {
          id: "invoice:i-1",
          kind: "invoice",
          title: "Lior",
          subtitle: "₪1,500 outstanding",
          href: "/dashboard/clients-projects/p-2",
        },
      ],
      urgentProjects: [
        {
          id: "p-2",
          title: "Single",
          clientName: "Lior",
          stage: "in_production",
          urgency: "stuck",
        },
      ],
    });

    expect(queue.map((item) => item.kind)).toEqual(["invoice", "urgent_project"]);
  });

  it("preserves the server's newest-first order inside one priority", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      purchaseRequests: [
        { id: "z-newest", artistName: "Newest", productNameSnapshot: "Mix" },
        { id: "a-older", artistName: "Older", productNameSnapshot: "Master" },
      ],
    });

    expect(queue.map((item) => item.id)).toEqual(["purchase:z-newest", "purchase:a-older"]);
  });
});

describe("capNeedsYouQueue", () => {
  const items = buildNeedsYouQueue({
    ...EMPTY,
    purchaseRequests: Array.from({ length: 5 }, (_, index) => ({
      id: `r-${String(index)}`,
      artistName: `Artist ${String(index)}`,
      productNameSnapshot: "Mix",
    })),
  });

  it("caps the calm dashboard at three visible rows and reports the hidden count", () => {
    const result = capNeedsYouQueue(items, false);
    expect(result.visible).toHaveLength(3);
    expect(result.hiddenCount).toBe(2);
  });

  it("returns every row on the explicit View all path", () => {
    const result = capNeedsYouQueue(items, true);
    expect(result.visible).toHaveLength(5);
    expect(result.hiddenCount).toBe(0);
  });
});
