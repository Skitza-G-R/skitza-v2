import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import {
  and,
  createDb,
  desc,
  eq,
  isNotNull,
  isNull,
  notifications,
  producers,
  sql,
} from "@skitza/db";

// Request-scoped shell state used by AppShell and any server component
// that wants the producer slug / unread count without re-querying.
//
// Wrapping the fetch in `React.cache()` makes multiple calls within
// one render tree share a single SELECT + COUNT pair — previously the
// shell re-ran the query on every layout render, and child server
// components had no cheap way to read the same data. Per-request
// memoisation only; a fresh request always re-fetches.
//
// SK-76 extends the state with `recentNotifications`: the latest active
// (not archived) notifications, including both read and unread rows. The
// notification centre needs both states for its All / Unread tabs; unresolved
// dashboard work is deliberately supplied by the dashboard data layer instead
// of being inferred from this read-state feed.
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
  purchaseRequestId: string | null;
  readAtIso: string | null;
}

export interface ShellNotificationCandidate {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: Date;
  projectId: string | null;
  trackVersionId: string | null;
  commentId: string | null;
  bookingId: string | null;
  purchaseRequestId: string | null;
  readAt: Date | null;
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
  recentNotifications: ShellNotificationItem[];
}

export const NOTIFICATION_FEED_LIMIT = 20;

function compareNewestFirst(
  left: ShellNotificationCandidate,
  right: ShellNotificationCandidate,
): number {
  const timeDifference = right.createdAt.getTime() - left.createdAt.getTime();
  return timeDifference !== 0 ? timeDifference : left.id.localeCompare(right.id);
}

function toShellNotificationItem(row: ShellNotificationCandidate): ShellNotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAtIso: row.createdAt.toISOString(),
    projectId: row.projectId,
    trackVersionId: row.trackVersionId,
    commentId: row.commentId,
    bookingId: row.bookingId,
    purchaseRequestId: row.purchaseRequestId,
    readAtIso: row.readAt?.toISOString() ?? null,
  };
}

/**
 * Build the bounded centre feed without allowing recent read activity to
 * displace surfaced unread rows. Unread candidates consume the cap first;
 * newest read rows fill the remaining context slots. The final feed is sorted
 * chronologically with an id tie-breaker so server renders are deterministic.
 */
export function mergeShellNotificationRows(
  unreadRows: readonly ShellNotificationCandidate[],
  recentReadRows: readonly ShellNotificationCandidate[],
  limit = NOTIFICATION_FEED_LIMIT,
): ShellNotificationItem[] {
  const boundedLimit = Math.max(0, Math.floor(limit));
  const unreadById = new Map<string, ShellNotificationCandidate>();
  for (const row of [...unreadRows].sort(compareNewestFirst)) {
    if (unreadById.size >= boundedLimit) break;
    if (row.readAt === null && !unreadById.has(row.id)) {
      unreadById.set(row.id, row);
    }
  }

  const mergedRows = [...unreadById.values()];
  const includedIds = new Set(unreadById.keys());
  for (const row of [...recentReadRows].sort(compareNewestFirst)) {
    if (mergedRows.length >= boundedLimit) break;
    if (row.readAt !== null && !includedIds.has(row.id)) {
      includedIds.add(row.id);
      mergedRows.push(row);
    }
  }

  return mergedRows.sort(compareNewestFirst).map(toShellNotificationItem);
}

const DEFAULT_STATE: ShellState = {
  slug: null,
  displayName: null,
  plan: "free",
  unreadCount: 0,
  recentNotifications: [],
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
  const notificationSelection = {
    id: notifications.id,
    kind: notifications.kind,
    title: notifications.title,
    body: notifications.body,
    createdAt: notifications.createdAt,
    projectId: notifications.projectId,
    trackVersionId: notifications.trackVersionId,
    commentId: notifications.commentId,
    bookingId: notifications.bookingId,
    purchaseRequestId: notifications.purchaseRequestId,
    readAt: notifications.readAt,
  };
  const [unreadCountRows, unreadRows, recentReadRows] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(notifications)
      .where(
        and(
          eq(notifications.producerId, row.id),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      ),
    db
      .select(notificationSelection)
      .from(notifications)
      .where(
        and(
          eq(notifications.producerId, row.id),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(NOTIFICATION_FEED_LIMIT),
    db
      .select(notificationSelection)
      .from(notifications)
      .where(
        and(
          eq(notifications.producerId, row.id),
          isNotNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(NOTIFICATION_FEED_LIMIT),
  ]);
  const recentNotifications = mergeShellNotificationRows(unreadRows, recentReadRows);
  return {
    slug: row.slug,
    displayName: row.displayName,
    plan: row.plan,
    unreadCount: unreadCountRows[0]?.value ?? 0,
    recentNotifications,
  };
});
