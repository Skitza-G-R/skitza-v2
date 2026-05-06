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
