import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// We mirror the portfolio router test pattern: table
// marker objects let the dbMock route select() chains to the right
// per-table mock. The project.chargeFinal mutation reads three tables
// (producers for ownership, projects for plan state, invoices for the
// deposit currency) and then calls getStripe().paymentIntents.create.

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";
const CUSTOMER_ID = "cus_abc";
const PAYMENT_METHOD_ID = "pm_abc";
const STRIPE_ACCOUNT_ID = "acct_abc";
const DEPOSIT_CURRENCY = "USD";

const producersMarker = { __table: "producers" };
const projectsMarker = { __table: "projects" };
const invoicesMarker = { __table: "invoices" };

// producers table has two shapes the router queries:
// - producerProcedure middleware: SELECT id FROM producers WHERE clerkUserId = ?
// - chargeFinal body: SELECT stripeAccountId, stripeChargesEnabled FROM producers WHERE id = ?
//
// We serve both from a single FIFO queue so each test can seed them
// independently — the middleware always runs first on every call, so
// seed [ [middleware], [body] ] for each chargeFinal invocation.
type Row = Record<string, unknown>;
const producerSelectQueue: Row[][] = [];
const projectSelectQueue: Row[][] = [];
const invoiceSelectQueue: Row[][] = [];
const projectUpdateMock = vi.fn<() => Promise<void>>();
// Captures every .set(...) payload on the projects update chain, so
// the cancel tests can assert "stage was set to cancelled".
const projectUpdateSetSpy = vi.fn<(payload: Row) => void>();

function shift<T>(q: T[][]): T[] {
  return q.shift() ?? [];
}

// Spy that records every `.values(...)` call on the db insert chain.
// chargeFinal is supposed to NEVER insert — the webhook writes the
// ledger row — so we assert this mock is never invoked.
const insertValuesSpy = vi.fn(() => Promise.resolve());

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return {
          where: () => ({ limit: () => Promise.resolve(shift(producerSelectQueue)) }),
        };
      }
      if (table === invoicesMarker) {
        // chargeFinal: .where(and(...)).orderBy(desc()).limit(1)
        return {
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(shift(invoiceSelectQueue)),
            }),
            limit: () => Promise.resolve(shift(invoiceSelectQueue)),
          }),
        };
      }
      // projects — chargeFinal uses .where().limit(1).
      return {
        where: () => ({ limit: () => Promise.resolve(shift(projectSelectQueue)) }),
      };
    },
  }),
  insert: () => ({
    values: insertValuesSpy,
  }),
  update: () => ({
    set: (payload: Row) => {
      projectUpdateSetSpy(payload);
      return { where: () => projectUpdateMock() };
    },
  }),
};

// Stripe mock — chargeFinal uses stripe.paymentIntents.create(params, opts).
// cancel uses stripe.subscriptionSchedules.cancel(scheduleId).
const paymentIntentsCreateMock = vi.fn();
const subscriptionSchedulesCancelMock = vi.fn();
vi.mock("~/server/stripe/client", () => ({
  getStripe: () => ({
    paymentIntents: { create: paymentIntentsCreateMock },
    subscriptionSchedules: { cancel: subscriptionSchedulesCancelMock },
  }),
  getSiteUrl: () => "https://skitza.test",
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  invoices: invoicesMarker,
  // The router imports these table symbols too, even if chargeFinal
  // doesn't touch them; leaving them as opaque markers keeps the router
  // module loadable inside the test.
  bookings: { __table: "bookings" },
  projectTracks: { __table: "project_tracks" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  notifications: { __table: "notifications" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  sql: () => ({ sql: true }),
}));

// Silences the notification + contact side-effects that publicComment
// and addVersion trigger — not exercised by chargeFinal, but we mock
// defensively so the router module loads cleanly.
vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitCommentCreated: vi.fn() }));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  invoiceSelectQueue.length = 0;
  projectUpdateMock.mockReset().mockResolvedValue(undefined);
  projectUpdateSetSpy.mockReset();
  insertValuesSpy.mockReset().mockResolvedValue(undefined);
  paymentIntentsCreateMock.mockReset();
  subscriptionSchedulesCancelMock.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

// Factory for a happy-path producer row + payment intent — individual
// tests override the failing field to exercise each precondition.
function seedHappyPath(overrides: {
  project?: Partial<Row>;
  producerMiddleware?: Row;
  producerBody?: Partial<Row>;
  deposit?: Partial<Row>;
} = {}) {
  producerSelectQueue.push([
    overrides.producerMiddleware ?? { id: PRODUCER_ID },
  ]);
  projectSelectQueue.push([
    {
      id: PROJECT_ID,
      producerId: PRODUCER_ID,
      paymentPlanKind: "split_50_50",
      chargesCompleted: 1,
      chargesTotal: 2,
      stripeCustomerId: CUSTOMER_ID,
      stripePaymentMethodId: PAYMENT_METHOD_ID,
      totalAmountCents: 20000, // $200 total → $100 deposit + $100 final
      ...(overrides.project ?? {}),
    },
  ]);
  producerSelectQueue.push([
    {
      stripeAccountId: STRIPE_ACCOUNT_ID,
      stripeChargesEnabled: true,
      ...(overrides.producerBody ?? {}),
    },
  ]);
  invoiceSelectQueue.push([
    { currency: DEPOSIT_CURRENCY, ...(overrides.deposit ?? {}) },
  ]);
  paymentIntentsCreateMock.mockResolvedValue({ id: "pi_new_final" });
}

describe("project.chargeFinal", () => {
  it("rejects when project is not split_50_50", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        paymentPlanKind: "monthly",
        chargesCompleted: 1,
        chargesTotal: 6,
        stripeCustomerId: CUSTOMER_ID,
        stripePaymentMethodId: PAYMENT_METHOD_ID,
        totalAmountCents: 60000,
      },
    ]);

    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Final charge only applies to 50/50 plans.",
    });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when chargesCompleted === 0 (deposit not paid)", async () => {
    seedHappyPath({ project: { chargesCompleted: 0 } });
    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when chargesCompleted === 2 (already fully charged)", async () => {
    seedHappyPath({ project: { chargesCompleted: 2 } });
    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when saved customer id is missing", async () => {
    seedHappyPath({ project: { stripeCustomerId: null } });
    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Missing saved payment method — re-run checkout.",
    });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when saved payment method id is missing", async () => {
    seedHappyPath({ project: { stripePaymentMethodId: null } });
    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Missing saved payment method — re-run checkout.",
    });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when producer stripe_charges_enabled is false", async () => {
    seedHappyPath({ producerBody: { stripeChargesEnabled: false } });
    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when producer stripe account id is missing", async () => {
    seedHappyPath({ producerBody: { stripeAccountId: null } });
    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the project belongs to a different producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: "some-other-producer",
        paymentPlanKind: "split_50_50",
        chargesCompleted: 1,
        chargesTotal: 2,
        stripeCustomerId: CUSTOMER_ID,
        stripePaymentMethodId: PAYMENT_METHOD_ID,
        totalAmountCents: 20000,
      },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it("happy path: creates off-session PI with correct params + idempotency key", async () => {
    seedHappyPath();

    const caller = await buildCaller();
    const res = await caller.project.chargeFinal({ projectId: PROJECT_ID });

    expect(res).toEqual({ paymentIntentId: "pi_new_final" });
    expect(paymentIntentsCreateMock).toHaveBeenCalledTimes(1);

    const [params, options] = paymentIntentsCreateMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // Correct second-half amount — $200 total → $100 final.
    expect(params.amount).toBe(10000);
    // Lowercased currency per Stripe's requirement, sourced from the
    // project row (Important 3 — single source of truth).
    expect(params.currency).toBe("usd");
    expect(params.customer).toBe(CUSTOMER_ID);
    expect(params.payment_method).toBe(PAYMENT_METHOD_ID);
    expect(params.off_session).toBe(true);
    expect(params.confirm).toBe(true);
    expect(params.transfer_data).toEqual({ destination: STRIPE_ACCOUNT_ID });
    expect(params.metadata).toEqual({
      projectId: PROJECT_ID,
      kind: "final",
      producerId: PRODUCER_ID,
    });
    // Idempotency key exactly as specified — lets Stripe collapse
    // double-clicks into a single charge.
    expect(options.idempotencyKey).toBe(`proj_${PROJECT_ID}_charge_2`);
  });

  it("uses the second-half charge amount for odd totals (remainder on first)", async () => {
    // $200.01 → deposit $100.01, final $100.00.
    seedHappyPath({ project: { totalAmountCents: 20001 } });
    const caller = await buildCaller();
    await caller.project.chargeFinal({ projectId: PROJECT_ID });
    const [params] = paymentIntentsCreateMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(params.amount).toBe(10000);
  });

  it("uses project.currency (not deposit-invoice currency) for the off-session PI (Important 3)", async () => {
    // The race the fix addresses: producer changes a product's currency
    // mid-engagement (or a manual intermediate invoice gets recorded
    // in a different currency). The deposit invoice and the project
    // row could disagree. Single-source-of-truth = the project row's
    // currency snapshot persisted at booking time. chargeFinal must
    // read from there.
    seedHappyPath({
      project: { currency: "EUR" },
      // Stale invoice from before the producer changed currency.
      deposit: { currency: "USD" },
    });
    const caller = await buildCaller();
    await caller.project.chargeFinal({ projectId: PROJECT_ID });
    const [params] = paymentIntentsCreateMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    // Lowercased per Stripe convention; must come from the project row.
    expect(params.currency).toBe("eur");
  });

  it("does NOT insert an invoice row (webhook writes the ledger)", async () => {
    seedHappyPath();
    const caller = await buildCaller();
    await caller.project.chargeFinal({ projectId: PROJECT_ID });
    // chargeFinal's contract: fire the PI and return. The webhook
    // (payment_intent.succeeded) is the single canonical writer of
    // the invoice row — inserting here would race the webhook and
    // the partial unique index would force one of them to fail.
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("surfaces Stripe card decline error verbatim", async () => {
    seedHappyPath();
    const declineErr = Object.assign(
      new Error("Your card was declined."),
      { type: "StripeCardError", code: "card_declined", decline_code: "insufficient_funds" },
    );
    paymentIntentsCreateMock.mockRejectedValueOnce(declineErr);

    const caller = await buildCaller();
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({
      // The raw Stripe error bubbles up — the UI surfaces its message
      // ("Your card was declined.") directly rather than wrapping it
      // in a generic "Something went wrong".
      message: "Your card was declined.",
    });
  });

  it("throws UNAUTHORIZED when caller is not signed in", async () => {
    const caller = await buildCaller(null);
    await expect(
      caller.project.chargeFinal({ projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(paymentIntentsCreateMock).not.toHaveBeenCalled();
  });
});

// ─── Task 9 — project.cancel ────────────────────────────────────────
// The cancel mutation stops future Stripe charges (monthly schedule
// only — full/split have no future-charge surface) and writes
// stage='cancelled' eagerly so the producer sees immediate feedback
// rather than waiting for the customer.subscription.deleted webhook.
describe("project.cancel", () => {
  const PROJECT_TITLE = "My album mixing project";
  const SCHEDULE_ID = "sub_sched_to_cancel";

  // Helper: most cancel tests follow the same shape — middleware
  // resolves producer ownership, then the body reads the project. This
  // keeps the test bodies focused on the override that matters.
  function seedCancel(project: Partial<Row> = {}) {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        title: PROJECT_TITLE,
        stage: "in_production",
        paymentPlanKind: "monthly",
        chargesCompleted: 2,
        chargesTotal: 6,
        stripeSubscriptionScheduleId: SCHEDULE_ID,
        ...project,
      },
    ]);
  }

  it("rejects NOT_FOUND when project doesn't belong to producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    // Empty project queue → ownership-scoped SELECT returns no rows.
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.project.cancel({
        projectId: PROJECT_ID,
        confirmTitle: PROJECT_TITLE,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(subscriptionSchedulesCancelMock).not.toHaveBeenCalled();
    expect(projectUpdateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects BAD_REQUEST when confirmTitle doesn't match", async () => {
    seedCancel();
    const caller = await buildCaller();
    await expect(
      caller.project.cancel({
        projectId: PROJECT_ID,
        confirmTitle: "Wrong title",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Confirmation title mismatch",
    });
    expect(subscriptionSchedulesCancelMock).not.toHaveBeenCalled();
    expect(projectUpdateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects BAD_REQUEST when title differs only by case", async () => {
    // Sanity check: confirmation is case-sensitive so a producer typing
    // a near-miss is forced to re-look at the project name. The server
    // mirrors the modal's exact-match guard.
    seedCancel();
    const caller = await buildCaller();
    await expect(
      caller.project.cancel({
        projectId: PROJECT_ID,
        confirmTitle: PROJECT_TITLE.toUpperCase(),
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Confirmation title mismatch",
    });
  });

  it("rejects BAD_REQUEST when project is already paid", async () => {
    seedCancel({ stage: "paid" });
    const caller = await buildCaller();
    await expect(
      caller.project.cancel({
        projectId: PROJECT_ID,
        confirmTitle: PROJECT_TITLE,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Project is already finished; cannot cancel.",
    });
    expect(subscriptionSchedulesCancelMock).not.toHaveBeenCalled();
  });

  it("rejects BAD_REQUEST when project is already archived", async () => {
    seedCancel({ stage: "archived" });
    const caller = await buildCaller();
    await expect(
      caller.project.cancel({
        projectId: PROJECT_ID,
        confirmTitle: PROJECT_TITLE,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Project is already finished; cannot cancel.",
    });
    expect(subscriptionSchedulesCancelMock).not.toHaveBeenCalled();
  });

  it("monthly: calls stripe.subscriptionSchedules.cancel with schedule id", async () => {
    seedCancel(); // monthly + schedule id present by default
    subscriptionSchedulesCancelMock.mockResolvedValue({
      id: SCHEDULE_ID,
      status: "canceled",
    });

    const caller = await buildCaller();
    const res = await caller.project.cancel({
      projectId: PROJECT_ID,
      confirmTitle: PROJECT_TITLE,
    });

    expect(res).toEqual({ ok: true });
    expect(subscriptionSchedulesCancelMock).toHaveBeenCalledTimes(1);
    expect(subscriptionSchedulesCancelMock).toHaveBeenCalledWith(SCHEDULE_ID);
    // DB write: stage flipped to 'archived'. We capture the .set()
    // payload via the spy so we can assert the exact field is touched.
    const setCalls = projectUpdateSetSpy.mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    const lastSet = setCalls[setCalls.length - 1]?.[0] as Row;
    expect(lastSet.stage).toBe("archived");
  });

  it("full plan: skips Stripe call (no schedule), still sets stage", async () => {
    seedCancel({
      paymentPlanKind: "full",
      stripeSubscriptionScheduleId: null,
      // Full was charged at checkout — chargesCompleted reflects that.
      chargesCompleted: 1,
      chargesTotal: 1,
    });
    const caller = await buildCaller();
    const res = await caller.project.cancel({
      projectId: PROJECT_ID,
      confirmTitle: PROJECT_TITLE,
    });
    expect(res).toEqual({ ok: true });
    expect(subscriptionSchedulesCancelMock).not.toHaveBeenCalled();
    const lastSet = projectUpdateSetSpy.mock.calls.at(-1)?.[0] as Row;
    expect(lastSet.stage).toBe("archived");
  });

  it("split_50_50: skips Stripe call (no schedule), still sets stage", async () => {
    seedCancel({
      paymentPlanKind: "split_50_50",
      stripeSubscriptionScheduleId: null,
      chargesCompleted: 1,
      chargesTotal: 2,
    });
    const caller = await buildCaller();
    const res = await caller.project.cancel({
      projectId: PROJECT_ID,
      confirmTitle: PROJECT_TITLE,
    });
    expect(res).toEqual({ ok: true });
    // Split's second-half is producer-triggered (chargeFinal), not on
    // a Stripe schedule — there's nothing on Stripe's side to cancel.
    expect(subscriptionSchedulesCancelMock).not.toHaveBeenCalled();
    const lastSet = projectUpdateSetSpy.mock.calls.at(-1)?.[0] as Row;
    expect(lastSet.stage).toBe("archived");
  });

  it("treats 'schedule already cancelled' as idempotent success", async () => {
    seedCancel();
    // Stripe surfaces this as an InvalidRequestError; we use the
    // message regex to identify the class.
    subscriptionSchedulesCancelMock.mockRejectedValueOnce(
      new Error(
        "This subscription schedule has already been canceled and cannot be updated.",
      ),
    );
    const caller = await buildCaller();
    const res = await caller.project.cancel({
      projectId: PROJECT_ID,
      confirmTitle: PROJECT_TITLE,
    });
    expect(res).toEqual({ ok: true });
    // The DB write still happens — our local state needs to converge
    // even if Stripe was already in the terminal state.
    const lastSet = projectUpdateSetSpy.mock.calls.at(-1)?.[0] as Row;
    expect(lastSet.stage).toBe("archived");
  });

  it("treats 'schedule already released' as idempotent success", async () => {
    seedCancel();
    subscriptionSchedulesCancelMock.mockRejectedValueOnce(
      new Error("Schedule already released."),
    );
    const caller = await buildCaller();
    await expect(
      caller.project.cancel({
        projectId: PROJECT_ID,
        confirmTitle: PROJECT_TITLE,
      }),
    ).resolves.toEqual({ ok: true });
    const lastSet = projectUpdateSetSpy.mock.calls.at(-1)?.[0] as Row;
    expect(lastSet.stage).toBe("archived");
  });

  it("surfaces unexpected Stripe errors as INTERNAL_SERVER_ERROR", async () => {
    seedCancel();
    subscriptionSchedulesCancelMock.mockRejectedValueOnce(
      new Error("Stripe API connection error"),
    );
    const caller = await buildCaller();
    await expect(
      caller.project.cancel({
        projectId: PROJECT_ID,
        confirmTitle: PROJECT_TITLE,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      // Wrap so the producer sees the underlying Stripe text.
      message: "Stripe cancel failed: Stripe API connection error",
    });
    // DB write must NOT happen on real Stripe failure — we don't want
    // local state to drift from the upstream truth (the schedule is
    // still active).
    expect(projectUpdateSetSpy).not.toHaveBeenCalled();
  });

  it("throws UNAUTHORIZED when caller is not signed in", async () => {
    const caller = await buildCaller(null);
    await expect(
      caller.project.cancel({
        projectId: PROJECT_ID,
        confirmTitle: PROJECT_TITLE,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(subscriptionSchedulesCancelMock).not.toHaveBeenCalled();
  });

  // ─── TDD-audit gap fills ──────────────────────────────────────────
  it("cancel works even when producer.stripeAccountId is null (schedule lives on platform)", async () => {
    // Design check: destination charges put the Customer + Schedule on
    // the platform, not Connect. So subscriptionSchedules.cancel is a
    // plain platform call — no { stripeAccount } header, no dependency
    // on the producer's Connect account being live. Even if a producer
    // somehow has a schedule-bearing project but nulled their Connect
    // account, the cancel must still work.
    seedCancel({ stripeSubscriptionScheduleId: SCHEDULE_ID });
    subscriptionSchedulesCancelMock.mockResolvedValue({
      id: SCHEDULE_ID,
      status: "canceled",
    });
    const caller = await buildCaller();
    const res = await caller.project.cancel({
      projectId: PROJECT_ID,
      confirmTitle: PROJECT_TITLE,
    });
    expect(res).toEqual({ ok: true });
    // The cancel mutation never reads stripeAccountId on this path —
    // the Stripe call takes just the schedule id.
    expect(subscriptionSchedulesCancelMock).toHaveBeenCalledWith(SCHEDULE_ID);
  });
});

// ─── setStage — money-handling stages must NOT be settable here ─────
//
// `cancelled` has Stripe side-effects: subscriptionSchedules.cancel must
// fire BEFORE the DB write, otherwise the schedule keeps billing the card
// even though the producer's UI says "Cancelled". The Cancel project
// button is the only correct path.
//
// `payment_paused` is webhook-driven (customer.subscription.paused after
// Smart Retries exhaust). Allowing the producer to flip it manually
// detaches Skitza state from Stripe state.
describe("project.setStage", () => {
  function seedSetStage(stage: string = "in_production") {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([
      { id: PROJECT_ID, producerId: PRODUCER_ID, stage },
    ]);
  }

  it("accepts 'in_production' (a normal Kanban stage)", async () => {
    seedSetStage();
    const caller = await buildCaller();
    const res = await caller.project.setStage({
      id: PROJECT_ID,
      stage: "in_production",
    });
    expect(res).toEqual({ ok: true });
    const lastSet = projectUpdateSetSpy.mock.calls.at(-1)?.[0] as Row;
    expect(lastSet.stage).toBe("in_production");
  });

  it("accepts 'paid' (terminal stage, no Stripe side-effect)", async () => {
    seedSetStage();
    const caller = await buildCaller();
    const res = await caller.project.setStage({
      id: PROJECT_ID,
      stage: "paid",
    });
    expect(res).toEqual({ ok: true });
    const lastSet = projectUpdateSetSpy.mock.calls.at(-1)?.[0] as Row;
    expect(lastSet.stage).toBe("paid");
  });

  it("accepts 'archived' (CRM-side flag, no Stripe)", async () => {
    seedSetStage();
    const caller = await buildCaller();
    const res = await caller.project.setStage({
      id: PROJECT_ID,
      stage: "archived",
    });
    expect(res).toEqual({ ok: true });
    const lastSet = projectUpdateSetSpy.mock.calls.at(-1)?.[0] as Row;
    expect(lastSet.stage).toBe("archived");
  });
});
