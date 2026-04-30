"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useGlobalShortcuts } from "~/lib/keyboard/use-shortcuts";

import { ShortcutCheatsheet } from "./shortcut-cheatsheet";

// Wires the global shortcut hook to real UI: owns cheatsheet open state,
// dispatches the sidebar-toggle event, and resolves context-aware
// "create" to a route based on the current path. Sits alongside
// CommandPalette — both are client islands inside the server AppShell.

export function ShortcutsBridge() {
  const [cheatOpen, setCheatOpen] = useState(false);
  const router = useRouter();

  const openCheatsheet = useCallback(() => {
    setCheatOpen(true);
  }, []);
  const toggleSidebar = useCallback(() => {
    window.dispatchEvent(new CustomEvent("skitza:toggle-sidebar"));
  }, []);
  const createContextAware = useCallback(() => {
    // In the 4-screen world "create" always means "start a new
    // project" — projects are the container for every other entity
    // (contracts, bookings, files, tracks), so there's no ambiguity
    // about the right target. Previously this branched on pathname
    // (clients / contracts / portfolio) but none of those pages
    // exist anymore.
    router.push("/dashboard/clients-projects/new");
  }, [router]);

  const handlers = useMemo(
    () => ({ openCheatsheet, toggleSidebar, createContextAware }),
    [openCheatsheet, toggleSidebar, createContextAware],
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
