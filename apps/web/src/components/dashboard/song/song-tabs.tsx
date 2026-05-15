"use client";

import { Calendar, DollarSign, LayoutGrid, Music } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// SongTabs — pill-shaped segmented control for the Song Space.
// Mirrors AlbumTabs but switches the tab count by mode:
//
//   - album mode  → 3 tabs: Overview · Versions (n) · Sessions
//   - single mode → 4 tabs: Overview · Versions (n) · Sessions · Payments
//
// Default tab = `overview`. The Payments tab only renders in single
// mode because the album already has a project-scope Payments tab —
// per-song payments make sense only when the project IS one song.
//
// Active tab paints `bg-sidebar` (near-black) + white text to match
// the design prototype's dark-fill "you are here" treatment. Each
// tab carries a leading icon for visual scan.

export type SongTab = "overview" | "versions" | "sessions" | "payments";

interface SongTabsProps {
  mode: "album" | "single";
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

export function SongTabs({
  mode,
  active,
  onChange,
  versionsCount,
}: SongTabsProps) {
  const baseEntries: TabEntry[] = [
    { key: "overview", label: "Overview", icon: LayoutGrid },
    {
      key: "versions",
      label: `Versions (${String(versionsCount)})`,
      icon: Music,
    },
    { key: "sessions", label: "Sessions", icon: Calendar },
  ];
  const entries: TabEntry[] =
    mode === "single"
      ? [
          ...baseEntries,
          { key: "payments", label: "Payments", icon: DollarSign },
        ]
      : baseEntries;

  return (
    <div
      className="inline-flex items-center gap-1 self-start rounded-full border p-1 shadow-[var(--shadow-sm)]"
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
            onClick={() => {
              onChange(t.key);
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: isActive
                ? "rgb(var(--bg-sidebar))"
                : "transparent",
              color: isActive
                ? "rgb(var(--bg-elevated))"
                : "rgb(var(--fg-muted))",
            }}
          >
            <Icon size={13} strokeWidth={2.2} aria-hidden />
            {t.key === "versions" ? (
              <>
                Versions{" "}
                <span className="tabular-nums">({versionsCount})</span>
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
