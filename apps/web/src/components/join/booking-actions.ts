"use server";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

// Public booking-flow server actions for `/join/<slug>`.
//
// Wraps the existing tRPC public surface (publicProfile + booking
// public procedures) in a thin server-action layer so the inline
// booking modal — which lives in the public route group — can call
// the server without standing up a separate client-side tRPC HTTP
// pipeline. Each action invokes appRouter.createCaller({ userId: null })
// directly: simpler than fetch('/api/trpc/...'), preserves typed
// errors, and matches the pattern already used by /join's page.tsx
// for forJoin().
//
// Public route group: ENGLISH ONLY, LTR ONLY per CLAUDE.md i18n
// scope. No t() calls, no NextIntlClientProvider — error strings are
// inline English.
//
// All actions return { ok: true, data } on success and { ok: false,
// error } on a known failure (rate-limit, slot taken, validation).
// Network / server errors propagate as thrown errors so the client
// can fall back to a generic toast.

const SlugInput = z.object({ slug: z.string().min(1).max(64) });

export interface BookingProduct {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  currency: string;
  position: number;
}

export interface FetchProductsResult {
  ok: true;
  data: { products: BookingProduct[] };
}

/**
 * Fetch the producer's active products for the modal Step 2 list.
 * Wraps booking.publicProducts.
 */
export async function fetchPublicProducts(
  input: z.infer<typeof SlugInput>,
): Promise<FetchProductsResult> {
  const parsed = SlugInput.parse(input);
  const caller = appRouter.createCaller({ userId: null });
  const result = await caller.booking.publicProducts({ slug: parsed.slug });
  return {
    ok: true,
    data: {
      products: result.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        durationMin: p.durationMin,
        priceCents: p.priceCents,
        currency: p.currency,
        position: p.position,
      })),
    },
  };
}

const SlotsActionInput = z.object({
  slug: z.string().min(1).max(64),
  productId: z.string().uuid(),
  days: z.number().int().min(1).max(60).optional(),
});

export interface FetchSlotsResult {
  ok: true;
  data: { slots: string[]; durationMin: number };
}

/**
 * Fetch open slots for a product over the next N days (default 14).
 * Wraps booking.publicSlots.
 */
export async function fetchPublicSlots(
  input: z.infer<typeof SlotsActionInput>,
): Promise<FetchSlotsResult> {
  const parsed = SlotsActionInput.parse(input);
  const caller = appRouter.createCaller({ userId: null });
  const result = await caller.booking.publicSlots({
    slug: parsed.slug,
    productId: parsed.productId,
    days: parsed.days ?? 14,
  });
  return {
    ok: true,
    data: { slots: result.slots, durationMin: result.durationMin },
  };
}

const RequestActionInput = z.object({
  slug: z.string().min(1).max(64),
  productId: z.string().uuid(),
  artistName: z.string().min(1).max(80),
  artistEmail: z.string().email(),
  notes: z.string().max(1000).optional(),
  startsAtIso: z.string().datetime().optional(),
});

export type RequestBookingResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

/**
 * Submit a booking request from the public modal.
 * Wraps booking.publicRequest. Maps known TRPC error codes to
 * friendly inline copy; throws on unknown 5xx so the caller can show
 * a generic toast.
 */
export async function requestPublicBooking(
  input: z.infer<typeof RequestActionInput>,
): Promise<RequestBookingResult> {
  const parsed = RequestActionInput.parse(input);
  const caller = appRouter.createCaller({ userId: null });
  try {
    await caller.booking.publicRequest({
      slug: parsed.slug,
      productId: parsed.productId,
      artistName: parsed.artistName,
      artistEmail: parsed.artistEmail,
      ...(parsed.notes ? { notes: parsed.notes } : {}),
      ...(parsed.startsAtIso ? { startsAtIso: parsed.startsAtIso } : {}),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof TRPCError) {
      // Known cases the UI can recover from gracefully.
      switch (err.code) {
        case "CONFLICT":
          return {
            ok: false,
            code: "CONFLICT",
            error: "That slot was just taken. Pick another time.",
          };
        case "BAD_REQUEST":
          return {
            ok: false,
            code: "BAD_REQUEST",
            error: err.message || "That request looks off — try again.",
          };
        case "TOO_MANY_REQUESTS":
          return {
            ok: false,
            code: "TOO_MANY_REQUESTS",
            error: "Too many requests — wait a moment and try again.",
          };
        case "NOT_FOUND":
          return {
            ok: false,
            code: "NOT_FOUND",
            error: "That product is no longer available.",
          };
      }
    }
    // For unknown errors we surface a server-side console log so
    // the producer's logs catch it. No Sentry on v3-clean yet — the
    // request still fails but the producer sees nothing leak.
    console.error("[booking-actions] requestPublicBooking failed", err);
    throw err;
  }
}
