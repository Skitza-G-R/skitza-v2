# Producer Storefront Redesign, Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (or run inline via `superpowers:subagent-driven-development` from the controller session). Phase 1 + 2 already ship in the same branch; Phase 3 lands additively before the PR is opened against `v3-clean`.

**Goal:** Add drag-to-reorder, a functional Table view, and the two animation polish details (Live status pulse + new-product shimmer-glow) so the producer Store page matches the prototype `storefront.html` end-to-end. After Phase 3, the `phase-1-store-redesign` branch is feature-complete and ready for a polish pass + the final PR.

**Architecture:** Drag is **native HTML5 DnD** — a small `useDragReorder` hook owns `dragId` + `dropTarget = {id, position: "above" | "below"}` and exposes per-card handlers. The card's drop indicator is a 3px brand-color line drawn via a pseudo-element when `dropTarget.id === product.id`. On `drop`, the screen optimistically reorders its local state and calls `reorderProducts(orderedIds[])`, which fans the new order into `products.position` in a single transaction; on server error the optimistic state reverts. The Table view is a separate `<StoreTable>` container that renders `<ProductRow>` rows in a 5-column grid; click-anywhere opens the editor. Animations are pure CSS keyframes added to `globals.css` (`sk-live-pulse`, `sk-shimmer-glow`, `sk-row-in`), gated by `prefers-reduced-motion`.

**Tech stack (no new deps):** Next.js 15 App Router, React 19, Tailwind v4, Lucide React, tRPC v11, Drizzle, Vitest (node env, source-grep tests). All primitives from Phase 1 + 2 are reused. No `dnd-kit` or other drag libraries — native DnD only, per the design brief.

**Source design brief:** `docs/plans/active/2026-05-10-storefront-redesign-design.md` (§7).

**Prototype reference:** `/Volumes/KINGSTON/Downloads/design_handoff_storefront/storefront.html`
- `livePulse` keyframe: line 95
- `shimmer-glow` keyframe: line 158, `.new-glow` selector line 159
- `.product-card.is-dragging` rule: line 40
- `.drag-handle` cursor + opacity rules: lines 52–54
- `.table-wrap` / `.table-head` / `.table-row`: lines 97–106
- `rowIn` 320ms staggered: line 104 (`animation: rowIn 320ms`)
- React `dragId` + `dropTarget` state + `reorderTo()`: lines 337–540
- Card-level `draggable` attribute + drag handlers: line 676 onward

**Critical constraints (per Gili's calls in chat 2026-05-11):**
1. **Native HTML5 DnD only.** No `dnd-kit`, `react-beautiful-dnd`, or anything similar. Keeps deps tight and matches the prototype 1:1.
2. **Mobile drag is hidden.** `@media (hover: none)` hides the drag handle entirely. Producer surface is desktop-only per `CLAUDE.md`; touch drag isn't worth fighting native DnD's touch quirks for.
3. **`prefers-reduced-motion: reduce` disables the new keyframes** (pulse + shimmer-glow + row stagger). The `popIn` modal animation from Phase 2 already respects this via the existing `@media (prefers-reduced-motion: reduce)` block in `globals.css`.

---

## Pre-flight findings (verified 2026-05-11 before plan was sealed)

1. **`products.position`** is a real column. Declared at `packages/db/src/schema.ts:158` as `position: integer("position").notNull().default(0)` inside the `products` pgTable (lines 138–213). Drizzle's `$inferSelect` already includes it; the Phase 1 page fetch can pass it through without a schema change.
2. **No existing `reorder` mutation on `booking.packages`.** The router (`apps/web/src/server/trpc/routers/booking.ts`) exposes `list`, `create`, `update`, `archive`, `restore`, `deactivate`, `setActive`, `duplicate`. The new `reorder` mutation sits next to `restore` (line 534) and follows the same `producerProcedure` shape: input zod `{ orderedIds: z.array(z.string().uuid()).min(1) }`, ownership check against `products.producerId === ctx.producerId`, then a single `tx` that updates every row in one round trip.
3. **`<ProductCard>` already has the drag-handle visual.** The `<GripVertical>` icon at `apps/web/src/app/(producer)/dashboard/store/product-card.tsx:82-84` has `cursor: grab` and `opacity 0.3 → 1` on hover. Phase 3 wires the actual drag attributes and handlers; the visual is already correct.
4. **`<ViewToggle>` already has an `enableTable` prop, currently passed `false`.** `apps/web/src/app/(producer)/dashboard/store/view-toggle.tsx:20`. When `enableTable=false`, the Table button is `disabled`/`aria-disabled` with a "Coming soon" tooltip. Phase 3 flips the prop to `true` after `<StoreTable>` lands.
5. **Existing `<StoreScreen>` filters by `live` / `hidden` arrays from `filtered`** (lines 74–76). Drag reordering operates on the source `products` array via `position`. After a successful reorder, the optimistic state mutates the local copy of `products`, and the existing `live` / `hidden` split re-derives. No new state shape required.
6. **Keyframes live in `apps/web/src/app/globals.css`** under `@layer base { ... }`. The file has many existing keyframes already (`skitza-reveal-up`, `skitza-pop-in`, `pulse-glow`, etc., lines 358–929). Phase 3 adds three new ones near the bottom of the `@layer base` block. Naming convention: existing ones are mixed (`skitza-pop-in` prefixed, `pulse-glow` bare) — Phase 3 uses `sk-` prefix for the new ones (`sk-live-pulse`, `sk-shimmer-glow`, `sk-row-in`) to namespace them clearly under the Skitza app shell.
7. **Existing `archivePackage` / `restorePackage` / `setPackageActive` pattern** at `apps/web/src/app/(producer)/dashboard/booking/actions.ts:130-199` is the template for the new `reorderProducts` server action. Wraps `callerOrError()` → calls `caller.booking.packages.reorder` → `revalidatePath(PATH)` + `revalidatePath("/dashboard/store")`.
8. **No existing Duplicate button on the new card.** The Phase 3 design brief mentions `shimmer-glow on duplicate/create` (§7.4) but the new `<ProductCard>` only has Edit + Delete in the action row — no Duplicate trigger exists yet on the new design. Phase 3 ships `sk-shimmer-glow` keyed off **create only**. The duplicate-trigger UI + animation is deferred to a future PR (or, if Gili wants it in the polish pass, it lands as a Phase 3.5 task). Recorded in §Out of scope.

---

## Phase 3a — Drag-to-reorder (Tasks P3-1 to P3-6)

### Task P3-1: `booking.packages.reorder` tRPC mutation

**Files:**
- Modify: `apps/web/src/server/trpc/routers/booking.ts` (add `reorder` next to `restore` on the `packages` router, around line 552)
- Test: `apps/web/src/server/trpc/routers/__tests__/booking-packages-reorder.test.ts`

**Step 1: Write the failing test (source-grep + zod-input intent test)**

The integration test pattern in this repo for tRPC mutations is source-grep, not a live DB roundtrip — same as the Phase 2 `restore` test.

```ts
// apps/web/src/server/trpc/routers/__tests__/booking-packages-reorder.test.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "booking.ts"), "utf8");

describe("booking.packages.reorder mutation", () => {
  it("exists as a producerProcedure on the packages router", () => {
    expect(SRC).toMatch(/reorder:\s*producerProcedure/);
  });

  it("accepts an orderedIds array of uuids", () => {
    expect(SRC).toMatch(/orderedIds:\s*z\.array\(\s*z\.string\(\)\.uuid\(\)/);
  });

  it("enforces producer ownership before writing", () => {
    // The mutation should verify every id belongs to ctx.producerId.
    expect(SRC).toMatch(/reorder[\s\S]{0,600}producerId/);
  });

  it("writes the new positions in a single transaction", () => {
    expect(SRC).toMatch(/reorder[\s\S]{0,800}ctx\.db\.transaction/);
  });
});
```

Run: `pnpm -F web test -- run booking-packages-reorder`. Expect FAIL ("reorder: producerProcedure" not found).

**Step 2: Implement** — drop this immediately after the `restore` mutation (line 551), before `deactivate`:

```ts
// Phase 3 store redesign — drag-to-reorder. Writes the new ordinals
// in one transaction so a partial failure can't leave the list
// half-reordered. Producer ownership is verified by selecting all
// row producerIds in one query and asserting equality before any
// write. Idempotent: calling with the same order is a no-op.
reorder: producerProcedure
  .input(z.object({ orderedIds: z.array(z.string().uuid()).min(1) }))
  .mutation(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({ id: products.id, producerId: products.producerId })
      .from(products)
      .where(inArray(products.id, input.orderedIds));
    if (rows.length !== input.orderedIds.length) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    if (rows.some((r) => r.producerId !== ctx.producerId)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    await ctx.db.transaction(async (tx) => {
      for (const [idx, id] of input.orderedIds.entries()) {
        await tx
          .update(products)
          .set({ position: idx })
          .where(eq(products.id, id));
      }
    });
    return { ok: true as const };
  }),
```

Note: `inArray` may need adding to the existing `drizzle-orm` imports at the top of the file. Confirm before writing.

Run test: `pnpm -F web test -- run booking-packages-reorder`. Expect PASS.

**Step 3: Commit**

```bash
git add apps/web/src/server/trpc/routers/booking.ts \
        apps/web/src/server/trpc/routers/__tests__/booking-packages-reorder.test.ts
git commit -m "feat(booking): add packages.reorder mutation for drag-to-reorder"
```

---

### Task P3-2: `reorderProducts` server action

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/booking/actions.ts` (append after `restorePackage`, line 199)
- Test: `apps/web/src/app/(producer)/dashboard/booking/__tests__/reorder-products.test.ts`

**Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "actions.ts"), "utf8");

describe("reorderProducts server action", () => {
  it("exports a reorderProducts function", () => {
    expect(SRC).toMatch(/export\s+async\s+function\s+reorderProducts/);
  });

  it("calls the tRPC packages.reorder mutation", () => {
    expect(SRC).toMatch(/booking\.packages\.reorder/);
  });

  it("revalidates the /dashboard/store path on success", () => {
    expect(SRC).toMatch(/reorderProducts[\s\S]{0,400}revalidatePath\(["']\/dashboard\/store["']\)/);
  });
});
```

Run: FAIL.

**Step 2: Implement** — mirror `restorePackage` (line 187) exactly:

```ts
// Phase 3 store redesign — drag-to-reorder. Persists the new product
// order via the booking.packages.reorder mutation. Caller is the
// drag-reorder hook in <StoreScreen>; revalidates both legacy
// /dashboard/profile and the new /dashboard/store so the next read
// reflects the new order.
export async function reorderProducts(input: {
  orderedIds: string[];
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.reorder(input);
    revalidatePath(PATH);
    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/store");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
```

Run test: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/booking/actions.ts \
        apps/web/src/app/\(producer\)/dashboard/booking/__tests__/reorder-products.test.ts
git commit -m "feat(booking): add reorderProducts server action"
```

---

### Task P3-3: `useDragReorder` hook

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/use-drag-reorder.ts`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/use-drag-reorder.test.ts`

The hook is a thin state machine. It does NOT call the server — `<StoreScreen>` is the one that owns the optimistic state + server call. The hook is pure UI plumbing.

**Step 1: Write the failing test (pure-function intent)**

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeNewOrder } from "../use-drag-reorder";

describe("computeNewOrder", () => {
  const ids = ["a", "b", "c", "d", "e"];

  it("moves an id above a target", () => {
    expect(computeNewOrder(ids, "d", "b", "above")).toEqual(["a", "d", "b", "c", "e"]);
  });

  it("moves an id below a target", () => {
    expect(computeNewOrder(ids, "d", "b", "below")).toEqual(["a", "b", "d", "c", "e"]);
  });

  it("returns the input unchanged when source equals target", () => {
    expect(computeNewOrder(ids, "c", "c", "above")).toEqual(ids);
  });

  it("returns the input unchanged when the source id is missing", () => {
    expect(computeNewOrder(ids, "zzz", "b", "above")).toEqual(ids);
  });

  it("returns the input unchanged when the target id is missing", () => {
    expect(computeNewOrder(ids, "a", "zzz", "above")).toEqual(ids);
  });

  it("moves the first item to the end via below-last", () => {
    expect(computeNewOrder(ids, "a", "e", "below")).toEqual(["b", "c", "d", "e", "a"]);
  });
});

// Source-grep that the hook exposes the expected handler shape.
const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "use-drag-reorder.ts"), "utf8");

describe("useDragReorder hook", () => {
  it("returns dragId and dropTarget state", () => {
    expect(SRC).toMatch(/dragId/);
    expect(SRC).toMatch(/dropTarget/);
  });

  it("exposes onDragStart, onDragOver, onDragEnd, onDrop handlers", () => {
    expect(SRC).toMatch(/onDragStart/);
    expect(SRC).toMatch(/onDragOver/);
    expect(SRC).toMatch(/onDragEnd/);
    expect(SRC).toMatch(/onDrop/);
  });

  it("calls back on a successful drop with (fromId, toId, position)", () => {
    expect(SRC).toMatch(/onReorder\s*\(/);
  });
});
```

Run: FAIL (file doesn't exist).

**Step 2: Implement**

```ts
// use-drag-reorder.ts
//
// Native HTML5 drag-and-drop state machine for the Store catalog.
//
// Pure UI plumbing: tracks the dragging row + the current drop target
// (target id + "above" / "below"). The consumer (StoreScreen) owns the
// optimistic list state and the server call. We deliberately don't call
// the server here — keeping the hook synchronous-only means tests stay
// pure and the consumer can revert on error without coupling.
//
// `computeNewOrder` is exported so it can be unit-tested in isolation:
// move `fromId` immediately above-or-below `toId` in the array, no-op
// when ids are equal or missing.

"use client";

import { useCallback, useState } from "react";

export type DropPosition = "above" | "below";

export interface DropTarget {
  id: string | null;
  position: DropPosition | null;
}

export interface UseDragReorderArgs {
  onReorder: (fromId: string, toId: string, position: DropPosition) => void;
}

export interface DragRowHandlers {
  isDragging: boolean;
  dropPosition: DropPosition | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
}

export function computeNewOrder(
  ids: readonly string[],
  fromId: string,
  toId: string,
  position: DropPosition,
): string[] {
  if (fromId === toId) return [...ids];
  const fromIdx = ids.indexOf(fromId);
  const toIdx = ids.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return [...ids];
  const without = ids.filter((id) => id !== fromId);
  const targetIdx = without.indexOf(toId);
  const insertAt = position === "above" ? targetIdx : targetIdx + 1;
  return [
    ...without.slice(0, insertAt),
    fromId,
    ...without.slice(insertAt),
  ];
}

export function useDragReorder({ onReorder }: UseDragReorderArgs) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>({
    id: null,
    position: null,
  });

  const reset = useCallback(() => {
    setDragId(null);
    setDropTarget({ id: null, position: null });
  }, []);

  const getHandlersFor = useCallback(
    (rowId: string): DragRowHandlers => ({
      isDragging: dragId === rowId,
      dropPosition: dropTarget.id === rowId ? dropTarget.position : null,
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", rowId);
        setDragId(rowId);
      },
      onDragOver: (e) => {
        if (!dragId || dragId === rowId) return;
        e.preventDefault();
        // Decide above-or-below by which half of the row the cursor is in.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isAbove = e.clientY < rect.top + rect.height / 2;
        const next: DropPosition = isAbove ? "above" : "below";
        setDropTarget((prev) =>
          prev.id === rowId && prev.position === next ? prev : { id: rowId, position: next },
        );
      },
      onDragEnd: () => {
        reset();
      },
      onDrop: (e) => {
        e.preventDefault();
        const from = dragId;
        const position = dropTarget.position;
        if (from && position && from !== rowId) {
          onReorder(from, rowId, position);
        }
        reset();
      },
    }),
    [dragId, dropTarget, onReorder, reset],
  );

  return { getHandlersFor };
}
```

Run test: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/use-drag-reorder.ts \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/use-drag-reorder.test.ts
git commit -m "feat(store): add useDragReorder hook with native HTML5 DnD"
```

---

### Task P3-4: Phase 3 animation keyframes in `globals.css`

**Files:**
- Modify: `apps/web/src/app/globals.css` (append the three new keyframes near the bottom of `@layer base`, around line 930 — after `confetti-fall`)

The new keyframes are pure CSS — no test file is strictly necessary, but we add one source-grep test to pin the names exist (so future refactors don't accidentally drop them).

**Test:** `apps/web/src/app/__tests__/globals-phase3-keyframes.test.ts`

**Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "globals.css"), "utf8");

describe("Phase 3 keyframes in globals.css", () => {
  it("defines sk-live-pulse for the Live status dot", () => {
    expect(SRC).toMatch(/@keyframes\s+sk-live-pulse/);
  });

  it("defines sk-shimmer-glow for newly-created products", () => {
    expect(SRC).toMatch(/@keyframes\s+sk-shimmer-glow/);
  });

  it("defines sk-row-in for table row entry stagger", () => {
    expect(SRC).toMatch(/@keyframes\s+sk-row-in/);
  });

  it("honors prefers-reduced-motion for the Phase 3 keyframes", () => {
    // Skitza already has a global `prefers-reduced-motion: reduce` block;
    // confirm the new animation utility classes are referenced inside it.
    expect(SRC).toMatch(/prefers-reduced-motion[\s\S]{0,2000}sk-(live-pulse|shimmer-glow|row-in)/);
  });
});
```

Run: FAIL.

**Step 2: Implement** — append inside `@layer base { ... }`, around line 930. Match the prototype's `livePulse` (line 95) + `shimmer-glow` (line 158) + `rowIn` (line 104):

```css
/* Phase 3 store redesign — Live status pulse, shimmer-glow on new
   products, table-row entry stagger. All three respect prefers-
   reduced-motion via the existing global block at the end of base. */
@keyframes sk-live-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgb(var(--fg-success) / 0.45); }
  50%      { box-shadow: 0 0 0 5px rgb(var(--fg-success) / 0); }
}
@keyframes sk-shimmer-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgb(var(--brand-primary) / 0.4); }
  50%      { box-shadow: 0 0 0 6px rgb(var(--brand-primary) / 0); }
}
@keyframes sk-row-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.sk-live-pulse   { animation: sk-live-pulse 2.2s ease-in-out infinite; }
.sk-shimmer-glow { animation: sk-shimmer-glow 2s ease-in-out 2; }
.sk-row-in       { animation: sk-row-in 320ms cubic-bezier(.16,1,.3,1) both; }
```

Then add to the existing `prefers-reduced-motion: reduce` block (find via grep — likely near the top of `globals.css`):

```css
.sk-live-pulse,
.sk-shimmer-glow,
.sk-row-in { animation: none !important; }
```

If no such block exists yet, add it next to the new keyframes:

```css
@media (prefers-reduced-motion: reduce) {
  .sk-live-pulse,
  .sk-shimmer-glow,
  .sk-row-in { animation: none !important; }
}
```

Run test: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/globals.css \
        apps/web/src/app/__tests__/globals-phase3-keyframes.test.ts
git commit -m "feat(store): add Phase 3 keyframes (sk-live-pulse, sk-shimmer-glow, sk-row-in)"
```

---

### Task P3-5: `<ProductCard>` drag wiring + drop indicator

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/product-card.tsx`
- Modify: `apps/web/src/app/(producer)/dashboard/store/__tests__/product-card.test.tsx`

Add an optional `drag` prop to `<ProductCard>` carrying `DragRowHandlers` (from Task P3-3). When present, the card is `draggable`, registers the drag handlers, and renders a 3px drop indicator line on top or bottom depending on `dropPosition`. When absent (e.g. in tests or other surfaces) the card behaves exactly as before.

Also: hide the drag handle on touch via `@media (hover: none)`.

**Step 1: Update the test**

```tsx
// Inside product-card.test.tsx — add these expectations on top of the existing ones:
it("accepts an optional drag prop that wires draggable + handlers", () => {
  expect(SRC).toMatch(/drag\?:\s*DragRowHandlers/);
  expect(SRC).toMatch(/draggable=\{?[a-zA-Z!?]*drag/);
  expect(SRC).toMatch(/onDragStart=\{drag\.onDragStart\}/);
  expect(SRC).toMatch(/onDragOver=\{drag\.onDragOver\}/);
  expect(SRC).toMatch(/onDragEnd=\{drag\.onDragEnd\}/);
  expect(SRC).toMatch(/onDrop=\{drag\.onDrop\}/);
});

it("renders a drop indicator when dropPosition is set", () => {
  expect(SRC).toMatch(/drag\.dropPosition\s*===\s*["']above["']/);
  expect(SRC).toMatch(/drag\.dropPosition\s*===\s*["']below["']/);
  // 3px brand-color line per the design brief §7.4.
  expect(SRC).toMatch(/--brand-primary/);
});

it("hides the drag handle on touch devices", () => {
  // Tailwind's `hover:` variant maps to (hover: hover), so hidden-on-touch
  // is the absence of hover. We use Tailwind's `hover:` + a fallback class.
  expect(SRC).toMatch(/sk-drag-handle/);
});
```

Run: FAIL.

**Step 2: Implement** — three edits to `product-card.tsx`:

a) Import the type and accept the prop:

```tsx
import type { DragRowHandlers } from "./use-drag-reorder";

interface ProductCardProps {
  product: ProductCardData;
  pending?: boolean;
  drag?: DragRowHandlers;          // ← NEW
  recentlyAdded?: boolean;         // ← NEW (used by Task P3-11)
  onOpen: () => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onDelete: () => void;
}
```

b) Wire the `<article>` root:

```tsx
<article
  role="button"
  tabIndex={0}
  draggable={!!drag}
  onClick={onOpen}
  onKeyDown={(e) => {
    if (e.key === "Enter") onOpen();
  }}
  onDragStart={drag?.onDragStart}
  onDragOver={drag?.onDragOver}
  onDragEnd={drag?.onDragEnd}
  onDrop={drag?.onDrop}
  className={[
    "group relative grid items-center rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 transition-[border-color,transform,box-shadow] duration-200",
    "hover:border-[rgb(var(--border-strong))] hover:-translate-y-px hover:shadow-[0_14px_36px_-22px_rgba(17,16,9,0.28),0_2px_8px_-3px_rgba(17,16,9,0.05)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2",
    product.active ? "" : "opacity-60",
    drag?.isDragging ? "opacity-40 scale-[0.98]" : "",
    recentlyAdded ? "sk-shimmer-glow" : "",
  ].join(" ")}
  /* …existing style block… */
>
```

c) Replace the existing drag-handle span (line 82) with a `sk-drag-handle` wrapper that hides on touch + render a `<span>` drop indicator that absolute-positions to top or bottom when `drag.dropPosition` is set:

```tsx
{/* Drop indicator: 3px brand-color line above or below the row */}
{drag?.dropPosition === "above" ? (
  <span
    aria-hidden
    className="pointer-events-none absolute -top-[2px] left-2 right-2 h-[3px] rounded-full"
    style={{ background: "rgb(var(--brand-primary))" }}
  />
) : null}
{drag?.dropPosition === "below" ? (
  <span
    aria-hidden
    className="pointer-events-none absolute -bottom-[2px] left-2 right-2 h-[3px] rounded-full"
    style={{ background: "rgb(var(--brand-primary))" }}
  />
) : null}

<span
  aria-hidden
  className="sk-drag-handle text-[rgb(var(--fg-muted))] opacity-30 transition-opacity group-hover:opacity-100"
  style={{ cursor: drag ? "grab" : "default" }}
>
  <GripVertical size={16} strokeWidth={2.1} />
</span>
```

d) In `globals.css`, add the touch-hide utility (one-time):

```css
@media (hover: none) {
  .sk-drag-handle { display: none; }
}
```

(Add this near the Phase 3 keyframes block from Task P3-4 so the Phase 3 CSS stays grouped.)

Run tests: `pnpm -F web test -- run product-card`. PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/product-card.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/product-card.test.tsx \
        apps/web/src/app/globals.css
git commit -m "feat(store): wire drag handlers + drop indicator on ProductCard"
```

---

### Task P3-6: `<StoreScreen>` drag integration (optimistic + revert)

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/store-screen.tsx`
- Modify: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-screen.test.tsx`

This is the wiring step. `<StoreScreen>` owns optimistic state and the server call.

**Step 1: Update test**

```tsx
// Append to store-screen.test.tsx:
it("uses the useDragReorder hook", () => {
  expect(SRC).toMatch(/useDragReorder/);
});

it("calls reorderProducts with the new orderedIds on drop", () => {
  expect(SRC).toMatch(/reorderProducts\(/);
  expect(SRC).toMatch(/orderedIds:/);
});

it("passes drag handlers into each ProductCard", () => {
  expect(SRC).toMatch(/drag=\{?[a-zA-Z(]*getHandlersFor/);
});
```

Run: FAIL.

**Step 2: Implement** — three changes to `store-screen.tsx`:

a) Replace the `products` prop with a local mirror so we can mutate optimistically. The Phase 2 file uses `products` directly from props — Phase 3 introduces a local `optimisticProducts` state that the drag-reorder hook + revert path mutate:

```tsx
// Existing: const counts = useMemo(() => countByFilter(products), [products]);
// Replace with:
const [optimisticProducts, setOptimisticProducts] = useState(products);

// Keep the local state in sync if the server-rendered props change
// (e.g. after a router.refresh()). Effect is one-shot per prop ref.
useEffect(() => {
  setOptimisticProducts(products);
}, [products]);

const counts = useMemo(() => countByFilter(optimisticProducts), [optimisticProducts]);
const filtered = useMemo(
  () => filterAndSearch(optimisticProducts, filter, search),
  [optimisticProducts, filter, search],
);
```

b) Wire `useDragReorder`:

```tsx
import { reorderProducts } from "~/app/(producer)/dashboard/booking/actions";
import { computeNewOrder, useDragReorder } from "./use-drag-reorder";

// …inside StoreScreen…
const { getHandlersFor } = useDragReorder({
  onReorder: (fromId, toId, position) => {
    setOptimisticProducts((prev) => {
      const ids = prev.map((p) => p.id);
      const nextIds = computeNewOrder(ids, fromId, toId, position);
      const byId = new Map(prev.map((p) => [p.id, p]));
      return nextIds
        .map((id) => byId.get(id))
        .filter((p): p is StoreProduct => p !== undefined);
    });
    // Fire-and-forget server call; revert on error.
    const orderedIds = (() => {
      const ids = optimisticProducts.map((p) => p.id);
      return computeNewOrder(ids, fromId, toId, position);
    })();
    startTransition(async () => {
      const res = await reorderProducts({ orderedIds });
      if (!res.ok) {
        // Revert by snapping back to the server-rendered props.
        setOptimisticProducts(products);
        toast(res.error, "error");
      } else {
        router.refresh();
      }
    });
  },
});
```

Note: the `orderedIds` calculation is duplicated inside the optimistic update + the server call. That's intentional — keeping them as separate pure calls avoids closure staleness on `optimisticProducts`. The duplication is 1 line and the test pins both.

c) Pass `drag={getHandlersFor(p.id)}` into every `<ProductCard>` (both the `live` map and the `hidden` map):

```tsx
<ProductCard
  key={p.id}
  product={p}
  drag={getHandlersFor(p.id)}   // ← NEW
  pending={pending}
  /* …existing props… */
/>
```

Run typecheck + test: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/store-screen.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/store-screen.test.tsx
git commit -m "feat(store): wire drag-to-reorder with optimistic update + revert"
```

**Manual verification before moving on:**
- Drag the first card down two positions. The drop indicator line should follow the cursor's vertical half. On drop, the list re-orders immediately. A page refresh (Cmd+R) preserves the new order. If not, the server didn't accept — check the network tab for the `booking.packages.reorder` 200.

---

## Phase 3b — Functional Table view (Tasks P3-7 to P3-9)

### Task P3-7: `<ProductRow>` table row component

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/product-row.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/product-row.test.tsx`

5-column grid `minmax(0,1fr) 140px 110px 80px 130px`. Columns: NAME (with type chip + tagline beneath), TYPE label, PRICE (Syne 700 right-aligned), STATUS (live dot or "Hidden"), ACTIONS (Toggle + Edit + Delete icon buttons).

**Step 1: Failing test (source-grep)**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "product-row.tsx"), "utf8");

describe("ProductRow", () => {
  it("uses the 5-column grid template from the design brief", () => {
    expect(SRC).toMatch(/minmax\(0,\s*1fr\)\s+140px\s+110px\s+80px\s+130px/);
  });

  it("renders a small type chip with the tile gradient", () => {
    expect(SRC).toMatch(/TILE_THEME|TypeTile/);
  });

  it("renders the live dot when product.active is true", () => {
    expect(SRC).toMatch(/product\.active[\s\S]{0,200}live/);
  });

  it("opens the editor when the row body is clicked", () => {
    expect(SRC).toMatch(/onOpen/);
  });

  it("blocks action-area clicks from bubbling", () => {
    expect(SRC).toMatch(/no-card-click-block|stopPropagation/);
  });
});
```

Run: FAIL.

**Step 2: Implement** — port from the prototype `storefront.html` table-row markup (line 604 onward). Match the existing `<ProductCard>` action area structure (Toggle / Edit / Delete) and the existing tagline derivation:

```tsx
// product-row.tsx
//
// Table-view counterpart to <ProductCard>. 5-column grid matching the
// prototype's table layout. Row click opens the editor; the action
// cluster on the right is wrapped in .no-card-click-block so its
// clicks don't bubble. Type chip is a small (~28px) TypeTile.

"use client";

import { Pencil, Trash2 } from "lucide-react";

import { formatMoney } from "~/lib/format/money";
import { kindToTile } from "./kind-to-tile";
import { TILE_THEME } from "./tile-theme";
import { Toggle } from "./toggle";
import { TypeTile } from "./type-tile";
import type { ProductCardData } from "./product-card";

interface ProductRowProps {
  product: ProductCardData;
  pending?: boolean;
  onOpen: () => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function deriveTagline(description: string | null): string {
  if (!description) return "";
  return description.split("\n")[0]?.trim() ?? "";
}

export function ProductRow({
  product,
  pending = false,
  onOpen,
  onToggleVisible,
  onEdit,
  onDelete,
}: ProductRowProps) {
  const tile = kindToTile(product.kind);
  const accent = TILE_THEME[tile].accent;
  const tagline = deriveTagline(product.description);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={[
        "sk-row-in grid cursor-pointer items-center gap-[14px] border-t border-[rgb(var(--border-subtle))] px-[18px] py-3 transition-colors duration-150",
        "hover:bg-[rgb(17_16_9/0.025)]",
        "focus-visible:outline-none focus-visible:bg-[rgb(17_16_9/0.04)]",
        product.active ? "" : "opacity-60",
      ].join(" ")}
      style={{ gridTemplateColumns: "minmax(0,1fr) 140px 110px 80px 130px" }}
    >
      {/* NAME */}
      <div className="flex min-w-0 items-center gap-3">
        <TypeTile type={tile} size={28} hidden={!product.active} />
        <div className="min-w-0">
          <p className="truncate font-display text-[14px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
            {product.name || <span className="italic text-[rgb(var(--fg-faint))]">Untitled</span>}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] leading-tight text-[rgb(var(--fg-muted))]">{tagline}</p>
        </div>
      </div>

      {/* TYPE */}
      <span
        className="truncate text-[11px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: accent }}
      >
        {TILE_THEME[tile].label}
      </span>

      {/* PRICE */}
      <span className="font-display text-[16px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
        {formatMoney(product.priceCents, product.currency)}
      </span>

      {/* STATUS */}
      {product.active ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[rgb(var(--fg-success))]">
          <span
            aria-hidden
            className="sk-live-pulse inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "rgb(var(--fg-success))" }}
          />
          Live
        </span>
      ) : (
        <span className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">Hidden</span>
      )}

      {/* ACTIONS */}
      <div
        className="no-card-click-block flex items-center justify-end gap-2"
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
          aria-label={`Edit ${product.name}`}
          className="sk-press inline-flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
        >
          <Pencil size={13} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${product.name}`}
          className="sk-press inline-flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
        >
          <Trash2 size={13} strokeWidth={2.1} />
        </button>
      </div>
    </div>
  );
}
```

Note: if `tile-theme.ts` doesn't export a `label` for each tile, add it as part of this task. Quick check via `grep "label" apps/web/src/app/\(producer\)/dashboard/store/tile-theme.ts` before writing. If missing, the type chip falls back to capitalized `tile` (e.g. `MIX`).

Note: `<TypeTile>` may not accept `size={28}` yet — Phase 1 ships sizes 32 + 60. If `TypeTile` ignores a 28 prop, either add a 28 size variant OR use `size={32}` in the row (scales down slightly via Tailwind `scale-[0.875]` for visual parity).

Run test: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/product-row.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/product-row.test.tsx
git commit -m "feat(store): add ProductRow for the Table view"
```

---

### Task P3-8: `<StoreTable>` container with group dividers

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/store-table.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-table.test.tsx`

The container renders the header strip (NAME / TYPE / PRICE / STATUS / ACTIONS), the LIVE group, an optional HIDDEN group divider, and a list of `<ProductRow>` rows. Match the prototype `.table-wrap` + `.table-head` + `.table-group-label` markup (lines 97–106).

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-table.tsx"), "utf8");

describe("StoreTable", () => {
  it("renders the 5-column header strip", () => {
    expect(SRC).toMatch(/NAME/);
    expect(SRC).toMatch(/TYPE/);
    expect(SRC).toMatch(/PRICE/);
    expect(SRC).toMatch(/STATUS/);
    expect(SRC).toMatch(/ACTIONS/);
  });

  it("uses the same 5-column grid as ProductRow", () => {
    expect(SRC).toMatch(/minmax\(0,\s*1fr\)\s+140px\s+110px\s+80px\s+130px/);
  });

  it("renders LIVE / HIDDEN group dividers when both groups are non-empty", () => {
    expect(SRC).toMatch(/LIVE/);
    expect(SRC).toMatch(/HIDDEN/);
  });
});
```

Run: FAIL.

**Step 2: Implement**

```tsx
// store-table.tsx
//
// Table view of the catalog. Owns the wrap, header strip, and group
// dividers (LIVE / HIDDEN). Rows are <ProductRow>; drag isn't wired
// in the table view (drag is a card-mode affordance only — table
// reordering would compete with the click-anywhere-to-edit behavior).

"use client";

import { ProductRow } from "./product-row";
import type { StoreProduct } from "./store-screen";

interface StoreTableProps {
  live: StoreProduct[];
  hidden: StoreProduct[];
  pending?: boolean;
  showHiddenGroup: boolean;
  onOpen: (p: StoreProduct) => void;
  onToggleVisible: (p: StoreProduct) => void;
  onEdit: (p: StoreProduct) => void;
  onDelete: (p: StoreProduct) => void;
}

const GRID = "minmax(0,1fr) 140px 110px 80px 130px";

export function StoreTable({
  live,
  hidden,
  pending = false,
  showHiddenGroup,
  onOpen,
  onToggleVisible,
  onEdit,
  onDelete,
}: StoreTableProps) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[0_1px_2px_rgba(17,16,9,0.03)]">
      {/* Header strip */}
      <div
        className="grid gap-[14px] border-b border-[rgb(var(--border-subtle))] bg-[rgb(17_16_9/0.025)] px-[18px] py-[11px]"
        style={{ gridTemplateColumns: GRID }}
      >
        {["NAME", "TYPE", "PRICE", "STATUS", "ACTIONS"].map((col, idx) => (
          <span
            key={col}
            className={[
              "font-display text-[10.5px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]",
              idx === 4 ? "text-right" : "",
            ].join(" ")}
          >
            {col}
          </span>
        ))}
      </div>

      {/* LIVE group */}
      {live.length > 0 ? (
        <>
          <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(17_16_9/0.015)] px-[18px] pt-[10px] pb-[6px] font-display text-[10px] font-bold uppercase tracking-[0.1em] text-[rgb(var(--fg-muted))]">
            LIVE
          </div>
          {live.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              pending={pending}
              onOpen={() => {
                onOpen(p);
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
        </>
      ) : null}

      {/* HIDDEN group */}
      {showHiddenGroup && hidden.length > 0 ? (
        <>
          <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(17_16_9/0.015)] px-[18px] pt-[10px] pb-[6px] font-display text-[10px] font-bold uppercase tracking-[0.1em] text-[rgb(var(--fg-muted))]">
            HIDDEN · {hidden.length}
          </div>
          {hidden.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              pending={pending}
              onOpen={() => {
                onOpen(p);
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
        </>
      ) : null}
    </div>
  );
}
```

Run test: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/store-table.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/store-table.test.tsx
git commit -m "feat(store): add StoreTable container with LIVE/HIDDEN dividers"
```

---

### Task P3-9: Enable Table view in `<ViewToggle>` + render switch in `<StoreScreen>`

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/store-screen.tsx`
- Modify: `apps/web/src/app/(producer)/dashboard/store/store-toolbar.tsx` (only if the toolbar hard-codes `enableTable={false}`; otherwise no change)
- Modify: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-screen.test.tsx`

**Step 1: Update tests**

```tsx
it("mounts the StoreTable when view === 'table'", () => {
  expect(SRC).toMatch(/StoreTable/);
});

it("passes enableTable=true into the ViewToggle", () => {
  // Either via the toolbar that re-emits the prop, or directly on
  // a ViewToggle usage. Source-grep on the literal value covers both.
  expect(SRC).toMatch(/enableTable=\{true\}|enableTable={true}/);
});
```

Run: FAIL.

**Step 2: Implement** — two edits to `store-screen.tsx`:

a) Pass `enableTable={true}` through to the `<ViewToggle>` (likely via the `<StoreToolbar>` — confirm by reading toolbar source first):

```tsx
<StoreToolbar
  /* …existing props… */
  enableTable={true}    // ← NEW
/>
```

If `<StoreToolbar>` doesn't accept `enableTable`, add the pass-through (one new prop on toolbar, passed straight into its `<ViewToggle>`).

b) Branch the render between cards and table:

```tsx
{filtered.length === 0 ? (
  /* …existing empty-state branch… */
) : view === "table" ? (
  <StoreTable
    live={live}
    hidden={hidden}
    pending={pending}
    showHiddenGroup={filter === "all" || filter === "hidden"}
    onOpen={onEdit}
    onToggleVisible={onToggleVisible}
    onEdit={onEdit}
    onDelete={onDelete}
  />
) : (
  <div className="flex flex-col gap-2">
    {/* …existing cards rendering… */}
  </div>
)}
```

Run typecheck + test: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/store-screen.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/store-toolbar.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/store-screen.test.tsx
git commit -m "feat(store): enable Table view, route StoreScreen render by mode"
```

**Manual verification before moving on:**
- Toggle the view to Table. The header strip + LIVE / HIDDEN group dividers + rows all render. Click a row → opens the editor. Toggle a row → flips between Live and Hidden in place. The rowIn 320ms stagger plays when the table first renders.

---

## Phase 3c — Animation polish (Tasks P3-10 to P3-11)

### Task P3-10: live-pulse on the Cards-view active state

Cards-view counterpart to the Table-view Live status (already wired in P3-7 via `sk-live-pulse` on the dot). The Cards `<ProductCard>` currently uses opacity to convey "hidden" but doesn't explicitly mark "live". Per the design brief §7.4, the live status pill should pulse — but the new card design from Phase 1 doesn't include an explicit Live pill on cards (the `<Toggle>` switch is the indicator). So this task is conditional:

- If the prototype shows a Live pill on the card → port it.
- If not → skip P3-10 entirely and instead pulse the `<Toggle>` thumb when `active=true`.

**Check first:** `grep -n "live.*pill\|status-pill" /Volumes/KINGSTON/Downloads/design_handoff_storefront/storefront.html`.

The prototype's card markup uses `.status-pill.live` (line 50). Phase 1 didn't port this pill — only the toggle made it across. Phase 3 ports the pill:

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/product-card.tsx`
- Modify: `apps/web/src/app/(producer)/dashboard/store/__tests__/product-card.test.tsx`

**Step 1: Test**

```tsx
it("renders a pulsing live dot when the product is active", () => {
  expect(SRC).toMatch(/sk-live-pulse/);
});
```

**Step 2: Implement** — add a small pulsing dot inside the action area, right before the `<Toggle>`:

```tsx
{product.active ? (
  <span
    aria-hidden
    className="sk-live-pulse inline-block h-1.5 w-1.5 rounded-full"
    style={{ background: "rgb(var(--fg-success))" }}
  />
) : null}
<Toggle /* …existing… */ />
```

Run test: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/product-card.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/product-card.test.tsx
git commit -m "feat(store): pulse a live dot on active cards"
```

---

### Task P3-11: shimmer-glow on newly created products

When a producer creates a new product via the editor, the new card pulses for 2 iterations of 2s (the `sk-shimmer-glow` keyframe from P3-4). After the animation, the flag clears so the card looks normal again.

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/store-screen.tsx`
- Modify: `apps/web/src/app/(producer)/dashboard/store/product-editor.tsx` (only the `onSave` success path — to notify `<StoreScreen>` of the new id)
- Modify: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-screen.test.tsx`

The `<ProductEditor>` already calls `tRPC.booking.packages.create` and refreshes. Phase 3 adds an `onCreated(id)` callback on the editor that fires with the new product's id, which `<StoreScreen>` uses to set a `recentlyAdded: string | null` state. The state clears via `setTimeout(4500)` (slightly longer than the 4s shimmer-glow runtime — the animation is `2s × 2 = 4s`, plus a buffer).

**Step 1: Test**

```tsx
it("tracks the most-recently-created product id", () => {
  expect(SRC).toMatch(/recentlyAdded/);
});

it("clears recentlyAdded after 4.5s", () => {
  expect(SRC).toMatch(/setTimeout[\s\S]{0,200}4500|4500[\s\S]{0,200}setTimeout/);
});

it("passes recentlyAdded to the matched ProductCard", () => {
  expect(SRC).toMatch(/recentlyAdded=/);
});
```

Run: FAIL.

**Step 2: Implement**

In `store-screen.tsx`:

```tsx
const [recentlyAdded, setRecentlyAdded] = useState<string | null>(null);

function handleCreated(id: string) {
  setRecentlyAdded(id);
  setTimeout(() => {
    setRecentlyAdded((cur) => (cur === id ? null : cur));
  }, 4500);
}

// …in the JSX, pass onCreated to ProductEditor's create-mode mount:
<ProductEditor
  open={creating}
  onOpenChange={(o) => { setCreating(o); }}
  product={null}
  defaultCurrency={defaultCurrency}
  onCreated={handleCreated}    // ← NEW
/>

// …and threaded through each ProductCard render:
<ProductCard
  /* …existing props… */
  recentlyAdded={p.id === recentlyAdded}
/>
```

In `product-editor.tsx`, after the `create` mutation returns successfully, call `onCreated?.(newId)` — the create mutation in `booking.packages.create` returns the new product row (confirm at the existing `.returning()` call in the router). Plumb the id through the save handler:

```tsx
const created = await trpc.booking.packages.create.mutate(input);
onCreated?.(created.id);
toast(`"${created.name}" saved.`, "success");
router.refresh();
onOpenChange(false);
```

(If the `create` mutation doesn't yet return the id, update its `.returning()` to include `id` — small, additive.)

Run typecheck + tests: PASS.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/store-screen.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/product-editor.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/store-screen.test.tsx
git commit -m "feat(store): shimmer-glow newly-created products for 4s"
```

---

## Task P3-12: Final verification + push

```bash
pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test && pnpm -F web build
```

All four must PASS. Push:

```bash
git push origin phase-1-store-redesign
```

Vercel auto-deploys to the same preview URL. Open in **Incognito** (per the `feedback_skitza_sw_cache_on_deploy.md` memory) and verify:

- [ ] Drag a card by its grip handle. The drop indicator (3px brand-color line) tracks the cursor's vertical half above/below the target. On drop, the order updates immediately. Refresh — the new order persists.
- [ ] Drag a card to itself: no-op, no flash, no server call.
- [ ] Drag, then release outside the list: no-op, no orphaned drop indicator.
- [ ] Switch to Table view. The header strip + LIVE / HIDDEN dividers + rows all render. The 320ms staggered `sk-row-in` plays on first render.
- [ ] Click a row body → editor opens. Click a row action (Toggle / Edit / Delete) → only that action fires, no row-click bubble.
- [ ] Active products' Live dot pulses 2.2s (cards + table both). `prefers-reduced-motion: reduce` (DevTools → Rendering → Emulate CSS media feature) stops all three animations.
- [ ] Create a new product. The new card flashes the brand-color shimmer-glow for ~4s, then settles.
- [ ] On mobile (DevTools narrow viewport), the drag handle is hidden, but Edit / Delete still work.
- [ ] No console errors, no network 500s.

Once visually confirmed, the branch is ready for Gili's polish pass + the final PR.

---

## Out of scope (Phase 3)

These are intentionally deferred:

- **Duplicate-trigger UI on the new card/row.** The `duplicatePackage` server action exists, but Phase 1's `<ProductCard>` doesn't surface it. Shimmer-glow ships keyed off **create only**. If Gili wants duplicate during the polish pass, a tiny follow-up (kebab menu or third icon button) adds it.
- **Multi-select + bulk reorder.** No selection mode in the design brief.
- **Touch drag.** Producer is desktop-only per `CLAUDE.md`; the drag handle is `display: none` on `@media (hover: none)`.
- **Animated row swap.** Native HTML5 DnD's drop is instant DOM reflow — no FLIP animation. The brief doesn't require one.
- **Live-region a11y announcements on reorder.** No screen-reader announcement when a row moves. Phase 4 a11y pass.
- **Schema migrations.** The `position` column already exists; no migration needed.

## Risks

| Risk | Mitigation |
|---|---|
| Reorder race with a mid-flight toggle/edit | Single transaction in `booking.packages.reorder`. If a toggle's `setActive` lands between the optimistic local reorder and the server reorder, the toggle's revalidate refreshes the page; the optimistic local reorder is overwritten by the server-truth render. Acceptable — order is preserved, only the in-flight optimistic reorder gets nudged by 1 refresh. |
| Mobile producers can't reorder | Acceptable; desktop-only surface. Drag handle hidden via `@media (hover: none)`. |
| Live-pulse runtime cost with many rows | The pulse animates `box-shadow` (compositor-friendly) on a 1.5×1.5px dot. Even at 100 rows the cost is negligible. `prefers-reduced-motion: reduce` disables. |
| `<TypeTile>` size 28 not supported | Phase 1 ships sizes 32 + 60. P3-7's `<ProductRow>` uses size 28; either add a 28 variant to `<TypeTile>` or render size 32 + `scale-[0.875]`. Decided during P3-7 implementation. |
| Drop indicator looks broken when the row is at the list's top/bottom edge | The indicator is absolute-positioned `-top-[2px]` / `-bottom-[2px]`; it draws cleanly on edge rows because the row's overflow isn't clipped (`product-card` doesn't set `overflow:hidden`). Visually verified during P3-5 manual check. |
| `create` mutation doesn't return the new id, breaking shimmer-glow | Confirm during P3-11 implementation by reading the existing `.returning()` clause. If only certain columns return, extend to include `id`. |
| Optimistic order desync after `router.refresh()` | The `useEffect` that re-syncs `optimisticProducts` from the `products` prop covers this. After the server confirms, the next refresh seeds the optimistic state with the server-truth order. |
| Lint trips on the unused `accent` variable in `product-row.tsx` if the implementation doesn't use it | If `TILE_THEME[tile].label` doesn't exist, the row falls back to uppercase tile name; in that case drop the `accent` destructuring. The Phase 3 commit must keep lint green per `feedback_run_lint_not_just_typecheck.md`. |
