"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useGlobalShortcuts } from "~/lib/keyboard/use-shortcuts";

import { ShortcutCheatsheet } from "./shortcut-cheatsheet";

// Wires the global shortcut hook to real UI: owns cheatsheet open state,
// dispatches the sidebar-toggle event, and opens the canonical New
// Project flow. Sits alongside CommandPalette — both are client islands
// inside the server AppShell.

export function ShortcutsBridge() {
  const [cheatOpen, setCheatOpen] = useState(false);
  const router = useRouter();

  const openCheatsheet = useCallback(() => {
    setCheatOpen(true);
  }, []);
  const toggleSidebar = useCallback(() => {
    window.dispatchEvent(new CustomEvent("skitza:toggle-sidebar"));
  }, []);
  const createNewProject = useCallback(() => {
    // The parent workspace owns the current modal; the retired
    // dedicated form route only redirects here.
    router.push("/dashboard/clients-projects?newProject=1");
  }, [router]);

  const handlers = useMemo(
    () => ({ openCheatsheet, toggleSidebar, createNewProject }),
    [openCheatsheet, toggleSidebar, createNewProject],
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
