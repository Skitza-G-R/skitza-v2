import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { and, createDb, desc, eq, isNull, notifications, producers } from "@skitza/db";

// Request-scoped shell state used by AppShell and any server component
// that wants the producer slug / unread count without re-querying.
//
// Wrapping the fetch in `React.cache()` makes multiple calls within
// one render tree share a single SELECT + COUNT pair — previously the
// shell re-ran the query on every layout render, and child server
// components had no cheap way to read the same data. Per-request
// memoisation only; a fresh request always re-fetches.
//
// Task 13 extended the state with `unreadItems` — the top 10 most
// recent unread notifications used by the AppShell notification bell.
// Fetched in the same request so the bell can render with real
// initial data (no client-side fetch needed for first paint) and the
// header badge stays authoritative. Capped at 10 because that's what
// the dropdown shows; scrolling through more is an anti-pattern for a
// header bell — producers who want the full list should open the
// Projects screen.
export interface ShellNotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAtIso: string;
  // One of these is always populated — see notifications schema comment.
  // Kept as a shallow record so the client can pick a deep-link target
  // without re-querying.
  projectId: string | null;
  trackVersionId: string | null;
  commentId: string | null;
  contractId: string | null;
  bookingId: string | null;
}

export interface ShellState {
  slug: string | null;
  unreadCount: number;
  unreadItems: ShellNotificationItem[];
}

const UNREAD_ITEMS_LIMIT = 10;

export const getShellState = cache(async (): Promise<ShellState> => {
  const { userId } = await auth();
  if (!userId) return { slug: null, unreadCount: 0, unreadItems: [] };
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { slug: null, unreadCount: 0, unreadItems: [] };
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ id: producers.id, slug: producers.slug })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);
  if (!row) return { slug: null, unreadCount: 0, unreadItems: [] };
  const unreadRows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      createdAt: notifications.createdAt,
      projectId: notifications.projectId,
      trackVersionId: notifications.trackVersionId,
      commentId: notifications.commentId,
      contractId: notifications.contractId,
      bookingId: notifications.bookingId,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.producerId, row.id),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ),
    )
    .orderBy(desc(notifications.createdAt));
  const unreadItems: ShellNotificationItem[] = unreadRows
    .slice(0, UNREAD_ITEMS_LIMIT)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      createdAtIso: r.createdAt.toISOString(),
      projectId: r.projectId,
      trackVersionId: r.trackVersionId,
      commentId: r.commentId,
      contractId: r.contractId,
      bookingId: r.bookingId,
    }));
  return { slug: row.slug, unreadCount: unreadRows.length, unreadItems };
});
