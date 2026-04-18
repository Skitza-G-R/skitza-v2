import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createDb } from "@skitza/db";

import { getStripe, STRIPE_WEBHOOK_SECRET } from "~/server/stripe/client";
import { dispatchEvent } from "./handlers";

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

  // The actual per-event logic lives in ./handlers.ts so each path can
  // be unit-tested in isolation with mocked DB + Stripe SDK. Here we
  // handle only transport concerns: signature verification (above), a
  // single try/catch that maps handler failures to 500 (Stripe retries
  // on any 5xx), and the 200 ack.
  try {
    await dispatchEvent({ db, stripe, event });
  } catch (err) {
    console.error("[stripe webhook] handler failed", event.type, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
