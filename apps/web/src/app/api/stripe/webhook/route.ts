import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createDb, eq, invoices, producers } from "@skitza/db";

import { getStripe, STRIPE_WEBHOOK_SECRET } from "~/server/stripe/client";

// Stripe signs every webhook; we MUST verify the signature against the
// raw body before trusting any field. Next.js streams JSON bodies by
// default — `req.text()` gives us the raw bytes Stripe signed.
//
// Mark dynamic so the route is never statically captured. Also opt out
// of the body parser (Edge runtimes can mangle binary payloads — we
// stick to Node).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig || !STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await req.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: "Missing DATABASE_URL" }, { status: 500 });
  }
  const db = createDb(dbUrl);

  // Switch on the event types we actually act on. Stripe will retry
  // any 5xx response — if we ever throw past this catch we'll see the
  // event again. 200 means "ack"; we don't need to handle every event
  // type to ack it.
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
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
        break;
      }
      case "account.updated": {
        const account = event.data.object;
        await db
          .update(producers)
          .set({ stripeChargesEnabled: account.charges_enabled })
          .where(eq(producers.stripeAccountId, account.id));
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object;
        const piId =
          typeof charge.payment_intent === "string" ? charge.payment_intent : null;
        if (piId) {
          await db
            .update(invoices)
            .set({ status: "refunded" })
            .where(eq(invoices.stripePaymentIntentId, piId));
        }
        break;
      }
      default:
        // Ignored event types still get a 200 — Stripe stops retrying
        // and we don't pollute logs with "unknown event" noise.
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler failed", event.type, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
