import type { ReactNode } from "react";

import { PersistentPlayer } from "~/components/audio/persistent-player";
import { getShellState } from "~/server/shell-data";

import { CommandPaletteTrigger } from "./command-palette-trigger";
import { DesktopMenuBridge } from "./desktop-menu-bridge";
import { ShortcutsBridge } from "./shortcuts-bridge";
import { Sidebar, type ActiveKey } from "./sidebar";

// App shell used by /dashboard and its children. Rebuilt as a left
// rail (Linear/Splice flavour) in D.6. The shell itself stays a
// server component so we can await the Clerk user + look up the
// producer slug once per render; everything interactive (sidebar
// state, command palette, keyboard shortcuts) lives in client
// islands mounted inside this layout.
//
// Slug + unread-count lookup now lives in `server/shell-data` and is
// wrapped with `React.cache()`, so any other server component in the
// same request that needs the same pair gets a free hit instead of
// re-running the SELECT. The parent layout already performs the full
// gate check — this call is additive.
//
// CommandPalette is lazy-loaded via CommandPaletteTrigger so cmdk
// doesn't ship in the First Load JS of every dashboard route.

export async function AppShell({
  active,
  children,
}: {
  active: ActiveKey;
  children: ReactNode;
}) {
  const { slug, unreadCount, unreadItems } = await getShellState();
  return (
    <div className="flex min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <Sidebar
        active={active}
        producerSlug={slug}
        unreadCount={unreadCount}
        unreadItems={unreadItems}
      />
      <main id="main-content" className="min-w-0 flex-1">
        {children}
      </main>
      <CommandPaletteTrigger />
      <ShortcutsBridge />
      <DesktopMenuBridge />
      <PersistentPlayer />
    </div>
  );
}
