import {
  bookings,
  clientContacts,
  eq,
  producers,
  products,
} from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { artistProcedure } from "../artist-procedure";
import { router } from "../init";
import { calendarPaymentSummary } from "~/lib/payment-plans";

export const paymentRouter = router({
  getPaymentDetails: artistProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // 1. Auth boundary — artist must have at least one client_contacts
      //    row. The booking's artistEmail must match one of those emails
      //    (case-insensitive) for the artist to see it.
      const myContacts = await ctx.db
        .select({ email: clientContacts.email })
        .from(clientContacts)
        .where(eq(clientContacts.clerkUserId, ctx.clerkUserId));
      if (myContacts.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const myEmails = [
        ...new Set(myContacts.map((c) => c.email.toLowerCase())),
      ];

      // 2. Booking + producer in one round-trip. Joining producers gives
      //    us the display name for the payment-page header without a
      //    second SELECT.
      const [row] = await ctx.db
        .select({
          bookingId: bookings.id,
          status: bookings.status,
          artistEmail: bookings.artistEmail,
          artistName: bookings.artistName,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          productId: bookings.productId,
          packageNameSnapshot: bookings.packageNameSnapshot,
          producerName: producers.displayName,
          producerTranzilaTerminalName: producers.tranzilaTerminalName,
        })
        .from(bookings)
        .innerJoin(producers, eq(producers.id, bookings.producerId))
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (!myEmails.includes(row.artistEmail.toLowerCase())) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (row.status !== "pending_payment") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Booking is ${row.status}, not pending_payment`,
        });
      }
      if (!row.productId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Booking has no product attached",
        });
      }

      // 3. Product. We need priceCents + paymentPlans for the amount
      //    calculation, plus name/currency for the page header.
      const [product] = await ctx.db
        .select({
          id: products.id,
          name: products.name,
          priceCents: products.priceCents,
          currency: products.currency,
          paymentPlans: products.paymentPlans,
        })
        .from(products)
        .where(eq(products.id, row.productId))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const { amountCents, planKind, planLabel } = calendarPaymentSummary(
        product.priceCents,
        product.paymentPlans,
      );

      return {
        booking: {
          id: row.bookingId,
          startsAt: row.startsAt,
          durationMin: row.durationMin,
          packageName: row.packageNameSnapshot,
          artistEmail: row.artistEmail,
          artistName: row.artistName,
        },
        product: {
          id: product.id,
          name: product.name,
          priceCents: product.priceCents,
        },
        amountCents,
        currency: product.currency,
        producerName: row.producerName ?? "Producer",
        producerTranzilaTerminalName: row.producerTranzilaTerminalName,
        planKind,
        planLabel,
      };
    }),
});
