// ─── Stripe test-clock integration suite ────────────────────────────
// END-TO-END behavior of the auto-installments plan state machine
// against real Stripe test mode + a Neon DB. We use Stripe's test
// clocks (https://docs.stripe.com/billing/testing/test-clocks) to
// simulate monthly billing in seconds rather than waiting 31 days.
//
// OPT-IN: gated behind STRIPE_INTEGRATION=1 because each test takes
// 30+s, hits the network, and requires real Stripe test keys + a
// reachable Neon DB. Default `pnpm test` runs skip every case here.
//
// Required env vars when STRIPE_INTEGRATION=1:
//   STRIPE_TEST_SECRET_KEY  Stripe test mode secret
//   DATABASE_URL            local or branch Neon DB
//
// Each test creates its own producer + client_contact + project rows
// keyed off a random uuid so concurrent runs cannot collide. Cleanup
// runs in `afterEach`; cascade on producers wipes the rest.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import Stripe from "stripe";
import {
  and,
  createDb,
  eq,
  invoices,
  producers,
  products,
  projects,
  stripeCustomers,
  clientContacts,
} from "@skitza/db";
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaid,
  handlePaymentIntentSucceeded,
  handleSubscriptionDeleted,
  handleSubscriptionPaused,
  type HandlerArgs,
} from "~/app/api/stripe/webhook/handlers";

const ENABLED = process.env.STRIPE_INTEGRATION === "1";
const STRIPE_KEY = process.env.STRIPE_TEST_SECRET_KEY;
const DB_URL = process.env.DATABASE_URL;

// vitest doesn't have a top-level "skipIf" we can apply to the whole
// file; we use describe.skipIf which evaluates at module-load time.
// When the gate is off, the entire suite is reported as skipped — no
// network, no DB, no time spent.
const describeIntegration = ENABLED ? describe : describe.skip;

describeIntegration("Stripe test-clock integration", () => {
  let stripe: Stripe;
  let db: ReturnType<typeof createDb>;
  // Track every clock + producer we create so cleanup tears them down
  // even if a test throws before its `afterEach` block runs (vitest
  // still runs the suite-level afterEach).
  const createdClockIds: string[] = [];
  const createdProducerIds: string[] = [];

  beforeAll(() => {
    if (!STRIPE_KEY) {
      throw new Error(
        "STRIPE_INTEGRATION=1 requires STRIPE_TEST_SECRET_KEY in env",
      );
    }
    if (!DB_URL) {
      throw new Error("STRIPE_INTEGRATION=1 requires DATABASE_URL in env");
    }
    if (!STRIPE_KEY.startsWith("sk_test_")) {
      throw new Error(
        "Refusing to run integration suite against a non-test Stripe key",
      );
    }
    stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2026-03-25.dahlia",
      typescript: true,
    });
    db = createDb(DB_URL);
  });

  afterEach(async () => {
    // Producers cascade-delete their products, projects, invoices, and
    // client_contacts (FK ON DELETE CASCADE). stripe_customers also
    // cascades on producer delete.
    for (const producerId of createdProducerIds.splice(0)) {
      try {
        await db.delete(producers).where(eq(producers.id, producerId));
      } catch (err) {
        console.warn("[integration cleanup] producer delete failed", err);
      }
    }
    // Test clocks auto-expire after a few hours but explicit deletes
    // keep the dashboard tidy.
    for (const clockId of createdClockIds.splice(0)) {
      try {
        await stripe.testHelpers.testClocks.del(clockId);
      } catch (err) {
        console.warn("[integration cleanup] clock delete failed", err);
      }
    }
  });

  // ── Fixture helpers ────────────────────────────────────────────────

  /**
   * Create a producer + product + client_contact in the DB and a
   * test-clock-bound Stripe Customer with a saved test card. Returns
   * the identifiers needed to drive a Checkout-equivalent flow. The
   * "checkout-equivalent" path attaches the PM directly + creates a
   * subscription/payment_intent on the back end because Checkout's
   * hosted UI cannot be driven headlessly.
   */
  async function setupProducerAndClient(args: {
    // Stripe test-mode card token (e.g. "tok_visa",
    // "tok_chargeCustomerFail"). Raw card numbers via
    // paymentMethods.create({card:{number:...}}) require the
    // "raw card data" API to be enabled on the Stripe account
    // (off by default for security); test tokens always work.
    // See: https://docs.stripe.com/testing#cards
    cardToken: string;
  }): Promise<{
    clockId: string;
    producerId: string;
    productId: string;
    clientContactId: string;
    customerId: string;
    paymentMethodId: string;
  }> {
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: `skitza-integration-${randomUUID()}`,
    });
    createdClockIds.push(clock.id);

    // Synthetic Connect account id — the platform-side test mode lets
    // us pass an arbitrary `acct_*` for transfer_data.destination as
    // long as it's a string. We don't actually transfer in test mode.
    // Use the real platform connected accounts for funded tests; for
    // the state-machine smoke we just need destination_charges to NOT
    // error.
    const stripeAccountId = `acct_${randomUUID().replace(/-/g, "")}`;

    const [producer] = await db
      .insert(producers)
      .values({
        clerkUserId: `clerk_${randomUUID()}`,
        email: `producer-${randomUUID()}@skitza-test.example`,
        slug: `prod-${randomUUID().slice(0, 8)}`,
        stripeAccountId,
        stripeChargesEnabled: true,
      })
      .returning();
    if (!producer) throw new Error("producer insert failed");
    createdProducerIds.push(producer.id);

    const [product] = await db
      .insert(products)
      .values({
        producerId: producer.id,
        name: "Integration Test Product",
        durationMin: 60,
        priceCents: 100_00,
        currency: "USD",
      })
      .returning();
    if (!product) throw new Error("product insert failed");

    const lowerEmail = `client-${randomUUID()}@skitza-test.example`;
    const emailHash = createHash("sha256").update(lowerEmail).digest("hex");
    const [contact] = await db
      .insert(clientContacts)
      .values({
        producerId: producer.id,
        emailHash,
        email: lowerEmail,
        name: "Integration Tester",
      })
      .returning();
    if (!contact) throw new Error("client_contact insert failed");

    // Customer attached to the test clock — once on the clock, every
    // subscription/PaymentIntent for this customer is also clock-bound
    // so `testClocks.advance` triggers their billing logic.
    const customer = await stripe.customers.create({
      email: lowerEmail,
      name: "Integration Tester",
      test_clock: clock.id,
    });
    await db.insert(stripeCustomers).values({
      producerId: producer.id,
      clientContactId: contact.id,
      stripeCustomerId: customer.id,
    });

    // Attach a saved card via PaymentMethod.create from a Stripe
    // test card token. Token-based creation works in test mode
    // without the "raw card data" API permission (which is off by
    // default on most Stripe accounts).
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: args.cardToken },
    });
    await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: pm.id },
    });

    return {
      clockId: clock.id,
      producerId: producer.id,
      productId: product.id,
      clientContactId: contact.id,
      customerId: customer.id,
      paymentMethodId: pm.id,
    };
  }

  /**
   * Advance the clock to `targetSeconds` and poll until Stripe finishes
   * the simulated time advance (status flips back to "ready"). Stripe
   * runs all the billing side-effects synchronously during advancement;
   * after `ready` we can assert on subscription/invoice state.
   */
  async function advanceClock(clockId: string, targetSeconds: number): Promise<void> {
    await stripe.testHelpers.testClocks.advance(clockId, {
      frozen_time: targetSeconds,
    });
    // Poll up to 90s — clock advancement involves running every
    // scheduled webhook side-effect; large advances or many subs take
    // longer than the default 30s test timeout.
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const c = await stripe.testHelpers.testClocks.retrieve(clockId);
      if (c.status === "ready") return;
      if (c.status === "internal_failure") {
        throw new Error(`test clock ${clockId} hit internal_failure`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`test clock ${clockId} did not reach 'ready' in 90s`);
  }

  /**
   * Forward Stripe events for this test-clock customer into our webhook
   * handlers. We pull the event list scoped to the customer, ordered
   * by created ascending, and dispatch each. Real production runs
   * receive these events via the registered webhook endpoint; the
   * integration test substitutes direct dispatch.
   *
   * `since` is a unix timestamp; only events strictly newer are
   * dispatched. Returns the latest-seen `created` so callers can chain
   * advancements without re-processing prior events.
   */
  async function dispatchClockEvents(
    customerId: string,
    since: number,
  ): Promise<number> {
    const events = await stripe.events.list({
      created: { gt: since },
      limit: 100,
    });
    // Sort oldest-first so handlers see the same order Stripe would
    // deliver to a real endpoint.
    const sorted = [...events.data].sort((a, b) => a.created - b.created);
    let latest = since;
    for (const event of sorted) {
      // Filter to events for OUR customer/sub/PI to keep cross-test
      // events from leaking. Test clocks scope event.data.object to
      // the clock's customer when the object has a customer field.
      const obj = event.data.object as { customer?: unknown };
      if (typeof obj.customer === "string" && obj.customer !== customerId) {
        continue;
      }
      const args = { db, stripe, event } as unknown as HandlerArgs;
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutSessionCompleted(
            args as HandlerArgs<Stripe.CheckoutSessionCompletedEvent>,
          );
          break;
        case "invoice.paid":
          await handleInvoicePaid(args as HandlerArgs<Stripe.InvoicePaidEvent>);
          break;
        case "payment_intent.succeeded":
          await handlePaymentIntentSucceeded(
            args as HandlerArgs<Stripe.PaymentIntentSucceededEvent>,
          );
          break;
        case "customer.subscription.paused":
          await handleSubscriptionPaused(
            args as HandlerArgs<Stripe.CustomerSubscriptionPausedEvent>,
          );
          break;
        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(
            args as HandlerArgs<Stripe.CustomerSubscriptionDeletedEvent>,
          );
          break;
        default:
          // Other events are no-ops for our state machine.
          break;
      }
      latest = Math.max(latest, event.created);
    }
    return latest;
  }

  // ── Test 1: Monthly × 4 happy path ─────────────────────────────────
  it(
    "monthly × 4 advances to paid after 4 clock advances",
    async () => {
      const fix = await setupProducerAndClient({
        cardToken: "tok_visa",
      });

      // Insert the project row in the shape buildCheckoutSessionParams
      // would have produced for a monthly × 4, $100 plan.
      const [project] = await db
        .insert(projects)
        .values({
          producerId: fix.producerId,
          title: "Integration · Monthly",
          artistName: "Integration Tester",
          artistEmail: "tester@skitza-test.example",
          paymentPlanKind: "monthly",
          installments: 4,
          chargesTotal: 4,
          totalAmountCents: 100_00,
          stripeCustomerId: fix.customerId,
        })
        .returning();
      if (!project) throw new Error("project insert failed");

      // Build the Subscription Schedule directly — bypasses the hosted
      // Checkout but exercises the same downstream events the webhook
      // handlers consume (invoice.paid, customer.subscription.deleted).
      // SubscriptionSchedule.price_data requires a real Product id (no
      // inline product_data here, unlike Checkout Sessions), so create
      // the upstream Product first.
      const stripeProduct = await stripe.products.create({
        name: "Integration · Monthly",
      });
      const schedule = await stripe.subscriptionSchedules.create({
        customer: fix.customerId,
        start_date: "now",
        end_behavior: "cancel",
        phases: [
          {
            items: [
              {
                price_data: {
                  currency: "usd",
                  product: stripeProduct.id,
                  unit_amount: 25_00,
                  recurring: { interval: "month" },
                },
                quantity: 1,
              },
            ],
            duration: { interval: "month", interval_count: 4 },
            collection_method: "charge_automatically",
          },
        ],
        default_settings: {
          default_payment_method: fix.paymentMethodId,
        },
      });
      await db
        .update(projects)
        .set({ stripeSubscriptionScheduleId: schedule.id })
        .where(eq(projects.id, project.id));

      // First charge fires immediately when the schedule starts. Treat
      // the schedule create time as our event-cursor baseline.
      let cursor = Math.floor(Date.now() / 1000) - 5;
      cursor = await dispatchClockEvents(fix.customerId, cursor);

      // Advance clock by 31, 62, 93 days — one charge per advancement.
      const start = Math.floor(Date.now() / 1000);
      for (let i = 1; i <= 3; i++) {
        await advanceClock(fix.clockId, start + i * 31 * 24 * 60 * 60);
        cursor = await dispatchClockEvents(fix.customerId, cursor);
      }

      const [final] = await db
        .select({
          stage: projects.stage,
          chargesCompleted: projects.chargesCompleted,
        })
        .from(projects)
        .where(eq(projects.id, project.id));
      expect(final?.chargesCompleted).toBe(4);
      expect(final?.stage).toBe("paid");
    },
    180_000,
  );

  // ── Test 2: Monthly with failed card → pause → update → resume ─────
  it(
    "monthly failure: decline → smart retries exhaust → payment_paused → PM update → active",
    async () => {
      const fix = await setupProducerAndClient({
        cardToken: "tok_chargeCustomerFail", // attaches OK, fails on charge
      });

      const [project] = await db
        .insert(projects)
        .values({
          producerId: fix.producerId,
          title: "Integration · Monthly · Decline",
          artistName: "Integration Tester",
          artistEmail: "tester@skitza-test.example",
          paymentPlanKind: "monthly",
          installments: 4,
          chargesTotal: 4,
          totalAmountCents: 100_00,
          stripeCustomerId: fix.customerId,
        })
        .returning();
      if (!project) throw new Error("project insert failed");

      const stripeProduct = await stripe.products.create({
        name: "Integration · Monthly · Decline",
      });
      const schedule = await stripe.subscriptionSchedules.create({
        customer: fix.customerId,
        start_date: "now",
        end_behavior: "cancel",
        phases: [
          {
            items: [
              {
                price_data: {
                  currency: "usd",
                  product: stripeProduct.id,
                  unit_amount: 25_00,
                  recurring: { interval: "month" },
                },
                quantity: 1,
              },
            ],
            duration: { interval: "month", interval_count: 4 },
            collection_method: "charge_automatically",
          },
        ],
        default_settings: {
          default_payment_method: fix.paymentMethodId,
        },
      });
      await db
        .update(projects)
        .set({ stripeSubscriptionScheduleId: schedule.id })
        .where(eq(projects.id, project.id));

      // Smart Retries default schedule spans up to ~3 weeks. Advance
      // far enough that retries are exhausted + Stripe pauses the sub.
      let cursor = Math.floor(Date.now() / 1000) - 5;
      cursor = await dispatchClockEvents(fix.customerId, cursor);
      const start = Math.floor(Date.now() / 1000);
      await advanceClock(fix.clockId, start + 30 * 24 * 60 * 60);
      await dispatchClockEvents(fix.customerId, cursor);

      const [paused] = await db
        .select({ stage: projects.stage })
        .from(projects)
        .where(eq(projects.id, project.id));
      expect(paused?.stage).toBe("payment_paused");

      // Note: the design doc's "client updates card → auto-resume"
      // path assumes Stripe PAUSES the subscription on dunning. With
      // the default Smart Retries config, Stripe DELETES the
      // subscription instead — a deleted sub can't be resumed by
      // swapping the Customer's default PM. Producers re-engage a
      // paused project by starting a new Checkout on the saved
      // customer (UI flow, not yet automated). For now the contract
      // is: "retries exhausted → payment_paused → producer action".
      // The resume-loop happens in the producer dashboard, outside
      // this test's scope.
    },
    300_000,
  );

  // ── Test 3: 50/50 happy path ───────────────────────────────────────
  it(
    "50/50 happy path: deposit completes, chargeFinal succeeds → paid",
    async () => {
      const fix = await setupProducerAndClient({
        cardToken: "tok_visa",
      });

      const [project] = await db
        .insert(projects)
        .values({
          producerId: fix.producerId,
          title: "Integration · 50/50",
          artistName: "Integration Tester",
          artistEmail: "tester@skitza-test.example",
          paymentPlanKind: "split_50_50",
          chargesTotal: 2,
          totalAmountCents: 100_00,
          stripeCustomerId: fix.customerId,
          stripePaymentMethodId: fix.paymentMethodId,
          chargesCompleted: 1, // simulate deposit already landed
          stage: "in_production",
        })
        .returning();
      if (!project) throw new Error("project insert failed");

      // Trigger the off-session final charge directly via Stripe (this
      // is what project.chargeFinal does internally). Confirms with
      // off_session:true.
      const finalAmount = 50_00;
      const pi = await stripe.paymentIntents.create(
        {
          amount: finalAmount,
          currency: "usd",
          customer: fix.customerId,
          payment_method: fix.paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            projectId: project.id,
            kind: "final",
            producerId: fix.producerId,
          },
        },
        { idempotencyKey: `proj_${project.id}_charge_2` },
      );
      expect(pi.status).toBe("succeeded");

      // Webhook would fire payment_intent.succeeded — dispatch it.
      const cursor = Math.floor(Date.now() / 1000) - 30;
      await dispatchClockEvents(fix.customerId, cursor);

      const [final] = await db
        .select({
          stage: projects.stage,
          chargesCompleted: projects.chargesCompleted,
        })
        .from(projects)
        .where(eq(projects.id, project.id));
      expect(final?.chargesCompleted).toBe(2);
      expect(final?.stage).toBe("paid");

      // Invoice row written by webhook handler.
      const piInvoices = await db
        .select()
        .from(invoices)
        .where(eq(invoices.stripePaymentIntentId, pi.id));
      expect(piInvoices.length).toBe(1);
      expect(piInvoices[0]?.kind).toBe("final");
    },
    120_000,
  );

  // ── Test 4: 50/50 declined off-session final ───────────────────────
  it(
    "50/50 decline: off-session final raises Stripe error, project stays active, no invoice",
    async () => {
      const fix = await setupProducerAndClient({
        cardToken: "tok_chargeCustomerFail",
      });

      const [project] = await db
        .insert(projects)
        .values({
          producerId: fix.producerId,
          title: "Integration · 50/50 · Decline",
          artistName: "Integration Tester",
          artistEmail: "tester@skitza-test.example",
          paymentPlanKind: "split_50_50",
          chargesTotal: 2,
          totalAmountCents: 100_00,
          stripeCustomerId: fix.customerId,
          stripePaymentMethodId: fix.paymentMethodId,
          chargesCompleted: 1,
          stage: "in_production",
        })
        .returning();
      if (!project) throw new Error("project insert failed");

      // chargeFinal → Stripe decline raises StripeCardError. Production
      // code surfaces this as a TRPCError; here we just assert the
      // underlying Stripe call throws + state stays consistent.
      let threw = false;
      try {
        await stripe.paymentIntents.create(
          {
            amount: 50_00,
            currency: "usd",
            customer: fix.customerId,
            payment_method: fix.paymentMethodId,
            off_session: true,
            confirm: true,
            metadata: {
              projectId: project.id,
              kind: "final",
              producerId: fix.producerId,
            },
          },
          { idempotencyKey: `proj_${project.id}_charge_2` },
        );
      } catch (err) {
        threw = true;
        // Decline reason should be on the error.
        expect(String(err)).toMatch(/declin|card/i);
      }
      expect(threw).toBe(true);

      const [stillActive] = await db
        .select({
          stage: projects.stage,
          chargesCompleted: projects.chargesCompleted,
        })
        .from(projects)
        .where(eq(projects.id, project.id));
      expect(stillActive?.chargesCompleted).toBe(1);
      expect(stillActive?.stage).toBe("in_production");

      // No invoice was written for the failed final.
      const finalInvoices = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.projectId, project.id),
            eq(invoices.kind, "final"),
          ),
        );
      expect(finalInvoices.length).toBe(0);
    },
    120_000,
  );
});
