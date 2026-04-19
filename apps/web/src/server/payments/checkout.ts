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
  const firstCharge = charges[0];
  if (firstCharge === undefined) {
    // calculateCharges always returns a non-empty array for valid
    // inputs — throws on zero/negative totals. Belt-and-suspenders:
    // if it ever returns [] we want a loud crash, not a bogus
    // unit_amount:undefined going to Stripe.
    throw new Error("calculateCharges returned no charges");
  }

  const common: Pick<
    Stripe.Checkout.SessionCreateParams,
    "customer" | "success_url" | "cancel_url" | "metadata"
  > = {
    customer: args.customerId,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    ...(args.metadata ? { metadata: args.metadata } : {}),
  };

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
