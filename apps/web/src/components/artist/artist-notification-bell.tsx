"use client";

import {
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  Loader2,
  MessageSquare,
  Music2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  loadArtistNotificationFeedAction,
  markAllArtistNotificationsReadAction,
  markArtistNotificationReadAction,
  openArtistNotificationAction,
} from "~/components/artist/artist-notification-actions";
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

type Tab = "all" | "unread";
const DESKTOP_QUERY = "(min-width: 1024px)";

function ItemIcon({ kind }: { kind: string }) {
  if (kind.startsWith("booking") || kind.startsWith("session")) {
    return <CalendarDays size={16} aria-hidden />;
  }
  if (kind.includes("comment")) return <MessageSquare size={16} aria-hidden />;
  return <Music2 size={16} aria-hidden />;
}

export function ArtistNotificationBell({
  initialUnreadCount = 0,
}: {
  initialUnreadCount?: number;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [items, setItems] = useState<ArtistNotificationFeedItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [markingAll, startMarkAll] = useTransition();

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => {
      setDesktop(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);

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

  const markAll = () => {
    if (unreadCount === 0 || markingAll) return;
    setError(null);
    startMarkAll(async () => {
      const result = await markAllArtistNotificationsReadAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((item) => (item.readAtIso === null ? { ...item, readAtIso: now } : item)),
      );
      setUnreadCount(0);
    });
  };

  const panel = (
    <ArtistNotificationPanel
      tab={tab}
      setTab={setTab}
      items={visibleItems}
      loading={loading}
      markingAll={markingAll}
      pendingId={pendingId}
      unreadCount={unreadCount}
      error={error}
      onRetry={loadFeed}
      onMarkAll={markAll}
      onMarkOne={markOne}
      onOpen={openItem}
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
        onClick={toggle}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
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
          aria-label="Notifications"
          className="absolute top-[calc(100%+0.5rem)] right-0 z-50 w-[390px] overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-lg)]"
        >
          {panel}
        </div>
      ) : null}

      {!desktop ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[82dvh] gap-0 p-0">
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
  loading,
  markingAll,
  pendingId,
  unreadCount,
  error,
  onRetry,
  onMarkAll,
  onMarkOne,
  onOpen,
  relativeNow,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  items: readonly ArtistNotificationFeedItem[];
  loading: boolean;
  markingAll: boolean;
  pendingId: string | null;
  unreadCount: number;
  error: string | null;
  onRetry: () => void;
  onMarkAll: () => void;
  onMarkOne: (item: ArtistNotificationFeedItem) => Promise<void>;
  onOpen: (item: ArtistNotificationFeedItem) => Promise<void>;
  relativeNow?: Date;
}) {
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
          onClick={onMarkAll}
          disabled={markingAll || unreadCount === 0}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-2 text-[11px] font-bold text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-40"
        >
          {markingAll ? (
            <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : (
            <CheckCheck size={14} aria-hidden />
          )}
          Mark all read
        </button>
      </div>

      <div role="tablist" aria-label="Notification filters" className="flex gap-1 px-4 pt-3">
        {(["all", "unread"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value);
            }}
            className={`min-h-11 rounded-[var(--radius-lg)] px-4 text-[11px] font-bold capitalize focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none ${
              tab === value
                ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
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

      <div role="tabpanel" className="mt-2 min-h-0 flex-1 overflow-y-auto">
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
