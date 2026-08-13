import { auth } from "~/server/auth/clerk-identity";
import {
  and,
  clientContacts,
  createDb,
  desc,
  eq,
  isNotNull,
  isNull,
  notifications,
  producers,
  sql,
} from "@skitza/db";
import { cache } from "react";

import { artistNotificationUnreadCount } from "~/server/artist/notifications";

// Request-scoped shell state used by AppShell and any server component
// that wants the producer slug / unread count without re-querying.
// React.cache keeps these reads shared only inside one render request.
export interface ShellNotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAtIso: string;
  projectId: string | null;
  trackVersionId: string | null;
  commentId: string | null;
  bookingId: string | null;
  purchaseRequestId: string | null;
  purchaseId: string | null;
  paymentProofId: string | null;
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
  purchaseId: string | null;
  readAt: Date | null;
}

export interface ShellState {
  userId: string | null;
  producerId: string | null;
  slug: string | null;
  displayName: string | null;
  plan: string;
  unreadCount: number;
  hasArtistAccount: boolean;
  artistUnreadCount: number;
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
    purchaseId: row.purchaseId,
    // Proof notifications deliberately reuse the immutable proof UUID as the
    // notification id, so no storage identity or request-level fallback is needed.
    paymentProofId: row.kind === "proof_submitted" ? row.id : null,
    readAtIso: row.readAt?.toISOString() ?? null,
  };
}

/**
 * Keep every unread row in the bounded centre before filling the remaining
 * slots with recently read context. The result stays newest-first.
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
    if (row.readAt === null && !unreadById.has(row.id)) unreadById.set(row.id, row);
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
  userId: null,
  producerId: null,
  slug: null,
  displayName: null,
  plan: "free",
  unreadCount: 0,
  hasArtistAccount: false,
  artistUnreadCount: 0,
  recentNotifications: [],
};

export const getShellState = cache(async (): Promise<ShellState> => {
  const { userId, providerUserId } = await auth();
  if (!userId || !providerUserId) return DEFAULT_STATE;
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
    purchaseId: notifications.purchaseId,
    readAt: notifications.readAt,
  };
  const [unreadCountRows, unreadRows, recentReadRows, artistContactRows, artistUnreadCount] =
    await Promise.all([
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
      db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.clerkUserId, userId))
        .limit(1),
      artistNotificationUnreadCount(db, userId),
    ]);

  const recentNotifications = mergeShellNotificationRows(unreadRows, recentReadRows);

  return {
    // Browser/local runtime identity deliberately remains the raw provider id.
    // All database reads above use the canonical userId.
    userId: providerUserId,
    producerId: row.id,
    slug: row.slug,
    displayName: row.displayName,
    plan: row.plan,
    unreadCount: unreadCountRows[0]?.value ?? 0,
    hasArtistAccount: artistContactRows[0] !== undefined,
    artistUnreadCount,
    recentNotifications,
  };
});
