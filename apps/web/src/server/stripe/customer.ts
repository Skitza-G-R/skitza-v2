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
