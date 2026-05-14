# Producer Storefront Redesign, Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `/dashboard/profile` with the new `Store.` design at `/dashboard/store`, move Portfolio to its own page, ship the new visual shell with cards, type tiles, filter, search, keyboard shortcuts. Existing edit/create still opens `NewPackageForm` (replaced in Phase 2).

**Architecture:** New folder `app/(producer)/dashboard/store/` holds the redesign. Reuses existing tRPC endpoints (`booking.packages.list`, `producer.me`) and existing server actions (`setPackageActive`, `duplicatePackage`, `archivePackage`). Type-tile mapping is a pure helper. Old `/dashboard/profile` becomes a redirect, old `storefront-screen.tsx` is deleted.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4, tRPC v11, Drizzle, Vitest (node env, no jsdom), Lucide React (already installed), Radix UI Dialog primitive.

**Source design brief:** `docs/plans/active/2026-05-10-storefront-redesign-design.md`

**Test convention (Skitza-specific):** No `@testing-library/react`, no jsdom. Pure helpers get standard vitest unit tests. Component shells get source-grep tests via `readFileSync` (mirrors `apps/web/src/components/dashboard/today/__tests__/pulse-card.test.tsx`).

---

## Task 0: Branch and verify base

**Files:** none

**Step 1: Verify base branch and clean tree**

Run:
```bash
cd "/Users/giliasraf/Skitza 16.4"
git status -s
git rev-parse --abbrev-ref HEAD
git fetch origin v3-clean
git diff origin/v3-clean --stat
```

Expected: branch is `v3-clean`, design doc commit `0357cb6` is the last commit, no diff vs origin (modulo the design doc).

**Step 2: Create feature branch**

Run:
```bash
git checkout -b phase-1-store-redesign
git push -u origin phase-1-store-redesign
```

Expected: new branch on origin, tracking set.

---

## Task 1: `kindToTile` helper

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/kind-to-tile.ts`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/kind-to-tile.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { kindToTile } from "../kind-to-tile";

describe("kindToTile", () => {
  it.each([
    ["mix", "mix"],
    ["mixing", "mix"],
    ["master", "master"],
    ["mastering", "master"],
    ["production", "production"],
    ["producing", "production"],
    ["album", "production"],
    ["consult", "consult"],
    ["session", "consult"],
    ["other", "consult"],
    ["custom", "consult"],
    ["hourly", "consult"],
    ["beat_lease", "consult"],
  ])("maps kind %s to tile %s", (kind, tile) => {
    expect(kindToTile(kind)).toBe(tile);
  });

  it("falls back to consult for unknown kinds", () => {
    expect(kindToTile("zzz_unknown")).toBe("consult");
    expect(kindToTile("")).toBe("consult");
  });

  it("handles uppercase input case-insensitively", () => {
    expect(kindToTile("MIX")).toBe("mix");
    expect(kindToTile("Production")).toBe("production");
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm -F web test -- run kind-to-tile
```

Expected: FAIL with "Cannot find module '../kind-to-tile'".

**Step 3: Write minimal implementation**

```ts
// kind-to-tile.ts
//
// Maps the free-text `products.kind` column to one of the four design
// tiles. Existing values fan out per the storefront design brief
// (docs/plans/active/2026-05-10-storefront-redesign-design.md §4).
// Anything unrecognised falls back to "consult" so the visual stays
// coherent for legacy or custom kinds. Re-tune here if a 5th tile is
// added later.

export type TileType = "mix" | "master" | "production" | "consult";

const KIND_TO_TILE: Record<string, TileType> = {
  mix: "mix",
  mixing: "mix",
  master: "master",
  mastering: "master",
  production: "production",
  producing: "production",
  album: "production",
  consult: "consult",
  session: "consult",
  other: "consult",
  custom: "consult",
  hourly: "consult",
  beat_lease: "consult",
};

export function kindToTile(kind: string): TileType {
  return KIND_TO_TILE[kind.toLowerCase()] ?? "consult";
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F web test -- run kind-to-tile
```

Expected: PASS, all 16 cases green.

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/kind-to-tile.ts \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/kind-to-tile.test.ts
git commit -m "feat(store): add kindToTile mapping helper"
```

---

## Task 2: Tile theme registry

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/tile-theme.ts`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/tile-theme.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { TILE_THEME } from "../tile-theme";

describe("TILE_THEME", () => {
  it("has exactly the 4 tile types", () => {
    expect(Object.keys(TILE_THEME).sort()).toEqual([
      "consult",
      "master",
      "mix",
      "production",
    ]);
  });

  it("each tile defines gradient, iconName, and accent", () => {
    for (const t of Object.values(TILE_THEME)) {
      expect(t.gradient).toMatch(/linear-gradient/);
      expect(t.iconName).toBeTypeOf("string");
      expect(t.iconName.length).toBeGreaterThan(0);
      expect(t.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("uses the four canonical Lucide icons", () => {
    expect(TILE_THEME.mix.iconName).toBe("sliders-horizontal");
    expect(TILE_THEME.master.iconName).toBe("volume-2");
    expect(TILE_THEME.production.iconName).toBe("music-2");
    expect(TILE_THEME.consult.iconName).toBe("message-square");
  });
});
```

**Step 2: Run test, expect FAIL** (`Cannot find module '../tile-theme'`).

```bash
pnpm -F web test -- run tile-theme
```

**Step 3: Implement**

```ts
// tile-theme.ts
//
// Per-tile visual theme. Source-of-truth for the gradient, icon, and
// hover-accent stripe color used on a product card. The handoff
// (storefront.html, TYPE_META constant) defines these gradients
// verbatim. Accent picked as the gradient's lighter stop so the
// 3px hover stripe is visible against the warm bg.

import type { TileType } from "./kind-to-tile";

interface TileTheme {
  gradient: string;
  iconName: string;
  accent: string;
}

export const TILE_THEME: Record<TileType, TileTheme> = {
  mix: {
    gradient: "linear-gradient(135deg, #d97706, #b45309)",
    iconName: "sliders-horizontal",
    accent: "#d97706",
  },
  master: {
    gradient: "linear-gradient(135deg, #c2410c, #9a3412)",
    iconName: "volume-2",
    accent: "#c2410c",
  },
  production: {
    gradient: "linear-gradient(135deg, #059669, #065f46)",
    iconName: "music-2",
    accent: "#059669",
  },
  consult: {
    gradient: "linear-gradient(135deg, #475569, #1e293b)",
    iconName: "message-square",
    accent: "#475569",
  },
};
```

**Step 4: Run test, expect PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/tile-theme.ts \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/tile-theme.test.ts
git commit -m "feat(store): add per-tile theme registry"
```

---

## Task 3: `<TypeTile>` component

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/type-tile.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/type-tile.test.tsx`

**Step 1: Write failing test (source-grep)**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "type-tile.tsx"), "utf8");

describe("TypeTile component shell", () => {
  it("imports the tile theme and the kind-to-tile types", () => {
    expect(SRC).toMatch(/from\s+["']\.\/tile-theme["']/);
    expect(SRC).toMatch(/from\s+["']\.\/kind-to-tile["']/);
  });

  it("imports lucide-react for the icon", () => {
    expect(SRC).toMatch(/from\s+["']lucide-react["']/);
  });

  it("renders 60 and 32 sizes", () => {
    expect(SRC).toContain('size === 60');
    expect(SRC).toContain('size === 32');
  });

  it("applies the eye-off overlay when hidden prop is set", () => {
    expect(SRC).toMatch(/EyeOff|eye-off/);
    expect(SRC).toMatch(/hidden\?/);
  });

  it("uses inset shadows on the tile per the design spec", () => {
    expect(SRC).toContain("inset 0 1px 0 rgba(255,255,255");
    expect(SRC).toContain("inset 0 -10px 16px rgba(0,0,0");
  });

  it("centers the icon with stroke width 2.2", () => {
    expect(SRC).toMatch(/strokeWidth=\{2\.2\}/);
  });
});
```

**Step 2: Run test, expect FAIL** (file does not exist).

**Step 3: Implement**

```tsx
// type-tile.tsx
//
// Gradient tile rendered on every product card. Two sizes: 60×60
// (cards view), 32×32 (table view, Phase 3). Inset shadows + radial
// highlight create depth; the design spec lives in
// docs/plans/active/2026-05-10-storefront-redesign-design.md §4.

"use client";

import {
  EyeOff,
  Music2,
  MessageSquare,
  SlidersHorizontal,
  Volume2,
  type LucideIcon,
} from "lucide-react";

import type { TileType } from "./kind-to-tile";
import { TILE_THEME } from "./tile-theme";

const ICON_BY_NAME: Record<string, LucideIcon> = {
  "sliders-horizontal": SlidersHorizontal,
  "volume-2": Volume2,
  "music-2": Music2,
  "message-square": MessageSquare,
};

interface TypeTileProps {
  type: TileType;
  size?: 32 | 60;
  hidden?: boolean;
}

export function TypeTile({ type, size = 60, hidden = false }: TypeTileProps) {
  const theme = TILE_THEME[type];
  const Icon = ICON_BY_NAME[theme.iconName] ?? Music2;
  const radius = size === 60 ? 12 : 8;
  const iconSize = size === 60 ? 24 : 16;

  return (
    <div
      aria-hidden
      className="relative shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: theme.gradient,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -10px 16px rgba(0,0,0,0.16), 0 4px 10px -4px rgba(17,16,9,0.22)",
      }}
    >
      {/* Radial highlight overlay top-left */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: radius,
          background:
            "radial-gradient(120% 120% at 0% 0%, rgba(255,255,255,0.32), transparent 55%)",
        }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-white">
        <Icon size={iconSize} strokeWidth={2.2} />
      </span>
      {hidden ? (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
          style={{ borderRadius: radius, background: "rgba(17,16,9,0.55)" }}
        >
          <EyeOff size={iconSize} strokeWidth={2.2} className="text-white/85" />
        </span>
      ) : null}
    </div>
  );
}
```

**Step 4: Run test, expect PASS.**

```bash
pnpm -F web test -- run type-tile
```

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/type-tile.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/type-tile.test.tsx
git commit -m "feat(store): add TypeTile component"
```

---

## Task 4: `filterAndSearch` helper

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/filter-search.ts`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/filter-search.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";

import {
  countByFilter,
  filterAndSearch,
  type FilterTab,
  type StoreItem,
} from "../filter-search";

const SAMPLE: StoreItem[] = [
  { id: "a", name: "Album mix", description: "Stems delivered", active: true },
  { id: "b", name: "Beat lease", description: "Single use", active: true },
  { id: "c", name: "Mastering", description: "Loudness pass", active: false },
];

describe("countByFilter", () => {
  it("returns counts for all, live, hidden", () => {
    const c = countByFilter(SAMPLE);
    expect(c.all).toBe(3);
    expect(c.live).toBe(2);
    expect(c.hidden).toBe(1);
  });

  it("returns zeroes on empty input", () => {
    expect(countByFilter([])).toEqual({ all: 0, live: 0, hidden: 0 });
  });
});

describe("filterAndSearch", () => {
  it.each<[FilterTab, string[]]>([
    ["all", ["a", "b", "c"]],
    ["live", ["a", "b"]],
    ["hidden", ["c"]],
  ])("filter %s returns ids %j", (tab, ids) => {
    expect(filterAndSearch(SAMPLE, tab, "").map((s) => s.id)).toEqual(ids);
  });

  it("searches case-insensitively across name", () => {
    expect(filterAndSearch(SAMPLE, "all", "ALBUM").map((s) => s.id)).toEqual([
      "a",
    ]);
  });

  it("searches case-insensitively across description", () => {
    expect(filterAndSearch(SAMPLE, "all", "stems").map((s) => s.id)).toEqual([
      "a",
    ]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterAndSearch(SAMPLE, "all", "no_match")).toEqual([]);
  });
});
```

**Step 2: Run test, expect FAIL.**

**Step 3: Implement**

```ts
// filter-search.ts
//
// Pure helpers driving the toolbar's filter tabs and the search input.
// Decoupled from React so they're testable without rendering and reused
// in Phase 3's table view.

export type FilterTab = "all" | "live" | "hidden";

export interface StoreItem {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface FilterCounts {
  all: number;
  live: number;
  hidden: number;
}

export function countByFilter(items: StoreItem[]): FilterCounts {
  let live = 0;
  for (const it of items) if (it.active) live += 1;
  return { all: items.length, live, hidden: items.length - live };
}

export function filterAndSearch<T extends StoreItem>(
  items: T[],
  tab: FilterTab,
  search: string,
): T[] {
  const q = search.trim().toLowerCase();
  return items.filter((it) => {
    if (tab === "live" && !it.active) return false;
    if (tab === "hidden" && it.active) return false;
    if (q.length === 0) return true;
    if (it.name.toLowerCase().includes(q)) return true;
    if ((it.description ?? "").toLowerCase().includes(q)) return true;
    return false;
  });
}
```

**Step 4: Run test, expect PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/filter-search.ts \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/filter-search.test.ts
git commit -m "feat(store): add filter+search helpers"
```

---

## Task 5: `<Toggle>` component

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/toggle.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/toggle.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "toggle.tsx"), "utf8");

describe("Toggle component shell", () => {
  it("declares the 44 by 24 dimensions per spec", () => {
    expect(SRC).toMatch(/width:\s*44/);
    expect(SRC).toMatch(/height:\s*24/);
  });

  it("uses the springy thumb easing curve from the spec", () => {
    expect(SRC).toContain("cubic-bezier(.34,1.56,.64,1)");
  });

  it("flips aria-pressed based on the on prop", () => {
    expect(SRC).toMatch(/aria-pressed=\{on\}/);
  });

  it("uses the success token for the on background", () => {
    expect(SRC).toMatch(/--fg-success/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// toggle.tsx
//
// 44×24 visibility toggle with springy thumb. The "on" state uses the
// success token (--fg-success); the "off" state uses --border-strong.
// Driven by a controlled `on` prop and an `onChange` callback so the
// parent owns the transition (so a server-action revert can flip state
// back without lag).

"use client";

interface ToggleProps {
  on: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
}

export function Toggle({ on, onChange, ariaLabel, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-pressed={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className="relative shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 disabled:opacity-50"
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: on
          ? "rgb(var(--fg-success))"
          : "rgb(var(--border-strong))",
      }}
    >
      <span
        aria-hidden
        className="absolute top-[3px] inline-block bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          left: on ? 23 : 3,
          transition: "left 220ms cubic-bezier(.34,1.56,.64,1)",
        }}
      />
    </button>
  );
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/toggle.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/toggle.test.tsx
git commit -m "feat(store): add 44x24 springy Toggle"
```

---

## Task 6: `<SegmentedTabs>` (filter bar)

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/segmented-tabs.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/segmented-tabs.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "segmented-tabs.tsx"), "utf8");

describe("SegmentedTabs shell", () => {
  it("renders a button per item", () => {
    expect(SRC).toMatch(/items\.map/);
    expect(SRC).toMatch(/<button/);
  });

  it("flips aria-pressed on the active tab", () => {
    expect(SRC).toMatch(/aria-pressed=\{[^}]*active/);
  });

  it("renders the count badge when count > 0", () => {
    expect(SRC).toMatch(/count\s*>\s*0/);
  });

  it("groups tabs in role group with an aria-label", () => {
    expect(SRC).toContain('role="group"');
    expect(SRC).toMatch(/aria-label/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
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
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/segmented-tabs.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/segmented-tabs.test.tsx
git commit -m "feat(store): add SegmentedTabs filter bar"
```

---

## Task 7: `<ViewToggle>` (Cards/Table)

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/view-toggle.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/view-toggle.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "view-toggle.tsx"), "utf8");

describe("ViewToggle shell", () => {
  it("renders both Cards and Table options", () => {
    expect(SRC).toContain('"cards"');
    expect(SRC).toContain('"table"');
  });

  it("disables the Table option in Phase 1 with a coming-soon hint", () => {
    expect(SRC).toMatch(/disabled/);
    expect(SRC).toMatch(/Coming soon|coming soon|aria-disabled/i);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// view-toggle.tsx
//
// Cards / Table switcher. Phase 1 disables the Table option (Phase 3
// enables it). The visual still shows both options so producers know
// it's coming.

"use client";

import { LayoutGrid, Rows3 } from "lucide-react";

export type ViewMode = "cards" | "table";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  /** When true, the Table option renders interactive (Phase 3). */
  enableTable?: boolean;
}

export function ViewToggle({ value, onChange, enableTable = false }: ViewToggleProps) {
  return (
    <div role="group" aria-label="View mode" className="inline-flex rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-0.5">
      <button
        type="button"
        aria-pressed={value === "cards"}
        onClick={() => {
          onChange("cards");
        }}
        className={[
          "sk-press inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11.5px] font-semibold",
          value === "cards"
            ? "bg-[rgb(var(--bg-base,242_237_230))] text-[rgb(var(--fg-default))]"
            : "text-[rgb(var(--fg-muted))]",
        ].join(" ")}
      >
        <LayoutGrid size={14} strokeWidth={2.1} /> Cards
      </button>
      <button
        type="button"
        aria-pressed={value === "table"}
        aria-disabled={!enableTable}
        disabled={!enableTable}
        title={!enableTable ? "Table view, Coming soon" : undefined}
        onClick={() => {
          if (enableTable) onChange("table");
        }}
        className={[
          "sk-press inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11.5px] font-semibold",
          value === "table" && enableTable
            ? "bg-[rgb(var(--bg-base,242_237_230))] text-[rgb(var(--fg-default))]"
            : "text-[rgb(var(--fg-muted))]",
          enableTable ? "" : "cursor-not-allowed opacity-60",
        ].join(" ")}
      >
        <Rows3 size={14} strokeWidth={2.1} /> Table
      </button>
    </div>
  );
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/view-toggle.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/view-toggle.test.tsx
git commit -m "feat(store): add ViewToggle (Table disabled in Phase 1)"
```

---

## Task 8: `<KeyboardHintChip>` shared chip

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/keyboard-hint-chip.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/keyboard-hint-chip.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "keyboard-hint-chip.tsx"), "utf8");

describe("KeyboardHintChip shell", () => {
  it("renders the kbd label inside a small chip", () => {
    expect(SRC).toMatch(/<kbd/);
    expect(SRC).toMatch(/font-mono/);
  });

  it("is purely presentational (aria-hidden)", () => {
    expect(SRC).toContain("aria-hidden");
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// keyboard-hint-chip.tsx
//
// Small monospace key-cap rendered next to buttons (e.g. the "+ New
// product" button shows "N"; the search input shows "/"). Decorative
// only, the actual key handling lives on the parent surface.

interface KeyboardHintChipProps {
  label: string;
}

export function KeyboardHintChip({ label }: KeyboardHintChipProps) {
  return (
    <kbd
      aria-hidden
      className="ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-1 font-mono text-[10px] font-bold text-[rgb(var(--fg-muted))]"
    >
      {label}
    </kbd>
  );
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/keyboard-hint-chip.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/keyboard-hint-chip.test.tsx
git commit -m "feat(store): add KeyboardHintChip"
```

---

## Task 9: `<NewProductButton>` (amber CTA)

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/new-product-button.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/new-product-button.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "new-product-button.tsx"), "utf8");

describe("NewProductButton shell", () => {
  it("uses the amber brand background", () => {
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("includes the Plus lucide icon", () => {
    expect(SRC).toMatch(/Plus/);
  });

  it("renders the N keyboard hint chip", () => {
    expect(SRC).toMatch(/KeyboardHintChip/);
    expect(SRC).toMatch(/label="N"/);
  });

  it("declares the button label '+ New product'", () => {
    expect(SRC).toContain("New product");
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// new-product-button.tsx
//
// Amber CTA matching the handoff. Carries the "N" keyboard hint chip;
// the actual N-key handler lives on <StoreScreen>.

"use client";

import { Plus } from "lucide-react";

import { KeyboardHintChip } from "./keyboard-hint-chip";

interface NewProductButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function NewProductButton({ onClick, disabled = false }: NewProductButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="sk-press inline-flex items-center justify-center rounded-[10px] px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--bg-sidebar))] shadow-[0_2px_14px_rgb(var(--brand-primary)/0.32)] transition-transform hover:translate-y-[-1px] disabled:opacity-50"
      style={{ background: "rgb(var(--brand-primary))" }}
    >
      <Plus size={15} strokeWidth={2.4} />
      <span className="ml-1.5">New product</span>
      <KeyboardHintChip label="N" />
    </button>
  );
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/new-product-button.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/new-product-button.test.tsx
git commit -m "feat(store): add NewProductButton with N hint chip"
```

---

## Task 10: `<SearchInput>` with `/` chip

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/search-input.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/search-input.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "search-input.tsx"), "utf8");

describe("SearchInput shell", () => {
  it("renders an input element", () => {
    expect(SRC).toMatch(/<input/);
  });

  it("accepts an external ref via forwardRef so the / handler can focus it", () => {
    expect(SRC).toMatch(/forwardRef/);
  });

  it("includes the search Lucide icon", () => {
    expect(SRC).toMatch(/Search/);
  });

  it("renders the / keyboard hint chip", () => {
    expect(SRC).toMatch(/KeyboardHintChip/);
    expect(SRC).toMatch(/label="\/"/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// search-input.tsx
//
// Search input with a leading lucide-search icon and a trailing "/"
// keyboard-hint chip. The / handler that focuses this input lives on
// <StoreScreen>; we forward the ref so the parent can call .focus().

"use client";

import { forwardRef } from "react";
import { Search } from "lucide-react";

import { KeyboardHintChip } from "./keyboard-hint-chip";

interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ value, onChange, placeholder = "Search products" }, ref) {
    return (
      <label className="relative inline-flex h-9 items-center rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] pl-2.5 pr-1.5 text-[12.5px] focus-within:border-[rgb(var(--border-strong))]">
        <Search size={14} strokeWidth={2.1} className="text-[rgb(var(--fg-muted))]" />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          className="ml-1.5 h-full w-[180px] bg-transparent outline-none placeholder:text-[rgb(var(--fg-faint))]"
        />
        <KeyboardHintChip label="/" />
      </label>
    );
  },
);
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/search-input.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/search-input.test.tsx
git commit -m "feat(store): add SearchInput with / hint chip"
```

---

## Task 11: `<EmptyState>`

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/empty-state.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/empty-state.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "empty-state.tsx"), "utf8");

describe("EmptyState shell", () => {
  it("uses the dashed border style from the spec", () => {
    expect(SRC).toMatch(/border-dashed/);
  });

  it("renders the title and body props", () => {
    expect(SRC).toMatch(/title/);
    expect(SRC).toMatch(/body/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// empty-state.tsx
//
// Dashed-border empty card shown when the catalog is empty or when a
// filter/search returns zero results. Action prop is rendered on the
// right of the body so the parent can pass either the new-product CTA
// or a "Clear filter" link.

import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="rounded-[16px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated)/0.6)] px-6 py-10 text-center">
      <p className="font-display text-[18px] font-extrabold tracking-tight text-[rgb(var(--fg-default))]">
        {title}
      </p>
      <p className="mx-auto mt-1 max-w-[40ch] text-[13px] text-[rgb(var(--fg-muted))]">
        {body}
      </p>
      {action ? <div className="mt-4 inline-flex justify-center">{action}</div> : null}
    </div>
  );
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/empty-state.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/empty-state.test.tsx
git commit -m "feat(store): add EmptyState"
```

---

## Task 12: `<ProductCard>`

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/product-card.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/product-card.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "product-card.tsx"), "utf8");

describe("ProductCard shell", () => {
  it("imports TypeTile and Toggle", () => {
    expect(SRC).toMatch(/from\s+["']\.\/type-tile["']/);
    expect(SRC).toMatch(/from\s+["']\.\/toggle["']/);
  });

  it("renders the GripVertical drag handle", () => {
    expect(SRC).toMatch(/GripVertical/);
  });

  it("renders the Pencil edit icon and Trash2 delete icon", () => {
    expect(SRC).toMatch(/Pencil/);
    expect(SRC).toMatch(/Trash2|X /);
  });

  it("uses formatMoney for the price", () => {
    expect(SRC).toMatch(/formatMoney/);
  });

  it("uses kindToTile to derive the tile type", () => {
    expect(SRC).toMatch(/kindToTile/);
  });

  it("derives the tagline from the first line of description", () => {
    expect(SRC).toMatch(/split\(\s*["']\\n["']\s*\)\[0\]/);
  });

  it("blocks card-click bubble on action area via no-card-click-block", () => {
    expect(SRC).toMatch(/no-card-click-block/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// product-card.tsx
//
// Single-row catalog card. Composition: drag handle, type tile, name +
// tagline, price, visibility toggle, edit, delete. Whole-card click
// opens the editor; the action area is wrapped in `.no-card-click-block`
// so its clicks don't bubble. Drag is visual-only in Phase 1
// (re-ordering wires up in Phase 3).

"use client";

import { GripVertical, Pencil, Trash2 } from "lucide-react";

import { formatMoney } from "~/lib/format/money";
import { kindToTile } from "./kind-to-tile";
import { TILE_THEME } from "./tile-theme";
import { Toggle } from "./toggle";
import { TypeTile } from "./type-tile";

export interface ProductCardData {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  active: boolean;
  kind: string;
}

interface ProductCardProps {
  product: ProductCardData;
  pending?: boolean;
  onOpen: () => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function deriveTagline(description: string | null): string {
  if (!description) return "";
  const first = description.split("\n")[0]?.trim() ?? "";
  return first;
}

export function ProductCard({
  product,
  pending = false,
  onOpen,
  onToggleVisible,
  onEdit,
  onDelete,
}: ProductCardProps) {
  const tile = kindToTile(product.kind);
  const accent = TILE_THEME[tile].accent;
  const tagline = deriveTagline(product.description);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={[
        "group relative grid items-center rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 transition-[border-color,transform,box-shadow] duration-200",
        "hover:border-[rgb(var(--border-strong))] hover:-translate-y-px hover:shadow-[0_14px_36px_-22px_rgba(17,16,9,0.28),0_2px_8px_-3px_rgba(17,16,9,0.05)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2",
        product.active ? "" : "opacity-60",
      ].join(" ")}
      style={{
        gridTemplateColumns: "20px 60px minmax(0,1fr) auto auto",
        columnGap: 14,
      }}
    >
      {/* Hover accent stripe in tile color */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: accent }}
      />

      <span aria-hidden className="text-[rgb(var(--fg-muted))] opacity-30 transition-opacity group-hover:opacity-100" style={{ cursor: "grab" }}>
        <GripVertical size={16} strokeWidth={2.1} />
      </span>

      <TypeTile type={tile} hidden={!product.active} />

      <div className="min-w-0">
        <p className="truncate font-display text-[17px] font-bold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          {product.name || <span className="italic text-[rgb(var(--fg-faint))]">Untitled</span>}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] leading-[1.45] text-[rgb(var(--fg-muted))]">
          {tagline || <span className="italic text-[rgb(var(--fg-faint))]">No tagline yet</span>}
        </p>
      </div>

      <p className="shrink-0 text-right font-display text-[26px] font-extrabold leading-none tracking-[-0.02em] text-[rgb(var(--fg-default))] tabular-nums">
        {formatMoney(product.priceCents, product.currency)}
      </p>

      <div
        className="no-card-click-block flex items-center gap-2.5"
        onClick={(e) => {
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
      >
        <Toggle
          on={product.active}
          onChange={onToggleVisible}
          ariaLabel={product.active ? `Hide ${product.name}` : `Make ${product.name} live`}
          disabled={pending}
        />
        <button
          type="button"
          onClick={onEdit}
          className="sk-press inline-flex items-center gap-1 rounded-[8px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2.5 py-1.5 text-[12px] font-semibold text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]"
        >
          <Pencil size={12} strokeWidth={2.2} /> Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${product.name}`}
          className="sk-press inline-flex h-[34px] w-[34px] items-center justify-center rounded-[8px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
        >
          <Trash2 size={14} strokeWidth={2.1} />
        </button>
      </div>
    </article>
  );
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/product-card.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/product-card.test.tsx
git commit -m "feat(store): add ProductCard with type tile + actions"
```

---

## Task 13: `<StoreHeader>`

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/store-header.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-header.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-header.tsx"), "utf8");

describe("StoreHeader shell", () => {
  it("renders the CATALOG eyebrow", () => {
    expect(SRC).toContain("CATALOG");
  });

  it("renders the Store. wordmark with brand-amber dot", () => {
    expect(SRC).toMatch(/Store/);
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("uses Syne for the wordmark", () => {
    expect(SRC).toMatch(/font-display|Syne|font-syne/);
  });

  it("renders the live and hidden counts", () => {
    expect(SRC).toMatch(/live/);
    expect(SRC).toMatch(/hidden/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// store-header.tsx
//
// Top of the page: eyebrow CATALOG + Store. wordmark + counts line.
// Wordmark size scales between mobile and desktop so the design holds
// on phones (the handoff specs ~120px which only fits desktop).

interface StoreHeaderProps {
  liveCount: number;
  hiddenCount: number;
}

export function StoreHeader({ liveCount, hiddenCount }: StoreHeaderProps) {
  return (
    <header className="mb-6">
      <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        CATALOG
      </p>
      <h1
        className="mt-2 font-display font-extrabold leading-[0.96] tracking-[-0.035em] text-[rgb(var(--fg-default))]"
        style={{ fontSize: "clamp(56px, 14vw, 120px)" }}
      >
        Store<span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
      <p className="mt-3 text-[14px] text-[rgb(var(--fg-muted))]">
        <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">{liveCount}</span>{" "}
        live{" "}
        <span aria-hidden className="opacity-50">·</span>{" "}
        <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">{hiddenCount}</span>{" "}
        hidden
      </p>
    </header>
  );
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/store-header.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/store-header.test.tsx
git commit -m "feat(store): add StoreHeader with eyebrow + wordmark + counts"
```

---

## Task 14: `<StoreToolbar>`

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/store-toolbar.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-toolbar.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-toolbar.tsx"), "utf8");

describe("StoreToolbar shell", () => {
  it("composes SegmentedTabs, ViewToggle, SearchInput", () => {
    expect(SRC).toMatch(/SegmentedTabs/);
    expect(SRC).toMatch(/ViewToggle/);
    expect(SRC).toMatch(/SearchInput/);
  });

  it("uses the FilterTab and ViewMode types from the helpers", () => {
    expect(SRC).toMatch(/FilterTab/);
    expect(SRC).toMatch(/ViewMode/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// store-toolbar.tsx
//
// Single toolbar row: filter tabs on the left, view-toggle + search on
// the right. Layout drops to wrap on narrow viewports.

"use client";

import { forwardRef } from "react";

import type { FilterCounts, FilterTab } from "./filter-search";
import { SearchInput } from "./search-input";
import { SegmentedTabs } from "./segmented-tabs";
import { ViewToggle, type ViewMode } from "./view-toggle";

interface StoreToolbarProps {
  filter: FilterTab;
  onFilterChange: (next: FilterTab) => void;
  counts: FilterCounts;
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
  search: string;
  onSearchChange: (next: string) => void;
}

export const StoreToolbar = forwardRef<HTMLInputElement, StoreToolbarProps>(
  function StoreToolbar(
    { filter, onFilterChange, counts, view, onViewChange, search, onSearchChange },
    searchRef,
  ) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs<FilterTab>
          ariaLabel="Filter products"
          value={filter}
          onChange={onFilterChange}
          items={[
            { value: "all", label: "All", count: counts.all },
            { value: "live", label: "Live", count: counts.live },
            { value: "hidden", label: "Hidden", count: counts.hidden },
          ]}
        />
        <div className="flex items-center gap-3">
          <ViewToggle value={view} onChange={onViewChange} enableTable={false} />
          <SearchInput ref={searchRef} value={search} onChange={onSearchChange} />
        </div>
      </div>
    );
  },
);
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/store-toolbar.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/store-toolbar.test.tsx
git commit -m "feat(store): add StoreToolbar"
```

---

## Task 15: `<StoreScreen>` composition + state + keyboard

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/store-screen.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-screen.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-screen.tsx"), "utf8");

describe("StoreScreen shell", () => {
  it("uses the existing tRPC server actions", () => {
    expect(SRC).toMatch(/setPackageActive/);
    expect(SRC).toMatch(/duplicatePackage/);
    expect(SRC).toMatch(/archivePackage/);
  });

  it("reuses NewPackageForm for create + edit (Phase 2 replaces)", () => {
    expect(SRC).toMatch(/NewPackageForm/);
  });

  it("wires the / and N global keyboard shortcuts", () => {
    expect(SRC).toMatch(/key === "\/"|"\\\/"/);
    expect(SRC).toMatch(/key\.toLowerCase\(\) === "n"|key === "N"|key === "n"/);
  });

  it("does NOT link Create or Edit to /dashboard/settings (regression carryover)", () => {
    expect(SRC).not.toMatch(
      /href\s*=\s*[`"']\/dashboard\/settings\?section=services/,
    );
  });

  it("renders the StoreHeader, StoreToolbar, ProductCard, EmptyState pieces", () => {
    expect(SRC).toMatch(/StoreHeader/);
    expect(SRC).toMatch(/StoreToolbar/);
    expect(SRC).toMatch(/ProductCard/);
    expect(SRC).toMatch(/EmptyState/);
  });

  it("renders the HIDDEN section divider when filter is all", () => {
    expect(SRC).toMatch(/HIDDEN/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

```tsx
// store-screen.tsx
//
// Composes the producer Store catalog. State: filter / search / view /
// editing. Keyboard: / focuses search, N opens new flow, Esc closes
// modal, Enter on a focused card opens edit (Enter handler lives on
// each card). Edit/Create open the existing NewPackageForm in Phase 1;
// Phase 2 swaps in the new Editor.

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  archivePackage,
  duplicatePackage,
  setPackageActive,
  type PackageKind,
  type PackageLocationType,
} from "~/app/(producer)/dashboard/booking/actions";
import {
  NewPackageForm,
  type Currency,
  type InitialPackageValues,
} from "~/app/(producer)/dashboard/booking/package-form";
import { useToast } from "~/components/ui/toast";

import { EmptyState } from "./empty-state";
import { countByFilter, filterAndSearch, type FilterTab } from "./filter-search";
import { NewProductButton } from "./new-product-button";
import { ProductCard, type ProductCardData } from "./product-card";
import { StoreHeader } from "./store-header";
import { StoreToolbar } from "./store-toolbar";
import type { ViewMode } from "./view-toggle";

export interface StoreProduct extends ProductCardData {
  // The Phase 1 editor is the existing NewPackageForm; we need the
  // form-typed columns to seed initialValues when "Edit" opens.
  depositPct: number;
  durationMin: number;
  sessionCount: number;
  paymentPlans: import("@skitza/db").PaymentPlan[];
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  contractUrl: string | null;
}

interface StoreScreenProps {
  products: StoreProduct[];
  defaultCurrency: Currency;
}

const VALID_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;
const VALID_KINDS = ["session", "mixing", "mastering", "producing", "other"] as const;
const VALID_LOCATIONS = ["studio", "remote", "client_space"] as const;

function toInitialValues(p: StoreProduct): InitialPackageValues {
  const currency = (VALID_CURRENCIES as readonly string[]).includes(p.currency)
    ? (p.currency as Currency)
    : "USD";
  const kind = (VALID_KINDS as readonly string[]).includes(p.kind)
    ? (p.kind as PackageKind)
    : "session";
  const locationType = (VALID_LOCATIONS as readonly string[]).includes(p.locationType)
    ? (p.locationType as PackageLocationType)
    : "studio";
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    durationMin: p.durationMin,
    sessionCount: p.sessionCount,
    priceCents: p.priceCents,
    currency,
    depositPct: p.depositPct,
    kind,
    locationType,
    bufferMinutes: p.bufferMinutes,
    minLeadHours: p.minLeadHours,
    paymentPlans: p.paymentPlans,
    contractUrl: p.contractUrl,
  };
}

export function StoreScreen({ products, defaultCurrency }: StoreScreenProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [view, setView] = useState<ViewMode>("cards");
  const [search, setSearch] = useState("");
  // Editor state. `creating` opens NewPackageForm in create mode;
  // `editing` opens it in edit mode pre-filled.
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => countByFilter(products), [products]);
  const filtered = useMemo(
    () => filterAndSearch(products, filter, search),
    [products, filter, search],
  );

  // Group filtered list into live + hidden when filter is "all" so we
  // can render the "HIDDEN · N" divider between them.
  const live = filtered.filter((p) => p.active);
  const hidden = filtered.filter((p) => !p.active);

  // Global keyboard handlers: / focuses search, N opens new flow, Esc
  // closes any open modal. We skip handling when the user is typing
  // inside a form field already.
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return t.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (creating) setCreating(false);
        if (editing) setEditing(null);
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setCreating(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [creating, editing]);

  function onToggleVisible(p: StoreProduct) {
    const next = !p.active;
    startTransition(async () => {
      const res = await setPackageActive({ id: p.id, active: next });
      if (res.ok) {
        toast(next ? `"${p.name}" is now live.` : `"${p.name}" hidden.`, "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onEdit(p: StoreProduct) {
    setEditing(p);
  }

  // Phase 1 keeps Delete wired to the existing archivePackage server
  // action without the confirm modal or undo toast (those land in
  // Phase 2). We still toast and refresh so producers see feedback.
  function onDelete(p: StoreProduct) {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    startTransition(async () => {
      const res = await archivePackage({ id: p.id });
      if (res.ok) {
        toast(`"${p.name}" deleted.`, "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-6 pb-24 sm:px-6 sm:pt-10">
      <StoreHeader liveCount={counts.live} hiddenCount={counts.hidden} />

      <div className="mb-4 flex justify-end">
        <NewProductButton
          onClick={() => {
            setCreating(true);
          }}
        />
      </div>

      <StoreToolbar
        ref={searchRef}
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
      />

      {filtered.length === 0 ? (
        products.length === 0 ? (
          <EmptyState
            title="No products yet"
            body="Create your first product to start taking bookings from your link."
            action={
              <NewProductButton
                onClick={() => {
                  setCreating(true);
                }}
              />
            }
          />
        ) : (
          <EmptyState
            title="Nothing matches"
            body="Try clearing the filter or search."
          />
        )
      ) : (
        <div className="flex flex-col gap-2">
          {live.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              pending={pending}
              onOpen={() => {
                onEdit(p);
              }}
              onToggleVisible={() => {
                onToggleVisible(p);
              }}
              onEdit={() => {
                onEdit(p);
              }}
              onDelete={() => {
                onDelete(p);
              }}
            />
          ))}
          {filter === "all" && hidden.length > 0 ? (
            <div className="mt-4 mb-1 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
              HIDDEN <span aria-hidden>·</span>{" "}
              <span className="tabular-nums">{hidden.length}</span>
            </div>
          ) : null}
          {(filter === "all" || filter === "hidden") &&
            hidden.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                pending={pending}
                onOpen={() => {
                  onEdit(p);
                }}
                onToggleVisible={() => {
                  onToggleVisible(p);
                }}
                onEdit={() => {
                  onEdit(p);
                }}
                onDelete={() => {
                  onDelete(p);
                }}
              />
            ))}
        </div>
      )}

      {/* Create modal — wraps NewPackageForm in Radix Dialog so scroll/
       * focus/scrim are owned by the primitive. Replaced in Phase 2
       * with the new <ProductEditor>. */}
      <DialogPrimitive.Root
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => {
              e.preventDefault();
            }}
            aria-label="New product"
            className="fixed z-50 flex flex-col overflow-hidden shadow-2xl
              inset-x-0 bottom-0 max-h-[90vh] rounded-t-[var(--radius-xl)]
              sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2
              sm:w-[calc(100vw-3rem)] sm:max-w-2xl sm:max-h-[calc(100vh-3rem)]
              sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-lg)]"
          >
            <DialogPrimitive.Title className="sr-only">New product</DialogPrimitive.Title>
            <div className="flex-1 overflow-y-auto">
              <NewPackageForm
                initialCurrency={defaultCurrency}
                onClose={() => {
                  setCreating(false);
                }}
              />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Edit modal */}
      <DialogPrimitive.Root
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => {
              e.preventDefault();
            }}
            aria-label={editing ? `Edit ${editing.name}` : "Edit product"}
            className="fixed z-50 flex flex-col overflow-hidden shadow-2xl
              inset-x-0 bottom-0 max-h-[90vh] rounded-t-[var(--radius-xl)]
              sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2
              sm:w-[calc(100vw-3rem)] sm:max-w-2xl sm:max-h-[calc(100vh-3rem)]
              sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-lg)]"
          >
            <DialogPrimitive.Title className="sr-only">
              {editing ? `Edit ${editing.name}` : "Edit product"}
            </DialogPrimitive.Title>
            <div className="flex-1 overflow-y-auto">
              {editing ? (
                <NewPackageForm
                  initialValues={toInitialValues(editing)}
                  onClose={() => {
                    setEditing(null);
                  }}
                />
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/store-screen.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/store-screen.test.tsx
git commit -m "feat(store): add StoreScreen composition + keyboard"
```

---

## Task 16: `/dashboard/store/page.tsx` server component

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/page.tsx`

**Step 1: Failing test (regression carryover)**

Create `apps/web/src/app/(producer)/dashboard/store/__tests__/page.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("dashboard/store/page.tsx", () => {
  it("authenticates via Clerk and redirects unauthenticated visitors", () => {
    expect(SRC).toMatch(/auth\(\)/);
    expect(SRC).toMatch(/redirect\("\/sign-in"\)/);
  });

  it("calls booking.packages.list and producer.me via the server caller", () => {
    expect(SRC).toMatch(/booking\.packages\.list/);
    expect(SRC).toMatch(/producer\.me/);
  });

  it("mounts <StoreScreen>", () => {
    expect(SRC).toMatch(/<StoreScreen/);
  });
});
```

**Step 2: Run, FAIL** (page does not exist).

**Step 3: Implement**

```tsx
// page.tsx
//
// Producer Store catalog. Server component that fetches the product
// list + producer profile and hands them to <StoreScreen>. Mirrors the
// shape used by the legacy /dashboard/profile?tab=store page so the
// data layer stays untouched.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import type { Currency } from "~/app/(producer)/dashboard/booking/package-form";
import { appRouter } from "~/server/trpc/routers/_app";

import { StoreScreen, type StoreProduct } from "./store-screen";

export default async function StorePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [packages, profile] = await Promise.all([
    caller.booking.packages.list(),
    caller.producer.me(),
  ]);

  const products: StoreProduct[] = packages.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    currency: p.currency,
    active: p.active,
    kind: p.kind,
    depositPct: p.depositPct,
    durationMin: p.durationMin,
    sessionCount: p.sessionCount,
    paymentPlans: p.paymentPlans,
    locationType: p.locationType,
    bufferMinutes: p.bufferMinutes,
    minLeadHours: p.minLeadHours,
    contractUrl: p.contractUrl,
  }));

  const VALID = ["USD", "EUR", "GBP", "ILS"] as const;
  const defaultCurrency: Currency = (VALID as readonly string[]).includes(
    profile.defaultCurrency,
  )
    ? (profile.defaultCurrency as Currency)
    : "USD";

  return <StoreScreen products={products} defaultCurrency={defaultCurrency} />;
}
```

**Step 4: Run, PASS.**

**Step 5: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/page.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/page.test.ts
git commit -m "feat(store): mount /dashboard/store server page"
```

---

## Task 17: Move portfolio to `/dashboard/portfolio`

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/portfolio/page.tsx`
- Create: `apps/web/src/app/(producer)/dashboard/portfolio/portfolio-panel.tsx` (moved from `/profile/`)
- Create: `apps/web/src/app/(producer)/dashboard/portfolio/actions.ts` (moved from `/profile/`)

**Step 1: Failing test**

Create `apps/web/src/app/(producer)/dashboard/portfolio/__tests__/page.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("dashboard/portfolio/page.tsx", () => {
  it("calls portfolio.list, producerExternalLinks.list, library.list", () => {
    expect(SRC).toMatch(/portfolio\.list/);
    expect(SRC).toMatch(/producerExternalLinks\.list/);
    expect(SRC).toMatch(/library\.list/);
  });

  it("mounts <PortfolioPanel>", () => {
    expect(SRC).toMatch(/<PortfolioPanel/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement**

Move the existing files via `git mv`:

```bash
git mv apps/web/src/app/\(producer\)/dashboard/profile/portfolio-panel.tsx \
       apps/web/src/app/\(producer\)/dashboard/portfolio/portfolio-panel.tsx
git mv apps/web/src/app/\(producer\)/dashboard/profile/actions.ts \
       apps/web/src/app/\(producer\)/dashboard/portfolio/actions.ts
```

Update the moved `actions.ts`:
- Change `const PROFILE_PATH = "/dashboard/profile";` to `const PORTFOLIO_PATH = "/dashboard/portfolio";`
- Update every `revalidatePath(PROFILE_PATH)` to `revalidatePath(PORTFOLIO_PATH)`

Then create `apps/web/src/app/(producer)/dashboard/portfolio/page.tsx`:

```tsx
// page.tsx
//
// Producer Portfolio. Tracks + external links. Lifted from the
// /dashboard/profile?tab=portfolio composition; content unchanged.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import type { PortfolioTrackRow } from "~/components/dashboard/setup/portfolio-section";
import { appRouter } from "~/server/trpc/routers/_app";

import {
  PortfolioPanel,
  type ExternalLinkRow,
  type LibraryPickRow,
} from "./portfolio-panel";

export default async function PortfolioPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [tracks, links, library] = await Promise.all([
    caller.portfolio.list(),
    caller.producerExternalLinks.list(),
    caller.library.list(),
  ]);

  const portfolioTracks: PortfolioTrackRow[] = tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    isPublicSample: t.isPublicSample,
  }));
  const addedAudioUrls = tracks
    .map((t) => t.audioUrl)
    .filter((u): u is string => Boolean(u));
  const externalLinks: ExternalLinkRow[] = links.map((l) => ({
    id: l.id,
    platform: l.platform,
    url: l.url,
    title: l.title,
  }));
  const libraryRows: LibraryPickRow[] = library.map((r) => ({
    versionId: r.versionId,
    trackTitle: r.trackTitle,
    projectTitle: r.projectTitle,
    artistName: r.projectArtistName,
    audioUrl: r.audioUrl,
    uploadedAt: r.uploadedAt.toISOString(),
  }));

  return (
    <div className="sk-page-enter mx-auto max-w-[1100px] px-4 pt-6 pb-24 sm:px-6 sm:pt-10">
      <header className="mb-6">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          PORTFOLIO
        </p>
        <h1
          className="mt-2 font-display font-extrabold leading-[0.96] tracking-[-0.035em] text-[rgb(var(--fg-default))]"
          style={{ fontSize: "clamp(48px, 11vw, 96px)" }}
        >
          Portfolio<span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
        </h1>
      </header>
      <PortfolioPanel
        tracks={portfolioTracks}
        links={externalLinks}
        library={libraryRows}
        addedAudioUrls={addedAudioUrls}
      />
    </div>
  );
}
```

**Step 4: Run, PASS.**

```bash
pnpm -F web typecheck
```
Expected: PASS, no broken imports.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(portfolio): move /profile portfolio content to /dashboard/portfolio"
```

---

## Task 18: Replace `/dashboard/profile` with redirects

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/profile/page.tsx`
- Delete: `apps/web/src/app/(producer)/dashboard/profile/profile-tabs.tsx`
- Delete: `apps/web/src/app/(producer)/dashboard/profile/profile-tab-key.ts`
- Delete: `apps/web/src/app/(producer)/dashboard/profile/store-panel.tsx`

**Step 1: Failing test**

Create `apps/web/src/app/(producer)/dashboard/profile/__tests__/redirect.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("/dashboard/profile redirect shim", () => {
  it("permanent-redirects to /dashboard/store by default", () => {
    expect(SRC).toMatch(/permanentRedirect|redirect\(["']\/dashboard\/store["']/);
  });

  it("redirects ?tab=portfolio to /dashboard/portfolio", () => {
    expect(SRC).toMatch(/portfolio/);
    expect(SRC).toMatch(/\/dashboard\/portfolio/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Implement** (overwrite `page.tsx`):

```tsx
// page.tsx
//
// /dashboard/profile is a legacy URL kept alive only as a redirect.
// New design lives at /dashboard/store; the old portfolio tab moved to
// /dashboard/portfolio.

import { permanentRedirect } from "next/navigation";

export default async function ProfileRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  if (tab === "portfolio") permanentRedirect("/dashboard/portfolio");
  permanentRedirect("/dashboard/store");
}
```

Delete the dead siblings:

```bash
git rm apps/web/src/app/\(producer\)/dashboard/profile/profile-tabs.tsx \
       apps/web/src/app/\(producer\)/dashboard/profile/profile-tab-key.ts \
       apps/web/src/app/\(producer\)/dashboard/profile/store-panel.tsx
```

**Step 4: Run, PASS + typecheck:**

```bash
pnpm -F web test -- run "dashboard/profile/__tests__/redirect"
pnpm -F web typecheck
```

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(profile): redirect legacy /dashboard/profile URLs"
```

---

## Task 19: Update sidebar + bottom-nav with Portfolio

**Files:**
- Modify: `apps/web/src/components/nav/producer-sidebar.tsx`
- Modify: `apps/web/src/components/nav/producer-bottom-nav.tsx`

**Step 1: Failing test**

Create `apps/web/src/components/nav/__tests__/producer-nav.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, "..", "producer-sidebar.tsx"), "utf8");
const BOTTOM = readFileSync(join(here, "..", "producer-bottom-nav.tsx"), "utf8");

describe("producer nav: Store + Portfolio", () => {
  it("sidebar Store entry hrefs to /dashboard/store", () => {
    expect(SIDEBAR).toMatch(/href:\s*["']\/dashboard\/store["']/);
  });

  it("sidebar contains a Portfolio entry hrefing to /dashboard/portfolio", () => {
    expect(SIDEBAR).toMatch(/label:\s*["']Portfolio["']/);
    expect(SIDEBAR).toMatch(/href:\s*["']\/dashboard\/portfolio["']/);
  });

  it("bottom-nav Store entry hrefs to /dashboard/store", () => {
    expect(BOTTOM).toMatch(/href:\s*["']\/dashboard\/store["']/);
  });

  it("bottom-nav contains a Portfolio entry hrefing to /dashboard/portfolio", () => {
    expect(BOTTOM).toMatch(/label:\s*["']Portfolio["']/);
    expect(BOTTOM).toMatch(/href:\s*["']\/dashboard\/portfolio["']/);
  });

  it("nav files contain no leftover /dashboard/profile hrefs", () => {
    expect(SIDEBAR).not.toMatch(/href:\s*["']\/dashboard\/profile["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/profile["']/);
  });
});
```

**Step 2: Run, FAIL.**

**Step 3: Edit nav files**

In `producer-sidebar.tsx` (line ~80):
- Change `href: "/dashboard/profile"` to `href: "/dashboard/store"`
- Insert a new entry after Store: `{ id: "portfolio", label: "Portfolio", labelKey: "portfolio", href: "/dashboard/portfolio", icon: <pick existing icon — e.g. "music" or "user">, shortcut: "G P" }`
- (Pick the icon name from the icon registry already in use in the file. If unsure, mirror what other nav items use.)

In `producer-bottom-nav.tsx` (line ~45):
- Change `href: "/dashboard/profile"` to `href: "/dashboard/store"`
- Insert a new entry: `{ id: "portfolio", label: "Portfolio", href: "/dashboard/portfolio", icon: <existing icon name> }`

**Step 4: Run, PASS:**

```bash
pnpm -F web test -- run producer-nav
pnpm -F web typecheck
```

**Step 5: Commit**

```bash
git add apps/web/src/components/nav/producer-sidebar.tsx \
        apps/web/src/components/nav/producer-bottom-nav.tsx \
        apps/web/src/components/nav/__tests__/producer-nav.test.ts
git commit -m "feat(nav): split Storefront into Store + Portfolio in sidebar + bottom-nav"
```

---

## Task 20: Delete legacy `storefront-screen.tsx` + its old test

**Files:**
- Delete: `apps/web/src/components/dashboard/storefront/storefront-screen.tsx`
- Delete: `apps/web/src/components/dashboard/storefront/__tests__/storefront-screen.test.ts`
- Delete: `apps/web/src/components/dashboard/storefront/` (entire folder if empty after the delete)

**Step 1: Verify no remaining imports**

Run:
```bash
grep -rn "components/dashboard/storefront" "/Users/giliasraf/Skitza 16.4/apps/web/src" || echo "clean"
```
Expected: only `clean` (or only the file we're about to delete).

**Step 2: Delete the files**

```bash
git rm -r apps/web/src/components/dashboard/storefront
```

**Step 3: Verify typecheck still passes**

```bash
pnpm -F web typecheck
```
Expected: PASS.

**Step 4: Commit**

```bash
git commit -m "refactor(storefront): remove legacy storefront-screen replaced by /dashboard/store"
```

---

## Task 21: Final pipeline + manual verification

**Files:** none

**Step 1: Run the full Skitza pipeline**

```bash
pnpm -F web typecheck
pnpm -F web lint
pnpm -F web test
```

Each must PASS. If lint flags anything, fix the source, re-run, re-commit.

**Step 2: Start preview and verify in the browser**

Run:
```bash
pnpm -F web dev
```

Open `http://localhost:3000/dashboard/store` and check:
- [ ] CATALOG eyebrow is uppercase, tracked
- [ ] `Store.` wordmark is huge, the dot is brand-amber
- [ ] Counts line shows live + hidden numbers
- [ ] `+ New product` button is amber, has the `N` chip
- [ ] Filter tabs with counts (All / Live / Hidden)
- [ ] Search input has the `/` chip; pressing `/` focuses it
- [ ] Cards / Table toggle visible; Table shows as disabled with "Coming soon" tooltip
- [ ] Each product card has a type tile in the right gradient color, name, tagline (first line of description), price
- [ ] Hover on a card lifts it and shows the accent stripe
- [ ] Toggle flips visibility and toasts
- [ ] Edit opens the existing form
- [ ] Delete prompts a native confirm and archives the product
- [ ] Pressing `N` opens the new-product form
- [ ] Pressing `Esc` closes the modal
- [ ] `/dashboard/profile` redirects to `/dashboard/store`
- [ ] `/dashboard/profile?tab=portfolio` redirects to `/dashboard/portfolio`
- [ ] `/dashboard/portfolio` renders tracks + external links exactly as before
- [ ] Sidebar shows Store + Portfolio as separate entries

**Step 3: Push the branch and open PR**

```bash
git push origin phase-1-store-redesign
gh pr create --base v3-clean --title "feat(store): producer storefront redesign, Phase 1 visual shell" --body "$(cat <<'EOF'
## Summary
- Replaces /dashboard/profile?tab=store with new design at /dashboard/store
- Moves portfolio content to its own page at /dashboard/portfolio
- New components: TypeTile, Toggle, SegmentedTabs, ViewToggle, ProductCard, StoreHeader, StoreToolbar, StoreScreen, NewProductButton, SearchInput, EmptyState, KeyboardHintChip
- Keyboard: / focuses search, N opens new-product, Esc closes modals
- Edit and Create still mount the existing NewPackageForm (replaced in Phase 2)
- Delete uses native confirm in Phase 1 (modal + Undo lands in Phase 2)
- Cards / Table toggle visible, Table disabled until Phase 3
- Old /dashboard/profile permanently redirects

Design brief: docs/plans/active/2026-05-10-storefront-redesign-design.md
Implementation plan: docs/plans/active/2026-05-10-storefront-redesign-phase-1.md

## Test plan
- [ ] All vitest suites pass
- [ ] Typecheck + lint clean
- [ ] /dashboard/store renders with type tiles and counts
- [ ] / and N keyboard shortcuts work
- [ ] /dashboard/profile redirects in incognito (no service-worker cache)
- [ ] Portfolio still works at /dashboard/portfolio

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 4: Verify on Vercel preview deploy**

After CI is green, open the preview URL in **Incognito** (per `feedback_skitza_sw_cache_on_deploy.md` memory). Confirm the same checklist as Step 2 against the deployed app.

---

## Done criteria (Phase 1)

- [x] All 21 tasks committed individually
- [x] Typecheck + lint + test pipeline clean
- [x] Manual verification on `localhost:3000` and Vercel preview
- [x] PR opened against `v3-clean`, not `main`
- [x] No regression in toggle / edit / duplicate / archive flows
- [x] Phase 2 + 3 design preserved in the design brief for the next plan
