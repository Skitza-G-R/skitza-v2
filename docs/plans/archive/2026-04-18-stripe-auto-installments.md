# Stripe Auto-Installments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Producers configure a product with payment plan options (full / 50-50 / N-monthly). Clients pick one at checkout. Stripe auto-charges on schedule with zero producer follow-up.

**Architecture:** Hybrid Stripe primitive per trigger type. Pay-in-full uses one-time Checkout (already built). 50-50 uses Checkout with `setup_future_usage: 'off_session'` to save the card, then an off-session PaymentIntent fires when the producer clicks "mark final delivered" behind a confirmation modal. Monthly installments use Checkout `mode: subscription` attached to a server-created Stripe Subscription Schedule — Stripe handles the schedule, smart retries, and card-update emails. One Stripe Customer per (producer, client) pair is reused across projects so saved cards carry over.

**Tech Stack:** Next.js 15 App Router (RSC + Server Actions), tRPC v11, Drizzle ORM + Neon Postgres, Stripe SDK `2026-03-25.dahlia` (Connect Express, destination charges), Vitest + Vercel Stripe test mode.

**Design doc:** `docs/plans/2026-04-18-stripe-auto-installments-design.md` — read before starting for full rationale on decisions.

---

## Prerequisites

Before Task 1, the engineer should:

1. Confirm `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLIC_KEY` are set in the Vercel production environment (the user has already done this).
2. Be able to run `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint` from `apps/web/` and get green output.
3. Read the design doc above. Everything in this plan assumes its decisions are locked.
4. Know that Skitza uses pnpm workspaces — the DB schema lives in `packages/db/` and the web app in `apps/web/`.

### Project conventions

- **Tests live beside code**: `foo.ts` → `foo.test.ts` in the same directory, OR `__tests__/foo.test.ts` if there are many. Follow whatever the surrounding files do.
- **tRPC procedures**: producer-scoped routers use `producerProcedure` from `~/server/trpc/producer-procedure`. It injects `ctx.db` (Drizzle) and `ctx.producerId` (uuid).
- **Money**: always store as integer cents (`amount_cents`). Never float. `currency` is ISO 4217.
- **Webhook handler**: single handler at `apps/web/src/app/api/stripe/webhook/route.ts` with a `switch(event.type)`.
- **Drizzle migrations**: each migration is a SQL file in `packages/db/drizzle/NNNN_<name>.sql`. Latest applied migration is `0018_stripe_integration.sql` — this plan's migration will be `0019`.
- **Idempotency**: Stripe retries webhooks on 5xx. Handler must be safe to replay. Use idempotency keys on outbound Stripe calls.
- **No platform fee**: destination charges with `transfer_data.destination` to producer's Connect account. Never set `application_fee_amount`.

---

## Task 1: Schema migration — add payment-plan columns

**Files:**
- Create: `packages/db/drizzle/0019_payment_plans.sql`
- Modify: `packages/db/src/schema.ts` (append new columns to `projects` + `products`, extend `projectStage` enum, add `stripeCustomers` table)

### Step 1.1: Write the migration SQL

Create `packages/db/drizzle/0019_payment_plans.sql`:

```sql
-- Stripe auto-installments — add payment-plan execution state.
-- One plan per project (no separate instance table — one-to-one
-- doesn't justify a join). Producers expose enabled plans per
-- product via the new payment_plans jsonb column.
BEGIN;

-- 1. Extend project_stage enum with the paused state. When monthly
-- retries exhaust, projects flip here; client self-booking locks
-- until payment method is updated.
ALTER TYPE "project_stage" ADD VALUE IF NOT EXISTS 'payment_paused';
ALTER TYPE "project_stage" ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. projects: plan state columns. Nulls acceptable — existing
-- rows stay as "no plan configured" until a payment activates one.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "payment_plan_kind" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "installments" integer;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stripe_payment_method_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stripe_subscription_schedule_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "charges_completed" integer NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "charges_total" integer;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_charge_at" timestamp with time zone;

-- 3. products: plans offered. Default to [{"kind":"full"}] so legacy
-- products keep working without edit.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "payment_plans" jsonb
  NOT NULL DEFAULT '[{"kind":"full"}]'::jsonb;

-- 4. invoices: new FK + kind value. FK is nullable because legacy
-- one-time invoices don't have a plan.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_plan_project_id" uuid
  REFERENCES "projects"("id") ON DELETE SET NULL;
-- `kind` stays text (no enum) so we don't need an ALTER TYPE for
-- the new 'installment' value — just start writing it.

-- 5. stripe_customers: one per (producer, client) pair. Reused
-- across projects so saved cards carry over. Composite PK prevents
-- duplicates.
CREATE TABLE IF NOT EXISTS "stripe_customers" (
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "client_contact_id" uuid NOT NULL REFERENCES "client_contacts"("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("producer_id", "client_contact_id")
);

-- 6. Index for webhook lookups — handlers need to find a project
-- by its Stripe schedule id quickly.
CREATE INDEX IF NOT EXISTS "projects_stripe_schedule_idx"
  ON "projects" ("stripe_subscription_schedule_id")
  WHERE "stripe_subscription_schedule_id" IS NOT NULL;

COMMIT;
```

### Step 1.2: Update `packages/db/src/schema.ts`

Append to the `projectStage` enum array:
```ts
export const projectStage = pgEnum("project_stage", [
  "lead", "booked", "contract_sent", "in_production",
  "final_review", "paid", "archived",
  "payment_paused",  // NEW: monthly retries exhausted
  "cancelled",       // NEW: producer cancelled mid-plan
]);
```

Add columns to the `projects` table definition (below existing `finalPaid`):
```ts
paymentPlanKind: text("payment_plan_kind"),       // 'full' | 'split_50_50' | 'monthly' | null
installments: integer("installments"),            // 2..12 for monthly, null otherwise
stripeCustomerId: text("stripe_customer_id"),
stripePaymentMethodId: text("stripe_payment_method_id"),
stripeSubscriptionScheduleId: text("stripe_subscription_schedule_id"),
chargesCompleted: integer("charges_completed").notNull().default(0),
chargesTotal: integer("charges_total"),
nextChargeAt: timestamp("next_charge_at", { withTimezone: true }),
```

Add to the `products` table definition (below existing `archivedAt`):
```ts
paymentPlans: jsonb("payment_plans").$type<PaymentPlan[]>()
  .notNull()
  .default([{ kind: "full" }]),
```

At the top of the file, near other type exports, add:
```ts
export type PaymentPlan =
  | { kind: "full" }
  | { kind: "split_50_50" }
  | { kind: "monthly"; installments: number };
```

Add to the `invoices` table definition (below existing `bookingId`):
```ts
paymentPlanProjectId: uuid("payment_plan_project_id")
  .references(() => projects.id, { onDelete: "set null" }),
```

Create a new `stripeCustomers` table export (after `invoices`):
```ts
// One Stripe Customer per (producer, client_contact) pair. Stored
// outside `client_contacts` because a single contact might be a
// customer of multiple producers (multi-tenant future), each with
// their own Stripe Customer on their own Connect account.
export const stripeCustomers = pgTable("stripe_customers", {
  producerId: uuid("producer_id").notNull()
    .references(() => producers.id, { onDelete: "cascade" }),
  clientContactId: uuid("client_contact_id").notNull()
    .references(() => clientContacts.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.producerId, t.clientContactId] }),
}));
export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type NewStripeCustomer = typeof stripeCustomers.$inferInsert;
```

Also export `stripeCustomers` from `packages/db/src/index.ts` (find the existing re-export block and add it alphabetically).

### Step 1.3: Run typecheck to verify schema is valid

Run: `pnpm --filter @skitza/db typecheck`

Expected: no errors. If there are errors, they're almost always missing imports (`primaryKey` from `drizzle-orm/pg-core`, `jsonb` which should already be imported).

### Step 1.4: Apply migration to production DB

Run:
```bash
cd apps/web && pnpm vercel env pull .env.migration --environment=production --yes
set -a && source .env.migration && set +a
cd ../.. && cat packages/db/drizzle/0019_payment_plans.sql | \
  node -e "const {Pool}=require('@neondatabase/serverless');const p=new Pool({connectionString:process.env.DATABASE_URL});require('fs').readFileSync(0).toString().split(';').filter(s=>s.trim()).forEach(async s=>{try{await p.query(s)}catch(e){console.error(s.slice(0,80),e.message)}});"
rm apps/web/.env.migration
```

Expected: no errors. Verify by querying:
```bash
psql "$DATABASE_URL" -c "\d projects" | grep -E "payment_plan|charges|stripe_customer"
```
(Or use the Neon web console if psql isn't installed.)

### Step 1.5: Commit

```bash
git add packages/db/drizzle/0019_payment_plans.sql packages/db/src/schema.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(db): payment plan schema for auto-installments

Add the execution-layer schema for Stripe auto-installments:
- projects gains plan_kind, installments, Stripe customer/PM/schedule
  ids, charges_completed/total, next_charge_at
- products gains payment_plans jsonb (array of PaymentPlan offered)
- project_stage gains payment_paused + cancelled
- invoices gains payment_plan_project_id FK + accepts 'installment'
  kind (no enum, stays text)
- new stripe_customers join table — one Customer per
  (producer, client) pair reused across projects

Migration 0019 applied to prod.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure helpers — `calculateCharges` + `advancePlanState`

**Files:**
- Create: `apps/web/src/server/payments/plan.ts`
- Test: `apps/web/src/server/payments/plan.test.ts`

These are pure functions. No DB, no Stripe. Easy to test, easy to fuzz, easy to reason about. The webhook handlers and router mutations will call these.

### Step 2.1: Write the failing tests

Create `apps/web/src/server/payments/plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { calculateCharges, advancePlanState } from "./plan";

describe("calculateCharges", () => {
  it("returns a single charge for 'full'", () => {
    expect(calculateCharges({ kind: "full" }, 10_000_00))
      .toEqual([10_000_00]);
  });

  it("splits 50/50 evenly", () => {
    expect(calculateCharges({ kind: "split_50_50" }, 10_000_00))
      .toEqual([5_000_00, 5_000_00]);
  });

  it("splits 50/50 with odd cents (remainder on first)", () => {
    // 10_001 cents / 2 → 5001 + 5000
    expect(calculateCharges({ kind: "split_50_50" }, 10_001))
      .toEqual([5_001, 5_000]);
  });

  it("splits monthly evenly", () => {
    expect(calculateCharges({ kind: "monthly", installments: 4 }, 10_000_00))
      .toEqual([2_500_00, 2_500_00, 2_500_00, 2_500_00]);
  });

  it("splits monthly with remainder on first", () => {
    // 10_003 / 3 → 3335 + 3334 + 3334
    expect(calculateCharges({ kind: "monthly", installments: 3 }, 10_003))
      .toEqual([3_335, 3_334, 3_334]);
  });

  it("throws on zero total", () => {
    expect(() => calculateCharges({ kind: "full" }, 0))
      .toThrow(/positive/);
  });

  it("throws on installments < 2", () => {
    expect(() => calculateCharges({ kind: "monthly", installments: 1 }, 100))
      .toThrow(/between 2 and 12/);
  });

  it("throws on installments > 12", () => {
    expect(() => calculateCharges({ kind: "monthly", installments: 13 }, 100))
      .toThrow(/between 2 and 12/);
  });
});

describe("advancePlanState", () => {
  const baseProject = {
    chargesCompleted: 0,
    chargesTotal: 2,
    stage: "lead" as const,
  };

  it("first successful charge → active + completed=1", () => {
    const next = advancePlanState(baseProject, { type: "charge_succeeded" });
    expect(next.chargesCompleted).toBe(1);
    expect(next.stage).toBe("active");
  });

  it("final successful charge → paid", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 1, stage: "active" },
      { type: "charge_succeeded" },
    );
    expect(next.chargesCompleted).toBe(2);
    expect(next.stage).toBe("paid");
  });

  it("exhausted retries → payment_paused", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 1, chargesTotal: 4, stage: "active" },
      { type: "retries_exhausted" },
    );
    expect(next.stage).toBe("payment_paused");
    // Counter not incremented — charge didn't succeed
    expect(next.chargesCompleted).toBe(1);
  });

  it("resume from paused on next successful charge", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 1, chargesTotal: 4, stage: "payment_paused" },
      { type: "charge_succeeded" },
    );
    expect(next.stage).toBe("active");
    expect(next.chargesCompleted).toBe(2);
  });

  it("cancel event → cancelled, stops charges", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 1, chargesTotal: 4, stage: "active" },
      { type: "cancelled" },
    );
    expect(next.stage).toBe("cancelled");
    expect(next.chargesCompleted).toBe(1);
  });

  it("never exceeds chargesTotal (idempotency invariant)", () => {
    const next = advancePlanState(
      { ...baseProject, chargesCompleted: 2, chargesTotal: 2, stage: "paid" },
      { type: "charge_succeeded" },
    );
    // Already paid — duplicate webhook must not over-count
    expect(next.chargesCompleted).toBe(2);
    expect(next.stage).toBe("paid");
  });
});
```

### Step 2.2: Run tests to verify they fail

Run: `cd apps/web && pnpm test src/server/payments/plan.test.ts`

Expected: FAIL with "Cannot find module './plan'".

### Step 2.3: Implement `plan.ts`

Create `apps/web/src/server/payments/plan.ts`:

```ts
import type { PaymentPlan } from "@skitza/db";

// ─── calculateCharges ─────────────────────────────────────────────
// Given a payment plan + total cents, return the per-charge breakdown
// array. Any cent remainder goes on the FIRST charge so the sum is
// always exactly the total (no rounding loss, no client dispute).
export function calculateCharges(plan: PaymentPlan, totalCents: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error("totalCents must be a positive integer");
  }

  if (plan.kind === "full") {
    return [totalCents];
  }

  if (plan.kind === "split_50_50") {
    const half = Math.floor(totalCents / 2);
    const remainder = totalCents - half * 2;
    return [half + remainder, half];
  }

  if (plan.kind === "monthly") {
    if (plan.installments < 2 || plan.installments > 12) {
      throw new Error("installments must be between 2 and 12");
    }
    const base = Math.floor(totalCents / plan.installments);
    const remainder = totalCents - base * plan.installments;
    return Array.from({ length: plan.installments }, (_, i) =>
      i === 0 ? base + remainder : base,
    );
  }

  // Exhaustive check — if PaymentPlan grows a new variant the compiler
  // will complain here, forcing us to handle it.
  const _exhaustive: never = plan;
  return _exhaustive;
}

// ─── advancePlanState ─────────────────────────────────────────────
// Pure state transition used by webhook handlers + cancel mutation.
// Keeps the invariant chargesCompleted ≤ chargesTotal and maps stage
// transitions for: happy path (charge → active → paid), failure path
// (retries_exhausted → payment_paused → resume → active), cancel.
export type PlanEvent =
  | { type: "charge_succeeded" }
  | { type: "retries_exhausted" }
  | { type: "cancelled" };

export type PlanProjectState = {
  chargesCompleted: number;
  chargesTotal: number;
  stage:
    | "lead"
    | "active"
    | "paid"
    | "payment_paused"
    | "cancelled";
};

export function advancePlanState(
  state: PlanProjectState,
  event: PlanEvent,
): PlanProjectState {
  if (event.type === "cancelled") {
    return { ...state, stage: "cancelled" };
  }

  if (event.type === "retries_exhausted") {
    return { ...state, stage: "payment_paused" };
  }

  // charge_succeeded — increment, but guard the invariant
  if (state.chargesCompleted >= state.chargesTotal) {
    return state; // duplicate webhook, already at terminal count
  }

  const nextCompleted = state.chargesCompleted + 1;
  const nextStage =
    nextCompleted >= state.chargesTotal ? "paid" : "active";
  return { ...state, chargesCompleted: nextCompleted, stage: nextStage };
}
```

### Step 2.4: Run tests to verify they pass

Run: `cd apps/web && pnpm test src/server/payments/plan.test.ts`

Expected: PASS, 11 tests green.

### Step 2.5: Commit

```bash
git add apps/web/src/server/payments/plan.ts apps/web/src/server/payments/plan.test.ts
git commit -m "$(cat <<'EOF'
feat(payments): calculateCharges + advancePlanState helpers

Pure functions for payment-plan logic — no DB, no Stripe. The webhook
handlers and router mutations will call these so all plan state
transitions happen in one testable place.

- calculateCharges: given plan + total cents, returns per-charge
  breakdown. Remainder on first charge so sum = total exactly.
- advancePlanState: pure state transition for charge_succeeded /
  retries_exhausted / cancelled events. Guards the invariant
  chargesCompleted ≤ chargesTotal so duplicate webhooks don't
  over-count.

11 tests cover: full/50-50/monthly splits with even + odd cent cases,
happy path (charge → active → paid), failure path (exhausted →
paused → resume), cancel, and the duplicate-webhook idempotency
invariant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `getOrCreateStripeCustomer` helper

**Files:**
- Create: `apps/web/src/server/stripe/customer.ts`
- Test: `apps/web/src/server/stripe/customer.test.ts`

Reusable helper for looking up (or creating) a Stripe Customer for a (producer, client) pair. Used by all 3 checkout flows and the off-session final charge.

### Step 3.1: Write the failing tests

Create `apps/web/src/server/stripe/customer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrCreateStripeCustomer } from "./customer";

// Mock Stripe SDK — we only test our lookup/create logic, not Stripe itself
const mockCreate = vi.fn();
vi.mock("./client", () => ({
  getStripe: () => ({ customers: { create: mockCreate } }),
}));

describe("getOrCreateStripeCustomer", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns existing Customer ID when join row exists", async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { stripeCustomerId: "cus_existing" },
      ]),
      insert: vi.fn(),
    };
    const result = await getOrCreateStripeCustomer({
      db: db as never,
      producerId: "prod_1",
      producerStripeAccountId: "acct_1",
      clientContactId: "client_1",
      clientEmail: "dan@example.com",
      clientName: "Dan Cohen",
    });
    expect(result).toBe("cus_existing");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates new Customer + join row when none exists", async () => {
    const insertValues = vi.fn().mockReturnThis();
    const insertReturning = vi.fn().mockResolvedValue([{}]);
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),  // no existing
      insert: vi.fn().mockReturnValue({
        values: insertValues,
        returning: insertReturning,
      }),
    };
    mockCreate.mockResolvedValue({ id: "cus_new" });

    const result = await getOrCreateStripeCustomer({
      db: db as never,
      producerId: "prod_1",
      producerStripeAccountId: "acct_1",
      clientContactId: "client_1",
      clientEmail: "dan@example.com",
      clientName: "Dan Cohen",
    });
    expect(result).toBe("cus_new");
    expect(mockCreate).toHaveBeenCalledWith(
      { email: "dan@example.com", name: "Dan Cohen", metadata: { producerId: "prod_1", clientContactId: "client_1" } },
      { stripeAccount: "acct_1" },
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        producerId: "prod_1",
        clientContactId: "client_1",
        stripeCustomerId: "cus_new",
      }),
    );
  });
});
```

### Step 3.2: Run to see it fail

Run: `cd apps/web && pnpm test src/server/stripe/customer.test.ts`

Expected: FAIL with "Cannot find module './customer'".

### Step 3.3: Implement `customer.ts`

Create `apps/web/src/server/stripe/customer.ts`:

```ts
import { and, eq, stripeCustomers } from "@skitza/db";
import type { createDb } from "@skitza/db";
import { getStripe } from "./client";

type DB = ReturnType<typeof createDb>;

// Looks up the Stripe Customer id for this (producer, client) pair.
// Creates one lazily on the producer's Connect account if it doesn't
// exist. The composite PK on stripe_customers guarantees one row per
// pair so this is safe against race conditions between two near-
// simultaneous first payments.
//
// Customer is created on the producer's Connect account — NOT the
// platform account — because saved PaymentMethods are scoped to the
// account they live on. Off-session charges later will go through
// that account too.
export async function getOrCreateStripeCustomer(args: {
  db: DB;
  producerId: string;
  producerStripeAccountId: string;
  clientContactId: string;
  clientEmail: string;
  clientName: string;
}): Promise<string> {
  const existing = await args.db
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(
      and(
        eq(stripeCustomers.producerId, args.producerId),
        eq(stripeCustomers.clientContactId, args.clientContactId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create(
    {
      email: args.clientEmail,
      name: args.clientName,
      metadata: {
        producerId: args.producerId,
        clientContactId: args.clientContactId,
      },
    },
    { stripeAccount: args.producerStripeAccountId },
  );

  await args.db.insert(stripeCustomers).values({
    producerId: args.producerId,
    clientContactId: args.clientContactId,
    stripeCustomerId: customer.id,
  }).returning();

  return customer.id;
}
```

### Step 3.4: Run tests

Run: `cd apps/web && pnpm test src/server/stripe/customer.test.ts`

Expected: PASS, 2 tests green.

### Step 3.5: Commit

```bash
git add apps/web/src/server/stripe/customer.ts apps/web/src/server/stripe/customer.test.ts
git commit -m "feat(stripe): getOrCreateStripeCustomer helper

Reusable lookup/create for Stripe Customers scoped per
(producer, client_contact) pair. Created on the producer's Connect
account so saved PaymentMethods are available for off-session
charges later. Used by all 3 checkout flows + off-session final.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Producer UI — payment plans section in product editor

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/booking/package-form.tsx` (add plan checkboxes)
- Modify: `apps/web/src/app/(app)/dashboard/booking/actions.ts` (persist paymentPlans)
- Test: `apps/web/src/app/(app)/dashboard/booking/__tests__/package-form-plans.test.ts` (new)

### Step 4.1: Write the failing test for the form action

Create `apps/web/src/app/(app)/dashboard/booking/__tests__/package-form-plans.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePaymentPlansFromFormData } from "../payment-plans-parser";

describe("parsePaymentPlansFromFormData", () => {
  it("returns [full] when only full is checked", () => {
    const fd = new FormData();
    fd.set("plan_full", "on");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([{ kind: "full" }]);
  });

  it("returns all 3 when all checkboxes checked", () => {
    const fd = new FormData();
    fd.set("plan_full", "on");
    fd.set("plan_split", "on");
    fd.set("plan_monthly", "on");
    fd.set("plan_monthly_n", "4");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 4 },
    ]);
  });

  it("defaults to [full] if nothing checked (safety fallback)", () => {
    const fd = new FormData();
    expect(parsePaymentPlansFromFormData(fd)).toEqual([{ kind: "full" }]);
  });

  it("clamps monthly N to [2, 12]", () => {
    const fd = new FormData();
    fd.set("plan_monthly", "on");
    fd.set("plan_monthly_n", "99");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([
      { kind: "monthly", installments: 12 },
    ]);
  });

  it("rejects non-numeric monthly N → falls back to 4", () => {
    const fd = new FormData();
    fd.set("plan_monthly", "on");
    fd.set("plan_monthly_n", "abc");
    expect(parsePaymentPlansFromFormData(fd)).toEqual([
      { kind: "monthly", installments: 4 },
    ]);
  });
});
```

### Step 4.2: Run to see it fail

Run: `cd apps/web && pnpm test src/app/\\(app\\)/dashboard/booking/__tests__/package-form-plans.test.ts`

Expected: FAIL with "Cannot find module '../payment-plans-parser'".

### Step 4.3: Implement the parser

Create `apps/web/src/app/(app)/dashboard/booking/payment-plans-parser.ts`:

```ts
import type { PaymentPlan } from "@skitza/db";

// Extracts the producer's plan selections from the product-form
// FormData. Called from the server action. Always returns at least
// [{kind:'full'}] so no product can end up with an empty plan list —
// that would make it unpurchasable.
export function parsePaymentPlansFromFormData(fd: FormData): PaymentPlan[] {
  const plans: PaymentPlan[] = [];
  if (fd.get("plan_full") === "on") plans.push({ kind: "full" });
  if (fd.get("plan_split") === "on") plans.push({ kind: "split_50_50" });
  if (fd.get("plan_monthly") === "on") {
    const raw = fd.get("plan_monthly_n");
    const n = Number.parseInt(typeof raw === "string" ? raw : "", 10);
    const installments = Number.isInteger(n)
      ? Math.max(2, Math.min(12, n))
      : 4;
    plans.push({ kind: "monthly", installments });
  }
  return plans.length > 0 ? plans : [{ kind: "full" }];
}
```

### Step 4.4: Run tests

Run: `cd apps/web && pnpm test src/app/\\(app\\)/dashboard/booking/__tests__/package-form-plans.test.ts`

Expected: PASS, 5 tests green.

### Step 4.5: Wire into the product form UI

Modify `apps/web/src/app/(app)/dashboard/booking/package-form.tsx`. Find the pricing section (look for `depositPct` or `priceCents` input). Add a new section below it:

```tsx
<fieldset className="mt-6 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-4">
  <legend className="px-2 text-xs font-mono uppercase tracking-wider text-[rgb(var(--fg-muted))]">
    Payment plans offered
  </legend>
  <p className="mt-2 text-xs text-[rgb(var(--fg-secondary))]">
    Client picks one at checkout.
  </p>
  <label className="mt-3 flex items-center gap-2 text-sm">
    <input type="checkbox" name="plan_full" defaultChecked={
      initialPlans.some((p) => p.kind === "full")
    } />
    Pay in full
  </label>
  <label className="mt-2 flex items-center gap-2 text-sm">
    <input type="checkbox" name="plan_split" defaultChecked={
      initialPlans.some((p) => p.kind === "split_50_50")
    } />
    50% deposit + 50% on delivery
  </label>
  <label className="mt-2 flex items-center gap-2 text-sm">
    <input type="checkbox" name="plan_monthly" defaultChecked={
      initialPlans.some((p) => p.kind === "monthly")
    } />
    Monthly installments —
    <input
      type="number"
      name="plan_monthly_n"
      min={2}
      max={12}
      defaultValue={
        initialPlans.find((p) => p.kind === "monthly")?.installments ?? 4
      }
      className="w-16 rounded-sm border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1 text-sm"
    />
    payments
  </label>
</fieldset>
```

Where `initialPlans` is the existing product's `paymentPlans` (pass it as a prop from the page → form, defaulting to `[{kind:'full'}]`).

### Step 4.6: Wire into the server action

Modify `apps/web/src/app/(app)/dashboard/booking/actions.ts`. In the create + update product actions, after parsing FormData:

```ts
import { parsePaymentPlansFromFormData } from "./payment-plans-parser";
// ...
const paymentPlans = parsePaymentPlansFromFormData(fd);
// Pass paymentPlans into the tRPC mutation input
```

And extend the tRPC input schema in `apps/web/src/server/trpc/routers/booking.ts` (the `products.create` + `products.update` procedures) to accept the new field:

```ts
paymentPlans: z.array(z.union([
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("split_50_50") }),
  z.object({ kind: z.literal("monthly"), installments: z.number().int().min(2).max(12) }),
])).optional(),
```

Persist into the DB in the mutations:
```ts
.set({
  // ...existing fields...
  ...(input.paymentPlans ? { paymentPlans: input.paymentPlans } : {}),
})
```

### Step 4.7: Typecheck + lint + test

Run: `cd apps/web && pnpm typecheck && pnpm lint && pnpm test`

Expected: all green.

### Step 4.8: Commit

```bash
git add apps/web/src/app/\(app\)/dashboard/booking/
git commit -m "feat(products): payment plans section in product editor

Producer ticks which of full / 50-50 / monthly this product offers.
Monthly gets a 2..12 number input. parser clamps + falls back to
[{kind:'full'}] if nothing is checked so products can't be made
unpurchasable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Client-side — plan picker component + Checkout wiring for all 3 shapes

**Files:**
- Create: `apps/web/src/app/(public)/p/[slug]/book/plan-picker.tsx`
- Modify: `apps/web/src/app/(public)/p/[slug]/book/actions.ts` (accept `paymentPlan` input)
- Modify: `apps/web/src/server/trpc/routers/booking.ts` (extend `publicRequest` to dispatch by plan kind)
- Create: `apps/web/src/server/payments/checkout.ts` (plan-aware Checkout session builder)
- Test: `apps/web/src/server/payments/checkout.test.ts`

### Step 5.1: Write failing test for `buildCheckoutSessionParams`

Create `apps/web/src/server/payments/checkout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCheckoutSessionParams } from "./checkout";

const baseArgs = {
  productName: "Single Production",
  currency: "usd",
  totalCents: 10_000_00,
  customerId: "cus_abc",
  destinationAccountId: "acct_xyz",
  successUrl: "https://skitza.app/success",
  cancelUrl: "https://skitza.app/cancel",
  metadata: { projectId: "proj_1" },
};

describe("buildCheckoutSessionParams", () => {
  it("full → mode:payment, unit_amount = total, no setup_future_usage", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "full" },
    });
    expect(p.mode).toBe("payment");
    expect(p.line_items[0].price_data.unit_amount).toBe(10_000_00);
    expect(p.payment_intent_data?.setup_future_usage).toBeUndefined();
  });

  it("split_50_50 → mode:payment, unit_amount = half, setup_future_usage set", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "split_50_50" },
    });
    expect(p.mode).toBe("payment");
    expect(p.line_items[0].price_data.unit_amount).toBe(5_000_00);
    expect(p.payment_intent_data?.setup_future_usage).toBe("off_session");
  });

  it("monthly → mode:subscription, no line_items, subscription_data present", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "monthly", installments: 4 },
    });
    expect(p.mode).toBe("subscription");
    // monthly checkout is set up differently — we use a one-off
    // price but cancel after N iterations via subscription_data
    expect(p.line_items[0].price_data.recurring).toEqual({ interval: "month" });
    expect(p.line_items[0].price_data.unit_amount).toBe(2_500_00);
    expect(p.subscription_data?.metadata?.installments).toBe("4");
  });

  it("customer is attached for all 3 kinds", () => {
    (["full", "split_50_50"] as const).forEach((kind) => {
      const p = buildCheckoutSessionParams({ ...baseArgs, plan: { kind } });
      expect(p.customer).toBe("cus_abc");
    });
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "monthly", installments: 4 },
    });
    expect(p.customer).toBe("cus_abc");
  });

  it("destination account goes into payment_intent_data for non-subscription", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "full" },
    });
    expect(p.payment_intent_data?.transfer_data).toEqual({ destination: "acct_xyz" });
  });

  it("destination account goes into subscription_data for monthly", () => {
    const p = buildCheckoutSessionParams({
      ...baseArgs,
      plan: { kind: "monthly", installments: 4 },
    });
    expect(p.subscription_data?.transfer_data).toEqual({ destination: "acct_xyz" });
  });
});
```

### Step 5.2: Run to see it fail

Run: `cd apps/web && pnpm test src/server/payments/checkout.test.ts`

Expected: FAIL with "Cannot find module './checkout'".

### Step 5.3: Implement `buildCheckoutSessionParams`

Create `apps/web/src/server/payments/checkout.ts`:

```ts
import type Stripe from "stripe";
import type { PaymentPlan } from "@skitza/db";
import { calculateCharges } from "./plan";

// Build the Stripe Checkout Session parameters for a selected
// payment plan. Returns the `create` params for stripe.checkout.sessions
// — NOT the session itself, so this is pure and testable.
//
// Destination charges with transfer_data point to the producer's
// Connect account. Customer is pre-created (via
// getOrCreateStripeCustomer) so saved PaymentMethod + Customer
// Portal work across projects.
export function buildCheckoutSessionParams(args: {
  plan: PaymentPlan;
  productName: string;
  currency: string;  // ISO 4217 lowercase
  totalCents: number;
  customerId: string;
  destinationAccountId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Stripe.Checkout.SessionCreateParams {
  const charges = calculateCharges(args.plan, args.totalCents);
  const firstCharge = charges[0]!;

  const common = {
    customer: args.customerId,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    metadata: args.metadata,
  } as const;

  if (args.plan.kind === "monthly") {
    // Subscription mode: Stripe charges the saved card every month
    // for N iterations via the Subscription Schedule we attach
    // post-session. The one-off price here defines the per-iteration
    // amount; `installments` in metadata tells the webhook when to
    // stop incrementing.
    return {
      ...common,
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: args.currency,
            product_data: { name: args.productName },
            unit_amount: firstCharge,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        transfer_data: { destination: args.destinationAccountId },
        metadata: {
          ...args.metadata,
          installments: String(args.plan.installments),
          planKind: "monthly",
        },
      },
    };
  }

  // full + split_50_50 both use mode:payment for the first charge.
  // split_50_50 additionally saves the card for the off-session final.
  const setupFutureUsage =
    args.plan.kind === "split_50_50" ? ("off_session" as const) : undefined;

  return {
    ...common,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: args.currency,
          product_data: { name: args.productName },
          unit_amount: firstCharge,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      transfer_data: { destination: args.destinationAccountId },
      ...(setupFutureUsage ? { setup_future_usage: setupFutureUsage } : {}),
      metadata: { ...args.metadata, planKind: args.plan.kind },
    },
  };
}
```

### Step 5.4: Run tests

Run: `cd apps/web && pnpm test src/server/payments/checkout.test.ts`

Expected: PASS, 6 tests green.

### Step 5.5: Commit

```bash
git add apps/web/src/server/payments/checkout.ts apps/web/src/server/payments/checkout.test.ts
git commit -m "feat(payments): buildCheckoutSessionParams for all 3 plan kinds

Pure function mapping PaymentPlan + total → Stripe Checkout Session
create params. full/50-50 use mode:payment (50-50 adds
setup_future_usage:off_session to save card). monthly uses
mode:subscription with recurring price + metadata.installments so
the webhook knows when to stop.

Destination charges via transfer_data → producer Connect account.
Zero platform fee.

6 tests cover the dispatch for each plan kind + customer attachment
+ destination account wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Step 5.6: Wire into the public request flow

Modify `apps/web/src/app/(public)/p/[slug]/book/actions.ts` — after the existing "pay deposit" flow, accept a `paymentPlan` field from the form and pass it to the tRPC mutation.

Modify `apps/web/src/server/trpc/routers/booking.ts` — in the `publicRequest` mutation (or wherever the booking→checkout redirect is orchestrated), do:
1. Look up/create client_contact
2. Call `getOrCreateStripeCustomer`
3. Call `buildCheckoutSessionParams` with the selected plan
4. Create the Checkout Session via `stripe.checkout.sessions.create(params)`
5. For monthly: also insert a Subscription Schedule on the resulting subscription — but we'll do that in the webhook handler instead, since the subscription doesn't exist until Checkout completes. So for Task 5, the session itself is enough — Task 6 handles the schedule creation.
6. Persist the pending `invoices` row (as today) and the selected plan onto the project row (`paymentPlanKind`, `installments`, `chargesTotal`, `stripeCustomerId`)
7. Return the Checkout URL

### Step 5.7: Create the client-side plan picker

Create `apps/web/src/app/(public)/p/[slug]/book/plan-picker.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { PaymentPlan } from "@skitza/db";

// Radio-group picker shown between contract signing and Stripe
// redirect. Only renders plans the producer enabled on this product.
// Submits the selected plan via the enclosing form.
export function PlanPicker({
  plans,
  totalCents,
  currency,
  onChoose,
}: {
  plans: PaymentPlan[];
  totalCents: number;
  currency: string;
  onChoose: (plan: PaymentPlan) => void;
}) {
  const [selected, setSelected] = useState<string>(planKey(plans[0]!));

  const format = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Choose how you'd like to pay</legend>
      {plans.map((p) => {
        const key = planKey(p);
        return (
          <label
            key={key}
            className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition-colors ${
              selected === key
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)]"
                : "border-[rgb(var(--border-subtle))]"
            }`}
          >
            <input
              type="radio"
              name="payment_plan"
              value={key}
              checked={selected === key}
              onChange={() => {
                setSelected(key);
                onChoose(p);
              }}
            />
            <span>{planLabel(p, totalCents, format)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function planKey(p: PaymentPlan): string {
  if (p.kind === "monthly") return `monthly_${p.installments}`;
  return p.kind;
}

function planLabel(
  p: PaymentPlan,
  total: number,
  format: (c: number) => string,
): string {
  if (p.kind === "full") return `Pay in full — ${format(total)} today`;
  if (p.kind === "split_50_50") {
    const half = Math.floor(total / 2) + (total % 2);
    return `50/50 — ${format(half)} now, ${format(total - half)} on delivery`;
  }
  const each = Math.floor(total / p.installments);
  return `Monthly — ${format(each)} today, then ${format(each)}/month for ${p.installments - 1} months`;
}
```

Wire this into the booking page so it appears after contract sign, before Stripe redirect. The selected plan submits as a hidden field on the same form.

### Step 5.8: Test the full booking flow in Stripe test mode

Manual QA:
1. As producer, create a product with all 3 plans enabled
2. As client, visit `/p/<slug>/book`, pick that product, sign contract, see plan picker
3. Pick "Pay in full" → Stripe Checkout → use test card `4242424242424242` → success
4. Pick "50/50" → Checkout → same test card → confirm project shows `charges_completed = 1` and `stripe_payment_method_id` populated
5. Pick "Monthly × 3" → Checkout → same test card → confirm subscription is created on Stripe Dashboard

### Step 5.9: Typecheck + commit

Run: `cd apps/web && pnpm typecheck && pnpm lint && pnpm test`

Expected: all green.

```bash
git add apps/web/
git commit -m "feat(checkout): plan picker + 3-shape Checkout integration

Client picks their plan after signing; server dispatches to the
right Stripe primitive (one-time / 50-50 setup_future_usage /
monthly subscription). Plan + chargesTotal persist on the project
row for downstream webhook handlers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Webhook handlers — `checkout.session.completed` + Subscription Schedule creation

**Files:**
- Modify: `apps/web/src/app/api/stripe/webhook/route.ts`
- Test: `apps/web/src/app/api/stripe/webhook/route.test.ts` (new)

### Step 6.1: Write failing test

Create `apps/web/src/app/api/stripe/webhook/route.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleCheckoutCompleted } from "./handlers";
// We extract handler logic from the route file into ./handlers for
// testability. The route.ts just validates signature + dispatches.

describe("handleCheckoutCompleted", () => {
  it("split_50_50: saves PM, sets charges 1/2, activates project", async () => {
    const dbUpdate = vi.fn().mockReturnThis();
    const dbSet = vi.fn().mockReturnThis();
    const dbWhere = vi.fn().mockResolvedValue(undefined);
    const db = { update: dbUpdate.mockReturnValue({ set: dbSet.mockReturnValue({ where: dbWhere }) }) } as never;

    await handleCheckoutCompleted({
      db,
      session: {
        id: "cs_1",
        mode: "payment",
        payment_intent: "pi_abc",
        customer: "cus_1",
        customer_details: { email: "dan@ex.com", name: "Dan" },
        metadata: { projectId: "proj_1", planKind: "split_50_50" },
      } as never,
      stripe: {
        paymentIntents: {
          retrieve: vi.fn().mockResolvedValue({ payment_method: "pm_xyz" }),
        },
      } as never,
    });

    // projects update called with charges=1, stage=active, pm saved
    expect(dbSet).toHaveBeenCalledWith(expect.objectContaining({
      stripePaymentMethodId: "pm_xyz",
      stripeCustomerId: "cus_1",
      chargesCompleted: 1,
      chargesTotal: 2,
      stage: "booked",
    }));
  });

  it("monthly: creates SubscriptionSchedule, saves schedule id, sets chargesTotal=N", async () => {
    // ... similar shape, asserting schedule creation
  });

  it("full: single charge → stage paid", async () => {
    // ...
  });
});
```

*(Engineer: the full test suite should cover all 3 dispatches — omitted here for length. Follow the pattern of the first test.)*

### Step 6.2: Extract + implement handler logic

Create `apps/web/src/app/api/stripe/webhook/handlers.ts` and move the switch-case logic into exported pure functions. Webhook route becomes a thin dispatcher.

Key handler: `handleCheckoutCompleted` must:
1. Parse `metadata.projectId` and `metadata.planKind`
2. Look up the project by id (scope-check via `producerId` in metadata)
3. For `split_50_50` or `full`: retrieve PaymentIntent to get PaymentMethod id, persist
4. For `monthly`: use Stripe SDK to upgrade the created Subscription into a Subscription Schedule with N iterations total (use `stripe.subscriptionSchedules.create({ from_subscription: subId, ... })` or `update` if created differently)
5. Call `advancePlanState(project, { type: "charge_succeeded" })` → persist new state
6. Insert `invoices` row with `kind = planKind === "monthly" ? "installment" : "deposit"`

See [Stripe Subscription Schedules docs](https://docs.stripe.com/api/subscription_schedules) and [setup_future_usage guide](https://docs.stripe.com/payments/payment-intents#future-usage).

### Step 6.3: Add handlers for `invoice.paid`, `payment_intent.succeeded`, `customer.subscription.deleted`, `customer.subscription.paused`

Each calls `advancePlanState` with the right event:
- `invoice.paid` (monthly) → `charge_succeeded`
- `payment_intent.succeeded` (off-session final) → `charge_succeeded`
- `customer.subscription.paused` or our own "retries exhausted" signal → `retries_exhausted`
- `customer.subscription.deleted` → if chargesCompleted === chargesTotal, stage `paid`; else `cancelled`

### Step 6.4: Run the webhook test suite

Run: `cd apps/web && pnpm test src/app/api/stripe/webhook`

Expected: all tests green.

### Step 6.5: Commit

```bash
git add apps/web/src/app/api/stripe/webhook/
git commit -m "feat(webhook): payment-plan-aware Stripe event handlers

- checkout.session.completed dispatches by planKind: saves PM for
  split_50_50, creates SubscriptionSchedule for monthly
- invoice.paid increments chargesCompleted, inserts installment row
- payment_intent.succeeded (off-session final) closes out 50-50
- customer.subscription.paused → payment_paused stage
- customer.subscription.deleted → paid (if complete) or cancelled

All handlers go through advancePlanState for state transitions —
single source of truth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Off-session final charge — producer confirmation + mutation

**Files:**
- Modify: `apps/web/src/server/trpc/routers/project.ts` (add `chargeFinal` mutation)
- Create: `apps/web/src/components/project/confirm-charge-modal.tsx`
- Modify: project room UI — hook modal to "Mark final delivered"
- Test: `apps/web/src/server/trpc/routers/project.test.ts` (add `chargeFinal` cases)

### Step 7.1: Write test for `chargeFinal`

In `apps/web/src/server/trpc/routers/project.test.ts`:

```ts
it("chargeFinal: only works on split_50_50 projects at chargesCompleted=1", async () => {
  // ... setup project with chargesCompleted: 1, chargesTotal: 2, stage: active
  // Call chargeFinal → assert PaymentIntent.create called with
  //   off_session: true, confirm: true, customer + payment_method saved
  // Idempotency key must be proj_<id>_charge_2
});

it("chargeFinal: rejects when already paid", async () => {
  // chargesCompleted: 2 → error PRECONDITION_FAILED
});

it("chargeFinal: rejects when plan is not split_50_50", async () => {
  // paymentPlanKind: 'monthly' → error BAD_REQUEST
});
```

### Step 7.2: Implement the mutation

In `apps/web/src/server/trpc/routers/project.ts`:

```ts
chargeFinal: producerProcedure
  .input(z.object({ projectId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const [project] = await ctx.db
      .select()
      .from(projects)
      .where(and(
        eq(projects.id, input.projectId),
        eq(projects.producerId, ctx.producerId),
      ))
      .limit(1);
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    if (project.paymentPlanKind !== "split_50_50") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Final charge only applies to 50/50 plans.",
      });
    }
    if (project.chargesCompleted !== 1) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Final charge already processed or deposit not yet paid.",
      });
    }
    if (!project.stripeCustomerId || !project.stripePaymentMethodId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Missing saved payment method — re-run checkout.",
      });
    }

    const [producer] = await ctx.db
      .select({ stripeAccountId: producers.stripeAccountId })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!producer?.stripeAccountId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED" });
    }

    const stripe = getStripe();
    const pi = await stripe.paymentIntents.create(
      {
        amount: /* calculate from invoices[deposit].amount — half of total */ 0,
        currency: /* from project... */ "usd",
        customer: project.stripeCustomerId,
        payment_method: project.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        transfer_data: { destination: producer.stripeAccountId },
        metadata: { projectId: project.id, kind: "final" },
      },
      {
        idempotencyKey: `proj_${project.id}_charge_2`,
        stripeAccount: producer.stripeAccountId,
      },
    );

    // Webhook handles the state update. This mutation just surfaces
    // any synchronous error (card declined) to the producer's UI.
    return { paymentIntentId: pi.id };
  }),
```

### Step 7.3: Modal UI

Create `apps/web/src/components/project/confirm-charge-modal.tsx`:

```tsx
"use client";

export function ConfirmChargeModal({
  open,
  clientName,
  amountCents,
  currency,
  cardLast4,
  onConfirm,
  onClose,
}: {
  open: boolean;
  clientName: string;
  amountCents: number;
  currency: string;
  cardLast4?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" /* ... standard modal shell ... */>
      <h2>Deliver final mix to {clientName}?</h2>
      <p>
        This will charge their card{cardLast4 ? ` ending ${cardLast4}` : ""} for{" "}
        <strong>{format(amountCents, currency)}</strong> (final payment).
      </p>
      <button onClick={onClose}>Cancel</button>
      <button onClick={onConfirm}>Confirm & charge</button>
    </div>
  );
}
```

### Step 7.4: Hook into project room's "Mark final delivered" button

Modify the existing button handler: if project's `paymentPlanKind === 'split_50_50'` AND `chargesCompleted === 1`, open the modal before calling the mark-final mutation. Modal confirm → call `project.chargeFinal` → on success, call mark-final as today.

### Step 7.5: Typecheck + lint + test + commit

```bash
cd apps/web && pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/
git commit -m "feat(project): producer-triggered final charge for 50-50 plans

Mutation creates an off-session PaymentIntent with the saved PM.
Idempotency key proj_<id>_charge_2 — producer double-click or
webhook replay are safe. UI shows a confirm modal with the amount
+ last-4 of the saved card before firing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Project-room payment status strip

**Files:**
- Create: `apps/web/src/components/project/payment-status-strip.tsx`
- Modify: project room page to render the strip

### Step 8.1: Write a snapshot test

Vitest + React Testing Library render of the component for each plan state (full/paid, 50-50 midway, monthly 2/4, paused). Assert visible text.

### Step 8.2: Implement the strip

Render dots via a simple map: `Array.from({length: chargesTotal}).map((_, i) => i < chargesCompleted ? '●' : '○')`. Compact, Tailwind-styled. Include next-charge date for monthly.

### Step 8.3: Wire into producer project room

Add `<PaymentStatusStrip project={project} />` near the top of `apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx` (or wherever the project view lives).

### Step 8.4: Typecheck + commit

```bash
cd apps/web && pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/components/project/payment-status-strip.tsx apps/web/src/app/\(app\)/dashboard/projects/
git commit -m "feat(project): payment status strip in project room"
```

---

## Task 9: Cancel project mutation + UI

**Files:**
- Modify: `apps/web/src/server/trpc/routers/project.ts` (add `cancel` mutation)
- Create: `apps/web/src/components/project/cancel-confirm-modal.tsx`
- Test: `apps/web/src/server/trpc/routers/project.test.ts`

### Step 9.1: Test

```ts
it("cancel: monthly project calls subscriptionSchedules.cancel + sets stage cancelled", async () => {
  // ... mock Stripe, assert schedules.cancel called with saved id
});
it("cancel: full/50-50 projects just set stage cancelled, no Stripe call for future charges", async () => {
  // ...
});
```

### Step 9.2: Implement

```ts
cancel: producerProcedure
  .input(z.object({ projectId: z.string().uuid(), confirmTitle: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const [project] = await ctx.db.select().from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.producerId, ctx.producerId)))
      .limit(1);
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    if (project.title !== input.confirmTitle) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmation title mismatch" });
    }
    if (project.stripeSubscriptionScheduleId) {
      const stripe = getStripe();
      const [producer] = await ctx.db.select().from(producers)
        .where(eq(producers.id, ctx.producerId)).limit(1);
      await stripe.subscriptionSchedules.cancel(
        project.stripeSubscriptionScheduleId,
        { stripeAccount: producer!.stripeAccountId! },
      );
    }
    await ctx.db.update(projects).set({ stage: "cancelled" })
      .where(eq(projects.id, project.id));
  }),
```

### Step 9.3: Modal — type-to-confirm pattern

Red "Cancel project" button on project settings. Clicks open modal requiring the user to type the project title. Calls `cancel` on confirm.

### Step 9.4: Commit

```bash
cd apps/web && pnpm typecheck && pnpm lint && pnpm test
git add apps/web/src/
git commit -m "feat(project): cancel mutation + type-to-confirm UI

Producer cancels project → Stripe Subscription Schedule cancelled
(monthly) → project stage cancelled. No future charges fire. Refund
policy lives in the contract; no in-app refund action per design.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Paused-state client banner

**Files:**
- Create: `apps/web/src/components/project/paused-banner.tsx`
- Modify: client-facing project surfaces to render when `stage === 'payment_paused'`
- Modify: booking mutation to reject new bookings on paused projects

### Step 10.1: Implement banner + block booking

Banner: shown at top of client-facing project view + magic-link music view when `stage === 'payment_paused'`. CTA: "Update payment method" → deep links to Stripe Customer Portal.

Stripe Customer Portal: create a tRPC query `createCustomerPortalSession` that returns `billing_portal.sessions.create({customer: project.stripeCustomerId, return_url, stripeAccount: producer.stripeAccountId})`.

Booking mutation: reject public booking creation when project is `payment_paused`.

### Step 10.2: Commit

```bash
git add apps/web/src/
git commit -m "feat(project): paused-state banner + Stripe Portal deep link

Banner on client surfaces when stage=payment_paused. CTA to
Stripe-hosted Customer Portal where they update the card. Booking
creation rejected while paused. Music + past mixes stay accessible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Integration testing with Stripe test clocks

**Files:**
- Create: `apps/web/src/server/payments/__tests__/integration.test.ts`

Use Stripe's [test clocks](https://docs.stripe.com/billing/testing/test-clocks) to advance simulated time and assert webhook-driven state transitions work end-to-end.

### Step 11.1: Write integration tests

Skipped by default (run manually with `STRIPE_INTEGRATION=1 pnpm test integration`). Test cases:

1. Create test-clock Customer, create monthly × 4 project, advance clock 31d → assert `chargesCompleted = 2`, next `next_charge_at` updated
2. Use card `4000000000000341` (fails) → advance → assert `stage = payment_paused`
3. Update PM via Portal → assert auto-resume
4. 50-50 happy path — producer triggers final, confirm state
5. Cancel monthly mid-plan → assert schedule cancelled in Stripe

### Step 11.2: Run and verify

Run: `STRIPE_INTEGRATION=1 pnpm test src/server/payments/__tests__/integration.test.ts`

Expected: all pass (slow — each test takes ~10-30s because of test-clock advances).

### Step 11.3: Commit

```bash
git add apps/web/src/server/payments/__tests__/integration.test.ts
git commit -m "test(payments): stripe test-clock integration suite

Runs against Stripe test mode with simulated time advancement.
Covers monthly happy path, failure → pause → resume, 50-50 happy +
decline, cancel. Opt-in via STRIPE_INTEGRATION=1 env flag so default
CI run stays fast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Manual QA + production rollout

### Step 12.1: Deploy to Vercel preview

Push the branch, open a PR, let Vercel build the preview deploy.

### Step 12.2: Run the manual QA checklist from the design doc

- [ ] Pay in full, Israeli card — full flow
- [ ] 50/50 happy path
- [ ] 50/50 with declined off-session final (test card `4000000000000341`)
- [ ] Monthly × 4, test clock through all 4 charges
- [ ] Monthly card fails on month 3 → verify pause banner appears
- [ ] Cancel project mid-monthly → verify Schedule cancelled in Stripe Dashboard
- [ ] Product editor: toggle each plan, save, reload, confirm persisted
- [ ] Project room: payment status strip renders correctly for each plan kind

### Step 12.3: Merge + deploy to prod

After all checks pass and user reviews the PR:
```bash
git checkout main && git merge --no-ff <branch>
git push origin main
```

Vercel auto-deploys to prod.

### Step 12.4: Verify in prod

- [ ] Load landing page (200)
- [ ] Producer creates a product with monthly plan
- [ ] Smoke-test a tiny real charge ($1) to confirm Connect + webhooks wired correctly
- [ ] Refund the test charge

### Step 12.5: Final commit / docs update

```bash
git add docs/plans/2026-04-18-stripe-auto-installments.md
git commit -m "docs: mark stripe auto-installments plan as shipped"
```

---

## Success criteria

When this plan is complete:

- [ ] Producer can check "Monthly × 4" on a product and save
- [ ] Client at checkout sees 3 plan options and can pick any one
- [ ] Pay-in-full works (regression — don't break existing flow)
- [ ] 50/50: first charge + save card at Checkout; producer confirms final → off-session charge fires; card update link if declined
- [ ] Monthly × N: Stripe creates Subscription Schedule on our behalf; auto-charges on schedule; pause on exhausted retries; resume on card update
- [ ] Project room shows payment status strip with filled/empty dots + next-charge date
- [ ] Producer can cancel mid-plan → Schedule cancelled → no more charges
- [ ] All state transitions go through `advancePlanState` — single source of truth
- [ ] All outbound Stripe charges use idempotency keys — duplicate webhooks/clicks safe
- [ ] 196+ existing tests still pass; new tests cover helpers + handlers + mutations
- [ ] Manual QA checklist all green before merge

---

## Out of scope (don't build these in this plan)

- 50/25/25 mid-milestone triggers
- Custom milestone builder UI
- In-app refund flow
- Promo codes at checkout
- Multi-currency per producer
- Plan changes mid-flight (must cancel + restart)
