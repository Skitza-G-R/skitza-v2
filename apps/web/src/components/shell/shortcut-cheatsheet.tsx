"use client";

import { useEffect } from "react";

// The `?` overlay. Mounted by ShortcutsBridge; open state is owned
// by the bridge so the hook can call openCheatsheet() as a plain
// handler. Esc closes. The backdrop is a real <button> so click-
// to-close is keyboard-reachable (matches the palette's a11y shape).

export function ShortcutCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const sections: Array<{ title: string; keys: Array<{ k: string; desc: string }> }> = [
    {
      // Phase 2 — entries mirror the locked design's ShortcutsHelp
      // (notes/nav.jsx) and the relabelled sidebar. Calendar + Store
      // added (the prior 4-row strip pre-dated the 6-page producer
      // surface). `g t` flipped from Today to Settings, `g s` flipped
      // from Setup to Store, and `g h` is new for Overview — kept in
      // sync with G_LEADER_ROUTES in lib/keyboard/use-shortcuts.ts.
      title: "Navigate",
      keys: [
        { k: "g h", desc: "Overview" },
        { k: "g p", desc: "Clients & Projects" },
        { k: "g m", desc: "Music" },
        { k: "g c", desc: "Calendar" },
        { k: "g s", desc: "Store" },
        { k: "g t", desc: "Settings" },
      ],
    },
    {
      title: "Global actions",
      keys: [
        { k: "⌘ K", desc: "Command palette" },
        { k: "n", desc: "New project" },
        { k: "c", desc: "Create (context-aware)" },
        { k: "/", desc: "Search" },
        { k: "[", desc: "Toggle sidebar" },
        { k: "?", desc: "This cheatsheet" },
        { k: "Esc", desc: "Close overlay / deselect" },
      ],
    },
    {
      title: "Context shortcuts",
      keys: [
        { k: "u", desc: "Upload track (Project Room)" },
        { k: "t", desc: "Toggle done (Project Room)" },
        { k: "e", desc: "Edit (context-aware)" },
        { k: "c", desc: "Copy share link (Today)" },
      ],
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[55] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="sk-pop-center relative w-full max-w-xl rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-2xl">
        <h2 className="font-display text-xl text-[rgb(var(--fg-primary))]">Keyboard shortcuts</h2>
        <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
          Press <kbd className="font-mono">?</kbd> any time.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-6 text-sm sm:grid-cols-3">
          {sections.map((s) => (
            <div key={s.title}>
              <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                {s.title}
              </h3>
              <ul className="space-y-1">
                {s.keys.map((k) => (
                  <li key={k.k} className="flex items-center justify-between gap-4">
                    <span className="text-[rgb(var(--fg-primary))]">{k.desc}</span>
                    <kbd className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">{k.k}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
