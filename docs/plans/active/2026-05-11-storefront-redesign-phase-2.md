# Producer Storefront Redesign, Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: superpowers:executing-plans (or run inline via subagent-driven-development from the controller session). Phase 1 ships in the same branch; Phase 2 lands additively before the PR is opened against `v3-clean`.

**Goal:** Ship the 4-step product Editor wizard (type-preset picker, then includes, pricing, contract), the portaled Delete confirm modal, and the Undo toast (4.5s). Remove `window.confirm` entirely from `<StoreScreen>` and remove the old `NewPackageForm` modal mounts. Match the prototype `storefront.html` editor stages 1–4 faithfully.

**Architecture:** `<ProductEditor>` is a Radix Dialog modal that holds a `draft` state object. The wizard is a state machine over `NEW_STEPS` (`type → includes → pricing → contract`) and `EDIT_STEPS` (`includes → pricing → contract`). Each step is a tiny presentational component that reads/writes the shared draft. On save, the editor calls existing tRPC mutations (`booking.packages.create` and `booking.packages.update`). Delete uses the new `<DeleteConfirmModal>` portaled to `document.body`; on confirm, the row is removed optimistically and a `useUndoableDelete` hook keeps a 4.5s undo window open in a toast action.

**Tech stack (no new deps):** Next.js 15 App Router, React 19, Radix Dialog, Tailwind v4, Lucide React, Vitest (node env, source-grep tests). All primitives from Phase 1 are reused.

**Source design brief:** `docs/plans/active/2026-05-10-storefront-redesign-design.md` (sections 6 + 8).
**Prototype reference:** `/Volumes/KINGSTON/Downloads/design_handoff_storefront/storefront.html` (TYPE_PRESETS at line 222, NEW_STEPS at line 752, IncludesStep at line 904, PricingStep at line 994, ContractStep at line 1095).

**Critical constraint (per Gili's call):** Zero `window.confirm`, zero `window.alert`, zero `window.prompt`. Every confirmation goes through `<DeleteConfirmModal>` or a toast action. The Phase 1 `window.confirm` in `<StoreScreen>` is removed in Task P2-12.

## Pre-flight findings (verified 2026-05-11 before plan was sealed)

1. **`booking.packages.create` and `.update` already exist** at `apps/web/src/server/trpc/routers/booking.ts`. Their zod input `ProductInputShape` (line 86) accepts every field the editor produces: `name`, `description` (max 500 chars), `kind`, `priceCents`, `currency` (USD/EUR/GBP/ILS), `durationMin`, `sessionCount`, `deliverables` (max 10 strings), `depositPct`, `locationType`, `bufferMinutes`, `minLeadHours`, `paymentPlans`, `contractUrl` (nullable URL).
2. **`ProductKind` enum (line 39) does NOT include `"consult"`** — it covers `mix / master / production / album / beat_lease / hourly / custom / session / mixing / mastering / producing / other`. The editor's "consult" preset must save as `kind: "custom"` so the zod input accepts it. On reload, `kindToTile` already maps `custom → consult` (Phase 1 Task 1), so the round-trip is invisible. Add this `consult → custom` translation in the editor's save handler with a code comment.
3. **`useToast()` is backed by Sonner** (`apps/web/src/components/ui/toast.tsx`). Current API is `toast(message, variant?)` with no `action` or `duration` plumbed through, BUT Sonner natively supports both. The CSS already styles `actionButton` (line 63). Extending `useToast` to accept `{ durationMs?: number; action?: { label: string; onClick: () => void } }` is a 6-line change that passes through to `sonnerToast.success(message, { duration, action: { label, onClick }})`. Backwards-compatible — existing call sites ignore the third arg.
4. **`description` is capped at 500 chars.** Tagline + revisions+turnaround suffix must stay under that. Defensive validation: cap tagline at 400 chars in the editor's onChange to keep room for the meta block (~100 chars budget).
5. **Phase 1's `useUndoableDelete` hook** depends on `restorePackage` from Task P2-2. Order matters: P2-2 ships before P2-12.

**Description-encoding for Phase-2-only fields.** The editor surfaces `revisions` (int) and `turnaround` (free text) which the DB schema does not have. These get encoded into `products.description` with a `\n---\nrevisions: N\nturnaround: T` suffix block, parsed back by a small pure helper. Card-side tagline derivation already grabs `description.split('\n')[0]`, so the suffix never leaks into the tagline. A future Phase 4 PR adds dedicated columns and ports the parser away.

**Contract step scope.** The prototype offers file-upload AND text-terms modes. Phase 2 ships a single URL input only (the existing `products.contractUrl` column). File upload + inline text terms are deferred to a follow-up that adds the required columns + a file pipeline.

---

## Task P2-1: TYPE_PRESETS data constant

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/type-presets.ts`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/type-presets.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { TYPE_PRESETS, getPreset } from "../type-presets";

describe("TYPE_PRESETS", () => {
  it("exposes exactly four preset cards in the order production, mix, master, blank", () => {
    expect(TYPE_PRESETS.map((p) => p.id)).toEqual([
      "production",
      "mix",
      "master",
      "blank",
    ]);
  });

  it("each preset has a label, desc, defaultName, baseline list, extras list, and preset object", () => {
    for (const p of TYPE_PRESETS) {
      expect(p.label).toBeTypeOf("string");
      expect(p.desc).toBeTypeOf("string");
      expect(p.defaultName).toBeTypeOf("string");
      expect(Array.isArray(p.baseline)).toBe(true);
      expect(Array.isArray(p.extras)).toBe(true);
      expect(p.preset).toBeTypeOf("object");
    }
  });

  it("production preset seeds $2500 multi-session with split payment", () => {
    const prod = getPreset("production");
    expect(prod?.preset.price).toBe(2500);
    expect(prod?.preset.duration).toBe("multi-session");
    expect(prod?.preset.sessions).toBe(8);
    expect(prod?.preset.paymentPlan).toBe("split");
  });

  it("blank preset has empty baseline + extras so the user starts fresh", () => {
    const blank = getPreset("blank");
    expect(blank?.baseline).toHaveLength(0);
    expect(blank?.extras).toHaveLength(0);
  });

  it("getPreset returns undefined for unknown ids", () => {
    expect(getPreset("zzz" as never)).toBeUndefined();
  });
});
```

Run: `pnpm -F web test -- run type-presets`. Expect FAIL.

**Step 2: Implement** (port verbatim from the prototype, line 222 onward):

```ts
// type-presets.ts
//
// Type-preset cards used in the wizard's first step (new products only).
// Ported verbatim from the prototype `storefront.html` (TYPE_PRESETS,
// line 222). Each preset defines: the picker card copy (label / desc /
// icon), the default product name, baseline inclusions (always added
// to the draft includes list), suggested extras (one-tap add), and a
// preset object that seeds the rest of the form on pick.

export type PresetId = "production" | "mix" | "master" | "blank";
export type PresetType = "production" | "mix" | "master" | "consult";
export type PaymentPlanChoice = "full" | "split" | "installments";

export interface ExtraOption {
  label: string;
  icon: string;
  desc: string;
}

export interface PresetSeed {
  type: PresetType;
  name: string;
  price: number;
  duration: string;
  sessions: number;
  unlimitedSessions: boolean;
  paymentPlan: PaymentPlanChoice;
  revisions: number;
  turnaround: string;
  includes: string[];
}

export interface TypePreset {
  id: PresetId;
  label: string;
  icon: string;
  desc: string;
  defaultName: string;
  baseline: string[];
  extras: ExtraOption[];
  preset: PresetSeed;
}

export const TYPE_PRESETS: TypePreset[] = [
  {
    id: "production",
    label: "Production",
    icon: "music-2",
    desc: "End-to-end: tracking, arrangement, mix & master",
    defaultName: "Full production",
    baseline: [
      "Pre-production calls",
      "Tracking sessions",
      "Arrangement & sound design",
      "Mix + master included",
    ],
    extras: [
      { label: "Live musicians", icon: "users", desc: "Hired session players" },
      { label: "Lyrics & topline writing", icon: "pen-line", desc: "Co-write the song" },
      { label: "Vocal coaching", icon: "mic", desc: "Performance direction" },
      { label: "Beat / instrumental", icon: "music", desc: "Original production" },
      { label: "Stem delivery (WAV)", icon: "layers", desc: "All multitracks" },
      { label: "Music video shoot", icon: "video", desc: "Visual deliverable" },
      { label: "Distribution help", icon: "send", desc: "Release strategy" },
      { label: "Mastering for vinyl", icon: "disc-3", desc: "Pre-master + cut" },
    ],
    preset: {
      type: "production",
      name: "",
      price: 2500,
      duration: "multi-session",
      sessions: 8,
      unlimitedSessions: false,
      paymentPlan: "split",
      revisions: 3,
      turnaround: "6–10 weeks",
      includes: [],
    },
  },
  {
    id: "mix",
    label: "Mix",
    icon: "sliders-horizontal",
    desc: "Per-song mixing with stems, revisions and references",
    defaultName: "Mixing session",
    baseline: [
      "Stereo bus + mix prep",
      "2 revision rounds",
      "Reference matching",
      "High-res WAV master",
    ],
    extras: [
      { label: "Up to 64 stems", icon: "layers", desc: "Large session support" },
      { label: "Vocal tuning + comp", icon: "mic", desc: "Pitch + timing" },
      { label: "Atmos mix", icon: "compass", desc: "Spatial / immersive" },
      { label: "Loom walk-through", icon: "video", desc: "Recorded mix notes" },
      { label: "Live session attendance", icon: "users", desc: "You join the mix" },
      { label: "Instrumental + acappella", icon: "volume-2", desc: "Bonus exports" },
    ],
    preset: {
      type: "mix",
      name: "",
      price: 150,
      duration: "180 min",
      sessions: 1,
      unlimitedSessions: false,
      paymentPlan: "split",
      revisions: 2,
      turnaround: "5–7 days",
      includes: [],
    },
  },
  {
    id: "master",
    label: "Master",
    icon: "volume-2",
    desc: "Loud, balanced, platform-ready masters",
    defaultName: "Mastering pass",
    baseline: [
      "Streaming master (-14 LUFS)",
      "High-res WAV + MP3",
      "1 revision",
    ],
    extras: [
      { label: "CD master", icon: "disc", desc: "Red-book delivery" },
      { label: "Vinyl pre-master", icon: "disc-3", desc: "Side-aware cut" },
      { label: "MFiT / Apple Digital Master", icon: "apple", desc: "Apple-spec master" },
      { label: "Loudness report (PDF)", icon: "file-text", desc: "Spec sheet" },
      { label: "Stem mastering", icon: "layers", desc: "Multi-stem master" },
      { label: "Instrumental master", icon: "volume-2", desc: "Bonus version" },
    ],
    preset: {
      type: "master",
      name: "",
      price: 200,
      duration: "90 min",
      sessions: 1,
      unlimitedSessions: false,
      paymentPlan: "full",
      revisions: 1,
      turnaround: "3–5 days",
      includes: [],
    },
  },
  {
    id: "blank",
    label: "Blank",
    icon: "plus",
    desc: "Start from scratch — define your own",
    defaultName: "",
    baseline: [],
    extras: [],
    preset: {
      type: "consult",
      name: "",
      price: 100,
      duration: "60 min",
      sessions: 1,
      unlimitedSessions: false,
      paymentPlan: "full",
      revisions: 0,
      turnaround: "1 week",
      includes: [],
    },
  },
];

export function getPreset(id: PresetId): TypePreset | undefined {
  return TYPE_PRESETS.find((p) => p.id === id);
}
```

Run test: PASS. Commit:
```
git add apps/web/src/app/\(producer\)/dashboard/store/type-presets.ts \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/type-presets.test.ts
git commit -m "feat(store): port TYPE_PRESETS data from prototype"
```

---

## Task P2-2: `restorePackage` server action (Undo support)

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/booking/actions.ts`
- Test: `apps/web/src/app/(producer)/dashboard/booking/__tests__/restore-package.test.ts`

The Phase 1 delete flow archives via `archivePackage`. Undo re-activates it. We re-use the existing tRPC mutation `booking.packages.update` with `{ archivedAt: null, active: false }`. Returns hidden (not live) so the producer reviews before re-publishing — matches the design brief §6.3.

**Step 1: Failing test** — source-grep + pure-function intent test. Since the action is a thin tRPC wrapper, the source-grep proves the wiring without spinning up the server:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "actions.ts"), "utf8");

describe("restorePackage server action", () => {
  it("exports a restorePackage function", () => {
    expect(SRC).toMatch(/export\s+async\s+function\s+restorePackage/);
  });

  it("calls the tRPC update mutation with archivedAt=null + active=false", () => {
    expect(SRC).toMatch(/archivedAt:\s*null/);
    expect(SRC).toMatch(/active:\s*false/);
  });
});
```

Run: expect FAIL (function not exported yet).

**Step 2: Look at the existing actions.ts to see where archivePackage lives and what the tRPC update endpoint looks like.** The implementer reads `apps/web/src/app/(producer)/dashboard/booking/actions.ts` and identifies the existing `archivePackage` pattern. The new `restorePackage` mirrors it but calls update with `{archivedAt: null, active: false}` instead.

**Step 3: Implement** the addition at the bottom of actions.ts (or wherever new exports go in that file):

```ts
// restorePackage — Undo for the Phase-2 delete flow. Resurrects a
// soft-deleted product by clearing archivedAt and forcing active=false
// (returns hidden so the producer reviews before re-publishing). Pair
// with the 4.5s toast action surfaced from <StoreScreen>.
export async function restorePackage({ id }: { id: string }): Promise<ActionResult<undefined>> {
  // Mirror existing archivePackage pattern: get caller via auth, then
  // call the same booking.packages.update mutation that powers the
  // existing edit flow.
  // … (implementer fills in matching existing pattern)
}
```

Run test: PASS.

**Step 4: Commit**
```
git add apps/web/src/app/\(producer\)/dashboard/booking/actions.ts \
        apps/web/src/app/\(producer\)/dashboard/booking/__tests__/restore-package.test.ts
git commit -m "feat(booking): add restorePackage server action for Undo"
```

---

## Task P2-3: Description-encoding helper

The editor exposes `revisions` (int) and `turnaround` (free text) which the schema does not have. Encode them as a suffix on `description` so they round-trip cleanly without a migration.

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/description-encoding.ts`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/description-encoding.test.ts`

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";

import {
  decodeDescription,
  encodeDescription,
} from "../description-encoding";

describe("encodeDescription", () => {
  it("returns just the tagline when revisions + turnaround are empty", () => {
    expect(encodeDescription({ tagline: "Stems delivered", revisions: 0, turnaround: "" })).toBe("Stems delivered");
  });

  it("appends the meta block when revisions > 0 or turnaround set", () => {
    const out = encodeDescription({ tagline: "Stems delivered", revisions: 2, turnaround: "5 days" });
    expect(out).toContain("Stems delivered");
    expect(out).toContain("---");
    expect(out).toMatch(/revisions:\s*2/);
    expect(out).toMatch(/turnaround:\s*5 days/);
  });

  it("preserves multi-line tagline bodies", () => {
    const out = encodeDescription({ tagline: "Line one\nLine two", revisions: 1, turnaround: "1 week" });
    expect(out.split("\n")[0]).toBe("Line one");
    expect(out).toContain("Line two");
    expect(out).toContain("---");
  });
});

describe("decodeDescription", () => {
  it("returns tagline only when no meta block exists", () => {
    expect(decodeDescription("Stems delivered")).toEqual({
      tagline: "Stems delivered",
      revisions: 0,
      turnaround: "",
    });
  });

  it("parses the meta block back out", () => {
    const dec = decodeDescription("Stems delivered\n\n---\nrevisions: 2\nturnaround: 5 days");
    expect(dec.tagline).toBe("Stems delivered");
    expect(dec.revisions).toBe(2);
    expect(dec.turnaround).toBe("5 days");
  });

  it("survives a null description", () => {
    expect(decodeDescription(null)).toEqual({
      tagline: "",
      revisions: 0,
      turnaround: "",
    });
  });

  it("round-trips encode → decode losslessly", () => {
    const original = { tagline: "Mix + master included", revisions: 3, turnaround: "10 days" };
    expect(decodeDescription(encodeDescription(original))).toEqual(original);
  });
});
```

Run: FAIL.

**Step 2: Implement**

```ts
// description-encoding.ts
//
// `products.description` doubles as both the public-page tagline AND
// (until a Phase-4 schema migration) the carrier for revisions +
// turnaround. This helper round-trips between the structured editor
// fields and the flat string. The format is line-based and stable:
//
//   <free-form body, can be multiple lines>
//   \n---\n
//   revisions: <int>
//   turnaround: <free text>
//
// Card-side `deriveTagline` already takes `description.split('\n')[0]`,
// so the meta block never leaks into the card UI.

const SEPARATOR = "\n---\n";

export interface DescriptionFields {
  tagline: string;
  revisions: number;
  turnaround: string;
}

export function encodeDescription({ tagline, revisions, turnaround }: DescriptionFields): string {
  const hasMeta = (revisions != null && revisions > 0) || turnaround.trim().length > 0;
  if (!hasMeta) return tagline;
  return `${tagline}${SEPARATOR}revisions: ${String(revisions ?? 0)}\nturnaround: ${turnaround}`;
}

export function decodeDescription(description: string | null): DescriptionFields {
  if (!description) return { tagline: "", revisions: 0, turnaround: "" };
  const idx = description.indexOf(SEPARATOR);
  if (idx === -1) return { tagline: description, revisions: 0, turnaround: "" };
  const tagline = description.slice(0, idx);
  const meta = description.slice(idx + SEPARATOR.length);
  const revisionsMatch = meta.match(/revisions:\s*(\d+)/);
  const turnaroundMatch = meta.match(/turnaround:\s*(.+?)(?:\n|$)/);
  return {
    tagline,
    revisions: revisionsMatch ? parseInt(revisionsMatch[1] ?? "0", 10) : 0,
    turnaround: turnaroundMatch ? (turnaroundMatch[1] ?? "").trim() : "",
  };
}
```

Run: PASS.

**Commit:**
```
git commit -m "feat(store): encode revisions+turnaround into description for Phase 2"
```

---

## Task P2-4: `<StepBar>` progress indicator

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/step-bar.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/step-bar.test.tsx`

**Step 1: Failing source-grep test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "step-bar.tsx"), "utf8");

describe("StepBar shell", () => {
  it("renders one segment per step", () => {
    expect(SRC).toMatch(/steps\.map/);
  });

  it("highlights the current step with the brand color", () => {
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("uses an aria progressbar role for assistive tech", () => {
    expect(SRC).toMatch(/role="progressbar"|role={"progressbar"}/);
  });
});
```

**Step 2: Implement**

```tsx
// step-bar.tsx
//
// Horizontal segmented progress bar for the editor wizard. Brand-amber
// fills past + current steps; the rest are muted. Pure presentation.

interface StepBarProps {
  steps: readonly string[];
  current: string;
}

export function StepBar({ steps, current }: StepBarProps) {
  const currentIdx = Math.max(0, steps.indexOf(current));
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuenow={currentIdx + 1}
      className="flex items-center gap-1"
    >
      {steps.map((id, idx) => {
        const reached = idx <= currentIdx;
        return (
          <span
            key={id}
            aria-hidden
            className="h-[3px] flex-1 rounded-full transition-colors"
            style={{
              background: reached
                ? "rgb(var(--brand-primary))"
                : "rgb(var(--border-subtle))",
            }}
          />
        );
      })}
    </div>
  );
}
```

PASS. Commit `feat(store): add StepBar progress indicator`.

---

## Task P2-5: `<EditorShell>` modal wrapper

The shell owns the modal portal, header (step indicator label + title + subtitle + close X), the `<StepBar>`, the scrollable body slot, and the footer (Back + Continue/Save). Each step component renders into the body slot.

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/editor-shell.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/editor-shell.test.tsx`

**Step 1: Failing test (source-grep on the rich shell)**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-shell.tsx"), "utf8");

describe("EditorShell shell", () => {
  it("uses Radix Dialog for portal + scrim", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
  });

  it("renders the step indicator label (Step N of M)", () => {
    expect(SRC).toMatch(/Step\s+\$\{|Step \$/);
  });

  it("renders the StepBar component", () => {
    expect(SRC).toMatch(/<StepBar/);
  });

  it("renders Back, Continue, and Save labels in the footer", () => {
    expect(SRC).toContain("Back");
    expect(SRC).toContain("Continue");
    expect(SRC).toContain("Save");
  });

  it("has a close X button in the header", () => {
    expect(SRC).toMatch(/aria-label="Close"/);
  });

  it("uses popIn animation per the design brief", () => {
    expect(SRC).toMatch(/popIn|scale\(0\.97\)|translateY\(12/);
  });
});
```

**Step 2: Implement** — see full source in the prototype's modal wrapper. Key points:
- Centered 640px max-w (handoff §4), 90vh max-h, 18px radius, scrim with blur
- `popIn` keyframes: scale 0.97→1, translateY 12→0, opacity 0→1, 240ms `cubic-bezier(.16,1,.3,1)`
- Header: small `STEP N OF M · NEW PRODUCT|EDITING · <name>` label, `h-headline` title, muted subtitle, close X top-right
- Body: scrollable `flex-1`
- Footer: Back (ghost) on the left, Cancel + Continue/Save on the right. On the last step "Save" replaces "Continue". On the first step Back is hidden.

(Implementer drafts the JSX; tests pin the contracts above.)

PASS. Commit `feat(store): add EditorShell modal wrapper with progress`.

---

## Task P2-6: `<TypeStep>` — the 4-preset picker

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/editor-steps/type-step.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/type-step.test.tsx`

**Step 1: Failing test**

```tsx
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-steps", "type-step.tsx"), "utf8");

describe("TypeStep", () => {
  it("imports the TYPE_PRESETS data", () => {
    expect(SRC).toMatch(/from\s+["']\.\.\/type-presets["']/);
  });

  it("renders a 2x2 grid of preset cards", () => {
    expect(SRC).toMatch(/grid|cols-2/);
  });

  it("highlights the picked preset via a thicker amber border", () => {
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("calls onPick with the preset id", () => {
    expect(SRC).toMatch(/onPick\s*\(\s*p\.id|onPick\(preset\.id/);
  });
});
```

**Step 2: Implement** — 2×2 grid of cards, each with the preset's icon tile (small), label (Syne 800), and desc (muted). Clicking a card sets `draft._picked = p.id` and seeds the rest from `p.preset` + `p.baseline`.

PASS. Commit `feat(store): add TypeStep preset picker`.

---

## Task P2-7: `<IncludesStep>`

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/editor-steps/includes-step.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/includes-step.test.tsx`

The IncludesStep shows:
- Product name input (autofocus on mount)
- "What's included" selected-chips area (dashed amber-tinted dropzone)
- "Suggested for <preset.label>" available extras
- "Add your own" custom-extra form (input + `+ Add` submit)

**Step 1: Test (source-grep)**

```tsx
// pins: input, selected chips with × remove, suggested extras, custom-add form
expect(SRC).toMatch(/<input/);
expect(SRC).toMatch(/selected\.|includes\.|draft\.includes/);
expect(SRC).toMatch(/Suggested for/);
expect(SRC).toMatch(/Add your own/);
```

**Step 2: Implement** matching the prototype lines 904–984 verbatim. PASS.

Commit: `feat(store): add IncludesStep (name + chips)`.

---

## Task P2-8: `<PricingStep>`

Has: price + currency, sessions count + unlimited toggle, deposit %, payment-plan radio group (full / split / installments-with-count), duration free text, revisions stepper, turnaround free text. The contract URL field stays on the next step.

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/editor-steps/pricing-step.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/pricing-step.test.tsx`

Source-grep test pins:
- Renders the four currency options (USD / ILS / EUR / GBP — Skitza supports all four)
- Renders three payment-plan options (full / split / installments)
- Includes a Stepper for revisions
- Reads/writes `draft.price`, `draft.currency`, `draft.sessions`, `draft.unlimitedSessions`, `draft.depositPct`, `draft.paymentPlan`, `draft.installments?.count`, `draft.duration`, `draft.revisions`, `draft.turnaround`

Implement matching prototype lines 994–1085. PASS. Commit `feat(store): add PricingStep`.

---

## Task P2-9: `<ContractStep>` (URL only for Phase 2)

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/editor-steps/contract-step.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/contract-step.test.tsx`

Phase-2 scope: a single URL input that writes to `draft.contractUrl`. A line of copy below explains that file upload + inline text terms are coming. (Future phase.)

Source-grep pins:
- A `<input>` with placeholder pointing at a contract URL (e.g. `https://drive.google.com/...`)
- The optional/skippable note from the prototype copy ("Adding a contract is optional — but artists who sign one are 3× more likely to complete their booking.")
- The "Skip anytime" affordance via a clear "Save" button on the next-of footer (handled by EditorShell)

Implement, PASS, commit `feat(store): add ContractStep (URL field)`.

---

## Task P2-10: `<ProductEditor>` orchestrator

The orchestrator owns the wizard state machine, the draft object, the save call, and the encode/decode round-trip via the description-encoding helper.

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/product-editor.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/product-editor.test.tsx`

**Step 1: Source-grep test**

```tsx
// pins (verbatim required snippets):
expect(SRC).toMatch(/NEW_STEPS\s*=\s*\[/);
expect(SRC).toMatch(/EDIT_STEPS\s*=\s*\[/);
expect(SRC).toMatch(/<TypeStep/);
expect(SRC).toMatch(/<IncludesStep/);
expect(SRC).toMatch(/<PricingStep/);
expect(SRC).toMatch(/<ContractStep/);
expect(SRC).toMatch(/<EditorShell/);
expect(SRC).toMatch(/encodeDescription|decodeDescription/);
// Calls existing tRPC mutations, not new ones
expect(SRC).toMatch(/booking\.packages\.create|packages\.create/);
expect(SRC).toMatch(/booking\.packages\.update|packages\.update/);
```

**Step 2: Implement**

Key state:
```ts
const NEW_STEPS = ["type", "includes", "pricing", "contract"] as const;
const EDIT_STEPS = ["includes", "pricing", "contract"] as const;
type StepId = (typeof NEW_STEPS)[number];

interface Draft {
  _picked: PresetId | null;          // null when editing
  name: string;
  tagline: string;
  type: PresetType;
  price: number;                      // dollars (or whatever currency)
  currency: "USD" | "EUR" | "GBP" | "ILS";
  sessions: number;
  unlimitedSessions: boolean;
  depositPct: number;
  paymentPlan: "full" | "split" | "installments";
  installments: { count: number };
  duration: string;                   // free text, parsed to durationMin
  revisions: number;
  turnaround: string;
  includes: string[];
  contractUrl: string;
}
```

On open, if `editing` prop is a product, decode `description` to seed `tagline / revisions / turnaround`, set `_picked = null`, set `currentStep = "includes"`. If creating, set `_picked = null` and `currentStep = "type"`; pressing a preset card calls `seedFromPreset(presetId)` and advances to `"includes"`.

On save:
- Build `priceCents = Math.round(draft.price * 100)`
- Build `paymentPlans` array from `draft.paymentPlan`:
  - `full` → `[{kind:"full"}]`
  - `split` → `[{kind:"split_50_50"}]`
  - `installments` → `[{kind:"monthly", installments: draft.installments.count}]`
- Build `description = encodeDescription({ tagline, revisions, turnaround })`
- Build `deliverables = draft.includes`
- Parse `durationMin` from `draft.duration` (`"180 min"` → 180; `"multi-session"` → 0; `"60 min"` → 60). Simple regex: `match(/(\d+)\s*min/)` else 0.
- Build `sessionCount = draft.unlimitedSessions ? 0 : draft.sessions`
- Build `kind = draft.type` (one of mix/master/production/consult)
- Call `tRPC.booking.packages.update` (edit) or `.create` (new)
- On success: refresh + close modal + success toast `<name> saved`
- On failure: toast error, keep modal open

Footer wiring (via EditorShell props): show Back when `currentStep !== firstStep`, hide Continue when `currentStep === lastStep`, then show Save instead. On `type` step, Continue is disabled until a preset is picked.

PASS. Commit `feat(store): add ProductEditor orchestrator`.

---

## Task P2-11: `<DeleteConfirmModal>`

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/delete-confirm-modal.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/delete-confirm-modal.test.tsx`

420px max-w, portaled to body (Radix Dialog), blurred scrim, red icon block top-left, title `Delete "<name>"?`, body copy, close X top-right, Cancel + Delete buttons in the footer. Dismiss on Esc / backdrop / Cancel. The Delete button calls `onConfirm()`.

Source-grep pins:
- Radix Dialog Portal
- 420 max width
- `Delete product` or `Delete` red button
- `Cancel` ghost button
- Red icon block via `--fg-danger` / `rgb(var(--danger`

PASS. Commit `feat(store): add DeleteConfirmModal portaled to body`.

---

## Task P2-12: `useUndoableDelete` hook

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/use-undoable-delete.ts`
- Test: `apps/web/src/app/(producer)/dashboard/store/__tests__/use-undoable-delete.test.ts`

Pure-function tests for the snapshot/restore logic + a small hook contract test. Body:

```ts
// use-undoable-delete.ts
//
// Encapsulates the snapshot-and-undo behaviour for the Phase 2 delete
// flow. Caller wires the toast action and the two server actions
// (archivePackage on delete; restorePackage on undo).

"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { archivePackage, restorePackage } from "~/app/(producer)/dashboard/booking/actions";
import { useToast } from "~/components/ui/toast";

export interface DeleteTarget {
  id: string;
  name: string;
}

export function useUndoableDelete() {
  const router = useRouter();
  const { toast } = useToast();

  return useCallback(
    async (target: DeleteTarget): Promise<void> => {
      const archive = await archivePackage({ id: target.id });
      if (!archive.ok) {
        toast(archive.error, "error");
        return;
      }
      router.refresh();
      toast(`"${target.name}" deleted.`, "success", {
        durationMs: 4500,
        action: {
          label: "Undo",
          onClick: async () => {
            const restore = await restorePackage({ id: target.id });
            if (restore.ok) {
              toast(`"${target.name}" restored.`, "success");
              router.refresh();
            } else {
              toast(restore.error, "error");
            }
          },
        },
      });
    },
    [router, toast],
  );
}
```

If the existing `useToast()` API doesn't accept `{durationMs, action}` shape, extend it minimally. Audit the toast primitive first; if it has only `toast(message, tone)`, this task ALSO adds an optional third options arg with `{durationMs?, action?}` and renders an action button in the toast template.

Source-grep test pins:
- `archivePackage` call
- `restorePackage` call
- 4500 or 4.5 second duration
- `label: "Undo"` action

PASS. Commit `feat(store): add useUndoableDelete hook`.

---

## Task P2-13: Wire `<ProductEditor>` into `<StoreScreen>`; remove `window.confirm`

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/store-screen.tsx`
- Modify: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-screen.test.tsx`

Changes inside `store-screen.tsx`:
1. Remove the two `DialogPrimitive.Root` blocks that mount `NewPackageForm` (both Create and Edit).
2. Mount `<ProductEditor>` once, with props `{ open, mode: "create" | "edit", product: editing | null, defaultCurrency, onClose }`.
3. Replace the `onDelete` handler. Drop `window.confirm`. Open `<DeleteConfirmModal>` (controlled by a `deleting: StoreProduct | null` state), and on confirm call the `useUndoableDelete` hook (Task P2-12).
4. Remove the `eslint-disable @typescript-eslint/no-unused-vars` on `duplicatePackage` — Phase 2 wires it into the editor's kebab/duplicate path if needed. (If we don't need it, drop the import.)
5. Remove `NewPackageForm` and `toInitialValues` from this file. They no longer mount here.

Update the regression test:
```ts
it("no longer uses window.confirm anywhere", () => {
  expect(SRC).not.toMatch(/window\.confirm/);
});

it("mounts the new ProductEditor and DeleteConfirmModal", () => {
  expect(SRC).toMatch(/<ProductEditor/);
  expect(SRC).toMatch(/<DeleteConfirmModal/);
});

it("no longer mounts NewPackageForm directly", () => {
  expect(SRC).not.toMatch(/NewPackageForm/);
});
```

The existing `it("reuses NewPackageForm for create + edit (Phase 2 replaces)")` test must be REPLACED, not deleted-without-replacement — the new assertion above takes its place.

Run typecheck + full test suite. Both must PASS. Commit `feat(store): wire ProductEditor + DeleteConfirmModal, remove window.confirm`.

---

## Task P2-14: Final verification + push

```bash
pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test && pnpm -F web build
```

All four must PASS. Push:
```bash
git push origin phase-1-store-redesign
```

Vercel auto-deploys to the same preview URL. Open in Incognito, verify:
- [ ] No browser confirm box appears anywhere
- [ ] `+ New product` opens the 4-step wizard, starting with Type
- [ ] Picking a preset advances to Includes and seeds the form
- [ ] Each step's StepBar segment is amber up to the current step
- [ ] Back / Continue / Save buttons work
- [ ] Save creates the product, toast confirms, page refreshes
- [ ] Edit on an existing card opens at the Includes step (3-step wizard)
- [ ] Delete opens the portaled red modal, Confirm removes the row, toast offers Undo for 4.5s
- [ ] Undo within 4.5s restores the row (as Hidden — producer reviews before publishing)
- [ ] No console errors in DevTools, no network 500s

Once visually confirmed, open the PR against `v3-clean`.

---

## Out of scope (Phase 2)

These are intentionally deferred to keep the PR shippable:
- File-upload mode of the contract step (uses a future R2 / file pipeline)
- Inline "type your terms" mode (needs a new column or another structured encoding)
- Drag-to-reorder of products (Phase 3)
- Table view (Phase 3)
- Live-pulse + new-glow animations (Phase 3)
- Schema columns for `revisions`, `turnaround` (Phase 4 — currently encoded into `description`)

## Risks

| Risk | Mitigation |
|---|---|
| `description` encoding leaks into tagline if a producer writes `\n---\n` in their tagline | Decode looks for `\n---\n` only between body and meta. Producer-typed `---` lines in the tagline body would land before the meta block, so they survive. Belt-and-braces: the decode regex requires `revisions:` to be present on the line immediately after, otherwise it treats the input as plain text. |
| Existing tRPC mutations don't accept the new shapes | Audit `packages.create` + `packages.update` zod schemas before implementing the editor's save. If they reject new fields, fall back to using only the columns they accept and surface the rest as a `TODO Phase 4` comment. |
| Old `NewPackageForm` imports break when removed | Grep across the repo before deleting the imports; only `store-screen.tsx` should still reference it after Phase 2. Any other surface (e.g. `/dashboard/booking`) keeps its own copy untouched. |
| Toast API doesn't support action buttons | Task P2-12 extends it minimally with a non-breaking optional `options` arg. If the API change touches more than one consumer, ship a tiny separate PR first. |
