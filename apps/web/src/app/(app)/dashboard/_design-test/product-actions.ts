"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

import { validateNewProductInput, type NewProductInput } from "./create-validators";

// Server action for the design-test "Add new product" modal. Wraps
// booking.products.create with the minimum-viable field set:
// title (→ name), session length (→ durationMin), and price.
//
// Defaults align with the router's ProductInput Zod schema:
//   - kind: "custom"               — generic session-style product
//   - pricingModel: "flat"         — single price (which is what we ask for)
//   - currency: "USD"
//   - depositModel: "paid_in_full" — buyer pays the full price upfront;
//     "flat" (the schema default) would require a depositPct that we
//     don't ask for in this minimal modal
//   - bufferMinutes: 0, minLeadHours: 12
//
// All defaults can be edited later via the existing product editor on
// main; the design-test modal stays minimal.

export type CreateProductResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createProduct(
  input: NewProductInput,
): Promise<CreateProductResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  const localError = validateNewProductInput(input);
  if (localError) return { ok: false, error: localError };

  try {
    const caller = appRouter.createCaller({ userId });
    const row = await caller.booking.products.create({
      name: input.title.trim(),
      durationMin: Math.floor(input.durationMin),
      priceCents: Math.floor(input.priceCents),
      depositModel: "paid_in_full",
    });
    revalidatePath("/dashboard/store");
    return { ok: true, id: row.id };
  } catch (err) {
    if (err instanceof TRPCError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't create product.",
    };
  }
}
