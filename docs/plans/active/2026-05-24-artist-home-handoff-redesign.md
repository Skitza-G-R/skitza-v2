# Artist Home — High-Fidelity Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Replace the existing v3-clean artist home (`/artist`) with the high-fidelity handoff design — strong size hierarchy, primary Last Upload hero, secondary Next Session strip, payments list, producer tiles.

**Architecture:** Server Components for the page + four of the five sections (greeting strip, next-session, payments, book tiles). Only `last-upload-card.tsx` is a client component (it dispatches `playerPlay()` to the existing global `PersistentPlayer`). All data is fetched in the page via `appRouter.createCaller({ userId })`. Tests follow the Skitza source-grep convention: read the `.tsx`, assert imports/classNames/structure with whitespace-tolerant regexes.

**Tech Stack:** Next.js 15 App Router, tRPC v11, Tailwind v4, Vitest (node env), Drizzle (read-only — no schema changes), existing PersistentPlayer dispatch helpers.

**Design Doc:** `docs/plans/active/2026-05-24-artist-home-handoff-redesign-design.md`

**Linear:** [SK-33](https://linear.app/raz-stamper/issue/SK-33/artist-home-high-fidelity-redesign-handoff-package)

**Branch:** `giasraf/sk-33-artist-home-high-fidelity-redesign-handoff-package` (already cut from `v3-clean`)

---

## Conventions

- **TDD:** every task writes the failing test first, runs it, then implements, runs it again, commits.
- **Source-grep tests** (Skitza convention): use `readFileSync` on `.tsx` files; use `\s*` in regexes; never use `jsdom` or `@testing-library/react`.
- **Client components** never call tRPC directly — wrap mutations in Server Actions if needed. Pure read = server component.
- **Verify gate** before opening the PR: `pnpm typecheck && pnpm -F web lint && pnpm test`.
- **Commits are small.** One task → one commit. Use conventional commits (`feat:`, `fix:`, `chore:`, `test:`).

---

## Task 1: Add `--copper` token

**Files:**
- Modify: `apps/web/src/app/globals.css` (token block near other color tokens)

**Step 1: Write the failing test**

Create `apps/web/src/__tests__/copper-token.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("--copper token", () => {
  it("is defined in globals.css with the exact handoff value", () => {
    const css = readFileSync(
      join(__dirname, "../app/globals.css"),
      "utf-8",
    );
    expect(css).toMatch(/--copper:\s*#B06830/);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm -F web exec vitest run src/__tests__/copper-token.test.ts
```

Expected: FAIL (`--copper` not found).

**Step 3: Implement — add the token**

In `apps/web/src/app/globals.css`, inside the existing `:root { ... }` block (right under the other color tokens like `--brand-primary`), add:

```css
  --copper: #B06830;  /* payment amounts only — used on artist home payment rows */
```

**Step 4: Run test to verify it passes**

```bash
pnpm -F web exec vitest run src/__tests__/copper-token.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/__tests__/copper-token.test.ts
git commit -m "feat(tokens): add --copper for artist home payment amounts (SK-33)"
```

---

## Task 2: Add `unread` field to `artist.home().latestMix`

**Files:**
- Modify: `apps/web/src/server/trpc/routers/artist.ts` (latestMix select + result shaping)
- Modify: `apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts` (add coverage)

**Context:** The handoff's `NEW` badge on the Last Upload card is driven by `latestMix.unread`. We derive it from `clientContacts.lastSeenAt` for the same producer/artist pair. If `lastSeenAt` is null OR earlier than `track.uploadedAt`, the track is unread for this artist.

**Step 1: Read the existing latestMix select**

```bash
sed -n '1480,1700p' apps/web/src/server/trpc/routers/artist.ts
```

Locate the `latestMixRows` query (around line 1488 from earlier grep) and the `mixRow` → `latestMix` shaping (around line 1680). The select needs to be extended to bring back `clientContacts.lastSeenAt` for the producer behind that track. The shaped result needs an `unread: boolean`.

**Step 2: Write the failing test**

In `apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts`, add a test that asserts the shape of `latestMix` includes `unread`. Pattern (source-grep style — assert the router file exposes the field):

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../artist.ts"),
  "utf-8",
);

describe("artist.home() — latestMix shape", () => {
  it("exposes an `unread` boolean derived from clientContacts.lastSeenAt", () => {
    // The shaping block builds the public latestMix object — assert
    // it includes `unread`.
    expect(SRC).toMatch(/latestMix\s*=\s*mixRow[\s\S]*?unread:\s*/);
  });
});
```

**Step 3: Run test to verify it fails**

```bash
pnpm -F web exec vitest run src/server/trpc/routers/__tests__/artist-home.test.ts
```

Expected: FAIL — `unread:` not yet in the shaping block.

**Step 4: Implement**

In `apps/web/src/server/trpc/routers/artist.ts`, locate the `latestMixRows` select (the one that selects from `tracks` joined to `producers` and the artist's `clientContacts`). Extend the select to include `lastSeenAt: clientContacts.lastSeenAt`. Then in the `mixRow` → `latestMix` shaping block, add:

```typescript
const mixRow = latestMixRows[0];
const latestMix = mixRow
  ? {
      id: mixRow.id,
      trackTitle: mixRow.trackTitle,
      label: mixRow.label,
      producerName: mixRow.producerName ?? "Untitled Studio",
      producerSlug: mixRow.producerSlug,
      projectId: mixRow.projectId,
      uploadedAt: mixRow.uploadedAt,
      audioUrl: mixRow.audioUrl,
      durationMs: mixRow.durationMs,
      // Derive unread: no lastSeenAt OR lastSeenAt is before the
      // upload → the artist hasn't acknowledged this track yet.
      unread:
        !mixRow.lastSeenAt ||
        mixRow.lastSeenAt.getTime() < mixRow.uploadedAt.getTime(),
    }
  : null;
```

If `lastSeenAt` isn't already joined into the existing query (it may be — that join already exists for the artist gate), add it via a `leftJoin(clientContacts, ...)` on the producer + clerkUserId pair.

**Step 5: Run test + typecheck**

```bash
pnpm -F web exec vitest run src/server/trpc/routers/__tests__/artist-home.test.ts
pnpm typecheck
```

Expected: both PASS.

**Step 6: Commit**

```bash
git add apps/web/src/server/trpc/routers/artist.ts apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts
git commit -m "feat(artist/home): surface unread flag on latestMix (SK-33)"
```

---

## Task 3: Expose `plan` field on `artist.book.myPendingPayments()`

**Files:**
- Modify: `apps/web/src/server/trpc/routers/artist.ts` (extend the mapped result around line 903–918)

**Context:** The handoff's payment row meta line reads `Gili · 50-50` (producer name + plan kind). The kind is already computed inline as `firstPlan.kind` to decide `amountCents`. We just surface it.

**Step 1: Write the failing test**

In `apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts`, add:

```typescript
describe("artist.book.myPendingPayments() — booking shape", () => {
  it("exposes a `plan` string on each booking row", () => {
    expect(SRC).toMatch(/myPendingPayments[\s\S]*?return\s*\{[\s\S]*?plan:\s*/);
  });
});
```

**Step 2: Run + verify fail**

```bash
pnpm -F web exec vitest run src/server/trpc/routers/__tests__/artist-home.test.ts
```

Expected: FAIL.

**Step 3: Implement**

In `apps/web/src/server/trpc/routers/artist.ts` (around line 903), extend the mapped result. The existing code computes `firstPlan` then `amountCents`; thread `firstPlan?.kind` (default to `'upfront'`) into the return:

```typescript
const out = rows.map((r) => {
  const price = r.priceCents ?? 0;
  const firstPlan = r.paymentPlans?.[0];
  let amountCents = price;
  if (firstPlan?.kind === "split_50_50") amountCents = Math.round(price / 2);
  else if (firstPlan?.kind === "monthly")
    amountCents = Math.round(price / firstPlan.installments);
  // Plan label for the artist home payment row. Normalize the
  // split_50_50 kind to the display string "50-50" since the UI
  // matches the handoff copy.
  const plan: "50-50" | "monthly" | "upfront" =
    firstPlan?.kind === "split_50_50"
      ? "50-50"
      : firstPlan?.kind === "monthly"
        ? "monthly"
        : "upfront";
  return {
    id: r.id,
    startsAt: r.startsAt,
    producerName: r.producerName ?? "Producer",
    packageName: r.packageName ?? "Session",
    amountCents,
    currency: r.currency ?? "ILS",
    plan,
  };
});
```

**Step 4: Run test + typecheck**

```bash
pnpm -F web exec vitest run src/server/trpc/routers/__tests__/artist-home.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/server/trpc/routers/artist.ts apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts
git commit -m "feat(artist/book): expose plan label on myPendingPayments rows (SK-33)"
```

---

## Task 4: Build `producer-art.tsx` (shared gradient art block)

**Files:**
- Create: `apps/web/src/components/artist/home/producer-art.tsx`
- Create: `apps/web/src/components/artist/home/__tests__/producer-art.test.ts`

**Context:** Used by both the Last Upload album art and the Book-a-session tiles. Renders an absolutely-positioned square with the producer's gradient + radial sheen overlay + initials. Hue is derived deterministically from the producer name (so the same producer always gets the same gradient).

**Step 1: Write the failing test**

`apps/web/src/components/artist/home/__tests__/producer-art.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../producer-art.tsx"),
  "utf-8",
);

describe("ProducerArt", () => {
  it("exports a default React component", () => {
    expect(SRC).toMatch(/export\s+function\s+ProducerArt/);
  });

  it("computes hue deterministically from the producer name", () => {
    expect(SRC).toMatch(/function\s+hueFromName/);
  });

  it("renders the OKLCH linear-gradient and the radial sheen overlay", () => {
    expect(SRC).toMatch(/oklch\(/);
    expect(SRC).toMatch(/radial-gradient\(/);
  });

  it("renders initials computed from the producer name", () => {
    expect(SRC).toMatch(/function\s+initialsFromName/);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/producer-art.test.ts
```

Expected: FAIL (file not found).

**Step 3: Implement**

`apps/web/src/components/artist/home/producer-art.tsx`:

```tsx
// Shared producer art block. Renders the gradient + radial sheen +
// producer initials in a fixed-size square. Used by the Last Upload
// card (170×170) and the Book-a-session tiles (44×44).

import type { CSSProperties } from "react";

type Props = {
  producerName: string;
  size: number;
  initialsFontSize?: number;
  className?: string;
};

export function ProducerArt({
  producerName,
  size,
  initialsFontSize,
  className,
}: Props) {
  const hue = hueFromName(producerName);
  const fontSize = initialsFontSize ?? Math.round(size * 0.13);
  const inset = Math.max(8, Math.round(size * 0.06));
  const gradientStyle: CSSProperties = {
    width: size,
    height: size,
    background: `linear-gradient(135deg, oklch(0.72 0.13 ${hue}) 0%, oklch(0.45 0.14 ${hue + 30}) 100%)`,
  };
  return (
    <div
      className={
        "relative shrink-0 overflow-hidden rounded-[10px] " + (className ?? "")
      }
      style={gradientStyle}
      aria-hidden
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 30% 18%, rgba(255,255,255,.28), transparent 62%)",
        }}
      />
      <span
        className="absolute font-bold text-white/95"
        style={{
          left: inset,
          bottom: inset,
          fontFamily: "var(--font-syne)",
          fontSize,
          letterSpacing: "-0.01em",
          textShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      >
        {initialsFromName(producerName)}
      </span>
    </div>
  );
}

// Deterministic hue (0–360) from a name. Same hash style as the
// existing `deriveGradient` helper so two surfaces of the same
// producer pick consistent colors.
export function hueFromName(name: string): number {
  if (!name) return 28; // fallback amber
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

// 1–2 letter initials. "Gili Studio" → "GS", "Skitza" → "S".
export function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const words = trimmed.split(/\s+/).slice(0, 2);
  const letters = words.map((w) => w.charAt(0).toUpperCase()).join("");
  return letters || "??";
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/producer-art.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/home/producer-art.tsx apps/web/src/components/artist/home/__tests__/producer-art.test.ts
git commit -m "feat(artist/home): add shared ProducerArt component (SK-33)"
```

---

## Task 5: Build `greeting-strip.tsx`

**Files:**
- Create: `apps/web/src/components/artist/home/greeting-strip.tsx`
- Create: `apps/web/src/components/artist/home/__tests__/greeting-strip.test.ts`

**Step 1: Failing test**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../greeting-strip.tsx"),
  "utf-8",
);

describe("GreetingStrip", () => {
  it("exports a server component", () => {
    expect(SRC).toMatch(/export\s+function\s+GreetingStrip/);
    expect(SRC).not.toMatch(/^"use client"/m);
  });

  it("renders date eyebrow in mono + uppercase", () => {
    expect(SRC).toMatch(/uppercase/);
    expect(SRC).toMatch(/font-mono|--font-jetbrains-mono/);
  });

  it("renders greeting with Syne", () => {
    expect(SRC).toMatch(/--font-syne/);
  });

  it("does NOT render a search input or '+ New project' CTA", () => {
    expect(SRC).not.toMatch(/<input/i);
    expect(SRC).not.toMatch(/New project/i);
  });
});
```

**Step 2: Run, expect FAIL**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/greeting-strip.test.ts
```

**Step 3: Implement**

`apps/web/src/components/artist/home/greeting-strip.tsx`:

```tsx
// Greeting strip at the very top of the artist home page. Date
// eyebrow + "Good afternoon, {firstName}." — no search, no CTA.

type Props = {
  firstName: string;
  now?: Date;
};

export function GreetingStrip({ firstName, now }: Props) {
  const date = now ?? new Date();
  const dateLabel = date
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase()
    .replace(/,/g, " ·");
  const greeting = greetingForHour(date.getHours(), firstName);
  return (
    <header className="pb-4">
      <p
        className="uppercase text-[10.5px] font-semibold tracking-[0.12em] text-[var(--fg-muted)]"
        style={{ fontFamily: "var(--font-jetbrains-mono)" }}
      >
        {dateLabel}
      </p>
      <h1
        className="mt-1 text-[22px] font-extrabold text-[var(--fg-default)]"
        style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.03em" }}
      >
        {greeting}
      </h1>
    </header>
  );
}

function greetingForHour(hour: number, firstName: string): string {
  if (hour < 5) return `Working late, ${firstName}.`;
  if (hour < 12) return `Good morning, ${firstName}.`;
  if (hour < 18) return `Good afternoon, ${firstName}.`;
  return `Good evening, ${firstName}.`;
}
```

**Step 4: Run test + typecheck**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/greeting-strip.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/home/greeting-strip.tsx apps/web/src/components/artist/home/__tests__/greeting-strip.test.ts
git commit -m "feat(artist/home): add GreetingStrip (SK-33)"
```

---

## Task 6: Build `last-upload-card.tsx` (primary hero)

**Files:**
- Create: `apps/web/src/components/artist/home/last-upload-card.tsx`
- Create: `apps/web/src/components/artist/home/__tests__/last-upload-card.test.ts`

**Context:** This is the PRIMARY card. Full content width. 170×170 art on the left with a 52px amber Play FAB inside (bottom-right corner). NEW badge if `unread`. Syne 26px title. Producer · uploadedAt below. Two pill buttons at the bottom: filled-dark `Play track` and outline `Open library →`. Client component — calls `playerPlay()` and reads `useNowPlaying()` to toggle FAB icon.

**Step 1: Failing test**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../last-upload-card.tsx"),
  "utf-8",
);

describe("LastUploadCard", () => {
  it("is a client component (uses player)", () => {
    expect(SRC).toMatch(/^"use client"/m);
  });

  it("imports the ProducerArt and player helpers", () => {
    expect(SRC).toMatch(/import\s*\{\s*ProducerArt\s*\}/);
    expect(SRC).toMatch(/playerPlay/);
    expect(SRC).toMatch(/useNowPlaying/);
  });

  it("does NOT call tRPC directly", () => {
    expect(SRC).not.toMatch(/useMutation/);
    expect(SRC).not.toMatch(/api\.[a-zA-Z]+\.[a-zA-Z]+\.useMutation/);
  });

  it("renders the LAST UPLOAD eyebrow", () => {
    expect(SRC).toMatch(/LAST\s*UPLOAD/);
  });

  it("renders a NEW badge when unread", () => {
    expect(SRC).toMatch(/track\.unread|latestMix\.unread|unread\s*&&/);
    expect(SRC).toMatch(/>NEW</);
  });

  it("renders an Open library button linking to the project page", () => {
    expect(SRC).toMatch(/Open\s*library/);
    expect(SRC).toMatch(/\/artist\/music\//);
  });

  it("renders an empty-state when latestMix is null", () => {
    expect(SRC).toMatch(/Nothing\s*new/);
  });
});
```

**Step 2: Run, expect FAIL**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/last-upload-card.test.ts
```

**Step 3: Implement**

`apps/web/src/components/artist/home/last-upload-card.tsx`:

```tsx
"use client";

import Link from "next/link";

import {
  playerPlay,
  useNowPlaying,
} from "~/components/audio/persistent-player";
import { ProducerArt } from "./producer-art";

export type LastUploadProps = {
  latestMix: {
    id: string;
    trackTitle: string;
    label: string | null;
    producerName: string;
    projectId: string;
    uploadedAt: Date;
    audioUrl: string | null;
    durationMs: number | null;
    unread: boolean;
  } | null;
};

const ART_SIZE = 170;
const FAB_SIZE = 52;

export function LastUploadCard({ latestMix }: LastUploadProps) {
  if (!latestMix) return <EmptyState />;
  return <FilledCard latestMix={latestMix} />;
}

function FilledCard({ latestMix }: { latestMix: NonNullable<LastUploadProps["latestMix"]> }) {
  const { trackId, playing } = useNowPlaying();
  const isThisPlaying = trackId === latestMix.id && playing;
  const onPlay = () => {
    playerPlay({
      id: latestMix.id,
      audioUrl: latestMix.audioUrl,
      title: `${latestMix.trackTitle}${latestMix.label ? ` · ${latestMix.label}` : ""}`,
      subtitle: latestMix.producerName,
      durationMs: latestMix.durationMs,
    });
  };
  const subtitle = `${latestMix.producerName} · ${relativeFrom(latestMix.uploadedAt)}`;
  return (
    <article className="flex gap-5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 transition-shadow hover:shadow-sm">
      <div className="relative" style={{ width: ART_SIZE, height: ART_SIZE }}>
        <button
          type="button"
          onClick={onPlay}
          className="absolute inset-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          aria-label={isThisPlaying ? "Pause track" : "Play track"}
        >
          <ProducerArt
            producerName={latestMix.producerName}
            size={ART_SIZE}
            initialsFontSize={20}
          />
        </button>
        <span
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center rounded-full"
          style={{
            width: FAB_SIZE,
            height: FAB_SIZE,
            bottom: 10,
            right: 10,
            backgroundColor: "var(--brand-primary)",
            color: "#111009",
            boxShadow: "0 6px 18px rgba(0,0,0,0.28)",
          }}
        >
          {isThisPlaying ? <PauseIcon /> : <PlayIcon />}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <p
            className="uppercase text-[9.5px] font-semibold tracking-[0.12em] text-[var(--fg-muted)]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            LAST UPLOAD
          </p>
          {latestMix.unread && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.08em]"
              style={{
                backgroundColor: "var(--brand-primary)",
                color: "#111009",
                fontFamily: "var(--font-jetbrains-mono)",
              }}
            >
              NEW
            </span>
          )}
        </div>
        <h2
          className="mt-1 truncate text-[26px] font-extrabold text-[var(--fg-default)]"
          style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.03em", lineHeight: 1.15 }}
        >
          {latestMix.trackTitle}
          {latestMix.label ? <span className="text-[var(--fg-muted)]"> · {latestMix.label}</span> : null}
        </h2>
        <p className="mt-1 truncate text-[12.5px] text-[var(--fg-muted)]">
          {subtitle}
        </p>
        <div className="mt-auto flex items-center gap-2 pt-4">
          <button
            type="button"
            onClick={onPlay}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-sidebar)] px-3.5 py-2 text-[13px] font-bold text-[var(--brand-primary)] transition-transform hover:brightness-110 active:scale-[0.97]"
          >
            <PlayIcon size={12} />
            {isThisPlaying ? "Pause track" : "Play track"}
          </button>
          <Link
            href={`/artist/music/${latestMix.projectId}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--fg-default)] transition-colors hover:bg-[var(--bg-background)]"
          >
            Open library →
          </Link>
        </div>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <article className="flex gap-5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
      <div
        className="rounded-[10px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-background)]"
        style={{ width: ART_SIZE, height: ART_SIZE }}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <p
            className="uppercase text-[9.5px] font-semibold tracking-[0.12em] text-[var(--fg-muted)]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            LAST UPLOAD
          </p>
          <h2
            className="mt-1 text-[22px] font-extrabold text-[var(--fg-default)]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.03em" }}
          >
            Nothing new from your studios yet.
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--fg-muted)]">
            Mixes show up here the moment a producer uploads.
          </p>
        </div>
        <div className="pt-4">
          <Link
            href="/artist/music"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--fg-default)] transition-colors hover:bg-[var(--bg-background)]"
          >
            Open library →
          </Link>
        </div>
      </div>
    </article>
  );
}

function relativeFrom(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  );
}

function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" />
    </svg>
  );
}
```

**Step 4: Run tests + typecheck + lint**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/last-upload-card.test.ts
pnpm typecheck
pnpm -F web exec eslint apps/web/src/components/artist/home/last-upload-card.tsx
```

Expected: all PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/home/last-upload-card.tsx apps/web/src/components/artist/home/__tests__/last-upload-card.test.ts
git commit -m "feat(artist/home): primary LastUploadCard (SK-33)"
```

---

## Task 7: Build new `next-session-card.tsx` (compact strip, REPLACES existing)

**Files:**
- Replace: `apps/web/src/components/artist/home/next-session-card.tsx` (overwrite)
- Create: `apps/web/src/components/artist/home/__tests__/next-session-card.test.ts` (overwrite if exists)

**Context:** One-row strip, ~72px tall. Avatar (28px ProducerArt) + title + time row on the left; TODAY badge + `Open calendar →` outline pill on the right. NO Join button. Empty state replaces the body with `No session booked.` + amber `Book a session →` CTA.

**Step 1: Failing test**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../next-session-card.tsx"),
  "utf-8",
);

describe("NextSessionCard (compact strip)", () => {
  it("is a server component (no client interactivity)", () => {
    expect(SRC).not.toMatch(/^"use client"/m);
  });

  it("has NO Join button", () => {
    expect(SRC).not.toMatch(/>\s*Join\s*</);
    expect(SRC).not.toMatch(/aria-label="Join"/);
  });

  it("has a single Open calendar CTA pointing to /artist/book", () => {
    expect(SRC).toMatch(/Open\s*calendar/);
    expect(SRC).toMatch(/href="\/artist\/book"/);
  });

  it("uses ProducerArt for the avatar", () => {
    expect(SRC).toMatch(/import\s*\{\s*ProducerArt\s*\}/);
  });

  it("renders TODAY badge gated by isToday helper", () => {
    expect(SRC).toMatch(/function\s+isToday/);
    expect(SRC).toMatch(/>TODAY</);
  });

  it("renders an empty state with Book a session CTA", () => {
    expect(SRC).toMatch(/No\s*session\s*booked/);
    expect(SRC).toMatch(/Book\s*a\s*session/);
  });
});
```

**Step 2: Run, expect FAIL**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/next-session-card.test.ts
```

The existing file may need to be removed before the new test runs cleanly:

```bash
rm -f apps/web/src/components/artist/home/next-session-card.tsx
```

After removing, the test should still fail (file not found).

**Step 3: Implement**

`apps/web/src/components/artist/home/next-session-card.tsx`:

```tsx
import Link from "next/link";

import { ProducerArt } from "./producer-art";

export type NextSessionStripProps = {
  nextSession: {
    id: string;
    startsAt: Date;
    durationMin: number;
    producerName: string;
    productName: string | null;
  } | null;
};

export function NextSessionCard({ nextSession }: NextSessionStripProps) {
  if (!nextSession) return <EmptyState />;
  const today = isToday(nextSession.startsAt);
  return (
    <article className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <ProducerArt
        producerName={nextSession.producerName}
        size={36}
        initialsFontSize={11}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <h3
            className="truncate text-[16px] font-bold text-[var(--fg-default)]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.02em" }}
          >
            {nextSession.productName ?? "Session"}
          </h3>
          {today && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.08em]"
              style={{
                backgroundColor: "var(--brand-primary)",
                color: "#111009",
                fontFamily: "var(--font-jetbrains-mono)",
              }}
            >
              TODAY
            </span>
          )}
        </div>
        <p
          className="mt-0.5 truncate text-[12.5px] text-[var(--fg-muted)]"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          {formatSessionLine(nextSession.startsAt, nextSession.durationMin)}
        </p>
      </div>
      <Link
        href="/artist/book"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--fg-default)] transition-colors hover:bg-[var(--bg-background)]"
      >
        Open calendar →
      </Link>
    </article>
  );
}

function EmptyState() {
  return (
    <article className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <div
        className="size-9 rounded-full border border-dashed border-[var(--border-subtle)] bg-[var(--bg-background)]"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3
          className="truncate text-[16px] font-bold text-[var(--fg-default)]"
          style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.02em" }}
        >
          No session booked.
        </h3>
        <p className="mt-0.5 truncate text-[12.5px] text-[var(--fg-muted)]">
          When you book your next session it shows up here.
        </p>
      </div>
      <Link
        href="/artist/book"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand-primary)] px-3.5 py-2 text-[12.5px] font-bold text-[#111009] transition-transform hover:brightness-110 active:scale-[0.97]"
      >
        Book a session →
      </Link>
    </article>
  );
}

export function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatSessionLine(startsAt: Date, durationMin: number): string {
  const weekday = startsAt.toLocaleDateString("en-US", { weekday: "short" });
  const hh = String(startsAt.getHours()).padStart(2, "0");
  const mm = String(startsAt.getMinutes()).padStart(2, "0");
  const end = new Date(startsAt.getTime() + durationMin * 60_000);
  const endHh = String(end.getHours()).padStart(2, "0");
  const endMm = String(end.getMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}–${endHh}:${endMm} · ${durationMin}m`;
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/next-session-card.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/home/next-session-card.tsx apps/web/src/components/artist/home/__tests__/next-session-card.test.ts
git commit -m "feat(artist/home): compact NextSessionCard strip with Open calendar CTA (SK-33)"
```

---

## Task 8: Build `payment-requests-section.tsx`

**Files:**
- Create: `apps/web/src/components/artist/home/payment-requests-section.tsx`
- Create: `apps/web/src/components/artist/home/__tests__/payment-requests-section.test.ts`

**Context:** Section header (`Payment requests   N OPEN · $TOTAL` + `Pay all →`) + thin list (up to 3 rows). Each row: avatar + title/meta stack + copper amount + dark Pay pill. Server component. Pay button points to the existing payment route.

**Step 1: Failing test**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../payment-requests-section.tsx"),
  "utf-8",
);

describe("PaymentRequestsSection", () => {
  it("uses --copper for amounts", () => {
    expect(SRC).toMatch(/var\(--copper\)/);
  });

  it("caps the visible list at 3 rows", () => {
    expect(SRC).toMatch(/\.slice\(0,\s*3\)/);
  });

  it("renders Pay all → action", () => {
    expect(SRC).toMatch(/Pay\s*all/);
  });

  it("shows the plan label on each row", () => {
    expect(SRC).toMatch(/booking\.plan|row\.plan/);
  });

  it("renders nothing when there are no open invoices", () => {
    expect(SRC).toMatch(/bookings\.length\s*===\s*0/);
  });
});
```

**Step 2: Run, expect FAIL**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/payment-requests-section.test.ts
```

**Step 3: Implement**

`apps/web/src/components/artist/home/payment-requests-section.tsx`:

```tsx
import Link from "next/link";

import { ProducerArt } from "./producer-art";

export type PaymentRequestsProps = {
  bookings: Array<{
    id: string;
    startsAt: Date;
    producerName: string;
    packageName: string;
    amountCents: number;
    currency: string;
    plan: "50-50" | "monthly" | "upfront";
  }>;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

function formatAmount(cents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const amt = cents / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: amt % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amt);
  return `${symbol}${formatted}`;
}

export function PaymentRequestsSection({ bookings }: PaymentRequestsProps) {
  if (bookings.length === 0) return null;

  const visible = bookings.slice(0, 3);
  const total = bookings.reduce((sum, b) => sum + b.amountCents, 0);
  const currency = bookings[0]?.currency ?? "USD";

  return (
    <section aria-labelledby="payment-requests-heading">
      <header className="flex items-baseline justify-between border-b border-[var(--border-subtle)] pb-2">
        <div className="flex items-baseline gap-3">
          <h2
            id="payment-requests-heading"
            className="text-[14px] font-bold text-[var(--fg-default)]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.01em" }}
          >
            Payment requests
          </h2>
          <span
            className="uppercase text-[10.5px] tracking-[0.04em] text-[var(--fg-muted)]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            {bookings.length} OPEN · {formatAmount(total, currency)}
          </span>
        </div>
        <Link
          href="/artist/book"
          className="text-[12px] font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-default)]"
        >
          Pay all →
        </Link>
      </header>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {visible.map((booking) => (
          <li
            key={booking.id}
            className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-3 px-1 py-2.5"
          >
            <ProducerArt
              producerName={booking.producerName}
              size={28}
              initialsFontSize={10}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13.5px] font-semibold text-[var(--fg-default)]">
                {booking.packageName}
              </span>
              <span className="truncate text-[11.5px] text-[var(--fg-muted)]">
                {booking.producerName} ·{" "}
                <span style={{ fontFamily: "var(--font-jetbrains-mono)" }}>
                  {booking.plan}
                </span>
              </span>
            </div>
            <span
              className="text-[14.5px] font-extrabold"
              style={{
                fontFamily: "var(--font-syne)",
                letterSpacing: "-0.02em",
                color: "var(--copper)",
              }}
            >
              {formatAmount(booking.amountCents, booking.currency)}
            </span>
            <Link
              href={`/artist/payment/${booking.id}`}
              className="inline-flex items-center rounded-full bg-[var(--bg-sidebar)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--brand-primary)] transition-transform hover:brightness-110 active:scale-[0.97]"
            >
              Pay
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/payment-requests-section.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/home/payment-requests-section.tsx apps/web/src/components/artist/home/__tests__/payment-requests-section.test.ts
git commit -m "feat(artist/home): PaymentRequestsSection list with copper amounts (SK-33)"
```

---

## Task 9: Build `book-session-tiles.tsx`

**Files:**
- Create: `apps/web/src/components/artist/home/book-session-tiles.tsx`
- Create: `apps/web/src/components/artist/home/__tests__/book-session-tiles.test.ts`

**Context:** Section header (`Book a session   N IN ROSTER` + `Browse all →`) + grid of producer tiles. Each tile is 2-col grid (44px art + name stack). Tile links to `/artist/book?producerId={id}`. Empty state shows a single "Find a studio" CTA.

**Step 1: Failing test**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../book-session-tiles.tsx"),
  "utf-8",
);

describe("BookSessionTiles", () => {
  it("renders Book a session heading", () => {
    expect(SRC).toMatch(/Book\s*a\s*session/);
  });

  it("uses producerId in the tile href", () => {
    expect(SRC).toMatch(/\/artist\/book\?producerId=/);
  });

  it("renders Browse all →", () => {
    expect(SRC).toMatch(/Browse\s*all/);
  });

  it("uses ProducerArt for the tile thumbnail", () => {
    expect(SRC).toMatch(/import\s*\{\s*ProducerArt\s*\}/);
  });

  it("renders an empty state with Find a studio CTA", () => {
    expect(SRC).toMatch(/Find\s*a\s*studio/);
  });
});
```

**Step 2: Run, expect FAIL**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/book-session-tiles.test.ts
```

**Step 3: Implement**

`apps/web/src/components/artist/home/book-session-tiles.tsx`:

```tsx
import Link from "next/link";

import { ProducerArt } from "./producer-art";

export type BookSessionTilesProps = {
  studios: Array<{
    producerId: string;
    producerName: string;
    producerSlug: string;
  }>;
};

export function BookSessionTiles({ studios }: BookSessionTilesProps) {
  return (
    <section aria-labelledby="book-session-heading">
      <header className="flex items-baseline justify-between border-b border-[var(--border-subtle)] pb-2">
        <div className="flex items-baseline gap-3">
          <h2
            id="book-session-heading"
            className="text-[14px] font-bold text-[var(--fg-default)]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.01em" }}
          >
            Book a session
          </h2>
          <span
            className="uppercase text-[10.5px] tracking-[0.04em] text-[var(--fg-muted)]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            {studios.length} IN ROSTER
          </span>
        </div>
        <Link
          href="/artist/book"
          className="text-[12px] font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-default)]"
        >
          Browse all →
        </Link>
      </header>
      {studios.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {studios.map((s) => (
            <li key={s.producerId}>
              <Link
                href={`/artist/book?producerId=${s.producerId}`}
                className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 transition-colors hover:bg-[var(--bg-background)]"
              >
                <ProducerArt
                  producerName={s.producerName}
                  size={44}
                  initialsFontSize={14}
                />
                <span className="truncate text-[12.5px] font-semibold text-[var(--fg-default)]">
                  {s.producerName}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <Link
      href="/artist/book"
      className="mt-3 flex items-center justify-center rounded-[10px] border border-dashed border-[var(--border-subtle)] px-4 py-6 text-[13px] font-semibold text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-background)]"
    >
      Find a studio →
    </Link>
  );
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm -F web exec vitest run src/components/artist/home/__tests__/book-session-tiles.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/home/book-session-tiles.tsx apps/web/src/components/artist/home/__tests__/book-session-tiles.test.ts
git commit -m "feat(artist/home): BookSessionTiles producer roster section (SK-33)"
```

---

## Task 10: Rewrite `apps/web/src/app/(artist)/artist/page.tsx`

**Files:**
- Rewrite: `apps/web/src/app/(artist)/artist/page.tsx`

**Step 1: Failing test (page composition smoke test)**

Create `apps/web/src/app/(artist)/artist/__tests__/page.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../page.tsx"),
  "utf-8",
);

describe("/artist page composition", () => {
  it("imports the 5 new home sections", () => {
    expect(SRC).toMatch(/import\s*\{\s*GreetingStrip\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*LastUploadCard\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*NextSessionCard\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*PaymentRequestsSection\s*\}/);
    expect(SRC).toMatch(/import\s*\{\s*BookSessionTiles\s*\}/);
  });

  it("fetches the three tRPC procedures in parallel", () => {
    expect(SRC).toMatch(/caller\.artist\.home\(\)/);
    expect(SRC).toMatch(/caller\.artist\.book\.myPendingPayments\(\)/);
    expect(SRC).toMatch(/caller\.artist\.studios\(\)/);
    expect(SRC).toMatch(/Promise\.all/);
  });

  it("does NOT import the deleted v3-clean components", () => {
    expect(SRC).not.toMatch(/HomeHero|LatestMixCard|UpcomingSessionsCard|BalanceCard|ActivityFeed/);
  });
});
```

**Step 2: Run, expect FAIL**

```bash
pnpm -F web exec vitest run "src/app/(artist)/artist/__tests__/page.test.ts"
```

**Step 3: Implement — rewrite page.tsx**

`apps/web/src/app/(artist)/artist/page.tsx`:

```tsx
import { auth, currentUser } from "@clerk/nextjs/server";

import { BookSessionTiles } from "~/components/artist/home/book-session-tiles";
import { GreetingStrip } from "~/components/artist/home/greeting-strip";
import { LastUploadCard } from "~/components/artist/home/last-upload-card";
import { NextSessionCard } from "~/components/artist/home/next-session-card";
import { PaymentRequestsSection } from "~/components/artist/home/payment-requests-section";
import { appRouter } from "~/server/trpc/routers/_app";

import { WelcomeModal } from "./welcome-modal";

// /artist — high-fidelity redesign (SK-33).
//
// Single column, top to bottom:
//   1. GreetingStrip       — date eyebrow + greeting
//   2. LastUploadCard      — PRIMARY hero (170×170 art + big Play FAB)
//   3. NextSessionCard     — SECONDARY compact strip
//   4. PaymentRequestsSection — TERTIARY thin list (up to 3 rows)
//   5. BookSessionTiles    — QUATERNARY producer roster tiles
//
// All four sections handle their own empty states. PersistentPlayer
// is mounted by the artist app shell and stays where it is.

export default async function ArtistHomePage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const [user, data, pendingPayments, studiosResp] = await Promise.all([
    currentUser(),
    caller.artist.home(),
    caller.artist.book.myPendingPayments(),
    caller.artist.studios(),
  ]);

  const firstName = user?.firstName?.trim() || "there";

  return (
    <>
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5 px-7 py-6">
        <GreetingStrip firstName={firstName} />
        <LastUploadCard latestMix={data.latestMix} />
        <NextSessionCard nextSession={data.nextSession} />
        <PaymentRequestsSection bookings={pendingPayments.bookings} />
        <BookSessionTiles studios={studiosResp.studios} />
      </div>
      <WelcomeModal />
    </>
  );
}
```

**Step 4: Run tests + typecheck + lint**

```bash
pnpm -F web exec vitest run "src/app/(artist)/artist/__tests__/page.test.ts"
pnpm typecheck
pnpm -F web exec eslint "apps/web/src/app/(artist)/artist/page.tsx"
```

Expected: all PASS.

**Step 5: Commit**

```bash
git add apps/web/src/app/\(artist\)/artist/page.tsx apps/web/src/app/\(artist\)/artist/__tests__/page.test.ts
git commit -m "feat(artist/home): rewrite page to compose new sections (SK-33)"
```

---

## Task 11: Delete the old v3-clean home components

**Files (delete):**
- `apps/web/src/components/artist/home/home-hero.tsx`
- `apps/web/src/components/artist/home/latest-mix-card.tsx`
- `apps/web/src/components/artist/home/upcoming-sessions-card.tsx`
- `apps/web/src/components/artist/home/balance-card.tsx`
- `apps/web/src/components/artist/home/activity-feed.tsx`
- Any `__tests__/*.test.ts` for the above components

`next-session-card.tsx` is NOT deleted here — Task 7 already overwrote it in place.

**Step 1: List what's there**

```bash
ls apps/web/src/components/artist/home/
ls apps/web/src/components/artist/home/__tests__/ 2>/dev/null || true
```

**Step 2: Delete the files**

```bash
rm apps/web/src/components/artist/home/home-hero.tsx
rm apps/web/src/components/artist/home/latest-mix-card.tsx
rm apps/web/src/components/artist/home/upcoming-sessions-card.tsx
rm apps/web/src/components/artist/home/balance-card.tsx
rm apps/web/src/components/artist/home/activity-feed.tsx
# Delete any matching test files (skip the new ones we created):
rm -f apps/web/src/components/artist/home/__tests__/home-hero.test.ts
rm -f apps/web/src/components/artist/home/__tests__/latest-mix-card.test.ts
rm -f apps/web/src/components/artist/home/__tests__/upcoming-sessions-card.test.ts
rm -f apps/web/src/components/artist/home/__tests__/balance-card.test.ts
rm -f apps/web/src/components/artist/home/__tests__/activity-feed.test.ts
```

**Step 3: Search for stragglers (anything else importing the deleted files)**

```bash
grep -rn "home-hero\|latest-mix-card\|upcoming-sessions-card\|balance-card\|activity-feed" apps/web/src/ --include="*.ts" --include="*.tsx" || echo "no stragglers"
```

Expected: `no stragglers`. If any references remain (e.g. an index barrel re-export), update or delete those.

**Step 4: Verify everything still compiles**

```bash
pnpm typecheck
pnpm -F web exec vitest run
```

Expected: all PASS.

**Step 5: Commit**

```bash
git add -u apps/web/src/components/artist/home/
git commit -m "chore(artist/home): delete pre-SK-33 home components (SK-33)"
```

---

## Task 12: Full verify gate

**Step 1: Run the gate**

```bash
pnpm typecheck && pnpm -F web lint && pnpm test
```

(Or use the shortcut: `/skitza-verify`.)

Expected: all three pass with zero warnings (lint is `--max-warnings 0`).

**Step 2: Fix anything that surfaces**

- typecheck errors → fix at the source.
- lint warnings → fix the file (Vercel's build rejects warnings).
- failing tests → check whether it's a real regression or an outdated test snapshot.

**Step 3: Commit any fixes**

If fixes were needed:

```bash
git add -A
git commit -m "fix(artist/home): address verify-gate findings (SK-33)"
```

---

## Task 13: Open the PR

**Step 1: Push the branch**

```bash
git push -u origin giasraf/sk-33-artist-home-high-fidelity-redesign-handoff-package
```

**Step 2: Open the PR with the SK-33 title**

```bash
gh pr create --base v3-clean --title "SK-33: artist home — high-fidelity redesign" --body "$(cat <<'EOF'
## Summary

Replaces the existing artist home with the high-fidelity handoff design ([`design_handoff_artist_home/`](/Volumes/KINGSTON/Downloads/design_handoff_artist_home/)).

- Single-column dashboard with strong size hierarchy.
- **Primary** — `LastUploadCard` (170×170 art + 52px amber Play FAB + Syne 26px title).
- **Secondary** — `NextSessionCard` compact strip with single `Open calendar →` CTA (no Join button).
- **Tertiary** — `PaymentRequestsSection` (copper amounts, dark Pay pills).
- **Quaternary** — `BookSessionTiles` (producer roster grid).
- Shared `ProducerArt` block for gradients + initials.
- New `GreetingStrip` (date eyebrow + greeting). Drops handoff's search + "+ New project" CTA.

## Behind the scenes

- Backend: `artist.home().latestMix` gains `unread`; `artist.book.myPendingPayments().bookings[]` exposes `plan`. **No schema changes.**
- Token: `--copper: #B06830` added (payment amounts only).
- Mobile: responsive translation — hero stacks, tiles wrap.
- Deleted: `home-hero.tsx`, `latest-mix-card.tsx`, `upcoming-sessions-card.tsx`, `balance-card.tsx`, `activity-feed.tsx`.

## Design + plan docs

- [Design doc](docs/plans/active/2026-05-24-artist-home-handoff-redesign-design.md)
- [Implementation plan](docs/plans/active/2026-05-24-artist-home-handoff-redesign.md)

## Test plan

- [ ] Incognito on the preview URL: `/artist` renders with no console errors
- [ ] Greeting eyebrow uses Mono 10.5px / .12em uppercase; greeting is Syne 22px 800
- [ ] Last upload card: 170×170 art, 52px amber Play FAB, Syne 26px title
- [ ] `NEW` badge appears when `unread === true`
- [ ] Clicking the FAB or "Play track" begins playback in PersistentPlayer
- [ ] Next session strip: TODAY badge only when today, `Open calendar →` → `/artist/book`
- [ ] Payment amount is `--copper` (#B06830); Pay button is dark
- [ ] Producer tile grid renders one per studio; tile → `/artist/book?producerId={id}`
- [ ] All 4 empty states render their fallback copy + CTA
- [ ] Mobile (<lg): hero stacks, tiles wrap to 2 cols, no horizontal scroll

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Verify the PR landed clean**

```bash
gh pr view --json url,baseRefName,headRefName,state
```

Expected: state `OPEN`, base `v3-clean`, head matches the SK-33 branch name.

---

## Done

The PR is up. Once the Vercel preview is ready and Gili has done the manual QA pass against the acceptance criteria in the design doc, merge to `v3-clean` and let Vercel deploy.
