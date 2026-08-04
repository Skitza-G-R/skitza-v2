"use client";

import {
  Bell,
  CalendarDays,
  CheckCircle2,
  MessageSquare,
  ShoppingBag,
  WalletCards,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import { formatRelativeTime } from "~/lib/time/relative";
import type { ShellNotificationItem } from "~/server/shell-data";

import {
  archiveAllNotifications,
  archiveNotification,
  markNotificationRead,
} from "./notification-bell-actions";

export type NotificationTab = "all" | "unread";

/** Arrow/Home/End behavior for the two-tab notification filter. */
export function notificationTabForKey(key: string): NotificationTab | null {
  if (key === "ArrowRight" || key === "End") return "unread";
  if (key === "ArrowLeft" || key === "Home") return "all";
  return null;
}

/** Pure read-state helper kept exported for focused regression tests. */
export function notificationIsUnread(
  notification: ShellNotificationItem,
  readOverrides: ReadonlySet<string> = new Set<string>(),
): boolean {
  return notification.readAtIso === null && !readOverrides.has(notification.id);
}

/** Pure tab filter: the All tab retains read rows; Unread removes them. */
export function filterNotifications(
  notifications: readonly ShellNotificationItem[],
  tab: NotificationTab,
  readOverrides: ReadonlySet<string> = new Set<string>(),
): ShellNotificationItem[] {
  if (tab === "all") return [...notifications];
  return notifications.filter((item) => notificationIsUnread(item, readOverrides));
}

/**
 * Notification deep links are source-specific. Purchase requests own their
 * dedicated SK-72 detail surface; bookings open Calendar with that booking
 * selected; project-backed events go to the project room.
 */
export function notificationHref(notification: ShellNotificationItem): string {
  if (notification.kind === "proof_submitted" && notification.paymentProofId) {
    return `/dashboard/payments/${encodeURIComponent(notification.paymentProofId)}`;
  }
  if (notification.purchaseRequestId) {
    return `/dashboard/requests/${encodeURIComponent(notification.purchaseRequestId)}`;
  }
  if (notification.bookingId) {
    return `/dashboard/calendar?booking=${encodeURIComponent(notification.bookingId)}`;
  }
  if (notification.kind === "comment_created" && notification.trackVersionId) {
    return `/dashboard/music/${encodeURIComponent(notification.trackVersionId)}`;
  }
  if (notification.projectId) {
    return `/dashboard/clients-projects/${encodeURIComponent(notification.projectId)}`;
  }
  return "/dashboard/clients-projects";
}

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FALLBACK_ERROR = "Notifications couldn't be updated. Try again.";
const SHEET_SETTLE_MS = 220;

export function shouldDismissNotificationSheet({
  distancePx,
  velocityPxPerMs,
  sheetHeightPx,
}: {
  distancePx: number;
  velocityPxPerMs: number;
  sheetHeightPx: number;
}): boolean {
  if (distancePx <= 0) return false;
  const distanceThreshold = Math.min(160, Math.max(80, sheetHeightPx * 0.25));
  const isFastDownwardFlick = distancePx >= 24 && velocityPxPerMs >= 0.75;
  return distancePx >= distanceThreshold || isFastDownwardFlick;
}

type SheetDragState = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocityPxPerMs: number;
};

export function NotificationBell({
  unreadCount,
  notifications,
}: {
  unreadCount: number;
  notifications: readonly ShellNotificationItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotificationTab>("unread");
  const [isDesktop, setIsDesktop] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readOverrides, setReadOverrides] = useState<Set<string>>(() => new Set<string>());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set<string>());
  const [clearedAll, setClearedAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetDragRef = useRef<SheetDragState | null>(null);
  const sheetSettleTimerRef = useRef<number | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const panelId = useId();
  const tabPanelId = useId();

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => {
      setIsDesktop(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  // Server refreshes replace the authoritative feed. Drop local optimistic
  // read markers then so a newly arrived notification is never hidden.
  useEffect(() => {
    setReadOverrides(new Set<string>());
    setDismissedIds(new Set<string>());
    setClearedAll(false);
  }, [notifications, unreadCount]);

  useEffect(
    () => () => {
      if (sheetSettleTimerRef.current !== null) {
        window.clearTimeout(sheetSettleTimerRef.current);
      }
    },
    [],
  );

  const closeWithFocusReturn = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      buttonRef.current?.focus();
    });
  }, []);

  // Desktop popover dismissal. The mobile sheet delegates Escape, backdrop
  // dismissal, focus trapping and focus return to Radix.
  useEffect(() => {
    if (!open || !isDesktop) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        // Preserve the outside target's normal pointer focus. Escape and
        // the mobile Sheet still return focus to the bell explicitly.
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWithFocusReturn();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeWithFocusReturn, isDesktop, open]);

  const isUnread = useCallback(
    (item: ShellNotificationItem) => notificationIsUnread(item, readOverrides),
    [readOverrides],
  );

  const activeNotifications = useMemo(
    () =>
      clearedAll ? [] : notifications.filter((notification) => !dismissedIds.has(notification.id)),
    [clearedAll, dismissedIds, notifications],
  );
  const visibleNotifications = useMemo(
    () => filterNotifications(activeNotifications, tab, readOverrides),
    [activeNotifications, readOverrides, tab],
  );

  const overriddenUnreadCount = useMemo(
    () =>
      notifications.reduce(
        (count, item) =>
          item.readAtIso === null && (readOverrides.has(item.id) || dismissedIds.has(item.id))
            ? count + 1
            : count,
        0,
      ),
    [dismissedIds, notifications, readOverrides],
  );
  const currentUnreadCount = clearedAll ? 0 : Math.max(0, unreadCount - overriddenUnreadCount);
  const badgeLabel = currentUnreadCount > 99 ? "99+" : String(currentUnreadCount);

  const handleItemClick = useCallback(
    async (item: ShellNotificationItem) => {
      if (pendingId !== null || clearing) return;
      setError(null);
      setPendingId(item.id);

      try {
        if (isUnread(item)) {
          const result = await markNotificationRead(item.id);
          if (result.ok) {
            setReadOverrides((current) => {
              const next = new Set(current);
              next.add(item.id);
              return next;
            });
          }
        }
      } catch {
        // Reading state is best-effort. A transient update failure must
        // never turn a real notification destination into a dead button.
      } finally {
        setOpen(false);
        setPendingId(null);
        router.push(notificationHref(item));
      }
    },
    [clearing, isUnread, pendingId, router],
  );

  const handleDismiss = useCallback(
    async (item: ShellNotificationItem) => {
      if (pendingId !== null || clearing) return;
      setError(null);
      setPendingId(item.id);
      try {
        const result = await archiveNotification(item.id);
        if (!result.ok) {
          setError(result.error || FALLBACK_ERROR);
          return;
        }
        setDismissedIds((current) => {
          const next = new Set(current);
          next.add(item.id);
          return next;
        });
        router.refresh();
      } catch {
        setError(FALLBACK_ERROR);
      } finally {
        setPendingId(null);
      }
    },
    [clearing, pendingId, router],
  );

  const handleClearAll = useCallback(async () => {
    if (clearing || pendingId !== null || activeNotifications.length === 0) return;
    setError(null);
    setClearing(true);
    try {
      const result = await archiveAllNotifications();
      if (!result.ok) {
        setError(result.error || FALLBACK_ERROR);
        return;
      }
      setClearedAll(true);
      setDismissedIds(new Set(notifications.map((item) => item.id)));
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setClearing(false);
    }
  }, [activeNotifications.length, clearing, notifications, pendingId, router]);

  const settleSheetDrag = useCallback((dismiss: boolean) => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    if (sheetSettleTimerRef.current !== null) {
      window.clearTimeout(sheetSettleTimerRef.current);
    }

    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
    if (reducedMotion) {
      sheet.style.transform = "translate3d(0, 0, 0)";
      sheet.style.removeProperty("transition");
      sheet.style.removeProperty("will-change");
      if (dismiss) setOpen(false);
      return;
    }

    sheet.style.transition = `transform ${String(SHEET_SETTLE_MS)}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    sheet.style.transform = dismiss ? "translate3d(0, 100%, 0)" : "translate3d(0, 0, 0)";
    if (dismiss) sheet.style.pointerEvents = "none";

    sheetSettleTimerRef.current = window.setTimeout(() => {
      sheetSettleTimerRef.current = null;
      if (dismiss) {
        setOpen(false);
        return;
      }
      sheet.style.removeProperty("transition");
      sheet.style.removeProperty("transform");
      sheet.style.removeProperty("will-change");
    }, SHEET_SETTLE_MS);
  }, []);

  const handleSheetPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    if (sheetSettleTimerRef.current !== null) {
      window.clearTimeout(sheetSettleTimerRef.current);
      sheetSettleTimerRef.current = null;
    }
    sheetDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocityPxPerMs: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    sheet.style.animation = "none";
    sheet.style.transition = "none";
    sheet.style.willChange = "transform";
  }, []);

  const handleSheetPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet || drag.pointerId !== event.pointerId) return;

    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocityPxPerMs = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;

    const distance = Math.max(0, event.clientY - drag.startY);
    sheet.style.transform = `translate3d(0, ${String(distance)}px, 0)`;
    event.preventDefault();
  }, []);

  const finishSheetDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, canceled: boolean) => {
      const drag = sheetDragRef.current;
      const sheet = sheetRef.current;
      if (!drag || !sheet || drag.pointerId !== event.pointerId) return;

      sheetDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const distance = Math.max(0, event.clientY - drag.startY);
      settleSheetDrag(
        !canceled &&
          shouldDismissNotificationSheet({
            distancePx: distance,
            velocityPxPerMs: drag.velocityPxPerMs,
            sheetHeightPx: sheet.getBoundingClientRect().height,
          }),
      );
    },
    [settleSheetDrag],
  );

  const handleSheetPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishSheetDrag(event, false);
    },
    [finishSheetDrag],
  );

  const handleSheetPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishSheetDrag(event, true);
    },
    [finishSheetDrag],
  );

  const panelProps = {
    tab,
    setTab,
    notifications: visibleNotifications,
    isUnread,
    currentUnreadCount,
    hasNotifications: activeNotifications.length > 0,
    pendingId,
    clearing,
    error,
    tabPanelId,
    onItemClick: handleItemClick,
    onDismiss: handleDismiss,
    onClearAll: handleClearAll,
  } as const;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid="notification-bell-trigger"
        aria-label={
          currentUnreadCount > 0 ? `Notifications (${badgeLabel} unread)` : "Notifications"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setError(null);
          setOpen((value) => !value);
        }}
        className="relative inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] focus-visible:outline-none active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <Bell size={19} strokeWidth={2} aria-hidden />
        {currentUnreadCount > 0 ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-1 font-mono text-[9px] leading-none font-bold text-[rgb(var(--fg-on-brand))] ring-2 ring-[rgb(var(--bg-elevated))]"
          >
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {open && isDesktop ? (
        <div
          role="dialog"
          aria-modal="false"
          id={panelId}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-testid="notification-popover"
          className="sk-pop absolute top-[calc(100%+0.65rem)] right-0 z-50 flex max-h-[calc(100vh-5.5rem)] w-[25rem] origin-top-right flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-lg)]"
        >
          <p id={descriptionId} className="sr-only">
            Recent producer notifications.
          </p>
          <NotificationPanel
            {...panelProps}
            title={
              <h2
                id={titleId}
                className="font-display text-lg font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
              >
                Notifications
              </h2>
            }
          />
        </div>
      ) : null}

      <Sheet
        open={open && !isDesktop}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOpen(false);
        }}
      >
        <SheetContent
          ref={sheetRef}
          side="bottom"
          showHandle={false}
          id={panelId}
          data-testid="notification-sheet"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            buttonRef.current?.focus();
          }}
          className="max-h-[88dvh] w-full gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] sm:p-0"
        >
          <div
            aria-hidden
            data-testid="notification-sheet-handle"
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={handleSheetPointerUp}
            onPointerCancel={handleSheetPointerCancel}
            className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span className="h-1 w-10 rounded-full bg-[rgb(var(--border-subtle))]" />
          </div>
          <SheetDescription className="sr-only">Recent producer notifications.</SheetDescription>
          <NotificationPanel
            {...panelProps}
            title={
              <SheetTitle className="text-xl font-bold tracking-[-0.025em]">
                Notifications
              </SheetTitle>
            }
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface NotificationPanelProps {
  title: ReactNode;
  tab: NotificationTab;
  setTab: (tab: NotificationTab) => void;
  notifications: readonly ShellNotificationItem[];
  isUnread: (item: ShellNotificationItem) => boolean;
  currentUnreadCount: number;
  hasNotifications: boolean;
  pendingId: string | null;
  clearing: boolean;
  error: string | null;
  tabPanelId: string;
  onItemClick: (item: ShellNotificationItem) => Promise<void>;
  onDismiss: (item: ShellNotificationItem) => Promise<void>;
  onClearAll: () => Promise<void>;
}

function NotificationPanel({
  title,
  tab,
  setTab,
  notifications,
  isUnread,
  currentUnreadCount,
  hasNotifications,
  pendingId,
  clearing,
  error,
  tabPanelId,
  onItemClick,
  onDismiss,
  onClearAll,
}: NotificationPanelProps) {
  const allTabId = `${tabPanelId}-all`;
  const unreadTabId = `${tabPanelId}-unread`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 px-4 pt-4 pb-3 sm:px-5">
        {title}
        <button
          type="button"
          onClick={() => {
            void onClearAll();
          }}
          disabled={clearing || pendingId !== null || !hasNotifications}
          className="min-h-8 rounded-[var(--radius-sm)] px-2.5 text-xs font-semibold text-[rgb(var(--brand-primary-text))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.09)] disabled:cursor-not-allowed disabled:text-[rgb(var(--fg-faint))] motion-reduce:transition-none"
        >
          {clearing ? "Clearing…" : "Clear all"}
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Notification filters"
        onKeyDown={(event) => {
          const nextTab = notificationTabForKey(event.key);
          if (nextTab === null) return;
          event.preventDefault();
          setTab(nextTab);
          const nextId = nextTab === "all" ? allTabId : unreadTabId;
          window.requestAnimationFrame(() => {
            document.getElementById(nextId)?.focus();
          });
        }}
        className="flex gap-1 border-b border-[rgb(var(--border-subtle))] px-4 sm:px-5"
      >
        <NotificationTabButton
          id={allTabId}
          selected={tab === "all"}
          controls={tabPanelId}
          onClick={() => {
            setTab("all");
          }}
        >
          All
        </NotificationTabButton>
        <NotificationTabButton
          id={unreadTabId}
          selected={tab === "unread"}
          controls={tabPanelId}
          onClick={() => {
            setTab("unread");
          }}
        >
          Unread{currentUnreadCount > 0 ? ` ${String(currentUnreadCount)}` : ""}
        </NotificationTabButton>
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="notification-error"
          className="mx-4 mt-3 rounded-[var(--radius-sm)] border border-[rgb(var(--fg-danger)/0.2)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2 text-xs font-medium text-[rgb(var(--fg-danger-text))] sm:mx-5"
        >
          {error}
        </p>
      ) : null}

      <div
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={tab === "all" ? allTabId : unreadTabId}
        tabIndex={0}
        data-testid="notification-list"
        className="custom-scrollbar min-h-0 flex-1 overflow-y-auto focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
      >
        {notifications.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <CheckCircle2
              size={24}
              strokeWidth={1.7}
              aria-hidden
              className="mx-auto mb-2 text-[rgb(var(--brand-primary))]"
            />
            <p className="text-sm font-medium text-[rgb(var(--fg-default))]">
              {tab === "unread" ? "You're all caught up." : "No notifications yet."}
            </p>
          </div>
        ) : (
          <ul>
            {notifications.map((item) => {
              const unread = isUnread(item);
              const pending = pendingId === item.id;
              return (
                <li
                  key={item.id}
                  className="border-b border-[rgb(var(--border-subtle))] last:border-b-0"
                >
                  <div className="group flex min-h-[72px] items-center transition-colors hover:bg-[rgb(var(--bg-overlay))] motion-reduce:transition-none">
                    <button
                      type="button"
                      onClick={() => {
                        void onItemClick(item);
                      }}
                      disabled={pendingId !== null || clearing}
                      aria-label={`${item.title}${unread ? ", unread" : ""}`}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-1 pl-4 text-left focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset disabled:cursor-wait disabled:opacity-60 sm:pl-5"
                    >
                      <NotificationKindIcon kind={item.kind} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`line-clamp-1 text-sm text-[rgb(var(--fg-default))] ${
                            unread ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {item.title}
                        </span>
                        {item.body ? (
                          <span className="mt-0.5 line-clamp-1 text-xs text-[rgb(var(--fg-muted))]">
                            {item.body}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                          {pending ? "Updating…" : formatRelativeTime(new Date(item.createdAtIso))}
                        </span>
                        {unread ? (
                          <span
                            aria-hidden
                            className="h-2 w-2 rounded-full bg-[rgb(var(--brand-primary))]"
                          />
                        ) : (
                          <span aria-hidden className="h-2 w-2" />
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Dismiss ${item.title}`}
                      disabled={pendingId !== null || clearing}
                      onClick={() => {
                        void onDismiss(item);
                      }}
                      className="mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none"
                    >
                      <X size={16} strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function NotificationTabButton({
  id,
  selected,
  controls,
  onClick,
  children,
}: {
  id: string;
  selected: boolean;
  controls: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      className={`relative min-h-10 rounded-t-[var(--radius-sm)] px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none ${
        selected
          ? "text-[rgb(var(--fg-default))] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[rgb(var(--brand-primary))]"
          : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
      }`}
    >
      {children}
    </button>
  );
}

function NotificationKindIcon({ kind }: { kind: string }) {
  let icon: ReactNode;
  if (kind === "booking_requested") {
    icon = <CalendarDays size={17} strokeWidth={1.9} aria-hidden />;
  } else if (kind === "comment_created") {
    icon = <MessageSquare size={17} strokeWidth={1.9} aria-hidden />;
  } else if (kind === "proof_submitted") {
    icon = <WalletCards size={17} strokeWidth={1.9} aria-hidden />;
  } else if (kind.startsWith("purchase_") || kind === "agreement_accepted") {
    icon = <ShoppingBag size={17} strokeWidth={1.9} aria-hidden />;
  } else {
    icon = <CheckCircle2 size={17} strokeWidth={1.9} aria-hidden />;
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--brand-primary-text))]">
      {icon}
    </span>
  );
}
