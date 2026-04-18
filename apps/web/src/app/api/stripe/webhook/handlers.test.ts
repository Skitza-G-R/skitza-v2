import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaid,
  handlePaymentIntentSucceeded,
  handleSubscriptionPaused,
  handleSubscriptionDeleted,
  handleAccountUpdated,
  handleChargeRefunded,
  planStageToProjectStage,
  dispatchEvent,
} from "./handlers";

// ─── Mock DB builder ────────────────────────────────────────────────
// The handlers use a small slice of the Drizzle surface:
//   db.select(...).from(...).where(...).limit(...)
//   db.update(...).set(...).where(...)
//   db.insert(...).values(...)
//
// We mock each chain as a callable that returns a thenable, recording
// every call so assertions can inspect what the handler did. Returning
// `vi.fn().mockReturnThis()` on intermediate methods keeps the chain
// alive; terminal methods (`limit`, `where` on updates/inserts) resolve
// the promise.

type SelectResult = Array<Record<string, unknown>>;

/**
 * Build a db mock. `selectResults` is a queue: the Nth call to .limit()
 * (which terminates a select chain) resolves to selectResults[N]. If
 * the queue runs out, subsequent selects resolve to [].
 */
function makeDb(selectResults: SelectResult[] = []) {
  const queue = [...selectResults];
  const limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  const where = vi.fn().mockReturnThis();
  const from = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();

  const updateSet = vi.fn().mockReturnThis();
  const updateWhere = vi.fn(() => Promise.resolve());

  const insertValues = vi.fn(() => Promise.resolve());

  const db = {
    select: (..._args: unknown[]) => {
      select(..._args);
      return { from, where, limit, select };
    },
    from,
    where,
    limit,
    update: vi.fn(() => ({ set: updateSet, where: updateWhere })),
    set: updateSet,
    insert: vi.fn(() => ({ values: insertValues })),
    values: insertValues,
  };

  // Drizzle's real chain reuses `where` between select and update —
  // since we return distinct objects for `.update()`, the update path
  // uses its own `where`. But the select path's chain ends on `limit`,
  // and because we return `this` from `from`/`where`, we need the `db`
  // itself to expose those proxy methods too for `.select().from(...)`.
  Object.assign(from, { where, limit, select });
  Object.assign(where, { limit, from });

  return { db, insertValues, updateSet, updateWhere, limit, update: db.update, insert: db.insert };
}

// ─── Stripe mock builder ────────────────────────────────────────────

function makeStripe(overrides: Partial<{
  paymentIntentsRetrieve: ReturnType<typeof vi.fn>;
  subscriptionsRetrieve: ReturnType<typeof vi.fn>;
  subscriptionSchedulesCreate: ReturnType<typeof vi.fn>;
  subscriptionSchedulesUpdate: ReturnType<typeof vi.fn>;
}> = {}): Stripe {
  const paymentIntentsRetrieve =
    overrides.paymentIntentsRetrieve ??
    vi.fn().mockResolvedValue({ id: "pi_x", payment_method: "pm_abc" });
  const subscriptionsRetrieve =
    overrides.subscriptionsRetrieve ??
    vi.fn().mockResolvedValue({ id: "sub_x", schedule: "sub_sched_x" });
  const subscriptionSchedulesCreate =
    overrides.subscriptionSchedulesCreate ??
    vi.fn().mockResolvedValue({
      id: "sub_sched_new",
      phases: [
        { items: [{ price: "price_abc", quantity: 1 }] },
      ],
    });
  const subscriptionSchedulesUpdate =
    overrides.subscriptionSchedulesUpdate ?? vi.fn().mockResolvedValue({});

  return {
    paymentIntents: { retrieve: paymentIntentsRetrieve },
    subscriptions: { retrieve: subscriptionsRetrieve },
    subscriptionSchedules: {
      create: subscriptionSchedulesCreate,
      update: subscriptionSchedulesUpdate,
    },
  } as unknown as Stripe;
}

// ─── planStageToProjectStage ─────────────────────────────────────────

describe("planStageToProjectStage", () => {
  it("maps plan-active → in_production (Skitza funnel's 'paid, working' stage)", () => {
    expect(planStageToProjectStage("active")).toBe("in_production");
  });
  it("maps 1:1 for paid/payment_paused/cancelled/lead", () => {
    expect(planStageToProjectStage("paid")).toBe("paid");
    expect(planStageToProjectStage("payment_paused")).toBe("payment_paused");
    expect(planStageToProjectStage("cancelled")).toBe("cancelled");
    expect(planStageToProjectStage("lead")).toBe("lead");
  });
});

// ─── checkout.session.completed ──────────────────────────────────────

describe("handleCheckoutSessionCompleted", () => {
  const baseSession: Record<string, unknown> = {
    id: "cs_abc",
    payment_intent: "pi_abc",
    customer: "cus_abc",
    customer_details: { email: "dan@example.com", name: "Dan" },
    metadata: { projectId: "proj_1", planKind: "full" },
    mode: "payment",
    subscription: null,
  };
  const baseEvent = (overrides: Record<string, unknown> = {}) => ({
    type: "checkout.session.completed",
    data: { object: { ...baseSession, ...overrides } },
  }) as unknown as Stripe.CheckoutSessionCompletedEvent;

  it("full plan → writes invoice paid, saves customer + PM, advances to paid", async () => {
    // First select: load project by id → returns full-plan row
    const project = {
      id: "proj_1",
      stage: "lead",
      chargesCompleted: 0,
      chargesTotal: 1,
      paymentPlanKind: "full",
      stripeSubscriptionScheduleId: null,
    };
    const { db, updateSet } = makeDb([[project]]);
    const stripe = makeStripe();

    await handleCheckoutSessionCompleted({
      db: db as never,
      stripe,
      event: baseEvent(),
    });

    // Customer + PM persisted
    const customerPmCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return "stripeCustomerId" in arg || "stripePaymentMethodId" in arg;
    });
    expect(customerPmCall?.[0]).toMatchObject({
      stripeCustomerId: "cus_abc",
      stripePaymentMethodId: "pm_abc",
    });
    // Stage advanced to paid (chargesTotal=1 → first+last charge → paid)
    const stageCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return arg.stage === "paid";
    });
    expect(stageCall).toBeTruthy();
  });

  it("split_50_50 plan → saves customer + PM, advances to in_production (active)", async () => {
    const project = {
      id: "proj_1",
      stage: "lead",
      chargesCompleted: 0,
      chargesTotal: 2,
      paymentPlanKind: "split_50_50",
      stripeSubscriptionScheduleId: null,
    };
    const { db, updateSet } = makeDb([[project]]);
    const stripe = makeStripe();

    await handleCheckoutSessionCompleted({
      db: db as never,
      stripe,
      event: baseEvent({
        metadata: { projectId: "proj_1", planKind: "split_50_50" },
      }),
    });

    const stageCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return arg.stage === "in_production";
    });
    expect(stageCall).toBeTruthy();
  });

  it("monthly plan → creates SubscriptionSchedule and persists id", async () => {
    const project = {
      id: "proj_1",
      stage: "lead",
      chargesCompleted: 0,
      chargesTotal: 4,
      paymentPlanKind: "monthly",
      stripeSubscriptionScheduleId: null,
    };
    const { db, updateSet } = makeDb([[project]]);
    const createMock = vi.fn().mockResolvedValue({
      id: "sub_sched_123",
      phases: [{ items: [{ price: "price_abc", quantity: 1 }] }],
    });
    const updateMock = vi.fn().mockResolvedValue({});
    const stripe = makeStripe({
      subscriptionSchedulesCreate: createMock,
      subscriptionSchedulesUpdate: updateMock,
    });

    await handleCheckoutSessionCompleted({
      db: db as never,
      stripe,
      event: baseEvent({
        mode: "subscription",
        subscription: "sub_abc",
        metadata: {
          projectId: "proj_1",
          planKind: "monthly",
          installments: "4",
        },
      }),
    });

    expect(createMock).toHaveBeenCalledWith({ from_subscription: "sub_abc" });
    // Inspect the second Stripe update call — scheduleSchedules.update
    // is called with (id, params). The params must include end_behavior
    // and a phase with our N-month duration.
    const updateCall = updateMock.mock.calls[0];
    expect(updateCall?.[0]).toBe("sub_sched_123");
    const updateParams = updateCall?.[1] as {
      end_behavior: string;
      phases: Array<{ duration: { interval: string; interval_count: number } }>;
    };
    expect(updateParams.end_behavior).toBe("cancel");
    expect(updateParams.phases[0]?.duration).toEqual({
      interval: "month",
      interval_count: 4,
    });
    // schedule id persisted on project
    const scheduleCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return arg.stripeSubscriptionScheduleId === "sub_sched_123";
    });
    expect(scheduleCall).toBeTruthy();
  });

  it("monthly with existing schedule id → skips schedule creation (idempotent replay)", async () => {
    const project = {
      id: "proj_1",
      stage: "in_production",
      chargesCompleted: 1,
      chargesTotal: 4,
      paymentPlanKind: "monthly",
      stripeSubscriptionScheduleId: "sub_sched_existing",
    };
    const { db } = makeDb([[project]]);
    const createMock = vi.fn();
    const stripe = makeStripe({ subscriptionSchedulesCreate: createMock });

    await handleCheckoutSessionCompleted({
      db: db as never,
      stripe,
      event: baseEvent({
        mode: "subscription",
        subscription: "sub_abc",
        metadata: {
          projectId: "proj_1",
          planKind: "monthly",
          installments: "4",
        },
      }),
    });

    expect(createMock).not.toHaveBeenCalled();
  });

  it("no metadata.projectId → no-op on project lookup (legacy deposit session)", async () => {
    const { db, update } = makeDb([]);
    const stripe = makeStripe();
    await handleCheckoutSessionCompleted({
      db: db as never,
      stripe,
      event: baseEvent({ metadata: {} }),
    });
    // Only the invoice-status update (no project lookups)
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("project not found → warn + no-op (no throw)", async () => {
    const { db } = makeDb([[]]);
    const stripe = makeStripe();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      handleCheckoutSessionCompleted({
        db: db as never,
        stripe,
        event: baseEvent(),
      }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

// ─── invoice.paid ────────────────────────────────────────────────────

describe("handleInvoicePaid", () => {
  const baseInvoice = (overrides: Record<string, unknown> = {}) =>
    ({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_abc",
          amount_paid: 25000,
          currency: "usd",
          customer_email: "dan@example.com",
          customer_name: "Dan",
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_recur" },
          },
          payment_intent: "pi_recur",
          ...overrides,
        },
      },
    }) as unknown as Stripe.InvoicePaidEvent;

  it("inserts installment invoice + advances plan state", async () => {
    const project = {
      id: "proj_1",
      stage: "in_production",
      chargesCompleted: 1,
      chargesTotal: 4,
      paymentPlanKind: "monthly",
      stripeSubscriptionScheduleId: "sub_sched_abc",
    };
    // select[0]: project by schedule (miss — [])
    // select[1]: project by schedule id from Stripe sub (hit)
    // select[2]: invoiceExistsForPaymentIntent (miss — [])
    // select[3]: load project for producer/booking
    const { db, insertValues, updateSet } = makeDb([
      [],
      [project],
      [],
      [{ producerId: "prod_1", bookingId: "book_1" }],
    ]);
    const stripe = makeStripe({
      subscriptionsRetrieve: vi
        .fn()
        .mockResolvedValue({ id: "sub_recur", schedule: "sub_sched_abc" }),
    });

    await handleInvoicePaid({ db: db as never, stripe, event: baseInvoice() });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        producerId: "prod_1",
        projectId: "proj_1",
        paymentPlanProjectId: "proj_1",
        amountCents: 25000,
        currency: "USD",
        kind: "installment",
        status: "paid",
        stripePaymentIntentId: "pi_recur",
      }),
    );
    // Plan advanced
    const stageCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return "chargesCompleted" in arg;
    });
    expect(stageCall?.[0]).toMatchObject({ chargesCompleted: 2 });
  });

  it("duplicate PI → skips insert but still advances state (idempotent)", async () => {
    const project = {
      id: "proj_1",
      stage: "in_production",
      chargesCompleted: 1,
      chargesTotal: 4,
      paymentPlanKind: "monthly",
      stripeSubscriptionScheduleId: "sub_sched_abc",
    };
    const { db, insertValues } = makeDb([
      [project],  // direct schedule-id hit
      [{ id: "inv_existing" }], // invoiceExistsForPaymentIntent returns hit
    ]);
    const stripe = makeStripe();
    await handleInvoicePaid({ db: db as never, stripe, event: baseInvoice() });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("swallows unique-violation on INSERT as replay, still advances state", async () => {
    // Simulates the race: the SELECT-check misses (sibling hasn't
    // committed yet), but by the time our INSERT fires the sibling
    // has landed — the partial unique index throws 23505. Our handler
    // must log + continue + advance plan state (idempotent).
    const project = {
      id: "proj_1",
      stage: "in_production",
      chargesCompleted: 1,
      chargesTotal: 4,
      paymentPlanKind: "monthly",
      stripeSubscriptionScheduleId: "sub_sched_abc",
    };
    // select[0]: direct schedule-id hit
    // select[1]: invoiceExistsForPaymentIntent (miss — [])
    // select[2]: load project for producer/booking
    const { db, insertValues, updateSet } = makeDb([
      [project],
      [],
      [{ producerId: "prod_1", bookingId: "book_1" }],
    ]);
    // Override insert to throw the unique-violation on first call.
    const uniqueErr = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "invoices_stripe_payment_intent_unique"',
      ),
      { code: "23505" },
    );
    insertValues.mockImplementationOnce(() => Promise.reject(uniqueErr));
    const stripe = makeStripe();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      handleInvoicePaid({ db: db as never, stripe, event: baseInvoice() }),
    ).resolves.toBeUndefined();

    // State still advanced despite the INSERT race.
    const stageCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return "chargesCompleted" in arg;
    });
    expect(stageCall?.[0]).toMatchObject({ chargesCompleted: 2 });
    info.mockRestore();
  });

  it("no subscription id on invoice → no-op", async () => {
    const { db, insertValues } = makeDb([]);
    const stripe = makeStripe();
    await handleInvoicePaid({
      db: db as never,
      stripe,
      event: baseInvoice({ parent: null, subscription: null }),
    });
    expect(insertValues).not.toHaveBeenCalled();
  });
});

// ─── payment_intent.succeeded ────────────────────────────────────────

describe("handlePaymentIntentSucceeded", () => {
  const basePi = (overrides: Record<string, unknown> = {}) =>
    ({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_off_session",
          amount_received: 5000_00,
          currency: "usd",
          metadata: { projectId: "proj_1", kind: "final" },
          ...overrides,
        },
      },
    }) as unknown as Stripe.PaymentIntentSucceededEvent;

  it("advances plan + writes final-invoice row", async () => {
    const project = {
      id: "proj_1",
      stage: "in_production",
      chargesCompleted: 1,
      chargesTotal: 2,
      paymentPlanKind: "split_50_50",
      stripeSubscriptionScheduleId: null,
    };
    const { db, insertValues, updateSet } = makeDb([
      [project], // load by id
      [], // invoiceExists check
      [{ producerId: "prod_1", bookingId: "book_1" }], // project details
    ]);
    const stripe = makeStripe();

    await handlePaymentIntentSucceeded({
      db: db as never,
      stripe,
      event: basePi(),
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        stripePaymentIntentId: "pi_off_session",
        kind: "final",
        status: "paid",
        amountCents: 5000_00,
      }),
    );
    // chargesCompleted 1 → 2 of 2 → stage paid
    const paidCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return arg.stage === "paid";
    });
    expect(paidCall).toBeTruthy();
  });

  it("no metadata.projectId → no-op", async () => {
    const { db, insertValues } = makeDb([]);
    const stripe = makeStripe();
    await handlePaymentIntentSucceeded({
      db: db as never,
      stripe,
      event: basePi({ metadata: {} }),
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("early-return when pi.invoice is set (subscription-originated)", async () => {
    // Subscription-invoiced PIs fire both payment_intent.succeeded AND
    // invoice.paid near-parallel. invoice.paid is the canonical writer
    // for installments; this handler must bail before any DB work so
    // we don't race the sibling.
    const { db, insertValues, update } = makeDb([]);
    const stripe = makeStripe();
    await handlePaymentIntentSucceeded({
      db: db as never,
      stripe,
      event: basePi({ invoice: "in_sub_abc" }),
    });
    expect(insertValues).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

// ─── customer.subscription.paused ────────────────────────────────────

describe("handleSubscriptionPaused", () => {
  it("retries exhausted → project stage = payment_paused", async () => {
    const project = {
      id: "proj_1",
      stage: "in_production",
      chargesCompleted: 2,
      chargesTotal: 4,
      paymentPlanKind: "monthly",
      stripeSubscriptionScheduleId: "sub_sched_abc",
    };
    const { db, updateSet } = makeDb([[project]]);
    const stripe = makeStripe();

    await handleSubscriptionPaused({
      db: db as never,
      stripe,
      event: {
        type: "customer.subscription.paused",
        data: {
          object: { id: "sub_recur", schedule: "sub_sched_abc" },
        },
      } as unknown as Stripe.CustomerSubscriptionPausedEvent,
    });

    const paused = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return arg.stage === "payment_paused";
    });
    expect(paused).toBeTruthy();
  });
});

// ─── customer.subscription.deleted ───────────────────────────────────

describe("handleSubscriptionDeleted", () => {
  it("schedule completed (chargesCompleted === chargesTotal) → stage=paid", async () => {
    const project = {
      id: "proj_1",
      stage: "in_production",
      chargesCompleted: 4,
      chargesTotal: 4,
      paymentPlanKind: "monthly",
      stripeSubscriptionScheduleId: "sub_sched_abc",
    };
    const { db, updateSet } = makeDb([[project]]);
    const stripe = makeStripe();

    await handleSubscriptionDeleted({
      db: db as never,
      stripe,
      event: {
        type: "customer.subscription.deleted",
        data: {
          object: { id: "sub_recur", schedule: "sub_sched_abc" },
        },
      } as unknown as Stripe.CustomerSubscriptionDeletedEvent,
    });

    const paidCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return arg.stage === "paid";
    });
    expect(paidCall).toBeTruthy();
  });

  it("cancelled mid-plan → stage=cancelled", async () => {
    const project = {
      id: "proj_1",
      stage: "in_production",
      chargesCompleted: 1,
      chargesTotal: 4,
      paymentPlanKind: "monthly",
      stripeSubscriptionScheduleId: "sub_sched_abc",
    };
    const { db, updateSet } = makeDb([[project]]);
    const stripe = makeStripe();

    await handleSubscriptionDeleted({
      db: db as never,
      stripe,
      event: {
        type: "customer.subscription.deleted",
        data: {
          object: { id: "sub_recur", schedule: "sub_sched_abc" },
        },
      } as unknown as Stripe.CustomerSubscriptionDeletedEvent,
    });

    const cancelledCall = updateSet.mock.calls.find((c) => {
      const arg = c[0] as Record<string, unknown>;
      return arg.stage === "cancelled";
    });
    expect(cancelledCall).toBeTruthy();
  });
});

// ─── account.updated (preserved from route.ts) ───────────────────────

describe("handleAccountUpdated", () => {
  it("mirrors charges_enabled onto producer row", async () => {
    const { db, updateSet } = makeDb();
    const stripe = makeStripe();
    await handleAccountUpdated({
      db: db as never,
      stripe,
      event: {
        type: "account.updated",
        data: { object: { id: "acct_1", charges_enabled: true } },
      } as unknown as Stripe.AccountUpdatedEvent,
    });
    expect(updateSet).toHaveBeenCalledWith({ stripeChargesEnabled: true });
  });
});

// ─── charge.refunded (preserved from route.ts) ───────────────────────

describe("handleChargeRefunded", () => {
  it("marks invoice refunded when payment_intent id present", async () => {
    const { db, updateSet } = makeDb();
    const stripe = makeStripe();
    await handleChargeRefunded({
      db: db as never,
      stripe,
      event: {
        type: "charge.refunded",
        data: { object: { payment_intent: "pi_xyz" } },
      } as unknown as Stripe.ChargeRefundedEvent,
    });
    expect(updateSet).toHaveBeenCalledWith({ status: "refunded" });
  });

  it("missing payment_intent → no-op", async () => {
    const { db, update } = makeDb();
    const stripe = makeStripe();
    await handleChargeRefunded({
      db: db as never,
      stripe,
      event: {
        type: "charge.refunded",
        data: { object: { payment_intent: null } },
      } as unknown as Stripe.ChargeRefundedEvent,
    });
    expect(update).not.toHaveBeenCalled();
  });
});

// ─── dispatchEvent unknown type ──────────────────────────────────────

describe("dispatchEvent", () => {
  it("ignores unknown events without throwing", async () => {
    const { db } = makeDb();
    const stripe = makeStripe();
    await expect(
      dispatchEvent({
        db: db as never,
        stripe,
        event: {
          type: "customer.created",
          data: { object: {} },
        } as unknown as Stripe.Event,
      }),
    ).resolves.toBeUndefined();
  });
});
