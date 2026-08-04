import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ShellNotificationItem } from "~/server/shell-data";

import {
  filterNotifications,
  notificationHref,
  notificationIsUnread,
  notificationTabForKey,
  shouldDismissNotificationSheet,
} from "../notification-bell";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "notification-bell.tsx"), "utf-8");

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
    purchaseId: null,
    paymentProofId: null,
    readAtIso: null,
    ...overrides,
  };
}

describe("notificationHref", () => {
  it("does not send an incomplete proof notification into Requests", () => {
    expect(
      notificationHref(
        makeItem({
          id: "proof-1",
          kind: "proof_submitted",
          purchaseId: "purchase-1",
        }),
      ),
    ).toBe("/dashboard/clients-projects");
  });

  it("routes purchase notifications to the dedicated request detail", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "purchase_requested",
          purchaseRequestId: "request-1",
          projectId: "project-ignored",
        }),
      ),
    ).toBe("/dashboard/requests/request-1");
  });

  it("keeps an agreement-accepted notification on that same exact request", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "agreement_accepted",
          purchaseRequestId: "request-accepted-1",
        }),
      ),
    ).toBe("/dashboard/requests/request-accepted-1");
  });

  it("routes bookings to Calendar with that booking selected", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "booking_requested",
          bookingId: "booking-1",
          projectId: "project-ignored",
        }),
      ),
    ).toBe("/dashboard/calendar?booking=booking-1");
  });

  it("routes a submitted proof to the exact Payments item", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "proof_submitted",
          purchaseId: "purchase-proof-1",
          paymentProofId: "proof-1",
        }),
      ),
    ).toBe("/dashboard/payments/proof-1");
  });

  it("routes comment notifications to the real track conversation", () => {
    expect(
      notificationHref(
        makeItem({
          projectId: "project-1",
          commentId: "comment-1",
          trackVersionId: "version-1",
        }),
      ),
    ).toBe("/dashboard/music/version-1");
  });

  it("routes other project-backed notifications into their project room", () => {
    expect(
      notificationHref(
        makeItem({
          kind: "project_updated",
          projectId: "project-1",
        }),
      ),
    ).toBe("/dashboard/clients-projects/project-1");
  });

  it("falls back to the projects list when no source ref is populated", () => {
    expect(notificationHref(makeItem())).toBe("/dashboard/clients-projects");
  });
});

describe("notification read state and tabs", () => {
  const unread = makeItem({ id: "unread" });
  const read = makeItem({
    id: "read",
    readAtIso: "2026-07-11T08:00:00.000Z",
  });

  it("derives unread state from readAtIso", () => {
    expect(notificationIsUnread(unread)).toBe(true);
    expect(notificationIsUnread(read)).toBe(false);
  });

  it("keeps both states in All and filters read rows from Unread", () => {
    expect(filterNotifications([unread, read], "all").map((item) => item.id)).toEqual([
      "unread",
      "read",
    ]);
    expect(filterNotifications([unread, read], "unread").map((item) => item.id)).toEqual([
      "unread",
    ]);
  });

  it("removes a locally marked row from Unread without deleting it from All", () => {
    const override = new Set(["unread"]);
    expect(filterNotifications([unread, read], "unread", override)).toEqual([]);
    expect(filterNotifications([unread, read], "all", override)).toHaveLength(2);
  });
});

describe("NotificationBell interaction contract", () => {
  it("opens on Unread and exposes persisted dismissal controls", () => {
    expect(SRC).toContain('useState<NotificationTab>("unread")');
    expect(SRC).toContain("archiveNotification");
    expect(SRC).toContain("archiveAllNotifications");
    expect(SRC).toContain("Clear all");
    expect(SRC).toContain("Dismiss ${item.title}");
  });

  it("renders an anchored desktop popover and a full-width mobile Sheet", () => {
    expect(SRC).toContain('data-testid="notification-popover"');
    expect(SRC).toContain('data-testid="notification-sheet"');
    expect(SRC).toMatch(/<SheetContent[\s\S]*?side="bottom"/);
    expect(SRC).toMatch(/<SheetTitle[\s\S]*?>[\s\S]*?Notifications/);
    expect(SRC).toMatch(/<SheetDescription[\s\S]*?>[\s\S]*?Recent producer notifications/);
    expect(SRC).toContain("w-full");
    expect(SRC).toContain("DESKTOP_MEDIA_QUERY");
  });

  it("supports All / Unread tabs with explicit tab semantics", () => {
    expect(SRC).toContain('role="tablist"');
    expect(SRC).toContain('role="tab"');
    expect(SRC).toContain('role="tabpanel"');
    expect(SRC).toContain("aria-selected");
    expect(notificationTabForKey("ArrowRight")).toBe("unread");
    expect(notificationTabForKey("End")).toBe("unread");
    expect(notificationTabForKey("ArrowLeft")).toBe("all");
    expect(notificationTabForKey("Home")).toBe("all");
    expect(notificationTabForKey("Enter")).toBeNull();
  });

  it("returns focus on Escape without stealing focus from an outside click", () => {
    expect(SRC).toContain('event.key === "Escape"');
    expect(SRC).toContain('addEventListener("pointerdown"');
    expect(SRC).toContain("buttonRef.current?.focus()");
    expect(SRC).toMatch(/handlePointerDown[\s\S]*?setOpen\(false\)/);
    expect(SRC).toMatch(/handleKeyDown[\s\S]*?closeWithFocusReturn\(\)/);
    expect(SRC).toContain("onCloseAutoFocus");
    expect(SRC).toContain('aria-haspopup="dialog"');
  });

  it("keeps archive failures visible and lets item navigation proceed", () => {
    expect(SRC).toContain('role="alert"');
    expect(SRC).toContain('data-testid="notification-error"');
    expect(SRC).toContain("setDismissedIds");
    expect(SRC).toMatch(/catch \{[\s\S]*?setError\(FALLBACK_ERROR\)/);
    expect(SRC).toMatch(/handleItemClick[\s\S]*?finally \{[\s\S]*?router\.push/);
  });

  it("uses a numeric amber badge rather than an unread-only dot", () => {
    expect(SRC).toContain("badgeLabel");
    expect(SRC).toContain("99+");
    expect(SRC).toContain("{badgeLabel}");
  });

  it("disables transform motion when reduced motion is requested", () => {
    expect(SRC).toContain("motion-reduce:transition-none");
    expect(SRC).toContain("motion-reduce:active:scale-100");
  });

  it("lets the mobile sheet handle track a downward pointer drag", () => {
    expect(SRC).toContain('data-testid="notification-sheet-handle"');
    expect(SRC).toContain("onPointerDown={handleSheetPointerDown}");
    expect(SRC).toContain("onPointerMove={handleSheetPointerMove}");
    expect(SRC).toContain("translate3d(0,");
  });
});

describe("notification sheet drag dismissal", () => {
  it("dismisses after a deliberate drag past the distance threshold", () => {
    expect(
      shouldDismissNotificationSheet({
        distancePx: 170,
        velocityPxPerMs: 0.2,
        sheetHeightPx: 600,
      }),
    ).toBe(true);
  });

  it("dismisses a short but intentional fast downward flick", () => {
    expect(
      shouldDismissNotificationSheet({
        distancePx: 36,
        velocityPxPerMs: 0.9,
        sheetHeightPx: 600,
      }),
    ).toBe(true);
  });

  it("springs back after a short slow drag or an upward gesture", () => {
    expect(
      shouldDismissNotificationSheet({
        distancePx: 40,
        velocityPxPerMs: 0.2,
        sheetHeightPx: 600,
      }),
    ).toBe(false);
    expect(
      shouldDismissNotificationSheet({
        distancePx: -80,
        velocityPxPerMs: -0.6,
        sheetHeightPx: 600,
      }),
    ).toBe(false);
  });
});
