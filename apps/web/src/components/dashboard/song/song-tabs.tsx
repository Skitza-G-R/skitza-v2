"use client";

// SongTabs — pill-shaped segmented control for the Song Space.
// Mirrors AlbumTabs but switches the tab count by mode:
//
//   - album mode  → 3 tabs: Overview · Versions (n) · Sessions
//   - single mode → 4 tabs: Overview · Versions (n) · Sessions · Payments
//
// Default tab = `overview`. The Payments tab only renders in single
// mode because the album already has a project-scope Payments tab —
// per-song payments make sense only when the project IS one song.

export type SongTab = "overview" | "versions" | "sessions" | "payments";

interface SongTabsProps {
  mode: "album" | "single";
  active: SongTab;
  onChange: (tab: SongTab) => void;
  versionsCount: number;
}

interface TabEntry {
  key: SongTab;
  label: string;
}

export function SongTabs({
  mode,
  active,
  onChange,
  versionsCount,
}: SongTabsProps) {
  const baseEntries: TabEntry[] = [
    { key: "overview", label: "Overview" },
    { key: "versions", label: `Versions (${String(versionsCount)})` },
    { key: "sessions", label: "Sessions" },
  ];
  const entries: TabEntry[] =
    mode === "single"
      ? [...baseEntries, { key: "payments", label: "Payments" }]
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
