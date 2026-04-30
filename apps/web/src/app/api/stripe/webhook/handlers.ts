import type Stripe from "stripe";
import {
  eq,
  invoices,
  producers,
  projects,
  type Db,
} from "@skitza/db";
import { advancePlanState, type PlanProjectState } from "~/server/payments/plan";

// ─── Stripe webhook handlers ──────────────────────────────────────────
// Each handler is a pure function taking `{ db, stripe, event }` so the
// route file can be a thin dispatcher and each event path is covered by
// a vitest unit test that mocks the DB + Stripe clients.
//
// Design notes:
//
// 1. Lookup order is METADATA-FIRST, then subscription-id fallback.
//    Checkout-originated events (checkout.session.completed,
//    payment_intent.succeeded) carry `metadata.projectId` pinned at
//    session-create time. Recurring monthly events (invoice.paid,
//    customer.subscription.{paused,deleted}) do NOT — we look up the
//    project by matching the subscription id against
//    `projects.stripeSubscriptionScheduleId` (the schedule's underlying
//    subscription id IS what Stripe reports on these events).
//
// 2. Idempotency. Every handler is replayed on any 5xx response. We
//    rely on three layers of safety:
//      (a) `advancePlanState` no-ops once chargesCompleted === chargesTotal,
//      (b) we guard against duplicate invoice rows by SELECTing on
//          `stripePaymentIntentId` before inserting,
//      (c) DB updates are idempotent by construction (SET field = value).
//
// 3. PlanProjectState.stage uses a narrow space ("active" / "paid" /
//    "payment_paused" / "cancelled"). The `projects.stage` pg enum is
//    wider; we translate "active" → "in_production" because that's the
//    Skitza funnel stage the "plan paid, work underway" state belongs
//    to. Other plan stages map 1:1 to enum values of the same name.
//    A project that's still in `lead` when a webhook arrives will
//    advance via this mapping.

type PgStage = typeof projects.$inferSelect.stage;

/**
 * Translate the narrow PlanProjectState.stage space into the wider
 * projects.stage pg enum. `active` is the interesting case: the plan's
 * "active" state is semantically "plan paid, work in progress", which
 * maps to the existing Skitza funnel stage `in_production`.
 */
export function planStageToProjectStage(
  stage: PlanProjectState["stage"],
): PgStage {
  switch (stage) {
    case "active":
      return "in_production";
    case "paid":
      return "paid";
    case "payment_paused":
      return "in_production";
    case "cancelled":
      return "archived";
    case "lead":
      return "lead";
  }
}

// ─── Common args for every handler ───────────────────────────────────

export type HandlerArgs<E extends Stripe.Event = Stripe.Event> = {
  db: Db;
  stripe: Stripe;
  event: E;
};

// ─── Project lookup helpers ──────────────────────────────────────────

type ProjectPlanRow = {
  id: string;
  stage: PgStage;
  chargesCompleted: number;
  chargesTotal: number | null;
  paymentPlanKind: string | null;
  stripeSubscriptionScheduleId: string | null;
};

async function loadProjectById(
  db: Db,
  projectId: string,
): Promise<ProjectPlanRow | null> {
  const [row] = await db
    .select({
      id: projects.id,
      stage: projects.stage,
      chargesCompleted: projects.chargesCompleted,
      chargesTotal: projects.chargesTotal,
      paymentPlanKind: projects.paymentPlanKind,
      stripeSubscriptionScheduleId: projects.stripeSubscriptionScheduleId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}

async function loadProjectByScheduleId(
  db: Db,
  scheduleId: string,
): Promise<ProjectPlanRow | null> {
  const [row] = await db
    .select({
      id: projects.id,
      stage: projects.stage,
      chargesCompleted: projects.chargesCompleted,
      chargesTotal: projects.chargesTotal,
      paymentPlanKind: projects.paymentPlanKind,
      stripeSubscriptionScheduleId: projects.stripeSubscriptionScheduleId,
    })
    .from(projects)
    .where(eq(projects.stripeSubscriptionScheduleId, scheduleId))
    .limit(1);
  return row ?? null;
}

/**
 * Apply advancePlanState + persist the resulting stage/chargesCompleted
 * back onto the project row. Returns the projected next state (or null
 * if the source row has no plan attached).
 */
async function advanceAndPersist(
  db: Db,
  project: ProjectPlanRow,
  event: Parameters<typeof advancePlanState>[1],
): Promise<PlanProjectState | null> {
  if (project.chargesTotal === null) {
    // No plan attached — this project was never wired up for
    // auto-installments. Skip silently rather than corrupt the stage.
    return null;
  }
  const currentStage: PlanProjectState["stage"] =
    project.stage === "in_production"
      ? "active"
      : project.stage === "paid"
        ? "paid"
        : "lead";
  const next = advancePlanState(
    {
      chargesCompleted: project.chargesCompleted,
      chargesTotal: project.chargesTotal,
      stage: currentStage,
    },
    event,
  );
  await db
    .update(projects)
    .set({
      chargesCompleted: next.chargesCompleted,
      stage: planStageToProjectStage(next.stage),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id));
  return next;
}

/**
 * Defensive idempotency check — has an invoice row already been written
 * for this payment intent? First line of defence; the second is a
 * partial unique index on `invoices.stripe_payment_intent_id` (migration
 * 0021) which guarantees at-most-one row even under the near-parallel
 * Stripe event ordering that races this SELECT with an INSERT in the
 * sibling handler.
 */
async function invoiceExistsForPaymentIntent(
  db: Db,
  paymentIntentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  return row !== undefined;
}

/**
 * Is the given error a Postgres unique-violation on the
 * `invoices_stripe_payment_intent_unique` partial index? We treat these
 * as "sibling handler already wrote this row" — log + continue, since
 * `advancePlanState` is idempotent via its counter guard.
 *
 * Matches both the wrapped-Drizzle message path and the raw pg error
 * code 23505, so any driver variance still lands as a no-op.
 */
function isInvoicePiUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes("invoices_stripe_payment_intent_unique")) return true;
  if ((err as { code?: string }).code === "23505") return true;
  return false;
}

// ─── checkout.session.completed ──────────────────────────────────────

/**
 * First Checkout completed — dispatches on `metadata.planKind`:
 *
 *  - full            : save customer + PM on project, advance to paid
 *                      (chargesTotal = 1), stamp invoice row.
 *  - split_50_50     : save customer + PM, advance to active
 *                      (chargesCompleted = 1 / chargesTotal = 2). PM is
 *                      retained for Task 7's off-session final charge.
 *  - monthly         : save customer + PM, advance to active, then
 *                      upgrade the Subscription to a SubscriptionSchedule
 *                      of N total phases (`end_behavior: cancel`) and
 *                      persist the schedule id on the project.
 *
 *  Also keeps pre-plan behavior: updates the invoice row linked by
 *  session id with `paid` status + customer_email/name.
 */
export async function handleCheckoutSessionCompleted(
  args: HandlerArgs<Stripe.CheckoutSessionCompletedEvent>,
): Promise<void> {
  const { db, stripe, event } = args;
  const session = event.data.object;

  // Always-on: mirror payment state onto the linked invoice row, keyed
  // by session id. Existed before auto-installments and still applies to
  // the legacy deposit flow.
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;
  await db
    .update(invoices)
    .set({
      status: "paid",
      paidAt: new Date(),
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      ...(session.customer_details?.email
        ? { customerEmail: session.customer_details.email }
        : {}),
      ...(session.customer_details?.name
        ? { customerName: session.customer_details.name }
        : {}),
    })
    .where(eq(invoices.stripeCheckoutSessionId, session.id));

  // Plan-aware branch: only runs for sessions we minted with a projectId
  // in metadata. Legacy deposit sessions carry no projectId and skip
  // straight to the return.
  const projectId =
    typeof session.metadata?.projectId === "string"
      ? session.metadata.projectId
      : null;
  if (!projectId) return;

  const project = await loadProjectById(db, projectId);
  if (!project) {
    // Malformed — log + ack (don't 500). Webhook shouldn't be retried
    // if the referenced project has been deleted.
    console.warn(
      "[stripe webhook] checkout.session.completed: project not found",
      projectId,
    );
    return;
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : null;
  const planKindFromMetadata =
    typeof session.metadata?.planKind === "string"
      ? session.metadata.planKind
      : project.paymentPlanKind;

  // For mode:"payment" (full + split_50_50), retrieve the PI to get
  // the saved PaymentMethod so Task 7's off-session final charge can
  // reuse it. For mode:"subscription" (monthly), PM is managed by
  // Stripe on the subscription's default_payment_method — we don't
  // need it on our row because we never off-session-charge monthly.
  let paymentMethodId: string | null = null;
  if (paymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    paymentMethodId =
      typeof pi.payment_method === "string" ? pi.payment_method : null;
  }

  // Persist customer + PM up front so that even if the subscription
  // schedule create below throws, we don't lose the identifiers we
  // already have.
  await db
    .update(projects)
    .set({
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      ...(paymentMethodId ? { stripePaymentMethodId: paymentMethodId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  // Advance the plan state: first successful charge landed. advancePlanState
  // handles idempotency — if this webhook is replayed we won't over-count.
  //
  // EXCEPTION: monthly. Stripe emits BOTH `checkout.session.completed` AND
  // `invoice.paid` (billing_reason: "subscription_create") for the very
  // first invoice of a new subscription. Counting the charge here AND in
  // handleInvoicePaid double-increments — the project flips to `paid`
  // one cycle early while Stripe still bills the final installment.
  //
  // Fix: skip the increment for monthly here; let `handleInvoicePaid` be
  // the canonical writer for ALL monthly charges, including the first.
  // For full + split_50_50 (mode:"payment"), invoice.paid never fires,
  // so this remains the only place the first charge gets counted.
  if (planKindFromMetadata !== "monthly") {
    await advanceAndPersist(db, project, { type: "charge_succeeded" });
  }

  // Monthly: upgrade the underlying Subscription into a SubscriptionSchedule
  // with exactly N total phases (`end_behavior: cancel`). Stripe creates
  // the schedule from_subscription with one phase inheriting the sub's
  // current item set; we then update that phase's `duration` to N months
  // so the schedule bills exactly N times before cancelling.
  //
  // All of this is idempotent-ish: if project.stripeSubscriptionScheduleId
  // is already set, we assume we've been here before and skip re-creation.
  if (planKindFromMetadata === "monthly" && session.mode === "subscription") {
    if (project.stripeSubscriptionScheduleId) {
      // Already upgraded — webhook replay. Nothing to do.
      return;
    }

    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : null;
    if (!subscriptionId) {
      console.warn(
        "[stripe webhook] checkout.session.completed: monthly session has no subscription id",
        session.id,
      );
      return;
    }

    const installments = Number.parseInt(
      typeof session.metadata?.installments === "string"
        ? session.metadata.installments
        : "",
      10,
    );
    if (!Number.isFinite(installments) || installments < 2) {
      console.warn(
        "[stripe webhook] checkout.session.completed: invalid installments metadata",
        session.metadata,
      );
      return;
    }

    // Create the schedule from the live subscription — Stripe clones the
    // current items into a single auto-renewing phase we'll then bound.
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: subscriptionId,
    });
    // Extract the phase's items from the newly created schedule so we
    // can echo them back on update. Stripe requires `items` on every
    // phase in an update call.
    const phase0 = schedule.phases[0];
    if (!phase0) {
      console.warn(
        "[stripe webhook] subscriptionSchedules.create returned no phases",
        schedule.id,
      );
      return;
    }
    const phaseItems = phase0.items.map((item) => ({
      price:
        typeof item.price === "string" ? item.price : item.price.id,
      ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
    }));
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "cancel",
      phases: [
        {
          items: phaseItems,
          // `iterations` isn't exposed on this SDK's Phase type — we
          // bound the phase with `duration` instead. `interval: 'month'`
          // × N ≡ N monthly charges before the cancel fires.
          duration: { interval: "month", interval_count: installments },
        },
      ],
    });

    await db
      .update(projects)
      .set({
        stripeSubscriptionScheduleId: schedule.id,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
  }
}

// ─── invoice.paid (recurring monthly installments) ───────────────────

/**
 * A recurring installment succeeded. Fires on every successful monthly
 * charge after the first (the first lands via checkout.session.completed).
 * Looks up the project by subscription id → schedule id match, advances
 * plan state, writes a new `kind: "installment"` invoice row.
 *
 * The first charge's invoice was already written by publicRequest at
 * checkout-create time, so we skip insertion if we see our own session.
 */
export async function handleInvoicePaid(
  args: HandlerArgs<Stripe.InvoicePaidEvent>,
): Promise<void> {
  const { db, event } = args;
  const invoice = event.data.object;

  // This event is only actionable for subscription-billed invoices.
  // `invoice.subscription` is set when the invoice was issued for a
  // Subscription (and NOT for ad-hoc invoices).
  const subscriptionId =
    typeof invoice.parent?.subscription_details?.subscription === "string"
      ? invoice.parent.subscription_details.subscription
      : typeof (invoice as unknown as { subscription?: unknown }).subscription ===
          "string"
        ? ((invoice as unknown as { subscription?: string }).subscription ??
          null)
        : null;
  if (!subscriptionId) return;

  // Look up project via schedule id. Stripe reports the subscription id
  // on each `invoice.paid`, but our projects table stores the SCHEDULE
  // id. For schedules created from_subscription, schedule.subscription
  // === subscriptionId — so we first attempt matching directly on
  // schedule id (legacy rows), then by retrieving the subscription's
  // schedule via Stripe. Matching by schedule id matches cleanly when
  // the schedule has the same id as the sub (they do not — schedules
  // are sub_sched_* and subs are sub_*). Our table stores sub_sched_*.
  // So we retrieve the sub to get its schedule id.
  //
  // To avoid an extra round-trip per webhook, we instead match both
  // ways: the stored id against the received sub id first (covers the
  // case where upstream migrations left a sub id on the row), and then
  // fall back to the Stripe API.
  let project = await loadProjectByScheduleId(db, subscriptionId);
  if (!project) {
    const sub = await args.stripe.subscriptions.retrieve(subscriptionId);
    const scheduleId =
      typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id ?? null;
    if (scheduleId) {
      project = await loadProjectByScheduleId(db, scheduleId);
    }
  }
  if (!project) {
    console.warn(
      "[stripe webhook] invoice.paid: no project for subscription",
      subscriptionId,
    );
    return;
  }

  const paymentIntentId =
    typeof (invoice as unknown as { payment_intent?: unknown })
      .payment_intent === "string"
      ? (invoice as unknown as { payment_intent: string }).payment_intent
      : null;

  // Idempotency — skip the insert if we've already recorded this PI.
  if (paymentIntentId && (await invoiceExistsForPaymentIntent(db, paymentIntentId))) {
    // Still advance state in case the previous webhook crashed before
    // reaching advancePlanState — the helper itself is idempotent.
    await advanceAndPersist(db, project, { type: "charge_succeeded" });
    return;
  }

  // Pull producer + currency off the project row for the invoice record.
  const [fullProject] = await db
    .select({
      producerId: projects.producerId,
      bookingId: projects.bookingId,
    })
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1);
  if (!fullProject) return; // race with project delete — noop

  try {
    await db.insert(invoices).values({
      producerId: fullProject.producerId,
      projectId: project.id,
      paymentPlanProjectId: project.id,
      ...(fullProject.bookingId ? { bookingId: fullProject.bookingId } : {}),
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      amountCents: invoice.amount_paid,
      currency: invoice.currency.toUpperCase(),
      description: "Installment payment",
      kind: "installment",
      status: "paid",
      paidAt: new Date(),
      ...(invoice.customer_email ? { customerEmail: invoice.customer_email } : {}),
      ...(invoice.customer_name ? { customerName: invoice.customer_name } : {}),
    });
  } catch (err) {
    // Race with the sibling handler already inserting this row. Unique
    // index guarantees at most one row per PI; the state advance below
    // is idempotent via advancePlanState.
    if (!isInvoicePiUniqueViolation(err)) throw err;
    console.info("[webhook] duplicate invoice row (race)", {
      stripePaymentIntentId: paymentIntentId,
    });
  }

  await advanceAndPersist(db, project, { type: "charge_succeeded" });
}

// ─── payment_intent.succeeded (off-session final for split_50_50) ────

/**
 * Ready for Task 7: when the server fires the off-session final charge
 * for a split_50_50 plan, Stripe emits a `payment_intent.succeeded`. We
 * look up the project by PI metadata, advance state, write an invoice.
 *
 * Safe to register now — Task 7 will set metadata.projectId on the PI.
 */
export async function handlePaymentIntentSucceeded(
  args: HandlerArgs<Stripe.PaymentIntentSucceededEvent>,
): Promise<void> {
  const { db, event } = args;
  const pi = event.data.object;

  // Subscription-invoiced PIs also fire invoice.paid, which is the
  // canonical writer for recurring installments. Early-return so we
  // don't race with handleInvoicePaid for the same PI. `pi.invoice` is
  // a string when the PI was created by a subscription invoice; null
  // for one-shot off-session charges (Task 7).
  if ((pi as unknown as { invoice?: unknown }).invoice) {
    return;
  }

  const projectId =
    typeof pi.metadata.projectId === "string" ? pi.metadata.projectId : null;
  if (!projectId) return; // Not one of ours — ignore.

  const project = await loadProjectById(db, projectId);
  if (!project) {
    console.warn(
      "[stripe webhook] payment_intent.succeeded: project not found",
      projectId,
    );
    return;
  }

  if (await invoiceExistsForPaymentIntent(db, pi.id)) {
    // Duplicate — still let advancePlanState run (it's idempotent).
    await advanceAndPersist(db, project, { type: "charge_succeeded" });
    return;
  }

  const [fullProject] = await db
    .select({
      producerId: projects.producerId,
      bookingId: projects.bookingId,
    })
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1);
  if (!fullProject) return;

  try {
    await db.insert(invoices).values({
      producerId: fullProject.producerId,
      projectId: project.id,
      paymentPlanProjectId: project.id,
      ...(fullProject.bookingId ? { bookingId: fullProject.bookingId } : {}),
      stripePaymentIntentId: pi.id,
      amountCents: pi.amount_received,
      currency: pi.currency.toUpperCase(),
      description:
        typeof pi.metadata.kind === "string" && pi.metadata.kind.length > 0
          ? pi.metadata.kind
          : "Final payment",
      kind:
        typeof pi.metadata.kind === "string" && pi.metadata.kind.length > 0
          ? pi.metadata.kind
          : "final",
      status: "paid",
      paidAt: new Date(),
    });
  } catch (err) {
    // Race with the sibling handler already inserting this row. Unique
    // index guarantees at most one row per PI; the state advance below
    // is idempotent via advancePlanState.
    if (!isInvoicePiUniqueViolation(err)) throw err;
    console.info("[webhook] duplicate invoice row (race)", {
      stripePaymentIntentId: pi.id,
    });
  }

  await advanceAndPersist(db, project, { type: "charge_succeeded" });
}

// ─── customer.subscription.paused ────────────────────────────────────

/**
 * Smart Retries ran out + Stripe paused the subscription. Flip the
 * project into `payment_paused`; the producer UI surfaces this and the
 * client can update their payment method to resume.
 */
export async function handleSubscriptionPaused(
  args: HandlerArgs<Stripe.CustomerSubscriptionPausedEvent>,
): Promise<void> {
  const { db, stripe, event } = args;
  const sub = event.data.object;

  let project = await loadProjectByScheduleId(db, sub.id);
  if (!project) {
    // Look up via schedule id on the sub (as with invoice.paid).
    const scheduleId =
      typeof sub.schedule === "string"
        ? sub.schedule
        : sub.schedule?.id ?? null;
    if (scheduleId) {
      project = await loadProjectByScheduleId(db, scheduleId);
    }
  }
  if (!project) return;
  void stripe; // unused here; kept in signature for symmetry + future hooks

  await advanceAndPersist(db, project, { type: "retries_exhausted" });
}

// ─── customer.subscription.deleted ───────────────────────────────────

/**
 * Schedule completed (or sub cancelled). Three branches:
 *   - chargesCompleted === chargesTotal → plan finished successfully
 *     → mark `paid` directly.
 *   - cancellation_details.reason === "payment_failed" → Stripe
 *     auto-cancelled after Smart Retries exhausted. Recoverable: we
 *     transition to `payment_paused` so the client's "Update payment
 *     method" flow can resume the plan (via a new Checkout or manual
 *     PaymentIntent on the saved customer).
 *   - otherwise → producer cancelled via the UI, or another terminal
 *     reason → mark `cancelled` (not recoverable).
 *
 * We check `cancellation_details.reason` specifically for the
 * payment_failed signal because that branch is the only one where
 * Stripe itself cancelled due to dunning — the other values (e.g.
 * "cancellation_requested", "incomplete_expired") are all producer- or
 * user-driven and correctly terminal.
 */
export async function handleSubscriptionDeleted(
  args: HandlerArgs<Stripe.CustomerSubscriptionDeletedEvent>,
): Promise<void> {
  const { db, stripe, event } = args;
  const sub = event.data.object;

  let project = await loadProjectByScheduleId(db, sub.id);
  if (!project) {
    const scheduleId =
      typeof sub.schedule === "string"
        ? sub.schedule
        : sub.schedule?.id ?? null;
    if (scheduleId) {
      project = await loadProjectByScheduleId(db, scheduleId);
    }
  }
  if (!project) return;
  void stripe;

  const complete =
    project.chargesTotal !== null &&
    project.chargesCompleted >= project.chargesTotal;
  if (complete) {
    // Belt-and-suspenders — snap to paid stage explicitly in case the
    // last invoice.paid webhook is still in flight (rare; schedule
    // cancellation fires after the final invoice settles).
    await db
      .update(projects)
      .set({ stage: "paid", updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    return;
  }

  // Stripe auto-cancelled after dunning — recoverable state. The
  // client's update-payment-method flow creates a fresh Checkout or
  // off-session PaymentIntent on the saved customer; this stage
  // gates that UI and locks new bookings without destroying history.
  if (sub.cancellation_details?.reason === "payment_failed") {
    await advanceAndPersist(db, project, { type: "retries_exhausted" });
    return;
  }

  await advanceAndPersist(db, project, { type: "cancelled" });
}

// ─── invoice.payment_failed (informational — retries may continue) ──

/**
 * A single recurring charge failed. Stripe's Smart Retries decide
 * whether to retry automatically; we leave the state alone until the
 * terminal `customer.subscription.paused` or `customer.subscription.deleted`
 * arrives. Kept as a no-op handler so replays log cleanly.
 *
 * We DO NOT count retries here — that's Stripe's job. Trying to count
 * retries client-side makes us fragile to Smart Retries configuration
 * changes in the Stripe dashboard.
 */
export function handleInvoicePaymentFailed(
  args: HandlerArgs<Stripe.InvoicePaymentFailedEvent>,
): Promise<void> {
  // Intentionally no-op — wait for Stripe to tell us with a paused /
  // deleted event. Leaving the invoice row as-is so the producer UI can
  // surface the failure via the native Stripe invoice link.
  void args;
  return Promise.resolve();
}

// ─── account.updated (Connect charges_enabled mirror) ────────────────

/**
 * Producer's Connect account state changed — mirror `charges_enabled`
 * onto the producers row so the dashboard's "charges ready" banner +
 * the public booking page's Stripe-gate both reflect reality without
 * needing a Stripe API round-trip.
 */
export async function handleAccountUpdated(
  args: HandlerArgs<Stripe.AccountUpdatedEvent>,
): Promise<void> {
  const { db, event } = args;
  const account = event.data.object;
  await db
    .update(producers)
    .set({ stripeChargesEnabled: account.charges_enabled })
    .where(eq(producers.stripeAccountId, account.id));
}

// ─── charge.refunded ─────────────────────────────────────────────────

/**
 * A charge was refunded from the Stripe dashboard (or via API). Mirror
 * the refund onto the invoice row so the ledger reflects it.
 */
export async function handleChargeRefunded(
  args: HandlerArgs<Stripe.ChargeRefundedEvent>,
): Promise<void> {
  const { db, event } = args;
  const charge = event.data.object;
  const piId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) return;
  await db
    .update(invoices)
    .set({ status: "refunded" })
    .where(eq(invoices.stripePaymentIntentId, piId));
}

// ─── Dispatch ────────────────────────────────────────────────────────

/**
 * Switch on `event.type` and dispatch to the matching handler. Unknown
 * event types are silently ack'd — Stripe stops retrying on any 200.
 * Handlers throw on unrecoverable errors; the route wraps each dispatch
 * in try/catch to return 500 (→ Stripe retries the event).
 */
export async function dispatchEvent(
  args: HandlerArgs,
): Promise<void> {
  const { event } = args;
  // Stripe's Event.type discriminated union narrows `event` to the
  // correct event variant in each case arm, so we can pass the narrowed
  // event through without further casts.
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted({ ...args, event });
      return;
    case "invoice.paid":
      await handleInvoicePaid({ ...args, event });
      return;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed({ ...args, event });
      return;
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded({ ...args, event });
      return;
    case "customer.subscription.paused":
      await handleSubscriptionPaused({ ...args, event });
      return;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted({ ...args, event });
      return;
    case "account.updated":
      await handleAccountUpdated({ ...args, event });
      return;
    case "charge.refunded":
      await handleChargeRefunded({ ...args, event });
      return;
    default:
      // Unhandled event types still get a 200 upstream — Stripe stops
      // retrying, logs stay clean, we have no work to do.
      return;
  }
}
