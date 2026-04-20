"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Onboarding wizard server actions. Thin wrappers over the existing
// tRPC procedures — we deliberately don't add new surface area to the
// routers. The wizard just composes producer.update +
// booking.packages.create + booking.availability.setWeek. Each step
// is its own action so the client can call them independently (and
// stall on one without redoing the rest).

async function callerOrError(): Promise<
  | { ok: true; caller: ReturnType<typeof appRouter.createCaller> }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

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
      case "UNAUTHORIZED":
        return "Please sign in to continue.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      case "NOT_FOUND":
        return "Not found.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Step 1 — save slug + display name. The producer router already
// enforces slug format + uniqueness, so we just relay.
export async function saveIdentity(input: {
  displayName: string;
  slug: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producer.update({
      displayName: input.displayName,
      slug: input.slug,
    });
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/onboarding");
    // Post-Story-03: slug changes invalidate the /join/<slug> teaser.
    revalidatePath(`/join/${input.slug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Step 2 — create one starter package. sessionCount defaults to 1 +
// currency to the producer's default (or USD if not set yet).
export async function createFirstPackage(input: {
  name: string;
  durationMin: number;
  priceCents: number;
  depositPct?: number;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.create({
      name: input.name,
      durationMin: input.durationMin,
      priceCents: input.priceCents,
      depositPct: input.depositPct ?? 0,
      // The router applies sensible defaults for everything else
      // (kind=session, locationType=studio, etc.) so we keep the
      // wizard input surface minimal.
    });
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/booking");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Step 3 — weekly availability. The availability.setWeek atomically
// replaces the week, so the wizard can send either a preset ("Mon-Fri
// 10-18") or a custom array from the custom editor.
export async function saveWeeklyHours(input: {
  blocks: { weekday: number; startMin: number; endMin: number }[];
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.availability.setWeek(input);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/booking");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
