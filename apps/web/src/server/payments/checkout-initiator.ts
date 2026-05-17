import { TRPCError } from "@trpc/server";
import {
  clientContacts,
  invoices,
  projects,
  type Db,
  type PaymentPlan,
  type Product,
} from "@skitza/db";

import { emailHashFor } from "~/server/artist/identity";
import { buildCheckoutSessionParams } from "~/server/payments/checkout";
import { calculateCharges } from "~/server/payments/plan";
import { getOrCreateStripeCustomer } from "~/server/stripe/customer";
import { getSiteUrl, getStripe } from "~/server/stripe/client";
import { computeProjectSessionCount } from "~/lib/pricing";

// ─── initiatePaidPlanCheckout ────────────────────────────────────────
// Shared helper extracted from booking.publicRequest. Handles the
// plan-driven 3-shape Stripe Checkout dance:
//
//   1. Validate the selected plan is one of the product's enabled plans.
//   2. Upsert the client_contact row so the Stripe Customer key is
//      pinned.
//   3. Reuse-or-create the Stripe Customer for this (producer, client)
//      pair — saved PMs carry across future projects.
//   4. Create a project row up front in `lead` stage with the plan
//      snapshot so the webhook handler can patch it on
//      checkout.session.completed.
//   5. Build the Checkout Session params, call Stripe with an
//      idempotency key.
//   6. Record the first invoice for full + split_50_50 (monthly is
//      webhook-only — see booking.ts comment for why).
//
// Used by BOTH the public booking flow (visitor request) AND the
// signed-in artist app's Store tab (artist.store.checkout). The
// public flow additionally records a bookings row and uses
// `booking-{id}-checkout` as the idempotency key. The artist store
// flow uses `store-{clientContactId}-{productId}-checkout` so repeat
// submissions by the same artist on the same product hit Stripe's
// idempotency cache and don't duplicate sessions.
//
// Caller is responsible for:
// - Reading the product + producer rows. We take them as args so the
//   caller can run its own NOT_FOUND check with its own error message.
// - Verifying the producer has Stripe Connect enabled
//   (stripeAccountId + stripeChargesEnabled).
// - Linking the session back to any caller-side rows (booking id,
//   etc.) via the `metadata` arg.
//
// Throws:
// - TRPCError(BAD_REQUEST) if the selected plan isn't offered.
// - TRPCError(INTERNAL_SERVER_ERROR) if any required row insert comes
//   back empty (shouldn't happen under normal operation).
export async function initiatePaidPlanCheckout(args: {
  db: Db;
  producer: {
    id: string;
    slug: string;
    stripeAccountId: string;
  };
  product: Pick<
    Product,
    | "id"
    | "name"
    | "currency"
    | "paymentPlans"
    | "priceCents"
    | "pricingModel"
    | "volumeTiers"
    | "hourlyRateCents"
    | "sessionCount"
  >;
  paymentPlan: PaymentPlan;
  clientName: string;
  clientEmail: string;
  bookingId?: string;
  idempotencyKey: string;
  priceCents: number;
  metadata?: Record<string, string>;
  successUrl?: string;
  cancelUrl?: string;
  // Per-song pricing — denormalised onto the project row so the
  // producer dashboard can render "× N songs" without re-running
  // tier math. Both null when omitted (flat-price flow).
  songQty?: number;
  unitPriceCents?: number;
}): Promise<{
  checkoutUrl: string | null;
  sessionId: string;
  projectId: string;
  clientContactId: string;
  stripeCustomerId: string;
}> {
  // 1. Plan validation — the selected plan must actually be one of the
  //    product's offered plans. Otherwise a determined caller could POST
  //    any plan and bypass the producer's configured options.
  const offered = args.product.paymentPlans;
  const chosen = args.paymentPlan;
  const ok = offered.some((p) => {
    if (p.kind !== chosen.kind) return false;
    if (p.kind === "monthly" && chosen.kind === "monthly") {
      return p.installments === chosen.installments;
    }
    return true;
  });
  if (!ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That payment plan isn't offered on this product.",
    });
  }

  const plan: PaymentPlan = chosen;
  const charges = calculateCharges(plan, args.priceCents);
  const firstCharge = charges[0];
  if (firstCharge === undefined) {
    // calculateCharges always returns a non-empty array for the inputs
    // we reach here with — this can't happen unless the helper is
    // broken, in which case fail loud rather than send Stripe a bogus
    // session.
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }

  // 2. Upsert client_contact so we can key the Stripe Customer on its
  //    id. recordContact does the same upsert for the generic contacts
  //    cache; here we need the row's id, so we run an explicit
  //    insert/select.
  const lowerEmail = args.clientEmail.trim().toLowerCase();
  const emailHash = emailHashFor(args.clientEmail);
  const now = new Date();
  const inserted = await args.db
    .insert(clientContacts)
    .values({
      producerId: args.producer.id,
      emailHash,
      email: lowerEmail,
      name: args.clientName.trim(),
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [clientContacts.producerId, clientContacts.emailHash],
      set: { name: args.clientName.trim(), lastSeenAt: now },
    })
    .returning({ id: clientContacts.id });
  const clientContactId = inserted[0]?.id;
  if (!clientContactId) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }

  // 3. Stripe Customer — reuse-or-create for this (producer, client) pair.
  const customerId = await getOrCreateStripeCustomer({
    db: args.db,
    producerId: args.producer.id,
    clientContactId,
    clientEmail: lowerEmail,
    clientName: args.clientName.trim(),
  });

  // 4. Project row up front (stage=`lead`). Snapshot plan + total +
  //    currency so post-checkout surfaces (chargeFinal, page.tsx modal)
  //    read the same values the Stripe session was created with.
  const [projectRow] = await args.db
    .insert(projects)
    .values({
      producerId: args.producer.id,
      ...(args.bookingId ? { bookingId: args.bookingId } : {}),
      title: args.product.name,
      artistName: args.clientName,
      artistEmail: lowerEmail,
      clientName: args.clientName,
      clientEmail: lowerEmail,
      paymentPlanKind: plan.kind,
      installments: plan.kind === "monthly" ? plan.installments : null,
      chargesTotal: charges.length,
      totalAmountCents: args.priceCents,
      currency: args.product.currency,
      stripeCustomerId: customerId,
      // Per-song denormalisation — null on flat checkouts.
      songQty: args.songQty ?? null,
      unitPriceCents: args.unitPriceCents ?? null,
      // Session credit pool: flat → product.sessionCount as-is;
      // per_song → product.sessionCount * songQty. 0 stays 0
      // (unlimited). Helper handles both branches.
      sessionCount: computeProjectSessionCount(args.product, args.songQty),
    })
    .returning();
  if (!projectRow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

  // 5. Stripe Checkout session on the platform account. transfer_data
  //    in the session params routes funds to the producer's Connect
  //    account. idempotencyKey is caller-provided so repeat submissions
  //    by the same caller+target dedupe on Stripe's side.
  const base = getSiteUrl();
  // Post-Story-03 (PRD §6.6): the legacy `/p/<slug>/book` URLs are
  // gone. Default checkout return URLs funnel back through the new
  // `/join/<slug>` surface — callers that need a different landing
  // (e.g. the artist-store flow which sends back into `/artist`)
  // continue to override via `args.successUrl` / `args.cancelUrl`.
  const successUrl =
    args.successUrl ??
    `${base}/join/${args.producer.slug}?session_id={CHECKOUT_SESSION_ID}&booked=1`;
  const cancelUrl =
    args.cancelUrl ?? `${base}/join/${args.producer.slug}?cancelled=1`;

  const sessionMetadata: Record<string, string> = {
    ...(args.metadata ?? {}),
    producerId: args.producer.id,
    projectId: projectRow.id,
    planKind: plan.kind,
  };

  const params = buildCheckoutSessionParams({
    plan,
    productName: args.product.name,
    currency: args.product.currency.toLowerCase(),
    totalCents: args.priceCents,
    customerId,
    destinationAccountId: args.producer.stripeAccountId,
    successUrl,
    cancelUrl,
    metadata: sessionMetadata,
  });
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create(params, {
    idempotencyKey: args.idempotencyKey,
  });

  // 6. Record the first invoice for full + split_50_50. SKIP for
  //    monthly — subscription-mode sessions have session.payment_intent
  //    === null at completion time, so the webhook can't link a
  //    booking-time row to the PI. handleInvoicePaid (sole writer for
  //    monthly) inserts the canonical row on first charge.
  if (plan.kind !== "monthly") {
    const invoiceKind = plan.kind === "full" ? "full" : "deposit";
    await args.db.insert(invoices).values({
      producerId: args.producer.id,
      ...(args.bookingId ? { bookingId: args.bookingId } : {}),
      projectId: projectRow.id,
      paymentPlanProjectId: projectRow.id,
      stripeCheckoutSessionId: session.id,
      amountCents: firstCharge,
      currency: args.product.currency,
      description: `${args.product.name} — ${invoiceKind}`,
      kind: invoiceKind,
      status: "sent",
      customerEmail: lowerEmail,
      customerName: args.clientName,
    });
  }

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    projectId: projectRow.id,
    clientContactId,
    stripeCustomerId: customerId,
  };
}
