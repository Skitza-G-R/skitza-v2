import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  and,
  bookings,
  createDb,
  desc,
  eq,
  invoices,
  isNull,
  producers,
  products,
  projects,
  type Db,
} from "@skitza/db";

import { publicProcedure, router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { calculatePriceCents } from "./booking";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";
import { getSiteUrl, getStripe } from "~/server/stripe/client";

// Public-procedure helper. Mirrors the pattern in `project.ts`/`booking.ts`:
// we don't have a Clerk session for the client-facing endpoints, so each
// public mutation builds its own DB handle from DATABASE_URL.
async function publicCtx(): Promise<{ db: Db; ipHash: string }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  // Touch headers() so Next records this as a dynamic route — keeps the
  // share-token-keyed mutation from being statically optimised on accident.
  // Also lets us derive a per-IP rate-limit bucket key.
  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = createHash("sha256").update(ipRaw).digest("hex");
  return { db: createDb(dbUrl), ipHash };
}

// Public-procedure rate limits. Both keyed by IP hash because there's no
// authenticated identity to attribute to.
const PORTAL_LIMIT = 10;
const PORTAL_WINDOW_MS = 60_000;

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

  // Task 10 — Stripe Customer Portal session for the paused-state banner.
  //
  // Auth: share-token only. The client doesn't have a Clerk session
  // (we're on the public /share/<token> route). We hash the raw token
  // and look it up against `projects.shareTokenHash` — same discipline
  // as `project.publicByToken`.
  //
  // Portal session is created on the PLATFORM account (no `stripeAccount`
  // header) because Task 3 moved Customers to the platform for
  // destination-charge installments. The Portal then lets the client
  // update the saved card; once they do, Stripe auto-retries the failed
  // invoice → invoice.paid webhook → project.stage flips back to active
  // (handled in Task 6).
  //
  // First-use note: Stripe requires a default Portal configuration in
  // the Dashboard before the API call works. If unconfigured the call
  // throws with a Stripe-side message ("No configuration provided ..."),
  // which we surface verbatim — that's the producer/admin's signal to
  // do the one-time Dashboard setup, no code change needed.
  createCustomerPortalSession: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        shareToken: z.string().min(16).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      const { db, ipHash } = await publicCtx();
      // Rate-limit BEFORE any DB / Stripe work — without this an
      // attacker can both brute-force the (projectId, shareToken) pair
      // AND burn Stripe API quota with cheap requests. 10/min/IP matches
      // publicComment's ceiling.
      const rl = checkRateLimit(
        `portal-session:${ipHash}`,
        PORTAL_LIMIT,
        PORTAL_WINDOW_MS,
      );
      if (!rl.ok) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      const stripe = getStripe();

      const tokenHash = createHash("sha256").update(input.shareToken).digest("hex");
      const [project] = await db
        .select({
          id: projects.id,
          shareTokenHash: projects.shareTokenHash,
          stripeCustomerId: projects.stripeCustomerId,
          producerId: projects.producerId,
        })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      // Constant-time hash comparison via crypto.timingSafeEqual.
      // Plain `!==` on the hex string leaks timing proportional to common
      // prefix length — under a network noise floor that's hard to exploit
      // remotely, but the cost of doing it right is one Buffer.from + a
      // length guard, so we just do it.
      const provided = Buffer.from(tokenHash, "hex");
      const stored = Buffer.from(project.shareTokenHash, "hex");
      if (
        provided.length !== stored.length ||
        !timingSafeEqual(provided, stored)
      ) {
        // Same NOT_FOUND code as a missing project so a token-fishing
        // attacker can't distinguish "wrong token" from "no project".
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (!project.stripeCustomerId) {
        // The client hasn't completed checkout yet — there's no Stripe
        // Customer to point the Portal at. PRECONDITION_FAILED matches
        // the rest of the Stripe procedures' shape for "your Stripe
        // state isn't ready".
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No saved payment method on file yet — pay the first invoice first.",
        });
      }

      // Return the client to their project room when they're done in
      // the Portal. Token is unguessable so leaking it in the
      // return_url to Stripe is a non-event — Stripe already saw it as
      // input via the same browser. We don't need to look the producer
      // up here; the Portal lives entirely on the platform account so
      // there's no Connect-routing decision to make.
      const session = await stripe.billingPortal.sessions.create({
        customer: project.stripeCustomerId,
        return_url: `${getSiteUrl()}/share/${input.shareToken}`,
      });

      return { url: session.url };
    }),
});
