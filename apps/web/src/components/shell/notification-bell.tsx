"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { formatRelativeTime } from "~/lib/time/relative";
import type { ShellNotificationItem } from "~/server/shell-data";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "./notification-bell-actions";

// AppShell notification bell. Replaces the killed `/dashboard/inbox`
// page (Task 2): unread notifications now live in the shell footer
// next to the user menu, Linear/Notion-style. The bell owns nothing
// heavy — the list arrives server-side from getShellState() so first
// paint has real data, and each interaction (markRead, markAllRead)
// is a Server Action that revalidates the shell so the count + list
// stay authoritative without a client-side tRPC pipeline.
//
// The dropdown is a plain absolutely-positioned panel. We close on
// Escape + outside-click + route change. Items deep-link into the
// Project Room (or the Booking detail for session notifications) via
// notificationHref() below; clicking an item marks it read and
// navigates in a single transition so the badge updates on return.
//
// Accessibility:
// - Bell button: aria-haspopup="menu", aria-expanded, aria-live on count
// - Dropdown: role="menu" with role="menuitem" rows
// - Esc closes, focus returns to the bell button
// - "Mark all read" + Settings link anchor the bottom of the dropdown

// Derive a deep-link href from the notification's related refs.
// Exported for unit testing — the ordering mirrors the schema FK
// priority: a comment/track belongs to a project; a booking has its
// own detail surface. Kept pure so tests can exhaust every kind branch.
export function notificationHref(n: ShellNotificationItem): string {
  if (n.projectId) return `/dashboard/clients-projects/${n.projectId}`;
  if (n.bookingId) return `/dashboard/booking?id=${n.bookingId}`;
  return "/dashboard/clients-projects";
}

export function NotificationBell({
  unreadCount,
  unreadItems,
}: {
  unreadCount: number;
  unreadItems: readonly ShellNotificationItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Close on outside-click. Mirrors the studio-switcher pattern so
  // behaviour is consistent across the shell.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  // Escape closes the dropdown and returns focus to the bell. The
  // focus return is important for keyboard users — otherwise focus
  // vanishes when the dropdown's items unmount.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, [open]);

  const handleItemClick = useCallback(
    (item: ShellNotificationItem) => {
      const href = notificationHref(item);
      setOpen(false);
      startTransition(async () => {
        await markNotificationRead(item.id);
        router.push(href);
      });
    },
    [router],
  );

  const handleMarkAll = useCallback(() => {
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  }, []);

  const hasUnread = unreadCount > 0;
  const badgeLabel = unreadCount > 99 ? "99+" : unreadCount.toString();

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={hasUnread ? `Notifications (${badgeLabel} unread)` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
        // h-9 w-9 (36px) on mobile for drawer ergonomics, tightens
        // back to h-7 w-7 (28px) on desktop where the sidebar footer
        // is compact. focus-visible ring makes the bell reachable via
        // keyboard from the nav above.
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] md:h-7 md:w-7"
      >
        <BellIcon />
        {hasUnread ? (
          <span
            aria-live="polite"
            className="absolute -right-0.5 -top-0.5 flex min-w-[14px] items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-1 font-mono text-[0.55rem] font-semibold leading-[14px] text-[rgb(var(--fg-inverse))] ring-2 ring-[rgb(var(--bg-elevated))]"
          >
            {badgeLabel}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          // Anchored to the bell: sidebar lives at the left edge, so
          // align the dropdown to the button's left and push it above
          // (the bell is near the sidebar footer, so below would be
          // clipped by the bottom of the rail). max-w keeps it on
          // screen at 360px viewports.
          // `sk-pop` + inline `origin-bottom-left` overrides the
          // default top-left origin so the scale-in visually springs
          // from the bell icon sitting below the popover.
          style={{ transformOrigin: "bottom left" }}
          className="sk-pop absolute bottom-full left-0 z-50 mb-2 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-[rgb(var(--border-subtle))] px-3 py-2">
            <span className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]">
              Notifications
            </span>
            {hasUnread ? (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={isPending}
                className="font-mono text-[0.625rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--brand-primary))] disabled:opacity-50"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <ul aria-live="polite" className="max-h-[60vh] overflow-y-auto">
            {unreadItems.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-[rgb(var(--fg-muted))]">
                You're all caught up.
              </li>
            ) : (
              unreadItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleItemClick(item);
                    }}
                    disabled={isPending}
                    // min-h-[52px] keeps each notification row reliably
                    // tappable even when it's a single-line item. Inset
                    // focus-visible clips the ring to the row rect so
                    // it doesn't overflow the dropdown edges.
                    className="flex min-h-[52px] w-full flex-col items-start justify-center gap-0.5 border-b border-[rgb(var(--border-subtle))] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))] disabled:opacity-50"
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm text-[rgb(var(--fg-primary))]">
                        {item.title}
                      </span>
                      <span className="shrink-0 font-mono text-[0.625rem] text-[rgb(var(--fg-muted))]">
                        {formatRelativeTime(new Date(item.createdAtIso))}
                      </span>
                    </span>
                    {item.body ? (
                      <span className="line-clamp-1 text-xs text-[rgb(var(--fg-muted))]">
                        {item.body}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-[rgb(var(--border-subtle))] px-3 py-2">
            <Link
              href="/dashboard/settings"
              onClick={close}
              className="font-mono text-[0.625rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--brand-primary))]"
            >
              Notification settings →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Bell glyph — outlined style to match the other sidebar icons (home,
// library, folder, cog). 16x16, stroke=currentColor so hover states
// flow through parent text colour.
function BellIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 6.5a4.5 4.5 0 0 1 9 0v2.2l1 2.3H2.5l1-2.3V6.5Z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}
