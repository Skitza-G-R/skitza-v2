# Marketing Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dead-end ad-conversion landing page at `/get-started` (English) and `/get-started/he` (Hebrew). Captures email via Make.com webhook → Airtable. Fully isolated from the rest of the Skitza site (no nav, no footer, no off-page links, noindex). 5 sections: Hero → Demo video → Pain cascade → Founder note → CTA repeat.

**Architecture:** Next.js App Router routes outside the `(public)` group, with their own minimal layout. Form submission goes through a single tRPC `waitlist.signup` mutation that POSTs to a Make.com webhook (10s timeout, no DB writes). Make.com routes to Airtable + optional fan-outs. Hebrew page wraps content in `<div lang="he" dir="rtl">` (root `<html>` stays LTR per CLAUDE.md mistake log 2026-04-20).

**Tech Stack:** Next.js 15 App Router, tRPC, Zod, React Server Components for pages + client components for forms, pure CSS animations (no framer-motion), CSS variables only (no hex), `prefers-reduced-motion` gates (existing CI test enforces).

**Reference:** Full design doc at [`docs/plans/active/2026-05-08-marketing-landing-design.md`](./2026-05-08-marketing-landing-design.md). All copy (English + Hebrew), animation specs, color tokens, and section content live there.

**Pre-conditions:**
- ✅ `MAKE_WAITLIST_WEBHOOK_URL` set in Vercel (Production + Preview + Development) — confirmed by founder 2026-05-08
- ⚠️ Founder still needs to: set up Airtable base "Skitza Waitlist", create Make.com scenario routing webhook → Airtable. See §8 of design doc.
- ⏳ Founder photo + 15-sec demo video can ship as placeholders for v1; swap pre-launch.

**Existing infra this plan depends on:**
- Rate limit util: `apps/web/src/lib/rate-limit/in-memory.ts` — sync function `checkRateLimit(key, limit, windowMs): RateLimitResult`
- tRPC public procedure: `apps/web/src/server/trpc/init.ts` — `publicProcedure` (no auth, no DB context)
- tRPC root: `apps/web/src/server/trpc/routers/_app.ts` — register new routers here
- Public router pattern: `apps/web/src/server/trpc/routers/public-profile.ts` — uses local `publicCtx()` helper to read IP from `headers()`
- Existing motion-primitives test: `apps/web/src/app/__tests__/motion-primitives.test.ts` — fails CI if a new CSS animation lacks `prefers-reduced-motion` gate
- Auth helper: `auth()` from `@clerk/nextjs/server`
- Brand tokens: `apps/web/src/app/globals.css` — `var(--bg-base)`, `var(--fg-primary)`, etc.

**Verify command (run between tasks and before push):**
```bash
pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test
```

---

## Phase 1 — Foundation (isolated routing + SEO)

### Task 1: Isolated layout with noindex metadata

Sets up the dead-end-funnel boundary. The layout for `/get-started/*` renders children only — no nav, no footer, no clickable logo. Sets `robots: { index: false, follow: false }` on every page in the route.

**Files:**
- Create: `apps/web/src/app/get-started/layout.tsx`
- Create: `apps/web/src/app/get-started/__tests__/layout.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/web/src/app/get-started/__tests__/layout.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GetStartedLayout, { metadata } from "../layout";

describe("get-started layout", () => {
  it("renders children only — no nav, no footer", () => {
    const { container } = render(
      <GetStartedLayout>
        <div data-testid="child" />
      </GetStartedLayout>,
    );
    expect(container.querySelector("[data-testid='child']")).toBeTruthy();
    expect(container.querySelector("nav")).toBeFalsy();
    expect(container.querySelector("footer")).toBeFalsy();
    expect(container.querySelector("header")).toBeFalsy();
  });

  it("sets noindex+nofollow on the route", () => {
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    });
  });
});
```

**Step 2: Run test, verify fail**

```bash
pnpm -F web test apps/web/src/app/get-started/__tests__/layout.test.tsx
```

Expected: FAIL — module `../layout` does not exist.

**Step 3: Implementation**

```tsx
// apps/web/src/app/get-started/layout.tsx
import type { Metadata, ReactNode } from "next";

export const metadata: Metadata = {
  // Paid-traffic destination, not organic SEO. Keep search engines out
  // so the ad copy ("WhatsApp is not a studio") doesn't compete with
  // the homepage in SERPs and so we can iterate ad copy without SEO drag.
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

// Minimal layout — no header, no footer, no global nav. The ad funnel
// is a dead end by design (see design doc §3.5). Every off-page link
// is a conversion leak; this layout is the architectural enforcement.
export default function GetStartedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
```

**Step 4: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/app/get-started/__tests__/layout.test.tsx
```

Expected: PASS — both tests green.

**Step 5: Commit**

```bash
git add apps/web/src/app/get-started/
git commit -m "$(cat <<'EOF'
feat(landing): isolated layout for /get-started ad funnel

Per design doc §3.5: ad landing page is a dead-end funnel with no
links to the rest of Skitza. This layout renders children only and
sets noindex+nofollow so paid-traffic copy doesn't compete with the
organic homepage in search results.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Sitemap exclusion for /get-started routes

Belt-and-suspenders for noindex: also drop the routes from `sitemap.ts` so search engines never even see them advertised.

**Files:**
- Modify: `apps/web/src/app/sitemap.ts`
- Test: `apps/web/src/app/__tests__/sitemap.test.ts` (create or extend)

**Step 1: Read current sitemap to understand the shape**

```bash
cat apps/web/src/app/sitemap.ts
```

Read the existing file's URL list and shape — the test/implementation below assumes a `MetadataRoute.Sitemap` array. Adapt if the structure differs.

**Step 2: Write the failing test**

```ts
// apps/web/src/app/__tests__/sitemap.test.ts
import { describe, it, expect } from "vitest";
import sitemap from "../sitemap";

describe("sitemap", () => {
  it("excludes /get-started* routes from the sitemap", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.includes("/get-started"))).toBe(false);
  });
});
```

**Step 3: Run test**

```bash
pnpm -F web test apps/web/src/app/__tests__/sitemap.test.ts
```

Expected: PASS if sitemap doesn't currently include `/get-started` (it shouldn't — we haven't added the routes yet). The test now serves as a regression guard.

**Step 4: Belt-and-suspenders — add an explicit filter in sitemap.ts**

If `sitemap.ts` builds URLs from a list, add a defensive filter:

```ts
// apps/web/src/app/sitemap.ts (modified)
// Before returning, filter out any /get-started/* routes — these are
// paid-traffic destinations (see docs/plans/active/2026-05-08-marketing-landing-design.md §3.5).
return entries.filter((e) => !e.url.includes("/get-started"));
```

**Step 5: Run test, verify still passes**

```bash
pnpm -F web test apps/web/src/app/__tests__/sitemap.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/app/sitemap.ts apps/web/src/app/__tests__/sitemap.test.ts
git commit -m "test(landing): regression guard — sitemap excludes /get-started

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Static (non-clickable) logo component

The logo displays for brand recognition but does NOT link anywhere — that's the rule from §3.5. Pure visual.

**Files:**
- Create: `apps/web/src/app/get-started/_components/static-logo.tsx`
- Create: `apps/web/src/app/get-started/_components/__tests__/static-logo.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/web/src/app/get-started/_components/__tests__/static-logo.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StaticLogo } from "../static-logo";

describe("StaticLogo", () => {
  it("renders the brand mark", () => {
    const { getByLabelText } = render(<StaticLogo />);
    expect(getByLabelText("Skitza")).toBeTruthy();
  });

  it("is NOT wrapped in a link (isolation rule §3.5)", () => {
    const { container } = render(<StaticLogo />);
    expect(container.querySelector("a")).toBeFalsy();
    expect(container.querySelector("[role='link']")).toBeFalsy();
  });
});
```

**Step 2: Run test, verify fail**

```bash
pnpm -F web test apps/web/src/app/get-started/_components/__tests__/static-logo.test.tsx
```

Expected: FAIL — module `../static-logo` does not exist.

**Step 3: Implementation**

```tsx
// apps/web/src/app/get-started/_components/static-logo.tsx
// Brand-recognition logo for the ad funnel. Display-only — never
// wrapped in <a> or <Link> per §3.5 isolation rule.
export function StaticLogo() {
  return (
    <div
      aria-label="Skitza"
      className="inline-flex items-center gap-2 text-[rgb(var(--fg-primary))]"
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
        <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2" />
        <circle cx="14" cy="14" r="6" fill="currentColor" />
      </svg>
      <span className="font-semibold tracking-tight">Skitza</span>
    </div>
  );
}
```

**Step 4: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/app/get-started/_components/__tests__/static-logo.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/app/get-started/_components/
git commit -m "feat(landing): non-clickable static logo for ad funnel

Brand recognition without an escape hatch — the logo displays but
isn't a link. Enforced via test that asserts no <a> or [role='link']
in the rendered tree.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 2 — Server (waitlist webhook)

### Task 4: Waitlist tRPC procedure — happy path

The `waitlist.signup` mutation. Read IP from headers (no `ctx.ip` exists), POST signup payload to Make.com webhook with 10s timeout. Returns `{ status: "ok" }` on success.

**Files:**
- Create: `apps/web/src/server/trpc/routers/waitlist.ts`
- Create: `apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts`

**Step 1: Write the failing test (happy path only — other behaviors come in later tasks)**

```ts
// apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("next/headers", () => ({
  headers: async () => new Headers({
    "x-forwarded-for": "203.0.113.42",
    "user-agent": "Mozilla/5.0 (Test)",
  }),
}));

vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true, remaining: 4, resetMs: 0 })),
}));

import { waitlistRouter } from "../waitlist";

const caller = waitlistRouter.createCaller({ userId: null });

describe("waitlist.signup — happy path", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc123";
  });

  afterEach(() => {
    delete process.env.MAKE_WAITLIST_WEBHOOK_URL;
  });

  it("POSTs the payload to the webhook and returns ok", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await caller.signup({
      email: "yuval@example.com",
      firstName: "Yuval",
      locale: "en",
    });

    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hook.test/abc123");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      email: "yuval@example.com",
      firstName: "Yuval",
      locale: "en",
      ipAddress: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Test)",
    });
    expect(body.signedUpAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizes email to lowercase + trimmed", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await caller.signup({
      email: "  YUVAL@Example.COM  ",
      locale: "he",
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.email).toBe("yuval@example.com");
  });
});
```

**Step 2: Run test, verify fail**

```bash
pnpm -F web test apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
```

Expected: FAIL — module `../waitlist` does not exist.

**Step 3: Implementation**

```ts
// apps/web/src/server/trpc/routers/waitlist.ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { publicProcedure, router } from "../init";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";

const SignupInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    firstName: z.string().trim().min(1).max(60).optional(),
    locale: z.enum(["en", "he"]),
    utm: z
      .object({
        source: z.string().max(50).optional(),
        medium: z.string().max(50).optional(),
        campaign: z.string().max(100).optional(),
      })
      .optional(),
    referrer: z.string().url().max(2048).optional(),
    // Honeypot — must be empty (bots fill it, humans don't see it)
    company: z.string().max(0).optional(),
  })
  .strict();

const WEBHOOK_TIMEOUT_MS = 10_000;

export const waitlistRouter = router({
  signup: publicProcedure
    .input(SignupInput)
    .mutation(async ({ input }) => {
      // Honeypot — silent success so bots don't learn they were blocked
      if (input.company && input.company.length > 0) {
        return { status: "ok" as const };
      }

      const hdrs = await headers();
      const ip =
        hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const userAgent = hdrs.get("user-agent") ?? null;

      // Rate limit: 5 signups per IP per hour
      const rl = checkRateLimit(`waitlist:${ip}`, 5, 3_600_000);
      if (!rl.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many signups from this address. Try again later.",
        });
      }

      const webhookUrl = process.env.MAKE_WAITLIST_WEBHOOK_URL;
      if (!webhookUrl) {
        console.error("[waitlist] MAKE_WAITLIST_WEBHOOK_URL not configured");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Signup is temporarily unavailable.",
        });
      }

      const payload = {
        email: input.email,
        firstName: input.firstName ?? null,
        locale: input.locale,
        utmSource: input.utm?.source ?? null,
        utmMedium: input.utm?.medium ?? null,
        utmCampaign: input.utm?.campaign ?? null,
        referrer: input.referrer ?? null,
        userAgent,
        ipAddress: ip,
        signedUpAt: new Date().toISOString(),
      };

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, WEBHOOK_TIMEOUT_MS);

      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          console.error(
            `[waitlist] Webhook returned ${String(response.status)}`,
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not save your signup. Please try again.",
          });
        }
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[waitlist] Webhook fetch failed", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not save your signup. Please try again.",
        });
      } finally {
        clearTimeout(timer);
      }

      return { status: "ok" as const };
    }),
});
```

**Step 4: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
```

Expected: PASS — 2 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/server/trpc/routers/waitlist.ts apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
git commit -m "feat(landing): waitlist.signup tRPC procedure — happy path

POSTs signup payload to Make.com webhook (URL from env var,
10s AbortController timeout). No DB writes — Make.com handles
all downstream routing to Airtable + optional fan-outs.

Tests cover happy path + email normalization. Honeypot, rate-limit,
and error cases come in tasks 5-7.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Honeypot rejection

Bots that fill the hidden `company` field get a silent 200 (no webhook fire). Humans never see this field.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts` (add test)

**Step 1: Add a test for the honeypot**

Append to the existing test file:

```ts
describe("waitlist.signup — honeypot", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc";
  });

  it("returns ok WITHOUT firing the webhook when company field is non-empty", async () => {
    const result = await caller.signup({
      email: "bot@spam.com",
      locale: "en",
      company: "definitely-a-bot",
    });
    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test, verify pass**

The honeypot logic was already implemented in Task 4 — this test should pass on the first run because the implementation already short-circuits on `input.company.length > 0`.

```bash
pnpm -F web test apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
```

Expected: PASS — 3 tests green.

**Step 3: Commit**

```bash
git add apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
git commit -m "test(landing): honeypot regression test for waitlist.signup

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Rate-limit enforcement

After 5 signups in an hour from one IP, throw `TOO_MANY_REQUESTS`. Webhook never fires.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts`

**Step 1: Write the failing test**

```ts
import { checkRateLimit } from "~/lib/rate-limit/in-memory";

describe("waitlist.signup — rate limiting", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc";
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true, remaining: 4, resetMs: 0 });
  });

  it("throws TOO_MANY_REQUESTS when rate limit exceeded — webhook NOT called", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({
      ok: false, remaining: 0, resetMs: 12_000,
    });

    await expect(
      caller.signup({ email: "yuval@example.com", locale: "en" }),
    ).rejects.toThrow(/Too many signups/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses IP-keyed bucket with limit=5, window=1 hour", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await caller.signup({ email: "y@example.com", locale: "en" });
    expect(checkRateLimit).toHaveBeenCalledWith(
      "waitlist:203.0.113.42",
      5,
      3_600_000,
    );
  });
});
```

**Step 2: Run test, verify pass**

The rate-limit logic was already implemented in Task 4. Test should pass.

```bash
pnpm -F web test apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
```

Expected: PASS — 5 tests green.

**Step 3: Commit**

```bash
git add apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
git commit -m "test(landing): rate-limit regression tests for waitlist.signup

Asserts: TOO_MANY_REQUESTS is thrown without firing the webhook,
and the bucket key + window match the design spec (5/IP/hour).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Webhook URL missing + webhook timeout + webhook 500

Three failure modes, three tests.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts`

**Step 1: Add three failing tests**

```ts
describe("waitlist.signup — webhook failure modes", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true, remaining: 4, resetMs: 0 });
  });

  it("throws INTERNAL_SERVER_ERROR when MAKE_WAITLIST_WEBHOOK_URL is not configured", async () => {
    delete process.env.MAKE_WAITLIST_WEBHOOK_URL;
    await expect(
      caller.signup({ email: "y@example.com", locale: "en" }),
    ).rejects.toThrow(/temporarily unavailable/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws INTERNAL_SERVER_ERROR when webhook returns 500", async () => {
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc";
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(
      caller.signup({ email: "y@example.com", locale: "en" }),
    ).rejects.toThrow(/Could not save/);
  });

  it("throws INTERNAL_SERVER_ERROR when webhook fetch aborts (timeout)", async () => {
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc";
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(
      caller.signup({ email: "y@example.com", locale: "en" }),
    ).rejects.toThrow(/Could not save/);
  });
});
```

**Step 2: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
```

Expected: PASS — 8 tests green. Failure modes were implemented in Task 4.

**Step 3: Commit**

```bash
git add apps/web/src/server/trpc/routers/__tests__/waitlist.test.ts
git commit -m "test(landing): webhook failure-mode tests for waitlist.signup

Covers: MAKE_WAITLIST_WEBHOOK_URL missing, webhook 500 response,
webhook fetch abort/timeout. All three throw INTERNAL_SERVER_ERROR
with safe user-facing messages (no infra leak in error text).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Wire `waitlistRouter` into the root tRPC router

Make the new procedure callable from the client.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/_app.ts`

**Step 1: Read current root router**

```bash
cat apps/web/src/server/trpc/routers/_app.ts
```

Note the existing pattern — likely `appRouter = router({ key: someRouter, ... })`.

**Step 2: Add `waitlist: waitlistRouter`**

```ts
// apps/web/src/server/trpc/routers/_app.ts (add to existing imports + router object)
import { waitlistRouter } from "./waitlist";

export const appRouter = router({
  // ... existing routers
  waitlist: waitlistRouter,
});
```

**Step 3: Verify typecheck passes**

```bash
pnpm -F web typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/web/src/server/trpc/routers/_app.ts
git commit -m "feat(landing): wire waitlistRouter into appRouter

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 3 — Form + thanks pages

### Task 9: WaitlistForm component

Shared form used by hero + CTA-repeat. Calls `trpc.waitlist.signup`, shows error inline, redirects to `/thanks?n=...` on success.

**Files:**
- Create: `apps/web/src/app/get-started/_components/waitlist-form.tsx`
- Create: `apps/web/src/app/get-started/_components/__tests__/waitlist-form.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/web/src/app/get-started/_components/__tests__/waitlist-form.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutateMock = vi.fn();
const pushMock = vi.fn();

vi.mock("~/utils/trpc", () => ({
  trpc: {
    waitlist: {
      signup: {
        useMutation: () => ({
          mutate: mutateMock,
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { WaitlistForm } from "../waitlist-form";

describe("WaitlistForm", () => {
  it("submits with email + locale and redirects to /thanks on success", async () => {
    const { rerender } = render(<WaitlistForm locale="en" thanksHref="/get-started/thanks" />);
    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: "yuval@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /get early access/i }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: "yuval@example.com", locale: "en" }),
        expect.any(Object),
      );
    });

    // Simulate the mutation success callback
    const onSuccess = mutateMock.mock.calls[0][1].onSuccess;
    onSuccess({ status: "ok" });
    expect(pushMock).toHaveBeenCalledWith("/get-started/thanks");
  });

  it("includes honeypot field with display:none", () => {
    render(<WaitlistForm locale="en" thanksHref="/get-started/thanks" />);
    const honeypot = document.querySelector("input[name='company']") as HTMLInputElement;
    expect(honeypot).toBeTruthy();
    expect(getComputedStyle(honeypot).display).toBe("none");
  });
});
```

**Step 2: Run test, verify fail**

```bash
pnpm -F web test apps/web/src/app/get-started/_components/__tests__/waitlist-form.test.tsx
```

Expected: FAIL — module not found.

**Step 3: Implementation**

```tsx
// apps/web/src/app/get-started/_components/waitlist-form.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "~/utils/trpc";

export function WaitlistForm({
  locale,
  thanksHref,
}: {
  locale: "en" | "he";
  thanksHref: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const signup = trpc.waitlist.signup.useMutation();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const honeypot = (formEl.elements.namedItem("company") as HTMLInputElement | null)?.value ?? "";

    signup.mutate(
      {
        email: email.trim().toLowerCase(),
        firstName: firstName.trim() || undefined,
        locale,
        company: honeypot,
      },
      {
        onSuccess: () => {
          const url = firstName.trim()
            ? `${thanksHref}?n=${encodeURIComponent(firstName.trim())}`
            : thanksHref;
          router.push(url);
        },
        onError: (err) => {
          setError(err.message);
        },
      },
    );
  }

  const isHe = locale === "he";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <label className="sr-only" htmlFor="waitlist-email">
        {isHe ? "אימייל" : "Email"}
      </label>
      <input
        id="waitlist-email"
        type="email"
        required
        autoComplete="email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => { setEmail(e.target.value); }}
        className="h-12 flex-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 text-[rgb(var(--fg-primary))] placeholder-[rgb(var(--fg-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--brand-primary))] sm:h-14"
      />
      {/* Honeypot — bots fill it, humans don't see it */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <button
        type="submit"
        disabled={signup.isPending}
        className="h-12 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-6 font-semibold text-[rgb(var(--fg-inverse))] disabled:opacity-50 sm:h-14 sk-cta-shine"
      >
        {signup.isPending
          ? isHe ? "שולח..." : "Sending..."
          : isHe ? "גישה מוקדמת" : "Get early access"}
      </button>
      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-[rgb(var(--fg-danger))] sm:basis-full"
        >
          {error}
        </p>
      )}
    </form>
  );
}
```

**Step 4: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/app/get-started/_components/__tests__/waitlist-form.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/app/get-started/_components/waitlist-form.tsx apps/web/src/app/get-started/_components/__tests__/waitlist-form.test.tsx
git commit -m "feat(landing): WaitlistForm — shared by hero + CTA-repeat

Calls trpc.waitlist.signup, redirects to /thanks?n=<firstName> on
success, includes display:none honeypot, shows inline error with
aria-live='polite'. Localized button copy (EN/HE).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: English /thanks page

Reads `?n=<firstName>` from query, shows greeting + confetti animation. No outbound links.

**Files:**
- Create: `apps/web/src/app/get-started/thanks/page.tsx`
- Create: `apps/web/src/app/get-started/thanks/__tests__/page.test.tsx`
- Create: `apps/web/src/app/get-started/_components/post-signup-confetti.tsx`

**Step 1: Write the failing test**

```tsx
// apps/web/src/app/get-started/thanks/__tests__/page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null }),
}));

import ThanksPage from "../page";

describe("English /thanks page", () => {
  it("shows greeting with name when ?n=Yuval is provided", async () => {
    const ui = await ThanksPage({ searchParams: Promise.resolve({ n: "Yuval" }) });
    const { getByText } = render(ui);
    expect(getByText(/You're in, Yuval/i)).toBeTruthy();
  });

  it("falls back to no-name greeting when ?n is absent", async () => {
    const ui = await ThanksPage({ searchParams: Promise.resolve({}) });
    const { getByText } = render(ui);
    expect(getByText(/^You're in\.$/)).toBeTruthy();
  });

  it("strips HTML/special chars from the name param", async () => {
    const ui = await ThanksPage({ searchParams: Promise.resolve({ n: "<script>x" }) });
    const { container } = render(ui);
    expect(container.querySelector("script")).toBeFalsy();
  });

  it("renders no outbound links to non-/get-started routes", async () => {
    const ui = await ThanksPage({ searchParams: Promise.resolve({ n: "Yuval" }) });
    const { container } = render(ui);
    const links = Array.from(container.querySelectorAll("a"));
    for (const a of links) {
      const href = a.getAttribute("href") ?? "";
      expect(href.startsWith("/get-started") || href === "" || href.startsWith("#")).toBe(true);
    }
  });
});
```

**Step 2: Run test, verify fail**

```bash
pnpm -F web test apps/web/src/app/get-started/thanks/__tests__/page.test.tsx
```

Expected: FAIL — module not found.

**Step 3: Implementation — confetti component first**

```tsx
// apps/web/src/app/get-started/_components/post-signup-confetti.tsx
"use client";

// Pure-CSS confetti burst on mount. Gated by prefers-reduced-motion
// (the @keyframes are no-op'd in get-started.css when reduced-motion
// is preferred). Self-cleans after the animation completes.
export function PostSignupConfetti() {
  return (
    <div aria-hidden className="get-started-confetti" />
  );
}
```

**Step 4: Implementation — thanks page**

```tsx
// apps/web/src/app/get-started/thanks/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { PostSignupConfetti } from "../_components/post-signup-confetti";

export const dynamic = "force-dynamic";

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^\p{L}\p{M}\p{N}\s\-']/gu, "").trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : null;
}

export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  const params = await searchParams;
  const name = sanitizeName(params.n);

  return (
    <main className="get-started-root flex min-h-screen flex-col items-center justify-center px-6 text-center text-[rgb(var(--fg-primary))]">
      <PostSignupConfetti />
      <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
        {name ? `You're in, ${name}.` : "You're in."}
      </h1>
      <p className="mt-6 max-w-md text-base text-[rgb(var(--fg-secondary))] sm:text-lg">
        Beta opens soon. We'll email you when your spot opens.
      </p>
    </main>
  );
}
```

**Step 5: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/app/get-started/thanks/__tests__/page.test.tsx
```

Expected: PASS — 4 tests green.

**Step 6: Commit**

```bash
git add apps/web/src/app/get-started/thanks/ apps/web/src/app/get-started/_components/post-signup-confetti.tsx
git commit -m "feat(landing): English /thanks page with name personalization

Reads ?n=<firstName> from query (sanitized — strips HTML/special
chars, max 60 chars), renders greeting + confetti. Redirects
signed-in producers to /dashboard. Test asserts no outbound links
to non-/get-started routes (isolation rule §3.5).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Hebrew /thanks page

Same logic, Hebrew copy, RTL wrapper.

**Files:**
- Create: `apps/web/src/app/get-started/he/thanks/page.tsx`
- Create: `apps/web/src/app/get-started/he/thanks/__tests__/page.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/web/src/app/get-started/he/thanks/__tests__/page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null }),
}));

import ThanksPageHe from "../page";

describe("Hebrew /thanks page", () => {
  it("shows Hebrew greeting with name when ?n=יובל is provided", async () => {
    const ui = await ThanksPageHe({ searchParams: Promise.resolve({ n: "יובל" }) });
    const { getByText } = render(ui);
    expect(getByText(/אתה בפנים, יובל/)).toBeTruthy();
  });

  it("wraps content in dir='rtl' lang='he'", async () => {
    const ui = await ThanksPageHe({ searchParams: Promise.resolve({}) });
    const { container } = render(ui);
    const wrapper = container.querySelector("[dir='rtl'][lang='he']");
    expect(wrapper).toBeTruthy();
  });
});
```

**Step 2: Run test, verify fail**

```bash
pnpm -F web test apps/web/src/app/get-started/he/thanks/__tests__/page.test.tsx
```

Expected: FAIL — module not found.

**Step 3: Implementation**

```tsx
// apps/web/src/app/get-started/he/thanks/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { PostSignupConfetti } from "../../_components/post-signup-confetti";

export const dynamic = "force-dynamic";

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^\p{L}\p{M}\p{N}\s\-']/gu, "").trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : null;
}

export default async function ThanksPageHe({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  const params = await searchParams;
  const name = sanitizeName(params.n);

  return (
    <div lang="he" dir="rtl" className="get-started-root get-started-root--he">
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-[rgb(var(--fg-primary))]">
        <PostSignupConfetti />
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          {name ? `אתה בפנים, ${name}.` : "אתה בפנים."}
        </h1>
        <p className="mt-6 max-w-md text-base text-[rgb(var(--fg-secondary))] sm:text-lg">
          הביטא נפתחת בקרוב. נשלח לך מייל ברגע שהמקום שלך מתפנה.
        </p>
      </main>
    </div>
  );
}
```

**Step 4: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/app/get-started/he/thanks/__tests__/page.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/app/get-started/he/thanks/
git commit -m "feat(landing): Hebrew /thanks page with RTL wrapper

dir='rtl' lang='he' on the page-level <div> (NOT root <html> per
CLAUDE.md mistake log 2026-04-20).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 4 — English landing page (sections + animations)

### Task 12: English page skeleton + landing CSS file

Empty page that renders all 5 section placeholders. Sets up `get-started.css` and the `.get-started-root` wrapper class.

**Files:**
- Create: `apps/web/src/app/get-started/page.tsx`
- Create: `apps/web/src/styles/get-started.css`
- Create: `apps/web/src/app/get-started/__tests__/page.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/web/src/app/get-started/__tests__/page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null }),
}));

import GetStartedPage from "../page";

describe("English /get-started page", () => {
  it("renders all 5 sections in order", async () => {
    const ui = await GetStartedPage();
    const { container } = render(ui);
    const sections = container.querySelectorAll("section");
    expect(sections.length).toBeGreaterThanOrEqual(5);
  });

  it("redirects signed-in users to /dashboard", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_123" } as any);
    const { redirect } = await import("next/navigation");
    vi.mocked(redirect).mockImplementationOnce((() => { throw new Error("redirected"); }) as any);

    await expect(GetStartedPage()).rejects.toThrow("redirected");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });
});
```

**Step 2: Run test, verify fail**

```bash
pnpm -F web test apps/web/src/app/get-started/__tests__/page.test.tsx
```

Expected: FAIL — module not found.

**Step 3: Implementation — minimal page**

```tsx
// apps/web/src/app/get-started/page.tsx
import "~/styles/get-started.css";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { StaticLogo } from "./_components/static-logo";

export default async function GetStartedPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="get-started-root">
      <header className="px-6 py-6">
        <StaticLogo />
      </header>
      <section id="hero" className="px-6 py-12">{/* Task 13 */}</section>
      <section id="demo" className="px-6 py-12">{/* Task 15 */}</section>
      <section id="cascade" className="px-6 py-12">{/* Task 16 */}</section>
      <section id="founder" className="px-6 py-12">{/* Task 17 */}</section>
      <section id="cta" className="px-6 py-12">{/* Task 17 */}</section>
    </main>
  );
}
```

**Step 4: Implementation — minimal CSS**

```css
/* apps/web/src/styles/get-started.css */
/* Landing-page-specific CSS. Scoped to .get-started-root so it never
 * leaks onto the rest of the app. All animations gated by
 * prefers-reduced-motion (existing CI test enforces). */

.get-started-root {
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-primary));
  min-height: 100svh;
}

@media (prefers-reduced-motion: reduce) {
  .get-started-root *,
  .get-started-root *::before,
  .get-started-root *::after {
    animation-duration: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0ms !important;
  }
}
```

**Step 5: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/app/get-started/__tests__/page.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/app/get-started/page.tsx apps/web/src/styles/get-started.css apps/web/src/app/get-started/__tests__/page.test.tsx
git commit -m "feat(landing): English page skeleton + get-started.css

5 empty section placeholders rendered in order. Static logo in
header. Redirects signed-in producers to /dashboard. Global
prefers-reduced-motion fallback at the .get-started-root scope.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: Hero section — copy + form (no animation yet)

Copy from design doc §4.1. Wires WaitlistForm. Renders without the split-screen animation (added in Task 14).

**Files:**
- Create: `apps/web/src/app/get-started/_components/hero-section.tsx`

**Step 1: Implementation**

```tsx
// apps/web/src/app/get-started/_components/hero-section.tsx
import { WaitlistForm } from "./waitlist-form";

export function HeroSection({
  locale,
}: {
  locale: "en" | "he";
}) {
  const isHe = locale === "he";
  const thanksHref = isHe ? "/get-started/he/thanks" : "/get-started/thanks";

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
        {isHe ? (
          <>
            אתה מפיק.
            <br />
            לא מזכירה.
          </>
        ) : (
          <>
            You're a producer.
            <br />
            Not an assistant.
          </>
        )}
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-[rgb(var(--fg-secondary))] sm:text-xl">
        {isHe
          ? "תיאום סשן לא אמור להיות ארוך יותר מהסשן עצמו. סקיצה מחליפה את WhatsApp, Drive, Notion, DocuSign ו-Stripe — בלינק אחד."
          : "Booking a session shouldn't take longer than the session. Skitza replaces WhatsApp, Drive, Notion, DocuSign, and Stripe — with one link."}
      </p>
      <div className="mt-8 max-w-xl">
        <WaitlistForm locale={locale} thanksHref={thanksHref} />
        <p className="mt-3 text-sm text-[rgb(var(--fg-muted))]">
          {isHe
            ? "בלי ספאם. נשלח לך מייל ברגע שהמקום שלך מתפנה."
            : "No spam. We email you when your spot opens."}
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Wire into page**

Replace `{/* Task 13 */}` in `apps/web/src/app/get-started/page.tsx`:

```tsx
import { HeroSection } from "./_components/hero-section";
// ...
<section id="hero" className="px-6 py-12">
  <HeroSection locale="en" />
</section>
```

**Step 3: Verify typecheck + visual smoke**

```bash
pnpm -F web typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/web/src/app/get-started/_components/hero-section.tsx apps/web/src/app/get-started/page.tsx
git commit -m "feat(landing): hero section copy + waitlist form

Headline + sub-head + email field. Animation comes in next task.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: Hero split-screen animation

The chaos↔Skitza visual. Pure CSS, 8-sec loop, hover-reactive on desktop, stacks vertically on mobile.

**Files:**
- Modify: `apps/web/src/app/get-started/_components/hero-section.tsx`
- Modify: `apps/web/src/styles/get-started.css`

**Step 1: Add markup to hero-section.tsx**

After the `<WaitlistForm>` block, append the split-screen container:

```tsx
<div className="get-started-split mt-16">
  <div className="get-started-split__chaos" aria-hidden>
    <div className="get-started-split__msg get-started-split__msg--1">u up to record Tuesday?</div>
    <div className="get-started-split__msg get-started-split__msg--2">where's the Stripe link?</div>
    <div className="get-started-split__msg get-started-split__msg--3">FINAL_v7.wav</div>
    <div className="get-started-split__msg get-started-split__msg--4">DECLINED</div>
  </div>
  <div className="get-started-split__calm" aria-hidden>
    <div className="get-started-split__card">
      <span className="get-started-split__card-title">Session — Aug 14, 2:00 PM</span>
      <span className="get-started-split__card-status">Confirmed ✓</span>
    </div>
  </div>
</div>
```

**Step 2: Add CSS to get-started.css**

```css
/* Hero split-screen — chaos (left) vs Skitza calm (right). 8-sec loop. */

.get-started-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  height: 320px;
}

@media (max-width: 768px) {
  .get-started-split {
    grid-template-columns: 1fr;
    height: 480px;
  }
}

.get-started-split__chaos,
.get-started-split__calm {
  position: relative;
  border: 1px solid rgb(var(--border-subtle));
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

@media (hover: hover) {
  .get-started-split:hover .get-started-split__chaos:not(:hover),
  .get-started-split:hover .get-started-split__calm:not(:hover) {
    opacity: 0.5;
  }
  .get-started-split__chaos:hover,
  .get-started-split__calm:hover {
    transform: scale(1.02);
  }
}

.get-started-split__chaos {
  background: rgb(var(--fg-danger) / 0.08);
}

.get-started-split__calm {
  background: rgb(var(--brand-primary) / 0.08);
}

.get-started-split__msg {
  position: absolute;
  padding: 0.5rem 1rem;
  background: rgb(var(--bg-elevated));
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  opacity: 0;
  animation: gs-chaos-fade 8s infinite;
}

.get-started-split__msg--1 { top: 16%; left: 8%; animation-delay: 0s; }
.get-started-split__msg--2 { top: 35%; left: 25%; animation-delay: 1s; }
.get-started-split__msg--3 { top: 55%; left: 12%; animation-delay: 2s; }
.get-started-split__msg--4 { top: 74%; left: 30%; animation-delay: 3s; color: rgb(var(--fg-danger)); }

@keyframes gs-chaos-fade {
  0%, 60% { opacity: 0; transform: translateY(8px); }
  10%, 50% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; }
}

.get-started-split__card {
  position: absolute;
  inset: 50% 1.5rem auto 1.5rem;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.25rem;
  background: rgb(var(--bg-elevated));
  border-radius: var(--radius-md);
  box-shadow: 0 4px 24px rgb(0 0 0 / 0.08);
  animation: gs-skitza-flip 8s infinite cubic-bezier(0.16, 1, 0.3, 1);
}

.get-started-split__card-title {
  font-weight: 600;
  color: rgb(var(--fg-primary));
}

.get-started-split__card-status {
  font-size: 0.875rem;
  color: rgb(var(--brand-primary));
}

@keyframes gs-skitza-flip {
  0%, 30% { transform: translateY(-50%) rotateY(0deg); }
  40%, 70% { transform: translateY(-50%) rotateY(180deg); }
  80%, 100% { transform: translateY(-50%) rotateY(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .get-started-split__msg,
  .get-started-split__card {
    animation: none;
    opacity: 1;
  }
}
```

**Step 3: Run motion-primitives test**

```bash
pnpm -F web test apps/web/src/app/__tests__/motion-primitives.test.ts
```

Expected: PASS — both `gs-chaos-fade` and `gs-skitza-flip` have `prefers-reduced-motion` gates.

**Step 4: Visual sanity check**

```bash
pnpm -F web dev
# Open http://localhost:3000/get-started in browser
```

Verify: hero animation runs, hover dims the opposite panel, stacks vertically on narrow viewport.

**Step 5: Commit**

```bash
git add apps/web/src/app/get-started/_components/hero-section.tsx apps/web/src/styles/get-started.css
git commit -m "feat(landing): hero split-screen animation (chaos vs Skitza calm)

Pure CSS, 8s loop, hover-reactive on desktop, stacks vertically on
mobile. Reduced-motion fallback drops the animation entirely.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 15: Demo video section

Phone-frame mockup with auto-playing 15-sec video. Lazy-loaded via IntersectionObserver. Reduced-motion fallback shows poster image.

**Files:**
- Create: `apps/web/src/app/get-started/_components/demo-video-section.tsx`
- Modify: `apps/web/src/styles/get-started.css`
- Modify: `apps/web/src/app/get-started/page.tsx`
- Add (placeholder): `apps/web/public/landing/demo-poster.jpg` (or use a 1×1 transparent PNG until the real asset is ready)

**Step 1: Create placeholder asset**

```bash
mkdir -p apps/web/public/landing
# Replace later with the real screen recording
echo "Placeholder — swap for real demo recording before launch" > apps/web/public/landing/README.md
```

For now, use an existing brand image as the poster, OR create a 1×1 png placeholder. The video file will be added pre-launch.

**Step 2: Implementation — section component**

```tsx
// apps/web/src/app/get-started/_components/demo-video-section.tsx
"use client";

import { useEffect, useRef, useState } from "react";

export function DemoVideoSection() {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldLoad(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => { obs.disconnect(); };
  }, []);

  return (
    <div className="get-started-phone">
      <video
        ref={ref}
        poster="/landing/demo-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="none"
        aria-label="Skitza app demo: producer creates session, artist books, payment confirmed"
        className="get-started-phone__video"
      >
        {shouldLoad && (
          <>
            <source src="/landing/demo.webm" type="video/webm" />
            <source src="/landing/demo.mp4" type="video/mp4" />
          </>
        )}
      </video>
    </div>
  );
}
```

**Step 3: CSS for the phone frame**

Append to `get-started.css`:

```css
.get-started-phone {
  position: relative;
  width: 320px;
  margin: 0 auto;
  aspect-ratio: 9 / 16;
  border-radius: 32px;
  background: rgb(var(--fg-primary));
  padding: 8px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.18);
}

@media (min-width: 768px) {
  .get-started-phone { width: 380px; }
}

.get-started-phone::before {
  content: "";
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 100px;
  height: 24px;
  background: rgb(var(--fg-primary));
  border-radius: 16px;
  z-index: 1;
}

.get-started-phone__video {
  width: 100%;
  height: 100%;
  border-radius: 24px;
  object-fit: cover;
  background: rgb(var(--bg-elevated));
}
```

**Step 4: Wire into page**

In `apps/web/src/app/get-started/page.tsx`, replace `{/* Task 15 */}`:

```tsx
import { DemoVideoSection } from "./_components/demo-video-section";
// ...
<section id="demo" className="px-6 py-12">
  <DemoVideoSection />
</section>
```

**Step 5: Typecheck + visual smoke**

```bash
pnpm -F web typecheck && pnpm -F web dev
# Open http://localhost:3000/get-started, scroll to demo section
```

Expected: phone frame renders, video element is present (no source until intersection — that's fine).

**Step 6: Commit**

```bash
git add apps/web/src/app/get-started/_components/demo-video-section.tsx apps/web/src/styles/get-started.css apps/web/src/app/get-started/page.tsx apps/web/public/landing/
git commit -m "feat(landing): demo video section with phone frame + lazy load

IntersectionObserver triggers <source> load when within 200px of
viewport. Pure CSS phone frame (no PNG asset). Real demo.webm / .mp4
swap in pre-launch — for now the section shows the poster image.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 16: Pain cascade section + stack-reveal animation

Cascade copy from design doc §4.3, plus the 5-logos-merge animation.

**Files:**
- Create: `apps/web/src/app/get-started/_components/pain-cascade-section.tsx`
- Create: `apps/web/src/app/get-started/_components/stack-reveal.tsx`
- Modify: `apps/web/src/styles/get-started.css`
- Modify: `apps/web/src/app/get-started/page.tsx`

**Step 1: Implementation — pain-cascade-section.tsx**

```tsx
// apps/web/src/app/get-started/_components/pain-cascade-section.tsx
import { StackReveal } from "./stack-reveal";

export function PainCascadeSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";

  return (
    <div className="mx-auto max-w-3xl text-center">
      {isHe ? (
        <>
          <h2 className="text-3xl font-semibold sm:text-4xl">כמה זמן הולך לך על?</h2>
          <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
            לקבוע סשנים. לזכור מי חייב לך. לרדוף אחרי תשלומים. לחפש גרסאות בוואטסאפ.
            לעקוב מי לקוח פעיל ומה דחוף ואז עוד לתעד את הכל מחדש — בכל פעם.
          </p>
          <p className="mt-6 text-2xl font-semibold">למי יש זמן לזה?</p>
          <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
            פעם היה צריך לזה מזכירה.
            <br />
            היום, יש סקיצה.
          </p>
          <p className="mt-6 text-xl font-semibold">אפליקציה אחת שסוגרת לך את כל הפינות.</p>
        </>
      ) : (
        <>
          <h2 className="text-3xl font-semibold sm:text-4xl">How much time goes to waste on…</h2>
          <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
            Booking sessions. Searching WhatsApp for the right version. Chasing payments.
            Tracking what's due Friday and re-typing the same to-do list, every. single. time.
          </p>
          <p className="mt-6 text-2xl font-semibold">Who's got time for this?</p>
          <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
            You used to need a part-time assistant just to keep up.
            <br />
            Now you have Skitza.
          </p>
          <p className="mt-6 text-xl font-semibold">One app. For everything. Forever.</p>
        </>
      )}
      <div className="mt-12">
        <StackReveal />
      </div>
    </div>
  );
}
```

**Step 2: Implementation — stack-reveal.tsx**

```tsx
// apps/web/src/app/get-started/_components/stack-reveal.tsx
// 5 monochrome icons → merge into 1 Skitza icon. 8-sec loop.
// Pure CSS animation. Logos are simple inline SVGs (avoid trademark
// concerns + keep weight tiny).
export function StackReveal() {
  return (
    <div className="get-started-stack" aria-label="Replaces 5 tools with 1">
      <div className="get-started-stack__logos">
        {(["WA", "GD", "NO", "DS", "ST"] as const).map((label, i) => (
          <div
            key={label}
            className="get-started-stack__logo"
            style={{ animationDelay: `${String(i * 0.15)}s` }}
            aria-hidden
          >
            {label}
          </div>
        ))}
      </div>
      <div className="get-started-stack__skitza" aria-hidden>S</div>
    </div>
  );
}
```

**Step 3: CSS for stack-reveal**

Append to `get-started.css`:

```css
.get-started-stack {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

.get-started-stack__logos {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  justify-content: center;
}

.get-started-stack__logo {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--border-strong));
  border-radius: var(--radius-md);
  color: rgb(var(--fg-secondary));
  animation: gs-stack-merge 8s infinite cubic-bezier(0.4, 0, 0.2, 1);
}

.get-started-stack__skitza {
  position: absolute;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 700;
  background: rgb(var(--brand-primary));
  color: rgb(var(--fg-inverse));
  border-radius: var(--radius-lg);
  opacity: 0;
  animation: gs-stack-skitza 8s infinite cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes gs-stack-merge {
  0%, 30% { transform: scale(1); opacity: 1; }
  50%, 70% { transform: scale(0); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes gs-stack-skitza {
  0%, 40% { opacity: 0; transform: scale(0.5); }
  55%, 80% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.5); }
}

@media (prefers-reduced-motion: reduce) {
  .get-started-stack__logo,
  .get-started-stack__skitza {
    animation: none;
    opacity: 1;
    transform: none;
  }
  .get-started-stack__skitza { display: none; }
}
```

**Step 4: Wire into page**

```tsx
import { PainCascadeSection } from "./_components/pain-cascade-section";
// ...
<section id="cascade" className="px-6 py-12">
  <PainCascadeSection locale="en" />
</section>
```

**Step 5: Verify motion-primitives test still passes**

```bash
pnpm -F web test apps/web/src/app/__tests__/motion-primitives.test.ts
```

Expected: PASS (both `gs-stack-merge` and `gs-stack-skitza` have reduce gates).

**Step 6: Commit**

```bash
git add apps/web/src/app/get-started/_components/pain-cascade-section.tsx apps/web/src/app/get-started/_components/stack-reveal.tsx apps/web/src/styles/get-started.css apps/web/src/app/get-started/page.tsx
git commit -m "feat(landing): pain cascade section + stack-reveal animation

5 logos shrinking into 1 Skitza icon, 8s loop, reduced-motion gate.
Cascade copy in EN; HE locale wiring done — Hebrew page renders the
HE branch in task 18.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 17: Founder section + CTA-repeat section

Last two sections of the English page.

**Files:**
- Create: `apps/web/src/app/get-started/_components/founder-section.tsx`
- Create: `apps/web/src/app/get-started/_components/cta-section.tsx`
- Modify: `apps/web/src/app/get-started/page.tsx`
- Add (placeholder): `apps/web/public/landing/founder.jpg` or use gradient placeholder

**Step 1: Founder section**

```tsx
// apps/web/src/app/get-started/_components/founder-section.tsx
import Image from "next/image";

export function FounderSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  return (
    <div className="mx-auto grid max-w-4xl items-center gap-8 sm:grid-cols-[auto_1fr]">
      <div
        className="mx-auto h-32 w-32 overflow-hidden rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] sm:h-44 sm:w-44"
        aria-label={isHe ? "גילי אסרף" : "Gili Asraf, Skitza founder"}
      >
        {/* Pre-launch: replace with <Image src="/landing/founder.jpg" .../> */}
        <div className="flex h-full items-center justify-center text-3xl font-bold text-[rgb(var(--fg-inverse))]">GA</div>
      </div>
      <div className="text-[rgb(var(--fg-primary))]">
        {isHe ? (
          <>
            <p className="text-base sm:text-lg">
              אני גילי. בניתי את סקיצה אחרי שצפיתי בחברים מפיקים מבזבזים יותר זמן בוואטסאפ
              מאשר בסטודיו.
              <br /><br />
              הזמנות באפליקציה אחת. דרייב באחרת. חוזים בשלישית. תשלומים ברביעית. אף אחד מהם
              לא דיבר עם השני, ואף אחד לא נבנה למוזיקה.
              <br /><br />
              סקיצה היא הכלי שתמיד רציתי שיהיה להם — לינק אחד שמטפל בכל הסטאק, כדי שתוכל
              לחזור לעשות מוזיקה.
            </p>
            <p className="mt-4 text-sm text-[rgb(var(--fg-muted))]">— גילי אסרף, מייסד</p>
          </>
        ) : (
          <>
            <p className="text-base sm:text-lg">
              I'm Gili, and I built Skitza after watching my producer friends spend more time
              on WhatsApp than in the studio.
              <br /><br />
              Bookings in one app. Drive in another. Contracts in a third. Payments in a
              fourth. None of them talked to each other. None of them were built for music.
              <br /><br />
              Skitza is what I wish they had — one link that handles the whole stack so you
              can get back to making music.
            </p>
            <p className="mt-4 text-sm text-[rgb(var(--fg-muted))]">— Gili Asraf, founder</p>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: CTA repeat section**

```tsx
// apps/web/src/app/get-started/_components/cta-section.tsx
import { WaitlistForm } from "./waitlist-form";

export function CtaSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  const thanksHref = isHe ? "/get-started/he/thanks" : "/get-started/thanks";

  return (
    <div className="mx-auto max-w-2xl rounded-[var(--radius-lg)] bg-[rgb(var(--bg-elevated))] p-8 text-center">
      <h2 className="text-2xl font-semibold sm:text-3xl">
        {isHe ? "הצטרף לרשימת ההמתנה." : "Get on the waitlist."}
      </h2>
      <div className="mt-6">
        <WaitlistForm locale={locale} thanksHref={thanksHref} />
      </div>
      <p className="mt-4 text-sm text-[rgb(var(--fg-muted))]">
        {isHe ? "הביטא נפתחת בקרוב. המקומות מוגבלים." : "Beta opens soon. Spots are limited."}
      </p>
    </div>
  );
}
```

**Step 3: Wire both into page**

```tsx
import { FounderSection } from "./_components/founder-section";
import { CtaSection } from "./_components/cta-section";
// ...
<section id="founder" className="px-6 py-12 bg-[rgb(var(--bg-elevated))]">
  <FounderSection locale="en" />
</section>
<section id="cta" className="px-6 py-12">
  <CtaSection locale="en" />
</section>
```

**Step 4: Typecheck**

```bash
pnpm -F web typecheck
```

**Step 5: Commit**

```bash
git add apps/web/src/app/get-started/_components/founder-section.tsx apps/web/src/app/get-started/_components/cta-section.tsx apps/web/src/app/get-started/page.tsx
git commit -m "feat(landing): founder note + CTA-repeat sections (EN page complete)

Founder section uses gradient placeholder until photo is provided.
CTA-repeat reuses WaitlistForm — same redirect target as hero.

English /get-started page is now feature-complete.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 5 — Hebrew page + verification

### Task 18: Hebrew landing page

Mirror of English, RTL wrapper, Hebrew copy already wired in each section component.

**Files:**
- Create: `apps/web/src/app/get-started/he/page.tsx`
- Create: `apps/web/src/app/get-started/he/__tests__/page.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/web/src/app/get-started/he/__tests__/page.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null }),
}));

import GetStartedPageHe from "../page";

describe("Hebrew /get-started page", () => {
  it("wraps content in dir='rtl' lang='he' on a div, NOT root <html>", async () => {
    const ui = await GetStartedPageHe();
    const { container } = render(ui);
    const wrapper = container.querySelector("[dir='rtl'][lang='he']");
    expect(wrapper).toBeTruthy();
    expect(wrapper?.tagName.toLowerCase()).toBe("div");
  });

  it("renders Hebrew hero copy", async () => {
    const ui = await GetStartedPageHe();
    const { getByText } = render(ui);
    expect(getByText(/אתה מפיק/)).toBeTruthy();
    expect(getByText(/לא מזכירה/)).toBeTruthy();
  });
});
```

**Step 2: Run test, verify fail**

```bash
pnpm -F web test apps/web/src/app/get-started/he/__tests__/page.test.tsx
```

Expected: FAIL — module not found.

**Step 3: Implementation**

```tsx
// apps/web/src/app/get-started/he/page.tsx
import "~/styles/get-started.css";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { StaticLogo } from "../_components/static-logo";
import { HeroSection } from "../_components/hero-section";
import { DemoVideoSection } from "../_components/demo-video-section";
import { PainCascadeSection } from "../_components/pain-cascade-section";
import { FounderSection } from "../_components/founder-section";
import { CtaSection } from "../_components/cta-section";

export default async function GetStartedPageHe() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div lang="he" dir="rtl" className="get-started-root get-started-root--he">
      <header className="px-6 py-6">
        <StaticLogo />
      </header>
      <section id="hero" className="px-6 py-12">
        <HeroSection locale="he" />
      </section>
      <section id="demo" className="px-6 py-12">
        <DemoVideoSection />
      </section>
      <section id="cascade" className="px-6 py-12">
        <PainCascadeSection locale="he" />
      </section>
      <section id="founder" className="px-6 py-12 bg-[rgb(var(--bg-elevated))]">
        <FounderSection locale="he" />
      </section>
      <section id="cta" className="px-6 py-12">
        <CtaSection locale="he" />
      </section>
    </div>
  );
}
```

**Step 4: Run test, verify pass**

```bash
pnpm -F web test apps/web/src/app/get-started/he/__tests__/page.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/app/get-started/he/page.tsx apps/web/src/app/get-started/he/__tests__/page.test.tsx
git commit -m "feat(landing): Hebrew /get-started/he page (full mirror)

Same 5 sections, locale='he' threaded through each component.
dir='rtl' lang='he' on the page-level <div> only — NEVER on root
<html> per CLAUDE.md mistake log 2026-04-20.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 19: Isolation test — no off-funnel links

CI-enforced regression: any future PR that adds an `<a href="/...">` to a non-`/get-started` route from the rendered ad page fails CI.

**Files:**
- Create: `apps/web/src/app/get-started/__tests__/isolation.test.tsx`

**Step 1: Write the test**

```tsx
// apps/web/src/app/get-started/__tests__/isolation.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null }),
}));

vi.mock("~/utils/trpc", () => ({
  trpc: {
    waitlist: {
      signup: { useMutation: () => ({ mutate: () => undefined, isPending: false, error: null }) },
    },
  },
}));

import GetStartedPage from "../page";
import GetStartedPageHe from "../he/page";

const ALLOWED_PREFIXES = ["/get-started", "#", ""];

function assertNoOffFunnelLinks(container: HTMLElement) {
  const links = Array.from(container.querySelectorAll("a"));
  for (const a of links) {
    const href = a.getAttribute("href") ?? "";
    const ok = ALLOWED_PREFIXES.some((p) => href.startsWith(p));
    expect(
      ok,
      `Found off-funnel link <a href="${href}"> on the ad page — violates §3.5 isolation rule`,
    ).toBe(true);
  }
}

describe("Ad funnel isolation (§3.5)", () => {
  it("English page has no off-funnel links", async () => {
    const ui = await GetStartedPage();
    const { container } = render(ui);
    assertNoOffFunnelLinks(container);
  });

  it("Hebrew page has no off-funnel links", async () => {
    const ui = await GetStartedPageHe();
    const { container } = render(ui);
    assertNoOffFunnelLinks(container);
  });
});
```

**Step 2: Run test**

```bash
pnpm -F web test apps/web/src/app/get-started/__tests__/isolation.test.tsx
```

Expected: PASS — the page currently has no off-funnel links.

**Step 3: Sanity check — temporarily add a forbidden link, confirm test fails**

Locally, add `<a href="/dashboard">break me</a>` to `hero-section.tsx`, re-run the test. Expected: FAIL with the descriptive error message. Then revert.

**Step 4: Commit**

```bash
git add apps/web/src/app/get-started/__tests__/isolation.test.tsx
git commit -m "test(landing): isolation guard — no off-funnel links on ad pages

CI-enforced regression. Any future change that adds <a href> to a
non-/get-started route from the rendered ad page will fail this
test with a descriptive error.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 20: Final verify pipeline + Vercel preview audit

The last gate before push.

**Files:** none — runs commands and a manual checklist.

**Step 1: Run the full verify pipeline**

```bash
pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test
```

Expected: all green. If any step fails, fix and re-run.

**Step 2: Local visual smoke**

```bash
pnpm -F web dev
```

Open in two viewports:
- `http://localhost:3000/get-started` — desktop
- DevTools mobile emulation at 360px width

Verify:
- ✅ Hero animation runs (chaos↔Skitza loop)
- ✅ Hover dims opposite panel (desktop only)
- ✅ Stack-reveal animation runs
- ✅ Form submits → redirects to `/get-started/thanks?n=...`
- ✅ Confetti fires on /thanks
- ✅ NO header nav, NO footer site links, NO clickable logo
- ✅ Hebrew page at `/get-started/he` renders RTL correctly

Same for `/get-started/he`.

**Step 3: Push the branch**

```bash
git push -u origin claude/gifted-curie-4aa2d8
```

Wait for Vercel preview URL.

**Step 4: Smoke-test the webhook on Vercel preview**

On the preview URL:
1. Submit a real signup
2. Check Make.com scenario history — should show 1 operation completed
3. Check Airtable "Skitza Waitlist" → "Signups" — should have the new row with all fields populated
4. Repeat with `?utm_source=test&utm_campaign=smoketest` in URL — verify UTM fields land in Airtable

**Step 5: Lighthouse audit**

```bash
# In Chrome DevTools, open the preview URL, run Lighthouse on Mobile
```

Targets:
- Performance ≥ 90
- Accessibility ≥ 95
- Best Practices ≥ 90
- SEO score does NOT matter (we set noindex on purpose)

If scores miss targets, file follow-up tasks but don't block the merge.

**Step 6: Open the PR (only after smoke test passes)**

```bash
gh pr create --base v3-clean --title "feat(landing): /get-started ad-conversion landing page" --body "$(cat <<'EOF'
## Summary
- New ad-conversion landing page at `/get-started` (EN) + `/get-started/he` (HE)
- 5 sections: Hero (split-screen animation) → Demo video → Pain cascade (stack-reveal) → Founder note → CTA repeat
- Email capture via tRPC mutation that POSTs to Make.com webhook (no DB writes)
- Fully isolated from the rest of Skitza (no nav, no footer, no off-page links, noindex, sitemap-excluded)

## Test plan
- [ ] All unit tests pass (`pnpm -F web test`)
- [ ] Typecheck + lint pass
- [ ] Vercel preview renders both languages correctly
- [ ] Real signup on preview → row appears in Airtable
- [ ] UTM params persist through to Airtable
- [ ] Lighthouse Mobile: Perf ≥ 90, A11y ≥ 95
- [ ] Isolation test passes — no off-funnel links

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 7: Commit (no-op — final task is procedural)**

No commit needed. The work is done; this task is the gate.

---

## Wrap-up

After Task 20 passes, the page is live on a Vercel preview URL. Founder review the preview, confirm the smoke test, then merge to `v3-clean`. Done.

**Total estimated tasks:** 20
**Total commits:** ~20 (one per task, plus a few sub-commits inside multi-test tasks)
**Total files added:** ~17
**Total files modified:** ~3

**Things still owed by the founder before launch (per design doc §15):**
1. Real demo video at `apps/web/public/landing/demo.webm` + `demo.mp4` + `demo-poster.jpg`
2. Real founder photo at `apps/web/public/landing/founder.jpg`
3. Real beta launch date to replace "soon" placeholders in copy
4. Confirm Make.com scenario routes payload → Airtable correctly (smoke test in Task 20 covers this)
