"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// Artist-side notification bell. Mirrors the producer shell's
// NotificationBell visually + behaviourally (Escape, outside-click,
// focus return) but lives in the artist sidebar and will eventually
// pull from an artist-scoped notification feed (new mix uploaded,
// session confirmation, payment received, etc.).
//
// 2026-04-22 — Task 17 Phase 2. Gili confirmed yes to artist
// notifications (design brief §7 Q2). This file ships the UI + empty
// state. Wiring the real data source (new artist tRPC procedure +
// notification-kinds extension) is Phase 2.5 — flagged in the audit
// paper trail.
//
// Intentionally NOT reusing the producer's NotificationBell component
// because its notificationHref() hardcodes /dashboard/projects/<id>
// routes. Artists deep-link into /artist/music/<projectId> or
// /artist/book, which is a different href-resolver. Extracting a
// shared BellDropdown primitive later is the refactor path, but not
// worth the abstraction until we have real data on both sides.

export type ArtistNotificationItem = {
  id: string;
  title: string;
  body: string | null;
  /** One of "new-mix" | "session-confirmed" | "payment-received" etc.
   *  — exact kind enum will be defined when the tRPC procedure lands. */
  kind: string;
  /** Deep-link target within the artist app. */
  href: string;
  createdAtIso: string;
};

export function ArtistNotificationBell({
  unreadCount,
  unreadItems,
}: {
  unreadCount: number;
  unreadItems: readonly ArtistNotificationItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Close on outside-click. Mirrors the producer's bell for consistency.
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

  // Escape closes + returns focus to the bell button.
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
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
      >
        <BellIcon />
        {hasUnread ? (
          <span
            aria-live="polite"
            className="absolute -right-0.5 -top-0.5 flex min-w-[14px] items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] px-1 font-mono text-[0.55rem] font-semibold leading-[14px] text-[rgb(var(--fg-inverse))] ring-2 ring-[rgb(var(--bg-elevated))]"
          >
            {badgeLabel}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          // Same pop origin as the producer bell so the scale-in
          // animation visually springs from the bell icon sitting
          // below the popover in a sidebar-footer placement.
          style={{ transformOrigin: "bottom left" }}
          className="sk-pop absolute bottom-full left-0 z-50 mb-2 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-[rgb(var(--border-subtle))] px-3 py-2">
            <span className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]">
              Notifications
            </span>
          </div>
          <ul aria-live="polite" className="max-h-[60vh] overflow-y-auto">
            {unreadItems.length === 0 ? (
              // While the notification data layer is still being wired
              // (roadmap S2.3), this empty state makes the stub status
              // explicit — otherwise the bell looks broken ("I'll never
              // get notifications?"). The "Coming soon" pill matches
              // the same language the Settings page uses for the
              // corresponding preference toggles.
              <li className="space-y-2 px-3 py-5 text-center">
                <p className="text-sm text-[rgb(var(--fg-muted))]">
                  You&apos;re all caught up.
                </p>
                <p className="inline-block rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  Live notifications coming soon
                </p>
              </li>
            ) : (
              unreadItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    role="menuitem"
                    onClick={close}
                    className="flex min-h-[52px] w-full flex-col items-start justify-center gap-0.5 border-b border-[rgb(var(--border-subtle))] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm text-[rgb(var(--fg-primary))]">
                        {item.title}
                      </span>
                    </span>
                    {item.body ? (
                      <span className="line-clamp-1 text-xs text-[rgb(var(--fg-muted))]">
                        {item.body}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-[rgb(var(--border-subtle))] px-3 py-2">
            <Link
              href="/artist/settings"
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
