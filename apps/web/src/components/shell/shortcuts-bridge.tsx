"use client";

import { useCallback, useMemo, useState } from "react";

import { useGlobalShortcuts } from "~/lib/keyboard/use-shortcuts";

import { ShortcutCheatsheet } from "./shortcut-cheatsheet";

// Wires the global shortcut hook to real UI: owns cheatsheet open state,
// and dispatches the sidebar-toggle event. Sits alongside CommandPalette — both are client islands
// inside the server AppShell.

export function ShortcutsBridge() {
  const [cheatOpen, setCheatOpen] = useState(false);

  const openCheatsheet = useCallback(() => {
    setCheatOpen(true);
  }, []);
  const toggleSidebar = useCallback(() => {
    window.dispatchEvent(new CustomEvent("skitza:toggle-sidebar"));
  }, []);
  const handlers = useMemo(
    () => ({ openCheatsheet, toggleSidebar }),
    [openCheatsheet, toggleSidebar],
  );

  useGlobalShortcuts(handlers);

  return (
    <ShortcutCheatsheet
      open={cheatOpen}
      onClose={() => {
        setCheatOpen(false);
      }}
    />
  );
}
