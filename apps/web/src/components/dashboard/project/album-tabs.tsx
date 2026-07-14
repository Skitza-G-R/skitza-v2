"use client";

import { DollarSign, FolderOpen, Music, Notebook } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// AlbumTabs — pill-shaped 4-tab segmented control for the new Album
// Page (DESIGN.md §5.9, BUILD-NOTES §5.3).
//
// Tabs (in order): Songs (n) · Files · Payments · Studio Log
// Default tab = "songs" (the album page has no "Overview" tab — the
// hero + stat strip already serves that role).
//
// Active tab paints `bg-sidebar` (near-black) + white text to match
// the design prototype — the dark-fill pill is the "you are here"
// signal. Each tab carries a leading icon for visual scan.

export type AlbumTab = "songs" | "files" | "payments" | "log";

interface AlbumTabsProps {
  active: AlbumTab;
  onChange: (tab: AlbumTab) => void;
  songsCount: number;
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface TabEntry {
  key: AlbumTab;
  label: string;
  icon: IconComponent;
}

export function AlbumTabs({ active, onChange, songsCount }: AlbumTabsProps) {
  const entries: TabEntry[] = [
    { key: "songs", label: `Songs (${String(songsCount)})`, icon: Music },
    { key: "files", label: "Files", icon: FolderOpen },
    { key: "payments", label: "Payments", icon: DollarSign },
    { key: "log", label: "Studio Log", icon: Notebook },
  ];

  return (
    <div
      // <md: pills scroll sideways inside the rail (never wrap — a
      // wrapped "Studio Log" pill turned into a 2-line blob and the
      // rail pushed the page to 408px). md+: original inline-flex.
      className="flex w-full max-w-full snap-x snap-mandatory scroll-px-1 items-center gap-1 overflow-x-auto rounded-[var(--radius-lg)] border p-1 shadow-[var(--shadow-sm)] [scrollbar-width:none] md:inline-flex md:w-auto md:snap-none md:overflow-visible [&::-webkit-scrollbar]:hidden"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
      role="tablist"
      aria-label="Album section"
    >
      {entries.map((t) => {
        const isActive = active === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={isActive}
            aria-controls={`panel-${t.key}`}
            onClick={() => {
              onChange(t.key);
            }}
            className="inline-flex min-h-[44px] shrink-0 snap-start items-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors md:min-h-0 md:px-4"
            style={{
              background: isActive ? "rgb(var(--bg-sidebar))" : "transparent",
              color: isActive ? "rgb(var(--bg-elevated))" : "rgb(var(--fg-muted))",
            }}
          >
            <Icon size={13} strokeWidth={2.2} aria-hidden />
            {t.key === "songs" ? (
              <>
                Songs <span className="tabular-nums">({songsCount})</span>
              </>
            ) : (
              t.label
            )}
          </button>
        );
      })}
    </div>
  );
}
