"use client";

import { Bell, CalendarDays, Check, Loader2, MessageSquare, Music2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  archiveAllArtistNotificationsAction,
  archiveArtistNotificationAction,
  loadArtistNotificationFeedAction,
  markArtistNotificationReadAction,
  openArtistNotificationAction,
} from "~/components/artist/artist-notification-actions";
import {
  ACCOUNT_SHEET_UPWARD_OVERSCAN_PX,
  accountSheetDragOffset,
  accountSheetReleaseVelocity,
  shouldDismissAccountSheet,
} from "~/components/shell/account-sheet-drag";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import { formatRelativeTime } from "~/lib/time/relative";

export type ArtistNotificationFeedItem = Readonly<{
  id: string;
  producerId: string;
  producerName: string;
  producerLogoUrl: string | null;
  kind: string;
  title: string;
  body: string;
  readAtIso: string | null;
  openedAtIso: string | null;
  createdAtIso: string;
}>;

export type ArtistNotificationTab = "all" | "unread";
const DESKTOP_QUERY = "(min-width: 1024px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const REMOVE_ERROR = "Notification couldn’t be removed. Try again.";
const CLEAR_ERROR = "Notifications couldn’t be cleared. Try again.";
const SHEET_SETTLE_MS = 240;
const SHEET_BOTTOM_BACKING_PX = ACCOUNT_SHEET_UPWARD_OVERSCAN_PX + 1;

type SheetDragState = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocityPxPerMs: number;
};

export type ArtistNotificationBellPreview = Readonly<{
  items: readonly ArtistNotificationFeedItem[];
  initialOpen?: boolean;
  relativeNow?: Date;
}>;

export function artistNotificationTabForKey(key: string): ArtistNotificationTab | null {
  if (key === "ArrowRight" || key === "End") return "unread";
  if (key === "ArrowLeft" || key === "Home") return "all";
  return null;
}

function ItemIcon({ kind }: { kind: string }) {
  if (kind.startsWith("booking") || kind.startsWith("session")) {
    return <CalendarDays size={16} aria-hidden />;
  }
  if (kind.includes("comment")) return <MessageSquare size={16} aria-hidden />;
  return <Music2 size={16} aria-hidden />;
}

export function ArtistNotificationBell({
  initialUnreadCount = 0,
  preview,
}: {
  initialUnreadCount?: number;
  preview?: ArtistNotificationBellPreview;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetDragRef = useRef<SheetDragState | null>(null);
  const sheetSettleTimerRef = useRef<number | null>(null);
  const panelId = useId();
  const tabPanelId = useId();
  const [open, setOpen] = useState(preview?.initialOpen ?? false);
  const [desktop, setDesktop] = useState(false);
  const [tab, setTab] = useState<ArtistNotificationTab>("unread");
  const [items, setItems] = useState<ArtistNotificationFeedItem[]>(() =>
    preview ? [...preview.items] : [],
  );
  const [unreadCount, setUnreadCount] = useState(() =>
    preview ? preview.items.filter((item) => item.readAtIso === null).length : initialUnreadCount,
  );
  const [loaded, setLoaded] = useState(preview !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [clearing, startClear] = useTransition();

  const clearSheetSettleTimer = useCallback(() => {
    if (sheetSettleTimerRef.current === null) return;
    window.clearTimeout(sheetSettleTimerRef.current);
    sheetSettleTimerRef.current = null;
  }, []);

  const resetSheetDrag = useCallback(() => {
    clearSheetSettleTimer();
    sheetDragRef.current = null;
    const sheet = sheetRef.current;
    sheet?.style.removeProperty("animation");
    sheet?.style.removeProperty("transition");
    sheet?.style.removeProperty("transform");
    sheet?.style.removeProperty("will-change");
    sheet?.style.removeProperty("pointer-events");
  }, [clearSheetSettleTimer]);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => {
      if (query.matches) resetSheetDrag();
      setDesktop(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, [resetSheetDrag]);

  useEffect(
    () => () => {
      clearSheetSettleTimer();
      sheetDragRef.current = null;
    },
    [clearSheetSettleTimer],
  );

  useEffect(() => {
    if (open) return;
    clearSheetSettleTimer();
    sheetDragRef.current = null;
  }, [clearSheetSettleTimer, open]);

  useEffect(() => {
    if (!open || !desktop) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [desktop, open]);

  const loadFeed = () => {
    setError(null);
    startLoad(async () => {
      const result = await loadArtistNotificationFeedAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems(result.notifications);
      setUnreadCount(result.unreadCount);
      setLoaded(true);
    });
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) loadFeed();
  };

  const visibleItems = useMemo(
    () => (tab === "all" ? items : items.filter((item) => item.readAtIso === null)),
    [items, tab],
  );

  const markLocalRead = (notificationId: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === notificationId && item.readAtIso === null
          ? { ...item, readAtIso: new Date().toISOString() }
          : item,
      ),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
  };

  const markOne = async (item: ArtistNotificationFeedItem) => {
    if (item.readAtIso !== null || pendingId) return;
    if (preview) {
      markLocalRead(item.id);
      return;
    }
    setPendingId(item.id);
    setError(null);
    const result = await markArtistNotificationReadAction({
      notificationId: item.id,
    });
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    markLocalRead(item.id);
  };

  const openItem = async (item: ArtistNotificationFeedItem) => {
    if (pendingId) return;
    if (preview) {
      if (item.readAtIso === null) markLocalRead(item.id);
      setOpen(false);
      return;
    }
    setPendingId(item.id);
    setError(null);
    const result = await openArtistNotificationAction({
      notificationId: item.id,
    });
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (item.readAtIso === null) markLocalRead(item.id);
    setOpen(false);
    router.push(result.href);
    router.refresh();
  };

  const removeLocal = (item: ArtistNotificationFeedItem) => {
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    if (item.readAtIso === null) {
      setUnreadCount((current) => Math.max(0, current - 1));
    }
  };

  const dismissOne = async (item: ArtistNotificationFeedItem) => {
    if (pendingId) return;
    if (preview) {
      removeLocal(item);
      return;
    }
    setPendingId(item.id);
    setError(null);
    try {
      const result = await archiveArtistNotificationAction({ notificationId: item.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      removeLocal(item);
      router.refresh();
    } catch {
      setError(REMOVE_ERROR);
    } finally {
      setPendingId(null);
    }
  };

  const clearAll = () => {
    if (items.length === 0 || clearing || pendingId) return;
    setError(null);
    if (preview) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    startClear(async () => {
      try {
        const result = await archiveAllArtistNotificationsAction();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setItems([]);
        setUnreadCount(0);
        router.refresh();
      } catch {
        setError(CLEAR_ERROR);
      }
    });
  };

  const settleSheetDrag = useCallback(
    (dismiss: boolean) => {
      const sheet = sheetRef.current;
      if (!sheet) return;

      clearSheetSettleTimer();
      if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
        sheet.style.removeProperty("transition");
        sheet.style.removeProperty("transform");
        sheet.style.removeProperty("will-change");
        sheet.style.removeProperty("pointer-events");
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
        sheet.style.removeProperty("pointer-events");
      }, SHEET_SETTLE_MS);
    },
    [clearSheetSettleTimer],
  );

  const handleSheetPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      const sheet = sheetRef.current;
      if (!sheet) return;

      clearSheetSettleTimer();
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
    },
    [clearSheetSettleTimer],
  );

  const handleSheetPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet || drag.pointerId !== event.pointerId) return;

    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocityPxPerMs = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;

    const distance = accountSheetDragOffset(event.clientY - drag.startY);
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
      const distance = event.clientY - drag.startY;
      const releaseVelocity = accountSheetReleaseVelocity({
        previousVelocityPxPerMs: drag.velocityPxPerMs,
        lastY: drag.lastY,
        lastTime: drag.lastTime,
        releaseY: event.clientY,
        releaseTime: event.timeStamp,
      });
      settleSheetDrag(
        !canceled &&
          shouldDismissAccountSheet({
            distancePx: distance,
            velocityPxPerMs: releaseVelocity,
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

  const handleSheetLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      const drag = sheetDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      finishSheetDrag(event, true);
    },
    [finishSheetDrag],
  );

  const panel = (
    <ArtistNotificationPanel
      tab={tab}
      setTab={setTab}
      items={visibleItems}
      hasItems={items.length > 0}
      loading={loading}
      clearing={clearing}
      pendingId={pendingId}
      unreadCount={unreadCount}
      error={error}
      onRetry={loadFeed}
      onClearAll={clearAll}
      onDismiss={dismissOne}
      onMarkOne={markOne}
      onOpen={openItem}
      tabPanelId={tabPanelId}
      {...(preview?.relativeNow ? { relativeNow: preview.relativeNow } : {})}
    />
  );

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={unreadCount > 0 ? `Notifications, ${badge} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="artist-notification-trigger"
        onClick={toggle}
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-full transition-[background-color,color,transform] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 ${
          open
            ? "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-text))]"
            : "text-[rgb(var(--fg-muted))]"
        }`}
      >
        <Bell size={19} aria-hidden />
        {unreadCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-1 font-mono text-[9px] font-bold text-[rgb(var(--fg-on-brand))] ring-2 ring-[rgb(var(--bg-elevated))]">
            {badge}
          </span>
        ) : null}
      </button>

      {open && desktop ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Notifications"
          id={panelId}
          data-testid="artist-notification-popover"
          className="absolute top-[calc(100%+0.5rem)] right-0 z-50 w-[390px] overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--brand-primary)/0.14)] bg-[rgb(var(--bg-elevated)/0.92)] shadow-[var(--shadow-lg)] backdrop-blur-2xl"
        >
          {panel}
        </div>
      ) : null}

      {!desktop ? (
        <Sheet
          open={open}
          onOpenChange={(nextOpen) => {
            if (nextOpen) {
              setOpen(true);
              return;
            }
            resetSheetDrag();
            setOpen(false);
          }}
        >
          <SheetContent
            ref={sheetRef}
            side="bottom"
            showHandle={false}
            id={panelId}
            data-testid="artist-notification-sheet"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
            className="max-h-[82dvh] gap-0 overflow-visible border-[rgb(var(--brand-primary)/0.14)] bg-[rgb(var(--bg-elevated)/0.94)] p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl sm:p-0"
          >
            <div
              aria-hidden
              data-testid="artist-notification-sheet-bottom-backing"
              className="pointer-events-none absolute inset-x-0 top-full bg-[rgb(var(--bg-elevated)/0.94)]"
              style={{ height: SHEET_BOTTOM_BACKING_PX }}
            />
            <div
              aria-hidden
              data-testid="artist-notification-sheet-handle"
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={handleSheetPointerUp}
              onPointerCancel={handleSheetPointerCancel}
              onLostPointerCapture={handleSheetLostPointerCapture}
              className="flex h-8 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
            >
              <span className="h-1 w-11 rounded-full bg-[rgb(var(--brand-primary)/0.42)]" />
            </div>
            <SheetTitle className="sr-only">Notifications</SheetTitle>
            <SheetDescription className="sr-only">
              Updates from your connected studios
            </SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

export function ArtistNotificationPanel({
  tab,
  setTab,
  items,
  hasItems,
  loading,
  clearing,
  pendingId,
  unreadCount,
  error,
  onRetry,
  onClearAll,
  onDismiss,
  onMarkOne,
  onOpen,
  relativeNow,
  tabPanelId,
}: {
  tab: ArtistNotificationTab;
  setTab: (tab: ArtistNotificationTab) => void;
  items: readonly ArtistNotificationFeedItem[];
  hasItems: boolean;
  loading: boolean;
  clearing: boolean;
  pendingId: string | null;
  unreadCount: number;
  error: string | null;
  onRetry: () => void;
  onClearAll: () => void;
  onDismiss: (item: ArtistNotificationFeedItem) => Promise<void>;
  onMarkOne: (item: ArtistNotificationFeedItem) => Promise<void>;
  onOpen: (item: ArtistNotificationFeedItem) => Promise<void>;
  relativeNow?: Date;
  tabPanelId?: string;
}) {
  const generatedTabPanelId = useId();
  const resolvedTabPanelId = tabPanelId ?? generatedTabPanelId;
  const allTabId = `${resolvedTabPanelId}-all`;
  const unreadTabId = `${resolvedTabPanelId}-unread`;

  return (
    <div className="flex max-h-[78dvh] min-h-[320px] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-3">
        <div>
          <p className="font-display text-base font-bold text-[rgb(var(--fg-default))]">
            Notifications
          </p>
          <p className="text-[10.5px] text-[rgb(var(--fg-muted))]">
            {unreadCount === 0 ? "You’re all caught up" : `${String(unreadCount)} unread`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClearAll}
          disabled={clearing || pendingId !== null || !hasItems}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-2 text-[11px] font-bold text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-40"
        >
          {clearing ? (
            <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : null}
          {clearing ? "Clearing…" : "Clear all"}
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Notification filters"
        onKeyDown={(event) => {
          const nextTab = artistNotificationTabForKey(event.key);
          if (nextTab === null) return;
          event.preventDefault();
          setTab(nextTab);
          const nextId = nextTab === "all" ? allTabId : unreadTabId;
          window.requestAnimationFrame(() => {
            document.getElementById(nextId)?.focus();
          });
        }}
        className="flex gap-1 px-4 pt-3"
      >
        {(["all", "unread"] as const).map((value) => (
          <button
            key={value}
            id={value === "all" ? allTabId : unreadTabId}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={resolvedTabPanelId}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => {
              setTab(value);
            }}
            className={`min-h-11 rounded-[var(--radius-lg)] px-4 text-[11px] font-bold capitalize focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none ${
              tab === value
                ? "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--brand-primary))] shadow-[0_6px_16px_-10px_rgb(var(--bg-sidebar)/0.8)]"
                : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))]"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.07)] px-3 py-2 text-[11px] text-[rgb(var(--fg-danger))]"
        >
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="min-h-11 shrink-0 font-bold">
            Retry
          </button>
        </div>
      ) : null}

      <div
        id={resolvedTabPanelId}
        role="tabpanel"
        aria-labelledby={tab === "all" ? allTabId : unreadTabId}
        tabIndex={0}
        data-testid="artist-notification-list"
        className="mt-2 min-h-0 flex-1 overflow-y-auto focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
      >
        {loading ? (
          <div
            role="status"
            className="flex h-40 items-center justify-center gap-2 text-sm text-[rgb(var(--fg-muted))]"
          >
            <Loader2 size={17} aria-hidden className="animate-spin motion-reduce:animate-none" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center px-8 text-center">
            <Check size={20} aria-hidden className="text-[rgb(var(--brand-primary))]" />
            <p className="mt-2 text-sm font-semibold text-[rgb(var(--fg-default))]">
              {tab === "unread" ? "No unread notifications" : "No notifications yet"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[rgb(var(--border-subtle))]">
            {items.map((item) => {
              const unread = item.readAtIso === null;
              return (
                <li key={item.id} className={unread ? "bg-[rgb(var(--brand-primary)/0.035)]" : ""}>
                  <div className="group flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--bg-overlay))] text-[rgb(var(--brand-primary))]">
                      <ItemIcon kind={item.kind} />
                    </span>
                    <button
                      type="button"
                      aria-label={`Open ${item.title}`}
                      disabled={pendingId !== null}
                      onClick={() => void onOpen(item)}
                      className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-60"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
                          {item.title}
                        </span>
                        {unread ? (
                          <span
                            aria-label="Unread"
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                          />
                        ) : null}
                      </span>
                      {item.body ? (
                        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-[rgb(var(--fg-secondary))]">
                          {item.body}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-[10px] text-[rgb(var(--fg-muted))]">
                        {item.producerName} ·{" "}
                        {formatRelativeTime(new Date(item.createdAtIso), relativeNow)}
                      </span>
                    </button>
                    {unread ? (
                      <button
                        type="button"
                        aria-label={`Mark ${item.title} read`}
                        disabled={pendingId !== null}
                        onClick={() => void onMarkOne(item)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
                      >
                        {pendingId === item.id ? (
                          <Loader2
                            size={14}
                            aria-hidden
                            className="animate-spin motion-reduce:animate-none"
                          />
                        ) : (
                          <Check size={14} aria-hidden />
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Dismiss ${item.title}`}
                      disabled={pendingId !== null || clearing}
                      onClick={() => void onDismiss(item)}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50"
                    >
                      {pendingId === item.id ? (
                        <Loader2
                          size={14}
                          aria-hidden
                          className="animate-spin motion-reduce:animate-none"
                        />
                      ) : (
                        <X size={15} aria-hidden />
                      )}
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
