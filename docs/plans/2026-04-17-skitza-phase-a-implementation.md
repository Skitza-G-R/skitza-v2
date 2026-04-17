# Skitza Phase A — Rebrand + Landing Port · Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a production deploy where (1) every page renders in warm-cream-default + amber/copper + Syne/Outfit, (2) the root route serves a full port of the user-supplied `index.html` with a working waitlist form, (3) all existing flows (onboarding → portfolio → magic link → analytics) keep working end-to-end.

**Architecture:** Token + font swap in `globals.css`/`layout.tsx` flips the app palette globally. Public portfolio (`/p/[slug]`) opts into `data-theme="chrome-dark"` to stay intentionally dark (matches landing's light→dark dramaturgy). Landing page is decomposed into 8 section components under `components/landing/`. Waitlist is a new Drizzle table + Server Action + Client form, rate-limited via the existing `checkRateLimit` helper.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS 4, Drizzle ORM, Neon serverless, Clerk, `next/font/google` (Syne + Outfit), Vitest, Playwright.

**Design reference:** `docs/plans/2026-04-17-skitza-phase-a-rebrand-and-landing-port.md` + user-supplied `index.html` at `/Volumes/KINGSTON/Downloads/index.html`.

---

## Task 1: Swap global palette tokens (LIGHT default + DARK alt)

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Step 1: Read the existing globals.css** so you know what's there and what to replace. Look for the `@layer base { :root { ... } [data-theme="room-paper"] { ... } }` block — that entire block is the swap target.

**Step 2: Replace the token block** with the new values from the design doc §4.2. Key invariants:

- Token *names* stay identical (`--bg-base`, `--bg-elevated`, `--fg-primary`, `--brand-primary`, etc.) so every existing consumer (`bg-[rgb(var(--bg-elevated))]` etc.) keeps working.
- `:root` becomes the LIGHT palette (was dark).
- Add new `[data-theme="chrome-dark"]` selector with the dark palette.
- Remove the `[data-theme="room-paper"]` selector entirely — the new `:root` IS room-paper's warm-cream aesthetic; `room-paper` is no longer used.
- Brand goes from `34 197 94` (green) → `212 150 10` (amber).
- Brand accent goes from `245 158 11` to `176 104 48` (copper).
- `color-scheme: light` in `html { }` default, `dark` inside `[data-theme="chrome-dark"]`.

Exact value table (RGB space-separated channels — do not add `rgb()` wrapper; the `rgb(var(--bg-base))` at call-sites provides that):

```
:root  (LIGHT default — new)
  --bg-base      242 237 230
  --bg-elevated  255 251 245
  --bg-sunken    232 224 214
  --bg-overlay   255 254 250
  --fg-primary    26  23  20
  --fg-secondary 107 101  96
  --fg-muted     140 132 124
  --fg-inverse   242 237 230
  --brand-primary 212 150  10
  --brand-accent  176 104  48
  --fg-danger    204  58  46
  --fg-warning   212 150  10
  --fg-success    70 140  70
  --border-subtle  0   0   0 / 0.08     (alpha in-token)
  --border-strong  0   0   0 / 0.18

[data-theme="chrome-dark"]  (DARK alt — new)
  --bg-base       17  16   9
  --bg-elevated   26  24  20
  --bg-sunken     12  10   5
  --bg-overlay    34  32  24
  --fg-primary   237 232 226
  --fg-secondary 122 114 104
  --fg-muted      89  82  76
  --fg-inverse    17  16   9
  --border-subtle 255 255 255 / 0.07
  --border-strong 255 255 255 / 0.18
```

**Step 3: Update `color-scheme` directives:**

```css
html { color-scheme: light; }
[data-theme="chrome-dark"] { color-scheme: dark; }
```

(Previously the default was `color-scheme: dark` — invert.)

**Step 4: Run build** to catch syntax errors early.

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web build 2>&1 | tail -15`
Expected: Successful build, possibly 14-ish routes compiled.

**Step 5: Commit.**

```bash
git add apps/web/src/app/globals.css
git commit -m "refactor(web): swap global palette — LIGHT warm cream default, amber/copper accents"
```

---

## Task 2: Swap typography stack to Syne + Outfit

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

**Step 1: Replace the `next/font/google` imports + loaders.** The current file loads Fraunces + IBM_Plex_Sans + IBM_Plex_Mono. Replace with:

```ts
import { Syne, Outfit } from "next/font/google";

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--font-display",
});
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-body",
});
```

**Step 2: Drop the `--font-mono` variable binding.** The landing doesn't use a branded mono, so we fall back to the system monospace stack. Find `${plexMono.variable}` in the `<html className>` and remove that reference. Leave `--font-mono` declared elsewhere? Check `globals.css` — if it's used in a `@utility font-mono` block, update that block to `font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;` with NO `var(--font-mono)` prefix.

**Step 3: Verify no remaining references to Fraunces / IBM_Plex.**

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && grep -rn "Fraunces\|IBM_Plex" src/ || echo "clean"`
Expected: `clean`

**Step 4: Build.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web build 2>&1 | tail -10`
Expected: Successful build.

**Step 5: Commit.**

```bash
git add apps/web/src/app/layout.tsx apps/web/src/app/globals.css
git commit -m "refactor(web): swap typography to Syne (display) + Outfit (body) + system mono"
```

---

## Task 3: Update Clerk appearance to light-mode hex values

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

**Step 1: Find the `clerkAppearance` const** in `layout.tsx`. Its `variables` block holds hex colors for the dark theme.

**Step 2: Replace hex values to match new tokens:**

- `colorPrimary` → `"#D4960A"` (amber)
- `colorBackground` → `"#F2EDE6"` (warm cream)
- `colorInputBackground` → `"#FFFBF5"` (cream-elevated)
- `colorInputText` → `"#1A1714"` (near-black)
- `colorText` → `"#1A1714"`
- `colorTextSecondary` → `"#6B6560"` (warm gray)
- `colorNeutral` → `"#6B6560"`
- `colorDanger` → `"#CC3A2E"`
- `colorSuccess` → `"#468C46"`
- `colorWarning` → `"#D4960A"`

Leave `borderRadius`, `fontFamily`, `fontFamilyButtons` unchanged (they reference CSS vars).

**Step 3: Build.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web build 2>&1 | tail -6`
Expected: Successful build.

**Step 4: Commit.**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "refactor(web): retheme Clerk appearance — amber on warm cream"
```

---

## Task 4: Opt the public portfolio into `chrome-dark`

**Files:**
- Modify: `apps/web/src/app/(public)/layout.tsx`

**Step 1: Read the current file.** It already has `data-theme="chrome-dark"` on the wrapper div — but the PROJECT default was previously dark, so this was a no-op comment. Now that `:root` is LIGHT, this attribute actually matters and must stay.

**Step 2: Verify the attribute is on the outermost `<div>`** that wraps `{children}`. If it is, no change needed — just confirm with a `git status` after reading. If it's missing or on a nested element, move it to the outer wrapper.

Run: `cd "/Users/giliasraf/Skitza 16.4" && grep -n 'data-theme' apps/web/src/app/\(public\)/layout.tsx`
Expected: output shows `data-theme="chrome-dark"` on the wrapper.

**Step 3: Update the explanatory comment** at the top of the file. The old comment said "chrome-dark is the `:root` default." Replace with:

```
// Public content pages (/p/[slug], /m/[token]) opt into chrome-dark
// explicitly — now that :root is LIGHT (warm cream), the public
// portfolio stays intentionally dark to read like a record sleeve +
// match the landing page's light→dark dramaturgy.
```

**Step 4: Commit.**

```bash
git add apps/web/src/app/\(public\)/layout.tsx
git commit -m "docs(web): clarify chrome-dark intent on public routes post palette-swap"
```

---

## Task 5: Generate + apply `waitlist` migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create (via drizzle-kit): `packages/db/drizzle/0002_<generated>.sql`

**Step 1: Append to `packages/db/src/schema.ts`:**

```ts
export const waitlist = pgTable("waitlist", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  source: text("source"),         // e.g. "landing-hero"
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),        // sha256(ip) — no raw IPs
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;
```

**Step 2: Generate the migration file.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && set -a && source apps/web/.env.local && set +a && corepack pnpm --filter @skitza/db db:generate`
Expected: New file under `packages/db/drizzle/0002_*.sql` + meta journal updated.

**Step 3: Inspect the generated SQL** (should be a pure `CREATE TABLE IF NOT EXISTS "waitlist" (...)` — no destructive operations). If it looks right, continue.

**Step 4: Apply the migration to Neon.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && set -a && source apps/web/.env.local && set +a && corepack pnpm --filter @skitza/db db:migrate`
Expected: `[✓] migrations applied successfully!`

**Step 5: Verify the table exists by directly querying Neon.**

Run:
```bash
cd "/Users/giliasraf/Skitza 16.4/packages/db" && set -a && source ../../apps/web/.env.local && set +a && node --input-type=module -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql\`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='waitlist'\`;
console.log(rows);
"
```
Expected: `[ { table_name: 'waitlist' } ]`

**Step 6: Commit.**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/
git commit -m "feat(db): waitlist table for landing page email capture"
```

---

## Task 6: Waitlist Server Action + unit tests

**Files:**
- Create: `apps/web/src/app/(public)/actions/waitlist.ts`
- Create: `apps/web/src/app/(public)/actions/waitlist.test.ts`

**Step 1: Write the failing test first** (TDD).

```ts
// waitlist.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const onConflictDoNothingMock = vi.fn().mockResolvedValue(undefined);
const valuesMock = vi.fn(() => ({ onConflictDoNothing: onConflictDoNothingMock }));
const insertMock = vi.fn(() => ({ values: valuesMock }));
const dbMock = { insert: insertMock };

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  waitlist: { email: "email" },
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "vt" })),
}));

beforeEach(() => {
  insertMock.mockClear();
  valuesMock.mockClear();
  onConflictDoNothingMock.mockReset().mockResolvedValue(undefined);
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("joinWaitlist", () => {
  it("accepts a well-formed email + source + inserts with hashed ip", async () => {
    const { joinWaitlist } = await import("./waitlist");
    const res = await joinWaitlist({ email: "ada@example.com", source: "landing-hero" });
    expect(res.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
    const inserted = valuesMock.mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      email: "ada@example.com",
      source: "landing-hero",
      userAgent: "vt",
    });
    // ipHash should be a 64-char hex string (sha256 hex)
    expect(inserted?.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an invalid email via zod", async () => {
    const { joinWaitlist } = await import("./waitlist");
    const res = await joinWaitlist({ email: "not-an-email" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/email/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns ok:true when the email is already on the list (idempotent)", async () => {
    // ON CONFLICT DO NOTHING — insert call resolves fine regardless.
    const { joinWaitlist } = await import("./waitlist");
    const res = await joinWaitlist({ email: "dup@example.com" });
    expect(res.ok).toBe(true);
  });

  it("returns ok:false when the DB throws", async () => {
    onConflictDoNothingMock.mockRejectedValueOnce(new Error("connection refused"));
    const { joinWaitlist } = await import("./waitlist");
    const res = await joinWaitlist({ email: "ok@example.com" });
    expect(res.ok).toBe(false);
  });
});
```

**Step 2: Run the test and confirm it fails** (the module doesn't exist yet).

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web test -- waitlist 2>&1 | tail -15`
Expected: FAIL with module-not-found or similar.

**Step 3: Write the implementation.**

```ts
// waitlist.ts
"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { ZodError, z } from "zod";
import { createDb, waitlist } from "@skitza/db";

import { checkRateLimit } from "~/lib/rate-limit/in-memory";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Allow-list of CTA locations so we can measure conversion by source.
const SourceEnum = z.enum(["landing-hero", "landing-final-cta", "landing-nav", "landing-pricing"]).optional();

const Input = z.object({
  email: z.string().email("please enter a valid email"),
  source: SourceEnum,
});

// Rate limit per-IP — generous enough for real users, tight enough that a
// scripted loop doesn't fill the table.
const WAITLIST_LIMIT = 10;
const WAITLIST_WINDOW_MS = 60_000;

export async function joinWaitlist(input: { email: string; source?: string }): Promise<ActionResult> {
  let parsed;
  try {
    parsed = Input.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return { ok: false, error: first?.message ?? "invalid input" };
    }
    return { ok: false, error: "invalid input" };
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { ok: false, error: "service temporarily unavailable" };

  // Read headers server-side so we can hash the IP + record UA. Never
  // store the raw IP — only sha256 of it.
  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = hdrs.get("user-agent") ?? null;
  const ipHash = createHash("sha256").update(ipRaw).digest("hex");

  const rl = checkRateLimit(`waitlist:${ipHash}`, WAITLIST_LIMIT, WAITLIST_WINDOW_MS);
  if (!rl.ok) return { ok: false, error: "too many requests — try again in a moment" };

  try {
    const db = createDb(dbUrl);
    await db
      .insert(waitlist)
      .values({
        email: parsed.email.toLowerCase(),
        source: parsed.source ?? null,
        userAgent,
        ipHash,
      })
      .onConflictDoNothing();
    return { ok: true };
  } catch {
    return { ok: false, error: "couldn't save — please try again" };
  }
}
```

**Step 4: Run the tests.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web test -- waitlist 2>&1 | tail -12`
Expected: 4 passed.

**Step 5: Typecheck + lint.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web typecheck && corepack pnpm --filter web lint 2>&1 | tail -10`
Expected: clean.

**Step 6: Commit.**

```bash
git add apps/web/src/app/\(public\)/actions/
git commit -m "feat(web): joinWaitlist Server Action + 4 tests"
```

---

## Task 7: Extract re-usable brand + landing primitives

**Files:**
- Create: `apps/web/src/components/brand/skitza-mark.tsx`
- Create: `apps/web/src/components/landing/landing-nav.tsx`

**Step 1: Port the `sk-*` SVG character from the landing.** The mark lives inside `<div class="sk-brand-link">` in index.html. It's a circular badge with:
- 3 papers fanning behind a headphoned character head
- An "OVERDUE" stamp on one paper
- Steam/sweat accents on the head
- Amber → copper gradient
- A "9" badge (count of papers stacked)

Keep the implementation as CSS (imported from a scoped `.module.css`) because the animation timings + complex layering are easier to maintain in CSS than inline styles.

For now, ship a simpler abstraction: `<SkitzaMark size="sm" | "md" | "lg" | "hero" />` that renders the badge + character. Reproduction is not pixel-perfect tonight — aim for the spirit (warm, anxious character, amber/copper halo).

Pragmatic approach: render an SVG approximation of the badge with the amber→copper gradient, a simple headphoned head silhouette, and a small papers-fan. Skip the eyes/brows/steam unless cheap to include. The landing page's character is a GIANT amount of CSS; for Phase A an 80%-faithful version ships faster + still reads as "the brand."

**Step 2: Landing nav.**

```tsx
// landing-nav.tsx
import Link from "next/link";
import { SkitzaMark } from "~/components/brand/skitza-mark";
import { Button } from "~/components/ui/button";

export function LandingNav() {
  return (
    <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:py-6">
      <Link href="/" className="flex items-center gap-2">
        <SkitzaMark size="sm" />
        <span className="font-display text-xl tracking-tight">Skitza</span>
      </Link>
      <ul className="hidden items-center gap-8 text-sm font-medium text-[rgb(var(--fg-secondary))] md:flex">
        <li><a href="#features" className="hover:text-[rgb(var(--fg-primary))]">Features</a></li>
        <li><a href="#how-it-works" className="hover:text-[rgb(var(--fg-primary))]">How It Works</a></li>
        <li><a href="#pricing" className="hover:text-[rgb(var(--fg-primary))]">Pricing</a></li>
      </ul>
      <Button asChild size="sm">
        <a href="#waitlist-hero">Join The Waiting List</a>
      </Button>
    </nav>
  );
}
```

**Step 3: Typecheck.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web typecheck 2>&1 | tail -5`
Expected: clean.

**Step 4: Commit.**

```bash
git add apps/web/src/components/brand/ apps/web/src/components/landing/
git commit -m "feat(web): brand mark + landing nav primitive"
```

---

## Task 8: Waitlist form client component

**Files:**
- Create: `apps/web/src/components/landing/waitlist-form.tsx`

**Step 1: Write the component.**

```tsx
"use client";

import { type SyntheticEvent, useState, useTransition } from "react";

import { joinWaitlist } from "~/app/(public)/actions/waitlist";
import { useToast } from "~/components/ui/toast";

interface WaitlistFormProps {
  source: "landing-hero" | "landing-final-cta" | "landing-nav" | "landing-pricing";
  /** Optional label variant — overrides the default "Join The Waiting List". */
  cta?: string;
  /** Stack form elements vertically (for narrow contexts like the hero). */
  compact?: boolean;
}

export function WaitlistForm({ source, cta = "Join The Waiting List", compact = false }: WaitlistFormProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("please enter your email");
      return;
    }
    startTransition(async () => {
      const res = await joinWaitlist({ email: trimmed, source });
      if (res.ok) {
        setDone(true);
        toast("You're on the list — we'll be in touch.", "success");
      } else {
        setError(res.error);
      }
    });
  }

  if (done) {
    return (
      <p
        role="status"
        className="text-sm text-[rgb(var(--brand-primary))] font-medium tracking-tight"
      >
        ✓ You're in. We'll email when early access opens.
      </p>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={[
        "flex gap-2",
        compact ? "flex-col sm:flex-row" : "flex-row items-stretch",
      ].join(" ")}
    >
      <input
        type="email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); }}
        placeholder="you@studio.com"
        required
        aria-label="Email"
        className="flex-1 min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-sm text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.18)]"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-5 py-3 text-sm font-semibold text-[rgb(var(--fg-inverse))] shadow-[0_8px_24px_-4px_rgb(var(--brand-primary)/0.35)] transition-transform hover:scale-[1.02] active:translate-y-[1px] disabled:opacity-60 disabled:pointer-events-none whitespace-nowrap"
      >
        {pending ? "Joining…" : cta}
      </button>
      {error ? (
        <p role="alert" className="sm:col-span-2 text-xs text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
```

**Step 2: Typecheck + lint.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web typecheck && corepack pnpm --filter web lint 2>&1 | tail -5`
Expected: clean.

**Step 3: Commit.**

```bash
git add apps/web/src/components/landing/waitlist-form.tsx
git commit -m "feat(web): waitlist form client component"
```

---

## Task 9: Landing — Hero section

**Files:**
- Create: `apps/web/src/components/landing/hero.tsx`
- Create: `apps/web/src/components/landing/landing.module.css` (for motion keyframes + ambient blobs)

**Step 1: CSS module with ambient drift + pulse-glow + cinematic dissolve.**

Match the landing's `.ambient-blob`, `.blob-amber`, `.blob-copper`, `drift`, `pulse-ambient`, `pulse-glow` keyframes. Port verbatim from index.html lines 122–172 into the module.

**Step 2: Hero component.**

```tsx
// hero.tsx — LIGHT world
import { SkitzaMark } from "~/components/brand/skitza-mark";
import { WaitlistForm } from "./waitlist-form";
import styles from "./landing.module.css";

export function Hero() {
  return (
    <header className="relative overflow-hidden pt-20 pb-28 sm:pt-28 sm:pb-36">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className={`${styles.ambientBlob} ${styles.blobAmber}`} style={{ left: "-12%", top: "-8rem" }} />
        <div className={`${styles.ambientBlob} ${styles.blobCopper}`} style={{ right: "-10%", top: "30%" }} />
      </div>
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <div className="mx-auto inline-flex"><SkitzaMark size="hero" /></div>
        <p className="mt-6 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          The all-in-one business tool for music producers
        </p>
        <h1
          className="mt-6 font-display text-[clamp(2.75rem,8vw,5.25rem)] leading-[0.98] tracking-tight text-[rgb(var(--fg-primary))]"
          style={{ fontVariationSettings: '"opsz" 144' }}
        >
          Stop chasing payments.
          <span className="block text-[rgb(var(--brand-primary))]">Just make music.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[rgb(var(--fg-secondary))]">
          Skitza is the only link you need. Clients book sessions, sign contracts, and pay
          automatically — and your final mixes stay locked until the invoice is cleared.
        </p>
        <div id="waitlist-hero" className="mx-auto mt-10 max-w-md">
          <WaitlistForm source="landing-hero" cta="Join The Waiting List" compact />
        </div>
        <p className="mt-4 font-mono text-xs text-[rgb(var(--fg-muted))]">
          Share one link. Your clients handle everything else.
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          ★★★★★ Joined by 1,200+ producers on the waitlist
        </p>

        {/* Floating mockup cards — 3 check items */}
        <div className="mx-auto mt-14 grid max-w-md gap-3 text-left">
          {[
            "Session booked · Tuesday 3pm — Marcus T.",
            "Invoice paid · $450 received automatically",
            "Files delivered · Final mix + stems",
          ].map((label, i) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[0_10px_30px_-8px_rgb(0_0_0_/_0.08)]"
              style={{ animation: `skitza-reveal-up 0.6s cubic-bezier(0.16,1,0.3,1) both`, animationDelay: `${(0.4 + i * 0.15).toString()}s` }}
            >
              <span className="text-sm text-[rgb(var(--fg-primary))]">{label}</span>
              <span className="text-[rgb(var(--brand-primary))]">✓</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
```

**Step 3: Typecheck.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web typecheck 2>&1 | tail -5`
Expected: clean.

**Step 4: Commit.**

```bash
git add apps/web/src/components/landing/hero.tsx apps/web/src/components/landing/landing.module.css
git commit -m "feat(web): landing — Hero section (LIGHT world)"
```

---

## Task 10: Landing — Pain grid (DARK world begins)

**Files:**
- Create: `apps/web/src/components/landing/pain-grid.tsx`

**Step 1: Build the 6-card grid.** Copy-paste the exact 6 headlines + subheads from index.html lines 1287-1406. Don't ship the elaborate character illustrations tonight — render each card as a simple bordered tile with headline + subhead + a subtle accent (copper top-border or copper dot). The meme-face characters are Phase B polish.

```tsx
export function PainGrid() {
  return (
    <section id="pain" className="relative py-24 sm:py-32" data-theme="chrome-dark">
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <span className="absolute -top-4 left-0 font-display text-[clamp(4rem,10vw,8rem)] font-extrabold leading-none opacity-[0.03] text-[rgb(var(--fg-primary))] pointer-events-none">01</span>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-accent))]">Sound familiar?</p>
          <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight text-[rgb(var(--fg-primary))]">
            You became a producer.
            <span className="block">Not a secretary.</span>
          </h2>
          <p className="mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
            Yet here you are — scheduling, invoicing, chasing, reminding, resending, following up.
            Every day. Before you've played a single note.
          </p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PAINS.map((p) => (
            <article
              key={p.title}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
            >
              <span aria-hidden className="mb-4 block h-1 w-10 rounded-full bg-[rgb(var(--brand-accent))]" />
              <h3 className="font-display text-xl tracking-tight text-[rgb(var(--fg-primary))]">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">{p.body}</p>
            </article>
          ))}
        </div>
        <p className="mt-14 text-center font-display text-xl text-[rgb(var(--brand-primary))] tracking-tight">
          Every one of these problems disappears with Skitza. ↓
        </p>
      </div>
    </section>
  );
}

const PAINS = [
  { title: "\"What are your rates?\"", body: "You've copy-pasted that answer so many times you could send it in your sleep." },
  { title: "The scheduling nightmare", body: "6 messages to confirm one session. \"Does Tuesday work? Actually Thursday?\"" },
  { title: "Unpaid invoices stacking up", body: "Chasing clients for money is the worst part of the job. Somehow it's also your job." },
  { title: "\"Can you resend the files?\"", body: "For the third time. On WhatsApp. At midnight." },
  { title: "Doing it all again tomorrow", body: "Wake up. Answer DMs. Make a beat. Chase payment. Repeat until you hate this." },
  { title: "Mental bandwidth, gone", body: "By the time you open your DAW, you're already running on empty." },
];
```

**Step 2: Typecheck + commit.**

```bash
git add apps/web/src/components/landing/pain-grid.tsx
git commit -m "feat(web): landing — Pain section (6-card grid, dark world)"
```

---

## Task 11: Landing — Solution flow diagram

**Files:**
- Create: `apps/web/src/components/landing/solution-flow.tsx`

**Step 1: Build the 6-node horizontal flow diagram** (scrolls horizontally on mobile, fits on desktop).

```tsx
export function SolutionFlow() {
  return (
    <section id="solution" className="relative py-24 sm:py-32" data-theme="chrome-dark">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">Enter Skitza</p>
          <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight text-[rgb(var(--fg-primary))]">
            One platform.
            <span className="block">Everything automated.</span>
            <span className="block">Nothing missed.</span>
          </h2>
          <p className="mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
            Skitza connects to your calendar, payments, and messaging — and runs your entire client workflow automatically.
          </p>
          <ul className="mt-5 space-y-2 text-[rgb(var(--fg-secondary))]">
            <li>📅 Clients book themselves — you just show up</li>
            <li>💸 Invoices sent and chased automatically</li>
            <li>📁 Files delivered securely — no WhatsApp links</li>
            <li>💬 Follow-ups and reminders — done for you</li>
          </ul>
        </div>
        <div className="mt-16 overflow-x-auto pb-4">
          <ol className="flex items-center gap-3 sm:gap-5 min-w-max">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3 sm:gap-5">
                <div className="flex items-center gap-2 rounded-full border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-2 text-sm font-medium text-[rgb(var(--fg-primary))]">
                  {s}
                  <span className="text-[rgb(var(--brand-primary))]">✓</span>
                </div>
                {i < STEPS.length - 1 ? (
                  <span aria-hidden className="h-px w-8 bg-[rgb(var(--border-strong))]" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
const STEPS = ["Lead", "Booking", "Session", "Invoice", "Delivery", "Follow-up"] as const;
```

**Step 2: Typecheck + commit.**

```bash
git add apps/web/src/components/landing/solution-flow.tsx
git commit -m "feat(web): landing — Solution flow (6-step pipeline)"
```

---

## Task 12: Landing — Features tabs

**Files:**
- Create: `apps/web/src/components/landing/features-tabs.tsx`

**Step 1: Build the 7-tab feature browser.** Interactive — user clicks a tab, right pane swaps. Needs client component (`"use client"`).

Each tab's right pane has a mini-mockup. Ship SIMPLIFIED mockups for Phase A — just a representative static card/visual per tab, NOT the full composed illustrations. Prioritize the text content (headline + body) being accurate.

Feature list (tabs in order):
1. Storefront & Booking — "Sell packages, not just time."
2. Payments on autopilot — "Payments on autopilot"
3. Files & Feedback — "Stream freely. Download when paid."
4. Client history — "Client Management"
5. Follow-up on autopilot — "Follow-up on autopilot"
6. Lead Management — "Lead Management" + kanban (New / Following Up / Booked)
7. Contracts & Protection — "Zero disputes. Guaranteed."

See index.html lines 1444-1660 for exact copy. Use the index.html copy verbatim.

**Step 2: Commit.**

```bash
git add apps/web/src/components/landing/features-tabs.tsx
git commit -m "feat(web): landing — Features (7-tab interactive)"
```

---

## Task 13: Landing — Consolidation, How-it-works, Testimonials, Pricing, Final CTA

**Files:**
- Create: `apps/web/src/components/landing/consolidation.tsx`
- Create: `apps/web/src/components/landing/how-it-works.tsx`
- Create: `apps/web/src/components/landing/testimonials.tsx`
- Create: `apps/web/src/components/landing/pricing.tsx`
- Create: `apps/web/src/components/landing/final-cta.tsx`

**Step 1: Port each section.** Exact copy from index.html:
- Consolidation: lines 1662-1704
- How-it-works: lines 1706-1734
- Testimonials: lines 1736-1760
- Pricing: lines 1762-1795
- Final CTA: lines 1797-1809

Sections stay in DARK world (`data-theme="chrome-dark"` on the `<section>`), EXCEPT Final CTA which transitions back to LIGHT at the end (mirroring the landing's final warm cream exit).

**Step 2: Each section commits separately** so the history reads cleanly. 5 commits.

---

## Task 14: Landing — assemble the page

**Files:**
- Modify: `apps/web/src/app/page.tsx`

**Step 1: Replace the current `page.tsx` content** with:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { LandingNav } from "~/components/landing/landing-nav";
import { Hero } from "~/components/landing/hero";
import { PainGrid } from "~/components/landing/pain-grid";
import { SolutionFlow } from "~/components/landing/solution-flow";
import { FeaturesTabs } from "~/components/landing/features-tabs";
import { Consolidation } from "~/components/landing/consolidation";
import { HowItWorks } from "~/components/landing/how-it-works";
import { Testimonials } from "~/components/landing/testimonials";
import { Pricing } from "~/components/landing/pricing";
import { FinalCTA } from "~/components/landing/final-cta";

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return (
    <>
      <LandingNav />
      <Hero />
      <PainGrid />
      <SolutionFlow />
      <FeaturesTabs />
      <Consolidation />
      <HowItWorks />
      <Testimonials />
      <Pricing />
      <FinalCTA />
    </>
  );
}
```

**Step 2: Build.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web build 2>&1 | tail -20`
Expected: Successful build.

**Step 3: Commit.**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(web): landing — assemble 8 sections on root route"
```

---

## Task 15: Reskin favicon + OG images (amber on cream)

**Files:**
- Modify: `apps/web/src/app/icon.tsx`
- Modify: `apps/web/src/app/opengraph-image.tsx`
- Leave: `apps/web/src/app/(public)/p/[slug]/opengraph-image.tsx` UNCHANGED (producer page stays dark)

**Step 1: Update icon.tsx** to use cream background (`#F2EDE6`) + amber ring (`#D4960A`) instead of obsidian + green.

**Step 2: Update root opengraph-image.tsx** similarly. Keep the same composition but swap palette:
- `backgroundColor: "#F2EDE6"`
- Accent color `#D4960A`
- Copper secondary `#B06830`
- Text color `#1A1714`

Update the hero tagline to match the new landing: "Stop chasing payments. Just make music."

**Step 3: Build to regenerate both.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web build 2>&1 | tail -10`
Expected: Successful build, `/icon`, `/opengraph-image` emitted.

**Step 4: Commit.**

```bash
git add apps/web/src/app/icon.tsx apps/web/src/app/opengraph-image.tsx
git commit -m "refactor(web): reskin favicon + root OG to cream + amber"
```

---

## Task 16: App-page re-theme audit

**Files:**
- Potentially modify (case-by-case): dashboard, portfolio, leads, settings, onboarding, auth pages, 404, error.

**Step 1: Start the dev server locally.**

Run: `cd "/Users/giliasraf/Skitza 16.4" && corepack pnpm --filter web dev`
(Background — open in another terminal via browser.)

**Step 2: Walk each page** in http://localhost:3000 (signed in as the smoke-test producer):
- `/dashboard`
- `/dashboard/portfolio`
- `/dashboard/leads`
- `/dashboard/leads/<id>` (drill-in)
- `/dashboard/settings`
- `/onboarding` (sign out another session to test)
- `/p/skitza-smoke-test` (this should be DARK — chrome-dark)
- `/sign-in`, `/sign-up`
- `/about`, `/privacy`, `/terms`
- A 404 (`/p/definitely-fake`)

**Step 3: Fix any obvious wrong-palette color refs.** Likely issues:
- Brand-green references (`#22c55e`) hard-coded somewhere (unlikely but grep-check).
- `<StatusPill>` variants — double-check "active" (green) still reads correctly when brand is now amber. Probably still fine because StatusPill uses CSS vars, not hex.
- `Badge variant="active"` — same.

Run: `cd "/Users/giliasraf/Skitza 16.4" && grep -rn '#22c55e\|#22C55E\|34, 197, 94\|34 197 94' apps/web/src/ || echo "clean"`
Expected: `clean` (the palette swap is token-based so no hex should remain).

**Step 4: Commit any fixes as a batch.**

```bash
git add -A
git commit -m "chore(web): re-theme audit — fix any hardcoded legacy palette refs"
```
(Skip this commit if there were no changes.)

---

## Task 17: Full test suite + lint + build verification

**Step 1: Run everything.**

```bash
cd "/Users/giliasraf/Skitza 16.4"
corepack pnpm --filter web typecheck  # expect: clean
corepack pnpm --filter web lint        # expect: clean
corepack pnpm --filter web test        # expect: 91 or more passed (waitlist adds 4 tests → 95)
corepack pnpm --filter web build       # expect: ok
```

Expected totals: 95/95 tests, 0 lint errors, 0 typecheck errors, build succeeds.

**Step 2: If anything fails, fix it THEN continue.**

**Step 3: Commit anything outstanding.**

---

## Task 18: Push + wait for Vercel deploy

```bash
cd "/Users/giliasraf/Skitza 16.4" && git push origin main
```

Then poll:
```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web" && until vercel ls --prod 2>&1 | head -4 | tail -1 | grep -qE "(Ready|Error)"; do sleep 15; done && vercel ls --prod | head -4
```

If deploy errors, pull build logs with `vercel inspect <url> --logs` and fix.

---

## Task 19: Production smoke — waitlist + key pages

**Step 1: Hit the landing and confirm it loads.**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://skitza-v2-web.vercel.app/
```
Expected: `HTTP 200`.

**Step 2: Submit a real waitlist email** via Playwright.

- Navigate to `https://skitza-v2-web.vercel.app/`
- Locate the hero WaitlistForm, fill with a disposable email (e.g. `morning+wl@example.com`)
- Submit
- Expect "You're in." status

**Step 3: Confirm the row landed in Neon.**

```bash
cd "/Users/giliasraf/Skitza 16.4/packages/db" && set -a && source ../../apps/web/.env.local && set +a && node --input-type=module -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql\`SELECT email, source, created_at FROM waitlist ORDER BY created_at DESC LIMIT 1\`;
console.log(rows);
"
```
Expected: One row with the email you submitted, source `landing-hero`.

**Step 4: Revisit the full producer flow** (to confirm no regressions):
- Sign out → sign in as smoke-test producer
- Land on `/dashboard` — should be LIGHT warm-cream
- Visit `/dashboard/portfolio` — still works, cream palette
- Visit `/dashboard/leads` — still works, analytics table intact
- Visit `/p/skitza-smoke-test` (incognito) — DARK, producer name huge, tracks visible, audio player plays

**Step 5: If all pass, mark Phase A complete.** Write final "morning delta" message summarizing what shipped overnight.

---

## Task 20: Final summary + handoff

Produce a markdown "morning delta" comparable to prior deltas:

- Landing URL
- Waitlist count
- Commits shipped
- Tests: 95/95 (or higher)
- What the user will notice when they wake up
- Explicit: the 6-step flow features (Booking, Packages, Contracts, Payments, Project Rooms, CRM) are STILL Phase B — the app still runs the same portfolio + magic-link flow, just reskinned.

---

## Notes on skills + conventions

- **TDD discipline** — Tasks 6 writes the test first, runs to confirm failure, then writes impl. Other tasks are mostly visual/port work where the "test" is the build + eyeball check.
- **Commit after every task** so reverts are easy if something goes sideways.
- **No new dependencies** except `qrcode` which is already installed. Syne + Outfit come via `next/font/google` — not new deps.
- **Superpowers skills to use while executing:**
  - `superpowers:verification-before-completion` — run the verify command before every "done" claim
  - `superpowers:executing-plans` — task-by-task runner with checkpoints
