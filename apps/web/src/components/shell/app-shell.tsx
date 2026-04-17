import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { and, createDb, eq, isNull, notifications, producers } from "@skitza/db";

import { CommandPalette } from "./command-palette";
import { DesktopMenuBridge } from "./desktop-menu-bridge";
import { ShortcutsBridge } from "./shortcuts-bridge";
import { Sidebar } from "./sidebar";

// App shell used by /dashboard and its children. Rebuilt as a left
// rail (Linear/Splice flavour) in D.6. The shell itself stays a
// server component so we can await the Clerk user + look up the
// producer slug once per render; everything interactive (sidebar
// state, command palette, keyboard shortcuts) lives in client
// islands mounted inside this layout.
//
// Slug lookup here is additive — the parent layout already runs the
// full gate check. We just need the slug string for the public-page
// shortcut; one small SELECT per render is cheap on Neon and React's
// request-scoped cache deduplicates against the parent query. Phase E
// also fetches the unread-inbox count here so the sidebar can paint a
// badge on every page (not just the inbox itself).
async function getProducerShellState(): Promise<{
  slug: string | null;
  unreadCount: number;
}> {
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
    .where(and(
      eq(notifications.producerId, row.id),
      isNull(notifications.readAt),
      isNull(notifications.archivedAt),
    ));
  return { slug: row.slug, unreadCount: unreadRows.length };
}

export async function AppShell({
  active,
  children,
}: {
  active: "pipeline" | "portfolio" | "leads" | "booking" | "contracts" | "settings" | "inbox";
  children: ReactNode;
}) {
  const { slug, unreadCount } = await getProducerShellState();
  return (
    <div className="flex min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <Sidebar active={active} producerSlug={slug} unreadCount={unreadCount} />
      <main id="main-content" className="min-w-0 flex-1">
        {children}
      </main>
      <CommandPalette />
      <ShortcutsBridge />
      <DesktopMenuBridge />
    </div>
  );
}
