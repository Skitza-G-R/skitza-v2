"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

const PATH = "/dashboard/booking";

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
      case "FORBIDDEN":
        return "You don't have access to this booking.";
      case "NOT_FOUND":
        return "Not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      case "CONFLICT":
        return err.message || "That slot was just taken.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// ─── Package actions ────────────────────────────────────────────────

export async function createPackage(input: {
  name: string;
  description?: string;
  durationMin: number;
  sessionCount?: number;
  priceCents?: number;
  currency?: "USD" | "EUR" | "GBP" | "ILS";
  depositPct?: number;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.create(input);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function updatePackage(input: {
  id: string;
  name?: string;
  description?: string;
  durationMin?: number;
  sessionCount?: number;
  priceCents?: number;
  currency?: "USD" | "EUR" | "GBP" | "ILS";
  depositPct?: number;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.update(input);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function deactivatePackage(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.deactivate(input);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ─── Availability ───────────────────────────────────────────────────

export async function setAvailabilityWeek(input: {
  blocks: { weekday: number; startMin: number; endMin: number }[];
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.availability.setWeek(input);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ─── Booking transitions ────────────────────────────────────────────

export async function confirmBooking(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.confirm(input);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function rejectBooking(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.reject(input);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
