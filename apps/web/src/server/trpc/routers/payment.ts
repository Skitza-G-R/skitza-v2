import {
  and,
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
import { activeArtistClientPair } from "~/server/artist/access";

export const paymentRouter = router({
  getPaymentDetails: artistProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Booking + producer in one round-trip. The client-contact join
      // requires the signed-in artist's exact active producer/email pair.
      // The producer join supplies the payment-page display name without
      // a second SELECT.
      const [row] = await ctx.db
        .select({
          bookingId: bookings.id,
          producerId: bookings.producerId,
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
        .innerJoin(
          clientContacts,
          activeArtistClientPair(ctx.clerkUserId, {
            producerId: bookings.producerId,
            email: bookings.artistEmail,
          }),
        )
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
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

      // Product. We need priceCents + paymentPlans for the amount
      // calculation, plus name/currency for the page header.
      const [product] = await ctx.db
        .select({
          id: products.id,
          name: products.name,
          priceCents: products.priceCents,
          currency: products.currency,
          paymentPlans: products.paymentPlans,
        })
        .from(products)
        .where(
          and(
            eq(products.id, row.productId),
            eq(products.producerId, row.producerId),
          ),
        )
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
