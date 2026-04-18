import { and, eq, stripeCustomers } from "@skitza/db";
import type { createDb } from "@skitza/db";
import { getStripe } from "./client";

type DB = ReturnType<typeof createDb>;

// Looks up the Stripe Customer id for this (producer, client) pair.
// Creates one lazily on the producer's Connect account if it doesn't
// exist. The composite PK on stripe_customers guarantees one row per
// pair; `onConflictDoNothing` + re-select handles concurrent first-
// payments gracefully (one Stripe Customer orphans on the Connect
// account — bounded cost, no correctness impact).
//
// Customer is created on the producer's Connect account — NOT the
// platform account — because saved PaymentMethods are scoped to the
// account they live on. Off-session charges later will go through
// that account too.
//
// Partial-failure note: if Stripe create succeeds but the DB insert
// hits a network error (not conflict), the Customer is orphaned on
// the Connect account. Caller retry will create a fresh one. Bounded
// cost, no correctness impact — do NOT "fix" with a DB-first
// approach, which is strictly worse.
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

  // Attempt insert — on composite-PK conflict the winner's row wins
  // and our Stripe customer.id gets orphaned on the producer's account
  // (acceptable: Stripe Customers are cheap; this only happens on true
  // concurrent first-payments — two tabs, one click each).
  const inserted = await args.db
    .insert(stripeCustomers)
    .values({
      producerId: args.producerId,
      clientContactId: args.clientContactId,
      stripeCustomerId: customer.id,
    })
    .onConflictDoNothing()
    .returning({ stripeCustomerId: stripeCustomers.stripeCustomerId });

  if (inserted[0]) {
    return inserted[0].stripeCustomerId;
  }

  // Lost the race — winner inserted the row first. Re-read to get the
  // winner's stripeCustomerId so the caller attaches PaymentMethods +
  // off-session charges to the single surviving Customer.
  const winner = await args.db
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(
      and(
        eq(stripeCustomers.producerId, args.producerId),
        eq(stripeCustomers.clientContactId, args.clientContactId),
      ),
    )
    .limit(1);
  if (!winner[0]) {
    // Unreachable under normal operation — we just lost a race on this
    // exact key, so the row MUST exist. If it doesn't, Postgres is in
    // an inconsistent state; fail loud rather than returning a stale id.
    throw new Error("stripeCustomers winner row missing after insert race");
  }
  return winner[0].stripeCustomerId;
}
