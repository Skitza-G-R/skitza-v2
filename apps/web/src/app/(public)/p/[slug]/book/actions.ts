"use server";

import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { appRouter } from "~/server/trpc/routers/_app";

export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    if (first) {
      const field = first.path.join(".");
      return field ? `${field}: ${first.message}` : first.message;
    }
    return "Invalid input.";
  }
  if (err instanceof TRPCError) {
    switch (err.code) {
      case "NOT_FOUND":
        return "Producer or package not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid request.";
      case "CONFLICT":
        return err.message || "That slot was just taken — please pick another.";
      case "TOO_MANY_REQUESTS":
        return "Too many requests — try again in a moment.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Visitor-side: submit a booking request. No auth — the tRPC public
// procedure does rate-limiting + IP hashing internally. We call the
// caller with `userId: null` (publicProcedure doesn't read it).
export async function submitBookingRequest(input: {
  slug: string;
  productId: string;
  artistName: string;
  artistEmail: string;
  artistPhone?: string;
  notes?: string;
  startsAtIso?: string;
  quantity?: number;
  hours?: number;
}): Promise<ActionDataResult<{ id: string; checkoutUrl: string | null }>> {
  try {
    const caller = appRouter.createCaller({ userId: null });
    const res = await caller.booking.publicRequest(input);
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
