import { describe, it, expect } from "vitest";

import { notificationHref } from "../notification-bell";
import type { ShellNotificationItem } from "~/server/shell-data";

// Pure helper test only. The bell component itself renders DOM +
// wires Server Actions, which vitest's node environment doesn't
// support — mirroring sidebar.test.tsx, we exercise just the data-
// shape → route mapping so every notification kind has a known
// deep-link target.

function makeItem(overrides: Partial<ShellNotificationItem> = {}): ShellNotificationItem {
  return {
    id: "n-1",
    kind: "comment_created",
    title: "New comment",
    body: "",
    createdAtIso: new Date().toISOString(),
    projectId: null,
    trackVersionId: null,
    commentId: null,
    bookingId: null,
    purchaseRequestId: null,
    paymentProofId: null,
    ...overrides,
  };
}

describe("notificationHref", () => {
  it("routes comment notifications into their project room", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "comment_created",
          projectId: "proj-1",
          commentId: "c-1",
          trackVersionId: "tv-1",
        }),
      ),
    ).toBe("/dashboard/clients-projects/proj-1");
  });

  it("routes booking notifications to the booking detail", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "booking_requested",
          bookingId: "b-1",
        }),
      ),
    ).toBe("/dashboard/booking?id=b-1");
  });

  it("routes a purchase request notification to the producer request detail", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "purchase_requested",
          purchaseRequestId: "request-1",
        }),
      ),
    ).toBe("/dashboard/requests/request-1");
  });

  it("routes a submitted proof to the exact request's private-evidence anchor", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "proof_submitted",
          purchaseRequestId: "request-proof-1",
          paymentProofId: "proof-1",
        }),
      ),
    ).toBe("/dashboard/requests/request-proof-1?proof=proof-1#payment-proof");
  });

  it("prefers projectId over bookingId when both are present", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "booking_requested",
          projectId: "proj-2",
          bookingId: "b-2",
        }),
      ),
    ).toBe("/dashboard/clients-projects/proj-2");
  });

  it("falls back to the projects list when no ref is populated", () => {
    expect(notificationHref(makeItem())).toBe("/dashboard/clients-projects");
  });
});
