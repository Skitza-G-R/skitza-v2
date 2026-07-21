"use client";

import { Calendar, LayoutGrid, Music } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { nextTabIndex } from "~/lib/keyboard/tab-navigation";

// SongTabs — pill-shaped segmented control for the Song Space.
// Mirrors AlbumTabs with Overview · Versions (n) · Sessions. Purchase-grouped
// payment UI lands separately from this creative-work shell.
//
// Default tab = `overview`.
// Active tab paints `bg-sidebar` (near-black) + white text to match
// the design prototype's dark-fill "you are here" treatment. Each
// tab carries a leading icon for visual scan.

export type SongTab = "overview" | "versions" | "sessions";

interface SongTabsProps {
  active: SongTab;
  onChange: (tab: SongTab) => void;
  versionsCount: number;
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface TabEntry {
  key: SongTab;
  label: string;
  icon: IconComponent;
}

export function SongTabs({ active, onChange, versionsCount }: SongTabsProps) {
  const entries: TabEntry[] = [
    { key: "overview", label: "Overview", icon: LayoutGrid },
    {
      key: "versions",
      label: `Versions (${String(versionsCount)})`,
      icon: Music,
    },
    { key: "sessions", label: "Sessions", icon: Calendar },
  ];

  return (
    <div
      // <md: pills scroll sideways inside the rail. md+: inline-flex.
      className="flex w-full max-w-full snap-x snap-mandatory scroll-px-1 items-center gap-1 overflow-x-auto rounded-[var(--radius-lg)] border p-1 shadow-[var(--shadow-sm)] [scrollbar-width:none] md:inline-flex md:w-auto md:snap-none md:overflow-visible [&::-webkit-scrollbar]:hidden"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
      role="tablist"
      aria-label="Song section"
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
            tabIndex={isActive ? 0 : -1}
            onClick={() => {
              onChange(t.key);
            }}
            onKeyDown={(event) => {
              const currentIndex = entries.findIndex((entry) => entry.key === t.key);
              const nextIndex = nextTabIndex(currentIndex, entries.length, event.key);
              if (nextIndex === null) return;
              const next = entries[nextIndex];
              if (!next) return;
              event.preventDefault();
              onChange(next.key);
              document.getElementById(`tab-${next.key}`)?.focus();
            }}
            className="inline-flex min-h-[44px] shrink-0 snap-start items-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors md:min-h-0 md:px-4"
            style={{
              background: isActive ? "rgb(var(--bg-sidebar))" : "transparent",
              color: isActive ? "rgb(var(--bg-elevated))" : "rgb(var(--fg-muted))",
            }}
          >
            <Icon size={13} strokeWidth={2.2} aria-hidden />
            {t.key === "versions" ? (
              <>
                Versions <span className="tabular-nums">({versionsCount})</span>
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
