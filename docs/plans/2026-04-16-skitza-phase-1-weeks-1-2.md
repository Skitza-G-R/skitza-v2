# Skitza Phase 1 — Weeks 1–2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Stand up the Skitza monorepo with a deployable Next.js 15 web app (themed shadcn/ui, Clerk auth, tRPC API, Drizzle + Neon Postgres) and a Tauri 2.x desktop shell that loads it, all behind green CI/CD on Vercel.

**Architecture:** pnpm-workspaces monorepo with `apps/web` (Next.js 15 App Router + tRPC + Drizzle), `apps/desktop` (Tauri 2.x shell loading the web app), and `packages/db` (shared Drizzle schema). TypeScript strict everywhere. Vitest for unit/integration; Playwright e2e is out of scope for these 2 weeks.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.5+, Tailwind v4, shadcn/ui, Radix, tRPC v11, TanStack Query, Drizzle ORM, Neon Postgres, Clerk, Tauri 2.x (Rust), Vitest, GitHub Actions, Vercel, pnpm 9.

**Reference:** see `2026-04-16-skitza-design.md` §3 for tool justifications.

---

## Prerequisites (USER ACTIONS — block all tasks below)

Complete these and capture credentials before starting Task 1:

1. **Cloudflare account** → enable R2 → create API token + access keys → create bucket `skitza-media-dev`.
2. **Stripe account** (test mode) → grab the publishable + secret keys.
3. **Neon account** → project `skitza` → grab `DATABASE_URL` for `main` and a `dev` branch.
4. **Clerk account** → application "Skitza" → grab the publishable key, secret key, and webhook signing secret (after configuring the webhook in Task 8).
5. **GitHub repo** `skitza/skitza` (private, empty, no README).
6. **Domain check** for `skitza.com` / `skitza.app` / `getskitza.com` — reserve one.

Once secrets are in `apps/web/.env.local` (template created in Task 2), tasks proceed.

---

## Task Map (12 tasks across 2 weeks)

| # | Task | TDD? | Est. |
|---|------|------|------|
| 1 | Initialize monorepo + git | scaffold | 30 min |
| 2 | Scaffold Next.js 15 web app | scaffold | 45 min |
| 3 | ESLint + Prettier | scaffold | 30 min |
| 4 | Vitest + first health-check test | TDD | 45 min |
| 5 | Tailwind v4 + shadcn baseline + design tokens | scaffold + visual | 90 min |
| 6 | tRPC root + `health.check` procedure | TDD | 45 min |
| 7 | Drizzle + Neon + `Producer` table | TDD (integration) | 90 min |
| 8 | Clerk auth + protected dashboard + Producer provisioning webhook | TDD | 2 hr |
| 9 | Magic-link token issuer (pure module) | TDD | 1 hr |
| 10 | Theme resolver (per-workspace CSS variables) | TDD | 1 hr |
| 11 | Tauri 2.x desktop shell wrapping the web app | scaffold + smoke | 2 hr |
| 12 | GitHub Actions CI + Vercel deploy + Tauri bundle | scaffold | 2 hr |

---

## Task 1 — Initialize Monorepo + Git

**Files (create all under `/Users/giliasraf/Skitza 16.4/`):** `.gitignore`, `.editorconfig`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `README.md`.

**Step 1:** `git init -b main`

**Step 2:** `.gitignore` — Node + Next + Tauri exclusions: `node_modules/`, `.next/`, `dist/`, `build/`, `out/`, `.DS_Store`, `.env`, `.env.local`, `.env.*.local`, `.vercel`, `*.tsbuildinfo`, `apps/desktop/src-tauri/target/`, `apps/desktop/src-tauri/gen/`, `.pnpm-store/`, `coverage/`.

**Step 3:** `.editorconfig`

```ini
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

**Step 4:** Root `package.json`

```json
{
  "name": "skitza",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "pnpm --filter web dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "tauri:dev": "pnpm --filter desktop tauri dev",
    "tauri:build": "pnpm --filter desktop tauri build"
  },
  "engines": { "node": ">=20.11", "pnpm": ">=9.0" },
  "devDependencies": { "typescript": "^5.5.4", "prettier": "^3.3.3" }
}
```

**Step 5:** `pnpm-workspace.yaml` → `packages: ["apps/*", "packages/*"]`

**Step 6:** `tsconfig.base.json` — strictest sensible settings

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "allowJs": false
  }
}
```

**Step 7:** `README.md` — short description + pointer to `docs/plans/`.

**Step 8:** `pnpm install` → `git add . && git commit -m "chore: initialize monorepo scaffold"`.

---

## Task 2 — Scaffold Next.js 15 Web App

**Files:** `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/.env.local.example`.

**Step 1:** `apps/web/package.json` — depends on `next@^15.0.3`, `react@^19`, `react-dom@^19`. Scripts: `dev`, `build`, `start`, `lint`, `typecheck` (= `tsc --noEmit`), `test` (= `vitest run`).

**Step 2:** `apps/web/tsconfig.json` extends the base, adds `jsx: "preserve"`, `incremental: true`, `plugins: [{ "name": "next" }]`, paths `~/* → ./src/*`, `noEmit: true`.

**Step 3:** `apps/web/next.config.ts`

```typescript
import type { NextConfig } from "next";
const config: NextConfig = { reactStrictMode: true, experimental: { typedRoutes: true } };
export default config;
```

**Step 4:** `apps/web/src/app/layout.tsx`

```tsx
import type { ReactNode } from "react";
export const metadata = { title: "Skitza", description: "Studio business platform for music producers" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
```

**Step 5:** `apps/web/src/app/page.tsx` — minimal `<h1>Skitza</h1>` placeholder.

**Step 6:** `apps/web/.env.local.example` — empty placeholders for `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `MAGIC_LINK_SECRET` (the rest added in later weeks).

**Step 7:** `pnpm install && pnpm --filter web dev` — confirm `http://localhost:3000` shows the headline.

**Step 8:** Commit: `feat(web): scaffold Next.js 15 app with strict TS`.

---

## Task 3 — ESLint Flat Config + Prettier

**Files:** `apps/web/eslint.config.mjs`, root `.prettierrc.json`, root `.prettierignore`.

**Step 1:** Install at workspace root: `eslint@^9`, `@eslint/js`, `typescript-eslint`, `eslint-config-next`, `prettier-plugin-tailwindcss`.

**Step 2:** `apps/web/eslint.config.mjs` — flat config that combines `js.configs.recommended`, `tseslint.configs.strictTypeChecked`, and the Next plugin's recommended + core-web-vitals rules. `parserOptions.project: "./tsconfig.json"`.

**Step 3:** Root `.prettierrc.json` — `semi: true`, `singleQuote: false`, `trailingComma: "all"`, `printWidth: 100`, plugin `prettier-plugin-tailwindcss`.

**Step 4:** `.prettierignore` — `node_modules`, `.next`, `dist`, `build`, `out`, `pnpm-lock.yaml`, `apps/desktop/src-tauri/target`.

**Step 5:** Verify: `pnpm --filter web lint` and `pnpm --filter web typecheck` both exit 0.

**Step 6:** Commit: `chore: add eslint flat config + prettier`.

---

## Task 4 — Vitest + First Failing Test (TDD)

**Files:** `apps/web/vitest.config.ts`, `apps/web/src/lib/version.ts`, `apps/web/src/lib/version.test.ts`.

**Step 1:** Install: `pnpm add -D --filter web vitest @vitest/coverage-v8`.

**Step 2:** `vitest.config.ts` — node environment, include `src/**/*.{test,spec}.ts(x)`, v8 coverage.

**Step 3 (RED):** Write `version.test.ts` first:

```typescript
import { describe, it, expect } from "vitest";
import { APP_VERSION, isProduction } from "./version";

describe("version module", () => {
  it("exports a semver-shaped APP_VERSION string", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("isProduction is false in test environment", () => {
    expect(isProduction()).toBe(false);
  });
});
```

**Step 4:** `pnpm --filter web test` → confirm FAIL ("Cannot find module './version'").

**Step 5 (GREEN):** Implement `version.ts`:

```typescript
export const APP_VERSION = "0.0.0";
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
```

**Step 6:** Re-run → 2 PASS.

**Step 7:** Commit: `test(web): add Vitest with first version-module test`.

---

## Task 5 — Tailwind v4 + shadcn Baseline + Design Tokens

**Files:** `apps/web/postcss.config.mjs`, `apps/web/src/app/globals.css`, `apps/web/components.json`, `apps/web/src/lib/cn.ts`, `apps/web/src/components/ui/button.tsx`. Modify `apps/web/src/app/layout.tsx` and `apps/web/src/app/page.tsx`.

**Step 1:** Install: `tailwindcss@next`, `@tailwindcss/postcss`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@radix-ui/react-slot`.

**Step 2:** `postcss.config.mjs` → `{ plugins: { "@tailwindcss/postcss": {} } }`.

**Step 3:** `globals.css` — both theme token sets:

```css
@import "tailwindcss";

@layer base {
  :root {
    --bg-base: 12 12 14;
    --bg-elevated: 22 22 26;
    --fg-primary: 245 245 247;
    --fg-secondary: 168 168 176;
    --brand-primary: 29 185 84;
    --brand-accent: 224 122 95;
    --border-subtle: 42 42 48;
    --radius-md: 0.5rem;
  }
  [data-theme="room-paper"] {
    --bg-base: 252 252 250;
    --bg-elevated: 255 255 255;
    --fg-primary: 32 32 36;
    --fg-secondary: 110 110 118;
    --brand-primary: 29 122 84;
    --brand-accent: 196 86 56;
    --border-subtle: 230 230 232;
  }
  body {
    background: rgb(var(--bg-base));
    color: rgb(var(--fg-primary));
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
}
```

**Step 4:** `layout.tsx` imports `./globals.css`.

**Step 5:** `lib/cn.ts` — the standard `cn(...inputs)` using `clsx` + `twMerge`.

**Step 6:** `components.json` — shadcn config with `rsc: true`, `tsx: true`, `cssVariables: true`, aliases pointing under `~/`.

**Step 7:** `components/ui/button.tsx` — CVA-driven Button with variants `default | outline | ghost`, sizes `default | sm | lg`, references the `--brand-primary` and `--bg-elevated` tokens via `rgb(var(...))`.

**Step 8:** `page.tsx` shows two sections — one default (chrome-dark) with a primary Button, one wrapped in `data-theme="room-paper"` showing an outline Button — visually proves both themes work.

**Step 9:** `pnpm --filter web dev` → manual visual confirmation in browser.

**Step 10:** Commit: `feat(web): tailwind v4 + shadcn baseline with chrome-dark/room-paper themes`.

---

## Task 6 — tRPC Root + `health.check` Procedure (TDD)

**Files:** `apps/web/src/server/trpc/init.ts`, `apps/web/src/server/trpc/routers/_app.ts`, `apps/web/src/server/trpc/routers/health.ts`, `apps/web/src/server/trpc/routers/health.test.ts`, `apps/web/src/app/api/trpc/[trpc]/route.ts`.

**Step 1:** Install: `@trpc/server@next`, `@trpc/client@next`, `@trpc/react-query@next`, `@tanstack/react-query@^5`, `zod@^3`, `superjson`.

**Step 2 (RED):** Write `health.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { appRouter } from "./_app";

describe("health.check", () => {
  it("returns ok=true with a version string", async () => {
    const caller = appRouter.createCaller({});
    const result = await caller.health.check();
    expect(result.ok).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

**Step 3:** Run → FAIL.

**Step 4 (GREEN):** Implement `init.ts` (initTRPC with superjson transformer + Context interface), `health.ts` (single query returning `{ ok: true as const, version: APP_VERSION }`), `_app.ts` (combine routers, export `AppRouter` type), and the fetch route handler at `app/api/trpc/[trpc]/route.ts` using `fetchRequestHandler`.

**Step 5:** Re-run → PASS.

**Step 6:** HTTP smoke: `curl http://localhost:3000/api/trpc/health.check` returns JSON containing `ok: true`.

**Step 7:** Commit: `feat(api): tRPC root with health.check procedure`.

---

## Task 7 — Drizzle + Neon + `Producer` Table (TDD-Integration)

**Files:** new package `packages/db/` containing `package.json`, `tsconfig.json`, `src/schema.ts`, `src/client.ts`, `src/index.ts`, `drizzle.config.ts`, `src/__tests__/producer.test.ts`. Modify `apps/web/package.json` to add `"@skitza/db": "workspace:*"`.

**Step 1:** Init the package; deps: `drizzle-orm@^0.36.0`, `@neondatabase/serverless@^0.10.0`. Dev deps: `drizzle-kit@^0.28.0`, `vitest@^2`, `typescript@^5.5.4`. Scripts: `typecheck`, `test`, `db:generate` (drizzle-kit generate), `db:migrate` (drizzle-kit migrate), `db:studio`.

**Step 2:** `src/schema.ts` defines `producers` table:

```typescript
import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";

export const producers = pgTable("producers", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  slug: text("slug").notNull().unique(),
  brand: jsonb("brand").$type<{ logoUrl?: string; primary?: string; accent?: string; font?: string }>().default({}),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("UTC"),
  stripeAccountId: text("stripe_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Producer = typeof producers.$inferSelect;
export type NewProducer = typeof producers.$inferInsert;
```

**Step 3:** `src/client.ts` exports `createDb(connectionString)` returning a `drizzle(neon(url), { schema })` instance + `Db` type. `src/index.ts` re-exports both modules.

**Step 4:** `drizzle.config.ts` points at `./src/schema.ts`, output `./drizzle`, dialect postgresql, db credentials from `DATABASE_URL`.

**Step 5 (RED):** Integration test in `src/__tests__/producer.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { createDb, producers } from "../index";
import { eq } from "drizzle-orm";

const url = process.env.DATABASE_URL_TEST;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("Producer table", () => {
  const db = createDb(url!);
  const testClerkId = `test_${Date.now()}`;
  afterAll(async () => { await db.delete(producers).where(eq(producers.clerkUserId, testClerkId)); });

  it("inserts and reads a Producer", async () => {
    const [inserted] = await db
      .insert(producers)
      .values({ clerkUserId: testClerkId, email: "test@example.com", slug: testClerkId })
      .returning();
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.defaultCurrency).toBe("USD");

    const [found] = await db.select().from(producers).where(eq(producers.clerkUserId, testClerkId));
    expect(found.email).toBe("test@example.com");
  });
});
```

**Step 6:** Generate migration: `DATABASE_URL=<neon-main> pnpm db:generate` → expect `drizzle/0000_*.sql` with `CREATE TABLE producers`.

**Step 7:** Apply to dev branch + run test:

```
DATABASE_URL=<neon-dev> pnpm db:migrate
DATABASE_URL_TEST=<neon-dev> pnpm test
```

→ migration succeeds, 1 test passes.

**Step 8:** Wire `apps/web` workspace dependency, `pnpm install`.

**Step 9:** Commit: `feat(db): drizzle + neon + producers table with integration test`.

---

## Task 8 — Clerk Auth + Protected Dashboard + Producer Provisioning Webhook (TDD)

**Files:** `apps/web/src/middleware.ts`, sign-in/up pages under `app/(auth)/`, dashboard at `app/(app)/dashboard/page.tsx`, webhook at `app/api/webhooks/clerk/route.ts` (+ test), helper `lib/slug.ts` (+ test). Modify `app/layout.tsx` to wrap in `<ClerkProvider>`.

**Step 1:** Install: `@clerk/nextjs`, `svix`.

**Step 2 (RED):** Write `lib/slug.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { emailToSlug } from "./slug";

describe("emailToSlug", () => {
  it("converts the local part to lowercase + appends a 4-char hash", () => {
    expect(emailToSlug("Anna.Karenina+test@gmail.com")).toMatch(/^anna-karenina-[a-z0-9]{4}$/);
  });
  it("differs across emails with the same local part but different domain", () => {
    expect(emailToSlug("ada@x.com")).not.toBe(emailToSlug("ada@y.com"));
  });
  it("strips disallowed chars", () => {
    expect(emailToSlug("hello world!@x.com")).toMatch(/^helloworld-[a-z0-9]{4}$/);
  });
});
```

**Step 3:** Run → FAIL.

**Step 4 (GREEN):** Implement `lib/slug.ts`:

```typescript
import { createHash } from "node:crypto";

export function emailToSlug(email: string): string {
  const [local = ""] = email.toLowerCase().split("@");
  const beforePlus = local.split("+")[0] ?? "";
  const cleaned = beforePlus
    .replace(/[^a-z0-9.]+/g, "")
    .replace(/\./g, "-")
    .replace(/^-|-$/g, "") || "user";
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 4);
  return `${cleaned}-${hash}`;
}
```

**Step 5:** Re-run → PASS.

**Step 6:** Add Clerk middleware (`src/middleware.ts`):

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/dashboard(.*)", "/projects(.*)", "/settings(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
```

**Step 7:** Wrap `layout.tsx` in `<ClerkProvider>`.

**Step 8:** Auth pages — `app/(auth)/sign-in/[[...sign-in]]/page.tsx` renders `<SignIn />`; mirror for sign-up.

**Step 9:** Protected dashboard — `app/(app)/dashboard/page.tsx`:

```tsx
import { currentUser } from "@clerk/nextjs/server";
export default async function Dashboard() {
  const user = await currentUser();
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Welcome, {user?.firstName ?? "producer"}.</h1>
      <p className="text-[rgb(var(--fg-secondary))]">Your studio dashboard will appear here.</p>
    </main>
  );
}
```

**Step 10 (RED):** Webhook test in `app/api/webhooks/clerk/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn().mockResolvedValue([{ id: "uuid-1" }]);
const dbMock = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: insertMock }) }) }) };

vi.mock("@skitza/db", () => ({ createDb: () => dbMock, producers: {} }));
vi.mock("svix", () => ({ Webhook: class { verify(payload: string) { return JSON.parse(payload); } } }));

beforeEach(() => {
  insertMock.mockClear();
  process.env.CLERK_WEBHOOK_SECRET = "test";
  process.env.DATABASE_URL = "x";
});

describe("clerk webhook", () => {
  it("creates a Producer on user.created", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: { id: "user_1", email_addresses: [{ email_address: "ada@x.com" }], first_name: "Ada" },
    });
    const req = new Request("http://x/api/webhooks/clerk", {
      method: "POST",
      headers: { "svix-id": "1", "svix-timestamp": "1", "svix-signature": "x" },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
  });
});
```

**Step 11:** Run → FAIL.

**Step 12 (GREEN):** Implement `route.ts`:

```typescript
import { Webhook } from "svix";
import { createDb, producers } from "@skitza/db";
import { emailToSlug } from "~/lib/slug";

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  const dbUrl = process.env.DATABASE_URL;
  if (!secret || !dbUrl) return new Response("missing env", { status: 500 });

  const payload = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let evt: { type: string; data: { id: string; email_addresses: { email_address: string }[]; first_name?: string } };
  try {
    evt = new Webhook(secret).verify(payload, headers) as typeof evt;
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  if (evt.type === "user.created") {
    const email = evt.data.email_addresses[0]?.email_address;
    if (!email) return new Response("no email", { status: 400 });
    const db = createDb(dbUrl);
    await db.insert(producers).values({
      clerkUserId: evt.data.id,
      email,
      displayName: evt.data.first_name ?? null,
      slug: emailToSlug(email),
    }).onConflictDoNothing().returning();
  }

  return new Response("ok", { status: 200 });
}
```

**Step 13:** Re-run → PASS. Manual smoke (optional): sign up via Clerk on dev → confirm row in Neon.

**Step 14:** Commit: `feat(auth): clerk integration + producer provisioning webhook`.

---

## Task 9 — Magic-Link Token Issuer (Pure TDD)

**Files:** `apps/web/src/lib/magic-links/token.ts` + co-located test.

**Step 1 (RED):** Test:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { issueMagicToken, verifyMagicToken, MagicTokenInvalid } from "./token";

const SECRET = "0".repeat(64);
beforeAll(() => { process.env.MAGIC_LINK_SECRET = SECRET; });

describe("magic-link tokens", () => {
  it("issues and verifies a token round-trip", () => {
    const token = issueMagicToken({ producerId: "p1", target: "portfolio", ttlSeconds: 60 });
    const decoded = verifyMagicToken(token);
    expect(decoded.producerId).toBe("p1");
    expect(decoded.target).toBe("portfolio");
  });
  it("throws on tampered token", () => {
    const token = issueMagicToken({ producerId: "p1", target: "booking", ttlSeconds: 60 });
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "b" : "a");
    expect(() => verifyMagicToken(tampered)).toThrow(MagicTokenInvalid);
  });
  it("throws on expired token", () => {
    const token = issueMagicToken({ producerId: "p1", target: "project", ttlSeconds: -1 });
    expect(() => verifyMagicToken(token)).toThrow(MagicTokenInvalid);
  });
});
```

**Step 2:** FAIL.

**Step 3 (GREEN):** Implement `token.ts` using `node:crypto` `createHmac` + `timingSafeEqual`. Token format: `base64url(JSON{producerId,target,context,exp}).base64url(hmac256)`. `verifyMagicToken` checks signature with constant-time compare and rejects expired tokens.

**Step 4:** PASS (3).

**Step 5:** Commit: `feat(magic-links): signed token issuer with TTL + tamper detection`.

---

## Task 10 — Theme Resolver (Per-Workspace CSS Variables) (TDD)

**Files:** `apps/web/src/lib/branding/theme-resolver.ts` + test.

**Step 1 (RED):**

```typescript
import { describe, it, expect } from "vitest";
import { resolveBrandStyle, defaultBrand } from "./theme-resolver";

describe("resolveBrandStyle", () => {
  it("returns default tokens when brand is empty", () => {
    expect(resolveBrandStyle({})["--brand-primary"]).toBe(defaultBrand.primary);
  });
  it("overrides primary + accent when valid hex provided", () => {
    const style = resolveBrandStyle({ primary: "#ff0066", accent: "#33ccff" });
    expect(style["--brand-primary"]).toBe("255 0 102");
    expect(style["--brand-accent"]).toBe("51 204 255");
  });
  it("falls back to default when hex is invalid", () => {
    expect(resolveBrandStyle({ primary: "not-a-color" })["--brand-primary"]).toBe(defaultBrand.primary);
  });
});
```

**Step 2:** FAIL.

**Step 3 (GREEN):** Implement `theme-resolver.ts` — exports `defaultBrand = { primary: "29 185 84", accent: "224 122 95" }`, a private `hexToRgbTriplet(hex)` returning `"R G B"` or `null`, and `resolveBrandStyle(brand)` returning a `Record<\`--brand-${string}\`, string>` with safe fallbacks.

**Step 4:** PASS.

**Step 5:** Commit: `feat(branding): theme resolver maps producer brand to CSS variables`.

---

## Task 11 — Tauri 2.x Desktop Shell

> **Prereq:** Rust toolchain (rustup) + macOS Xcode CLT installed locally.

**Files:** `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml`, `build.rs`, `src/main.rs`, default icon set.

**Step 1:** Workspace dev dep `@tauri-apps/cli@^2`.

**Step 2:** `apps/desktop/package.json` — scripts `tauri`, `dev` (= `tauri dev`), `build` (= `tauri build`).

**Step 3:** `tauri.conf.json` — productName "Skitza", identifier `com.skitza.desktop`, `beforeDevCommand: "pnpm --filter web dev"`, `devUrl: http://localhost:3000`, `frontendDist: ../web/.next`, single 1280×800 window with min 960×600, bundle targets `["dmg", "app"]`.

**Step 4:** Minimal Rust:

```rust
// src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`Cargo.toml` declares `tauri@2.0.0` + `tauri-build@2.0.0` + `serde@1` + `serde_json@1`. `build.rs` calls `tauri_build::build()`.

**Step 5:** Smoke: `pnpm tauri:dev` opens a native window loading the dark-themed home page.

**Step 6:** Commit: `feat(desktop): tauri 2.x shell loading the web app`.

---

## Task 12 — GitHub Actions CI + Vercel Deploy + Tauri Bundle

**Files:** `.github/workflows/ci.yml`, `.github/workflows/desktop-build.yml`. Vercel link via CLI (no committed file).

**Step 1:** `ci.yml` — on push to main + PRs. Job `test` on ubuntu-latest: checkout, setup pnpm 9, setup Node 20 with pnpm cache, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (passing `DATABASE_URL_TEST` from secrets), `pnpm build`.

**Step 2:** `desktop-build.yml` — on push to main when `apps/desktop/**` or `apps/web/**` changes (and `workflow_dispatch`). Job on macos-latest: checkout, pnpm 9, Node 20, stable Rust toolchain, `pnpm install`, `pnpm tauri:build`, upload-artifact the `.dmg`.

**Step 3:** From `apps/web/`: `pnpm dlx vercel link` then add env vars (`DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `MAGIC_LINK_SECRET`) to the production environment.

**Step 4:** Add `DATABASE_URL_TEST` repository secret in GitHub UI (Neon dev branch URL).

**Step 5:** First push: `git remote add origin git@github.com:skitza/skitza.git && git push -u origin main`. CI runs and passes; Vercel auto-deploys main.

**Step 6:** Acceptance for end of Weeks 1–2 — verify all pass:

- ☐ `pnpm dev` boots web at `localhost:3000` showing both themes.
- ☐ `pnpm tauri:dev` opens a native window with the same UI.
- ☐ `pnpm test` shows ≥ 8 passing tests across `apps/web` + `packages/db`.
- ☐ Sign up via Clerk on the deployed Vercel URL → new row appears in Neon `producers` within 5 s.
- ☐ `curl <vercel-url>/api/trpc/health.check` returns `ok: true`.
- ☐ GitHub Actions CI green on `main`.
- ☐ Desktop Build workflow produces a downloadable `.dmg` artifact.

**Step 7:** Commit: `ci: github actions for web tests + tauri macos bundle`. Push.

---

## What Comes Next (Weeks 3–5 — preview only)

Producer onboarding wizard, Portfolio page (server component reading `portfolio_tracks`), Magic Lead Link issuer + landing page resolver + analytics insert, Public booking page using Cal.com Atoms. A separate plan doc will be written for that.

---

## Skill Usage Reminders

- `superpowers:test-driven-development` — required for tasks marked TDD above. Red → green → refactor → commit.
- `superpowers:executing-plans` — for working through this plan step by step.
- `superpowers:verification-before-completion` — Task 12 §Step 6 acceptance list must all be ticked before declaring "Weeks 1–2 done".
- DRY · YAGNI · TDD · frequent commits — every task ends with a commit. Don't batch.
