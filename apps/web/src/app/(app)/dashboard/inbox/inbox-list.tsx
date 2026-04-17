"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { EmptyState } from "~/components/ui/empty-state";
import { useToast } from "~/components/ui/toast";
import { desktopNotify } from "~/lib/desktop/notifications";
import { isTypingTarget } from "~/lib/keyboard/use-shortcuts";

import { formatRelativeTime } from "../kanban-helpers";
import { archiveAction, markAllReadAction, markReadAction, unarchiveAction } from "./actions";

// Wire shape for inbox rows (matches server projection in page.tsx).
// Dates are ISO strings because the Server → Client serialise path is
// JSON; we re-hydrate Date inside the component when we need it.
export interface InboxItem {
  id: string;
  kind:
    | "comment_created"
    | "contract_signed"
    | "booking_requested"
    | "contract_viewed"
    | "track_approved";
  title: string;
  body: string;
  dealId: string | null;
  trackVersionId: string | null;
  commentId: string | null;
  contractId: string | null;
  bookingId: string | null;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

// Resolve a notification's best click-through target. Falls back to
// /dashboard for malformed rows — older rows from before dealId was
// wired may not have a source.
function targetFor(item: InboxItem): string {
  switch (item.kind) {
    case "comment_created":
      if (item.dealId) return `/dashboard/deals/${item.dealId}`;
      return "/dashboard";
    case "contract_signed":
    case "contract_viewed":
      return "/dashboard/contracts";
    case "booking_requested":
      return "/dashboard/booking?tab=requests";
    case "track_approved":
      if (item.dealId) return `/dashboard/deals/${item.dealId}`;
      return "/dashboard";
    default:
      return "/dashboard";
  }
}

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  comment_created: "Comment",
  contract_signed: "Contract",
  contract_viewed: "Contract",
  booking_requested: "Booking",
  track_approved: "Approval",
};

export function InboxList({
  initial,
  showArchived,
}: {
  initial: InboxItem[];
  showArchived: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<InboxItem[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Track the on-mount shape so a prop update (server re-fetch) replaces
  // local state. Without this, navigating from active → archived leaves
  // the stale list visible until the next interaction.
  useEffect(() => {
    setItems(initial);
    setSelectedId(null);
  }, [initial]);

  // Desktop (Tauri) only: fire a native OS notification for unread items
  // that landed in the last 60 seconds. De-duped via localStorage so a
  // page refresh doesn't replay old alerts. No-op in browsers.
  //
  // TODO (phase G+): migrate to a global SSE / realtime channel so
  // notifications fire regardless of whether the inbox tab is open.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const NOTIFIED_KEY = "skitza:notified-inbox-ids";
    let seen: string[] = [];
    try {
      const raw = window.localStorage.getItem(NOTIFIED_KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          seen = parsed.filter((v): v is string => typeof v === "string");
        }
      }
    } catch {
      seen = [];
    }
    const cutoff = Date.now() - 60_000;
    const fresh = initial.filter((i) => {
      if (i.readAt !== null || i.archivedAt !== null) return false;
      if (seen.includes(i.id)) return false;
      const createdMs = Date.parse(i.createdAt);
      return Number.isFinite(createdMs) && createdMs > cutoff;
    });
    if (fresh.length === 0) return;
    for (const item of fresh) {
      void desktopNotify(item.title, item.body);
    }
    const nextSeen = [...seen, ...fresh.map((i) => i.id)].slice(-200);
    try {
      window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify(nextSeen));
    } catch {
      // Ignore quota errors; the next mount will retry with its own slice.
    }
  }, [initial]);

  const unreadCount = useMemo(
    () => items.filter((i) => !i.readAt && !i.archivedAt).length,
    [items],
  );

  const openItem = useCallback(
    (item: InboxItem) => {
      // Optimistic mark-read so the bold weight drops instantly. The
      // server action runs in a transition and a failure shows a toast
      // but the navigation still happens — we prioritise UX over the
      // occasional stale read state.
      if (!item.readAt) {
        setItems((cur) =>
          cur.map((i) =>
            i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i,
          ),
        );
        startTransition(async () => {
          const res = await markReadAction({ id: item.id });
          if (!res.ok) toast(res.error, "error");
        });
      }
      router.push(targetFor(item));
    },
    [router, toast],
  );

  const archiveItem = useCallback(
    (item: InboxItem) => {
      // Optimistic removal in the active view; flip to active-again
      // in the archived view so the unarchive action reads correctly.
      setItems((cur) => cur.filter((i) => i.id !== item.id));
      setSelectedId(null);
      startTransition(async () => {
        const res = showArchived
          ? await unarchiveAction({ id: item.id })
          : await archiveAction({ id: item.id });
        if (!res.ok) {
          toast(res.error, "error");
          // Re-insert on failure so the user sees their item again.
          setItems((cur) => [item, ...cur]);
        }
      });
    },
    [showArchived, toast],
  );

  const markAllRead = useCallback(() => {
    setItems((cur) => cur.map((i) => (i.readAt ? i : { ...i, readAt: new Date().toISOString() })));
    startTransition(async () => {
      const res = await markAllReadAction();
      if (!res.ok) toast(res.error, "error");
    });
  }, [toast]);

  // Keyboard navigation — j/k move selection, Enter opens, e archives,
  // Esc clears. isTypingTarget keeps typing into the (non-existent
  // today but future-proof) reply field from stealing keys.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "j" && key !== "k" && key !== "e" && key !== "enter" && key !== "escape") return;

      const list = items;
      if (list.length === 0) return;
      const currentIdx = list.findIndex((i) => i.id === selectedIdRef.current);

      if (key === "j") {
        e.preventDefault();
        const nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, list.length - 1);
        setSelectedId(list[nextIdx]?.id ?? null);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        const prevIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
        setSelectedId(list[prevIdx]?.id ?? null);
        return;
      }
      if (key === "escape") {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      if (currentIdx < 0) return;
      const sel = list[currentIdx];
      if (!sel) return;
      if (key === "enter") {
        e.preventDefault();
        openItem(sel);
        return;
      }
      // Only `e` remains after the early returns above; lint narrows
      // the key type to that literal, so we skip the redundant check.
      e.preventDefault();
      archiveItem(sel);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [items, openItem, archiveItem]);

  return (
    <div>
      {/* Tabs + actions row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] pb-3">
        <nav aria-label="Inbox view" className="flex gap-1">
          <TabLink href="/dashboard/inbox" active={!showArchived}>
            Active{!showArchived && unreadCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-[rgb(var(--brand-primary))] px-1.5 py-[1px] font-mono text-[0.6rem] font-semibold text-[rgb(var(--fg-inverse))]">
                {unreadCount.toString()}
              </span>
            ) : null}
          </TabLink>
          <TabLink href="/dashboard/inbox?archived=1" active={showArchived}>
            Archived
          </TabLink>
        </nav>
        {!showArchived && unreadCount > 0 ? (
          <button
            type="button"
            onClick={markAllRead}
            className="rounded-md border border-[rgb(var(--border-subtle))] px-2.5 py-1 text-xs text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]"
          >
            Mark all read
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<InboxIcon />}
            title={showArchived ? "No archived items." : "You're caught up."}
            description={
              showArchived
                ? "Items you archive land here — a quiet shelf, not a trash can."
                : "When a client comments, books, or signs, you'll see it here. Nothing to do right now."
            }
            className="min-h-[60vh] justify-center"
          />
        </div>
      ) : (
        <ul role="list" className="mt-2 divide-y divide-[rgb(var(--border-subtle))]">
          {items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              showArchived={showArchived}
              onOpen={openItem}
              onArchive={archiveItem}
              onSelect={(id) => {
                setSelectedId(id);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: "/dashboard/inbox" | "/dashboard/inbox?archived=1";
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      {...(active ? { "aria-current": "page" as const } : {})}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-primary))]"
          : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
      }`}
    >
      {children}
    </Link>
  );
}

function InboxRow({
  item,
  selected,
  showArchived,
  onOpen,
  onArchive,
  onSelect,
}: {
  item: InboxItem;
  selected: boolean;
  showArchived: boolean;
  onOpen: (i: InboxItem) => void;
  onArchive: (i: InboxItem) => void;
  onSelect: (id: string) => void;
}) {
  const unread = !item.readAt && !item.archivedAt;
  const createdAt = useMemo(() => new Date(item.createdAt), [item.createdAt]);

  return (
    <li
      className={`group relative flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors ${
        selected
          ? "bg-[rgb(var(--bg-overlay))]"
          : "hover:bg-[rgb(var(--bg-elevated))]"
      }`}
      onMouseEnter={() => {
        onSelect(item.id);
      }}
      onClick={() => {
        onOpen(item);
      }}
    >
      {/* Unread dot — fixed slot so rows stay aligned read/unread. */}
      <div className="mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center">
        {unread ? (
          <span
            aria-label="Unread"
            className="block h-2 w-2 rounded-full bg-[rgb(var(--brand-primary))]"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            {KIND_LABEL[item.kind]}
          </span>
          <span className="text-[0.7rem] text-[rgb(var(--fg-muted))]">
            {formatRelativeTime(createdAt)}
          </span>
        </div>
        <p
          className={`mt-0.5 truncate text-sm ${
            unread
              ? "font-semibold text-[rgb(var(--fg-primary))]"
              : "text-[rgb(var(--fg-primary))]"
          }`}
        >
          {item.title}
        </p>
        {item.body ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-[rgb(var(--fg-secondary))]">
            {item.body}
          </p>
        ) : null}
      </div>

      {/* Action — archive/unarchive. Visible on hover OR when selected
          via keyboard. The stopPropagation keeps a click on the button
          from also navigating through the row. */}
      <button
        type="button"
        aria-label={showArchived ? "Unarchive" : "Archive"}
        title={showArchived ? "Unarchive" : "Archive (e)"}
        onClick={(e) => {
          e.stopPropagation();
          onArchive(item);
        }}
        className={`shrink-0 rounded-md border border-[rgb(var(--border-subtle))] px-2 py-1 text-[0.7rem] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] ${
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        {showArchived ? "Unarchive" : "Archive"}
      </button>
    </li>
  );
}

function InboxIcon() {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 9.5h3.5l1 2h3l1-2H14" />
      <path d="M2 9.5 3.5 3h9L14 9.5v3.25A.75.75 0 0 1 13.25 13.5h-10.5A.75.75 0 0 1 2 12.75Z" />
    </svg>
  );
}
