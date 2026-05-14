import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  and,
  bookings,
  desc,
  eq,
  invoices,
  isNull,
  producers,
  products,
} from "@skitza/db";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { calculatePriceCents } from "./booking";
import { getSiteUrl, getStripe } from "~/server/stripe/client";

// Phase H.5 — Stripe Connect onboarding + Checkout sessions + invoice
// listing. The router is intentionally thin: every external call goes
// through `getStripe()` which throws a friendly error if the key is
// missing. Producers onboard via Stripe Connect Express; we record
// the account id on `producers.stripeAccountId` and the verified
// `chargesEnabled` flag separately so an in-flight onboarding doesn't
// look "ready" to the public booking flow.
//
// Pricing model for MVP: destination charges with **no platform fee**.
// We could later add `application_fee_amount` here when Skitza wants
// a cut. Until then producers keep 100% minus Stripe's standard fees
// (2.9% + 30¢).
export const stripeRouter = router({
  // Returns a redirect URL the producer's browser should follow to
  // start (or resume) Stripe's hosted onboarding. Idempotent: if an
  // account already exists we reuse it; otherwise we create a new
  // Express account, persist its id, and then mint the link.
  createOnboardingLink: producerProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    const [producer] = await ctx.db
      .select()
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!producer) throw new TRPCError({ code: "NOT_FOUND" });

    let accountId = producer.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: producer.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          // 7929 = "musical entertainers" — the closest MCC for
          // independent producers. Stripe uses this for fraud heuristics
          // and dashboard categorisation.
          mcc: "7929",
          // Stripe Connect business profile URL. This is the public
          // URL Stripe shows in compliance/review dashboards as the
          // merchant's website. Post-Story-03 we point it at the new
          // `/join/<slug>` surface — it's the canonical artist-facing
          // URL for the producer, replacing the removed `/p/<slug>`.
          url: `${getSiteUrl()}/join/${producer.slug}`,
        },
      });
      accountId = account.id;
      await ctx.db
        .update(producers)
        .set({ stripeAccountId: accountId })
        .where(eq(producers.id, producer.id));
    }

    const base = getSiteUrl();
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${base}/dashboard/settings?stripe=refresh`,
      return_url: `${base}/dashboard/settings?stripe=return`,
      type: "account_onboarding",
    });
    return { url: link.url, accountId };
  }),

  // Pull the canonical `charges_enabled` flag from Stripe and persist
  // it. Called from the settings page after a producer returns from
  // Stripe's hosted flow (`?stripe=return`). The webhook
  // `account.updated` does the same thing in the background — this
  // mutation is the foreground race so the page reflects reality on
  // first paint.
  refreshAccount: producerProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    const [producer] = await ctx.db
      .select()
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!producer?.stripeAccountId) {
      return { chargesEnabled: false, accountId: null };
    }
    const acct = await stripe.accounts.retrieve(producer.stripeAccountId);
    await ctx.db
      .update(producers)
      .set({ stripeChargesEnabled: acct.charges_enabled })
      .where(eq(producers.id, producer.id));
    return {
      chargesEnabled: acct.charges_enabled,
      accountId: producer.stripeAccountId,
    };
  }),

  // Produces a one-shot login link to the producer's Stripe Express
  // dashboard. Producers click this from settings to manage payouts,
  // refunds, dispute responses, etc. Returns null if they haven't
  // onboarded yet.
  createDashboardLink: producerProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    const [producer] = await ctx.db
      .select({ stripeAccountId: producers.stripeAccountId })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!producer?.stripeAccountId) return { url: null };
    const link = await stripe.accounts.createLoginLink(producer.stripeAccountId);
    return { url: link.url };
  }),

  // Dashboard /dashboard/invoices reads from here. Producer-scoped,
  // newest first.
  listInvoices: producerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.producerId, ctx.producerId))
      .orderBy(desc(invoices.createdAt));
  }),

  // Producer-initiated Checkout — used when a producer wants to
  // request payment for a product against an existing booking
  // (typically a final payment after the deposit was paid via the
  // public flow). The visitor receives the URL out-of-band (we email
  // it in a later phase). Validates product + booking ownership,
  // computes price, and persists a draft invoice row pre-webhook.
  createCheckout: producerProcedure
    .input(
      z.object({
        bookingId: z.string().uuid().optional(),
        productId: z.string().uuid(),
        quantity: z.number().int().positive().optional(),
        hours: z.number().positive().optional(),
        customerEmail: z.string().email(),
        customerName: z.string().min(1),
        kind: z.enum(["deposit", "final", "milestone", "full"]).default("deposit"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const [producer] = await ctx.db
        .select()
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      if (!producer) throw new TRPCError({ code: "NOT_FOUND" });
      if (!producer.stripeAccountId || !producer.stripeChargesEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Connect Stripe before accepting payments.",
        });
      }

      const [product] = await ctx.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.producerId, ctx.producerId),
            isNull(products.archivedAt),
          ),
        )
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      // Optional booking ownership check.
      if (input.bookingId) {
        const [b] = await ctx.db
          .select({ id: bookings.id, producerId: bookings.producerId })
          .from(bookings)
          .where(eq(bookings.id, input.bookingId))
          .limit(1);
        if (!b || b.producerId !== ctx.producerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
      }

      const fullPriceCents = calculatePriceCents(product, {
        ...(input.quantity ? { quantity: input.quantity } : {}),
        ...(input.hours ? { hours: input.hours } : {}),
      });
      // Deposits collect depositPct of the full price; everything else
      // collects the full price. Milestones aren't expanded here —
      // producers picking 'milestone' pass an explicit kind and the
      // total they want; we honour the price as-computed.
      const amountCents =
        input.kind === "deposit"
          ? Math.round((fullPriceCents * product.depositPct) / 100)
          : fullPriceCents;
      if (amountCents <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Computed amount is zero — nothing to charge.",
        });
      }

      const base = getSiteUrl();
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: product.currency.toLowerCase(),
                product_data: {
                  name: `${product.name} — ${input.kind}`,
                },
                unit_amount: amountCents,
              },
              quantity: 1,
            },
          ],
          customer_email: input.customerEmail,
          // Post-Story-03 (PRD §6.6): legacy `/p/<slug>` URLs are gone.
          // Return URLs point at the new `/join/<slug>` surface.
          success_url: `${base}/join/${producer.slug}?session_id={CHECKOUT_SESSION_ID}&booked=1`,
          cancel_url: `${base}/join/${producer.slug}?cancelled=1`,
          // Destination charges — money lands on the producer's
          // account; Stripe deducts its standard fee; Skitza takes 0.
          payment_intent_data: {
            transfer_data: { destination: producer.stripeAccountId },
          },
          metadata: {
            producerId: producer.id,
            ...(input.bookingId ? { bookingId: input.bookingId } : {}),
            kind: input.kind,
          },
        },
        // Run the create on the platform account; transfer_data does
        // the destination split. (We deliberately don't use
        // `stripeAccount: producer.stripeAccountId` here — that would
        // make it a direct charge and bypass our platform-side
        // bookkeeping.)
      );

      const [inv] = await ctx.db
        .insert(invoices)
        .values({
          producerId: producer.id,
          ...(input.bookingId ? { bookingId: input.bookingId } : {}),
          stripeCheckoutSessionId: session.id,
          amountCents,
          currency: product.currency,
          description: `${product.name} — ${input.kind}`,
          kind: input.kind,
          status: "sent",
          customerEmail: input.customerEmail,
          customerName: input.customerName,
        })
        .returning();
      if (!inv) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (input.bookingId) {
        await ctx.db
          .update(bookings)
          .set({ stripeCheckoutSessionId: session.id })
          .where(eq(bookings.id, input.bookingId));
      }

      return { url: session.url, invoiceId: inv.id };
    }),
});
