// segmented-tabs.tsx
//
// Single-select pill row used for All / Live / Hidden. Active tab gets
// the amber surface; inactive tabs use the muted token. Each tab can
// carry a count badge that shows only when count > 0.

"use client";

interface SegmentedTabsItem<V extends string> {
  value: V;
  label: string;
  count: number;
}

interface SegmentedTabsProps<V extends string> {
  ariaLabel: string;
  value: V;
  onChange: (next: V) => void;
  items: SegmentedTabsItem<V>[];
}

export function SegmentedTabs<V extends string>({
  ariaLabel,
  value,
  onChange,
  items,
}: SegmentedTabsProps<V>) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex gap-1 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onChange(it.value);
            }}
            className={[
              "sk-press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
              active
                ? "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark,140_95_6))]"
                : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
            ].join(" ")}
          >
            {it.label}
            {it.count > 0 ? (
              <span
                aria-hidden
                className={[
                  "inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-bold tabular-nums",
                  active
                    ? "bg-[rgb(var(--brand-primary)/0.22)] text-[rgb(var(--brand-primary-dark,140_95_6))]"
                    : "bg-[rgb(var(--fg-muted)/0.12)] text-[rgb(var(--fg-muted))]",
                ].join(" ")}
              >
                {it.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
