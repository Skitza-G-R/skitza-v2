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
  bookingId: string | null;
}

export interface ShellState {
  slug: string | null;
  /** Producer's display name (Studio name) — used by the sidebar
   *  footer chip ("GS · Gili Studio · Pro plan"). Falls back to null
   *  when the producer hasn't filled it in; the chip then renders
   *  just the Clerk avatar with no label. */
  displayName: string | null;
  /** Producer's plan tier — surfaced on the sidebar footer chip
   *  ("Pro plan"). Settings redesign added the column (migration
   *  0012); defaults to 'free' on rows from before the migration.
   *  Stored as text so we can introduce additional tiers without a
   *  type churn. */
  plan: string;
  unreadCount: number;
  unreadItems: ShellNotificationItem[];
}

const UNREAD_ITEMS_LIMIT = 10;

const DEFAULT_STATE: ShellState = {
  slug: null,
  displayName: null,
  plan: "free",
  unreadCount: 0,
  unreadItems: [],
};

export const getShellState = cache(async (): Promise<ShellState> => {
  const { userId } = await auth();
  if (!userId) return DEFAULT_STATE;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return DEFAULT_STATE;
  const db = createDb(dbUrl);
  const [row] = await db
    .select({
      id: producers.id,
      slug: producers.slug,
      displayName: producers.displayName,
      plan: producers.plan,
    })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);
  if (!row) return DEFAULT_STATE;
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
      bookingId: r.bookingId,
    }));
  return {
    slug: row.slug,
    displayName: row.displayName,
    plan: row.plan,
    unreadCount: unreadRows.length,
    unreadItems,
  };
});
