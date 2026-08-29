import { describe, expect, it } from "vitest";

import { PAYMENTS_NEEDS_YOU_ANCHOR } from "~/components/payments/producer-payments-dashboard-model";

import {
  buildNeedsYouQueue,
  capNeedsYouQueue,
  groupFollowUps,
  shortActionLabel,
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
  showSetupNudge: false,
};

describe("groupFollowUps", () => {
  it("renders one follow-up per project and preserves the session count", () => {
    const groups = groupFollowUps([
      { id: "s-1", artistName: "Maya", projectTitle: "EP", projectId: "p-1", bookingId: "b-1" },
      { id: "s-2", artistName: "Maya", projectTitle: "EP", projectId: "p-1", bookingId: "b-2" },
      { id: "s-3", artistName: "Lior", projectTitle: "Single", projectId: "p-2", bookingId: "b-3" },
    ]);

    // The first row per project wins the booking id — the server already
    // orders each group newest-session-first.
    expect(groups).toEqual([
      { projectId: "p-1", artistName: "Maya", projectTitle: "EP", bookingId: "b-1", count: 2 },
      { projectId: "p-2", artistName: "Lior", projectTitle: "Single", bookingId: "b-3", count: 1 },
    ]);
  });

  it("adds server-grouped counts if the same project appears more than once", () => {
    const groups = groupFollowUps([
      {
        id: "p-1:first",
        artistName: "Maya",
        projectTitle: "EP",
        projectId: "p-1",
        bookingId: "b-1",
        count: 3,
      },
      {
        id: "p-1:second",
        artistName: "Maya",
        projectTitle: "EP",
        projectId: "p-1",
        bookingId: "b-2",
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
    expect(queue[1]?.href).toBe(`/dashboard/payments#${PAYMENTS_NEEDS_YOU_ANCHOR}`);
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
      followUps: [
        {
          id: "s-1",
          artistName: "NeedJuice",
          projectTitle: "Album",
          projectId: "p-1",
          bookingId: "b-2",
        },
      ],
      unresolvedItems: [
        {
          id: "comment:c-1",
          kind: "comment",
          title: "Lior",
          subtitle: "Please check the bridge",
          href: "/dashboard/music/v-2",
        },
      ],
      showSetupNudge: true,
    });

    expect(queue.map((item) => item.kind)).toEqual([
      "payment_proof",
      "purchase_request",
      "session_approval",
      "follow_up",
      "comment",
      "setup",
    ]);
    expect(queue[0]?.href).toBe("/dashboard/payments/proof-1");
    expect(queue[1]?.href).toBe("/dashboard/requests/r-1");
    expect(queue[2]?.href).toBe("/dashboard/calendar?booking=b-1");
    expect(queue.at(-1)).toEqual(
      expect.objectContaining({
        kind: "setup",
        href: "/onboarding",
        actionLabel: "Finish setup",
      }),
    );
  });

  it("keeps an artist comment separate from a project urgency signal", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      unresolvedItems: [
        {
          id: "comment:c-1",
          kind: "comment",
          title: "Lior",
          subtitle: "Please check the bridge",
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

    expect(queue.map((item) => item.kind)).toEqual(["comment", "urgent_project"]);
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
          bookingId: "b-7",
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

  it("does not let an unrelated comment hide a stuck-project signal", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      unresolvedItems: [
        {
          id: "comment:c-1",
          kind: "comment",
          title: "Lior",
          subtitle: "Please check the bridge",
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

    expect(queue.map((item) => item.kind)).toEqual(["comment", "urgent_project"]);
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

// SK-283 — a Needs You row is only honest if its button lands on a screen
// that can actually clear it. Before this suite, three rows pointed at pages
// with no matching control, so the producer clicked, found nothing to do, and
// the row stayed forever.
describe("SK-283 — every row lands where the work gets finished", () => {
  it("sends a finished-session follow-up to the calendar, where sessions are marked completed", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      followUps: [
        {
          id: "s-1",
          artistName: "Lital",
          projectTitle: "Album",
          projectId: "p-1",
          bookingId: "b-9",
        },
      ],
    });

    // The project page has no "Mark completed" control — the calendar does,
    // and ?booking= already resolves the right tab from the booking's status.
    expect(queue[0]?.href).toBe("/dashboard/calendar?booking=b-9");
  });

  it("keeps one row per project but points it at that project's newest finished session", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      followUps: [
        {
          id: "s-1",
          artistName: "Lital",
          projectTitle: "Album",
          projectId: "p-1",
          bookingId: "b-newest",
          count: 2,
        },
      ],
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]?.title).toBe("2 finished sessions");
    expect(queue[0]?.href).toBe("/dashboard/calendar?booking=b-newest");
  });

  it("sends a payment-due row to an anchor that exists on the payments page", () => {
    const queue = buildNeedsYouQueue({
      ...EMPTY,
      paymentBalances: [
        {
          purchaseId: "purchase-1",
          projectId: "p-1",
          projectTitle: "EP",
          clientName: "Maya",
          purchaseTitle: "EP production",
        },
      ],
    });

    // The old target, #payment-history-due-overdue, matches no element in the
    // app, so the browser silently ignored it.
    expect(queue[0]?.href).toBe(`/dashboard/payments#${PAYMENTS_NEEDS_YOU_ANCHOR}`);
    expect(queue[0]?.href).not.toContain("payment-history-due-overdue");
  });

});

// The phone button is min-w-[76px] with px-3, so a two-word action has to
// collapse. "Open project" already did; "Open calendar" is longer still and
// would push the row past the 360px budget.
describe("shortActionLabel", () => {
  it("collapses every two-word Open action to one word on phones", () => {
    expect(shortActionLabel("Open project")).toBe("Open");
    expect(shortActionLabel("Open calendar")).toBe("Open");
  });

  it("leaves the one-word actions alone", () => {
    expect(shortActionLabel("Review")).toBe("Review");
    expect(shortActionLabel("Open")).toBe("Open");
    expect(shortActionLabel("Finish setup")).toBe("Finish setup");
  });
});
