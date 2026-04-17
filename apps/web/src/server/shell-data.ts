import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { and, createDb, eq, isNull, notifications, producers } from "@skitza/db";

// Request-scoped shell state used by AppShell and any server component
// that wants the producer slug / unread count without re-querying.
//
// Wrapping the fetch in `React.cache()` makes multiple calls within
// one render tree share a single SELECT + COUNT pair — previously the
// shell re-ran the query on every layout render, and child server
// components had no cheap way to read the same data. Per-request
// memoisation only; a fresh request always re-fetches.
export interface ShellState {
  slug: string | null;
  unreadCount: number;
}

export const getShellState = cache(async (): Promise<ShellState> => {
  const { userId } = await auth();
  if (!userId) return { slug: null, unreadCount: 0 };
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { slug: null, unreadCount: 0 };
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ id: producers.id, slug: producers.slug })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);
  if (!row) return { slug: null, unreadCount: 0 };
  const unreadRows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.producerId, row.id),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ),
    );
  return { slug: row.slug, unreadCount: unreadRows.length };
});
