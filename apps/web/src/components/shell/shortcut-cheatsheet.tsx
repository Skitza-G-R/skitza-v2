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
      title: "Navigate",
      keys: [
        { k: "g p", desc: "Pipeline" },
        { k: "g i", desc: "Inbox" },
        { k: "g c", desc: "Clients" },
        { k: "g l", desc: "Library" },
        { k: "g n", desc: "Contracts" },
        { k: "g b", desc: "Bookings" },
        { k: "g r", desc: "Leads" },
        { k: "g o", desc: "Portfolio" },
        { k: "g s", desc: "Settings" },
      ],
    },
    {
      title: "Actions",
      keys: [
        { k: "⌘ K", desc: "Command palette" },
        { k: "c", desc: "Create (context-aware)" },
        { k: "/", desc: "Search" },
        { k: "[", desc: "Toggle sidebar" },
        { k: "?", desc: "This cheatsheet" },
        { k: "Esc", desc: "Close overlay" },
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
      <div className="relative w-full max-w-md rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-2xl">
        <h2 className="font-display text-xl text-[rgb(var(--fg-primary))]">Keyboard shortcuts</h2>
        <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
          Press <kbd className="font-mono">?</kbd> any time.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
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
