"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";

// The `?` overlay. Mounted by ShortcutsBridge; open state is owned
// by the bridge so the hook can call openCheatsheet() as a plain
// handler. The shared Radix dialog owns initial focus, Escape,
// focus trapping, outside-click dismissal, and focus return.

export function ShortcutCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        { k: "[", desc: "Toggle sidebar" },
        { k: "?", desc: "This cheatsheet" },
        { k: "Esc", desc: "Close overlay / deselect" },
      ],
    },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="gap-0 p-6 sm:max-w-xl">
        <DialogTitle className="pr-12 text-xl text-[rgb(var(--fg-primary))]">
          Keyboard shortcuts
        </DialogTitle>
        <DialogDescription className="mt-1 text-xs">
          Press <kbd className="font-mono">?</kbd> any time.
        </DialogDescription>
        <div className="mt-5 grid grid-cols-1 gap-6 text-sm sm:grid-cols-2">
          {sections.map((s) => (
            <div key={s.title}>
              <h3 className="mb-2 font-mono text-[11px] tracking-wider text-[rgb(var(--fg-muted))] uppercase">
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
      </DialogContent>
    </Dialog>
  );
}
