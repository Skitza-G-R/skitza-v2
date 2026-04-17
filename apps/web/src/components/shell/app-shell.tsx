import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";

import { CommandPalette } from "./command-palette";
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
// request-scoped cache deduplicates against the parent query.
async function getProducerSlug(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ slug: producers.slug })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);
  return row?.slug ?? null;
}

export async function AppShell({
  active,
  children,
}: {
  active: "pipeline" | "portfolio" | "leads" | "booking" | "contracts" | "settings";
  children: ReactNode;
}) {
  const slug = await getProducerSlug();
  return (
    <div className="flex min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <Sidebar active={active} producerSlug={slug} />
      <main id="main-content" className="min-w-0 flex-1">
        {children}
      </main>
      <CommandPalette />
      <ShortcutsBridge />
    </div>
  );
}
