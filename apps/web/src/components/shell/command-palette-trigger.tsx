"use client";

import { type ComponentType, Suspense, lazy, useEffect, useState } from "react";

// Thin always-mounted trigger that owns the keyboard listeners and
// defers loading the full command palette (cmdk + its deps, ~16 kB
// gzipped) until the user actually asks for it with ⌘K / Ctrl+K or
// via the desktop bridge. Keeps the dashboard First Load JS smaller
// on every route.
//
// The heavy `<CommandPalette />` is imported lazily and only rendered
// once `open` becomes true. Once mounted it's kept in the tree so
// repeat opens don't re-fetch the chunk; we just toggle `open`.

// `lazy()` widens the resolved module's type, losing the props shape
// on the default export. We re-annotate with an explicit
// ComponentType so JSX usage stays strictly typed.
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const CommandPalette: ComponentType<CommandPaletteProps> = lazy(() =>
  import("./command-palette").then((m) => ({ default: m.CommandPalette })),
);

export function CommandPaletteTrigger() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Global ⌘K / Ctrl+K toggle. Lives here so the keydown listener
  // is always active without needing to download cmdk first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setMounted(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Desktop-only: Tauri's global shortcut dispatches this synthetic
  // event. Same flow — mark mounted and open.
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setMounted(true);
    };
    window.addEventListener("skitza:open-palette", onOpen as EventListener);
    return () => {
      window.removeEventListener("skitza:open-palette", onOpen as EventListener);
    };
  }, []);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <CommandPalette
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </Suspense>
  );
}
