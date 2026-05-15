"use client";

// AlbumTabs — pill-shaped 4-tab segmented control for the new Album
// Page (DESIGN.md §5.9, BUILD-NOTES §5.3).
//
// Tabs (in order): Songs (n) · Files · Payments · Studio Log
// Default tab = "songs" (the album page has no "Overview" tab — the
// hero + stat strip already serves that role).
//
// Style precedent: WorkspaceListView's segmented control. Container is
// a rounded-full pill (border + bg-elevated). Active tab paints
// brand-primary amber + bg-sidebar text; inactive tabs are
// fg-muted on transparent.

export type AlbumTab = "songs" | "files" | "payments" | "log";

interface AlbumTabsProps {
  active: AlbumTab;
  onChange: (tab: AlbumTab) => void;
  songsCount: number;
}

interface TabEntry {
  key: AlbumTab;
  label: string;
}

export function AlbumTabs({ active, onChange, songsCount }: AlbumTabsProps) {
  const entries: TabEntry[] = [
    { key: "songs", label: `Songs (${String(songsCount)})` },
    { key: "files", label: "Files" },
    { key: "payments", label: "Payments" },
    { key: "log", label: "Studio Log" },
  ];

  return (
    <div
      className="inline-flex items-center gap-1 self-start rounded-full border p-1 shadow-[var(--shadow-sm)]"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
      role="tablist"
      aria-label="Album section"
    >
      {entries.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => { onChange(t.key); }}
            className="rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: isActive
                ? "rgb(var(--brand-primary))"
                : "transparent",
              color: isActive
                ? "rgb(var(--bg-sidebar))"
                : "rgb(var(--fg-muted))",
            }}
          >
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
