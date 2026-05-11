"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";
import type { PaymentPlan } from "@skitza/db";

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

// Shared narrow types for the v2 package fields so the form,
// action, and router all stay in sync. Kind/location are gated to
// the preset list; description is plain free-text.
export type PackageKind = "session" | "mixing" | "mastering" | "producing" | "other";
export type PackageLocationType = "studio" | "remote" | "client_space";

export async function createPackage(input: {
  name: string;
  description?: string;
  durationMin: number;
  sessionCount?: number;
  priceCents?: number;
  currency?: "USD" | "EUR" | "GBP" | "ILS";
  depositPct?: number;
  kind?: PackageKind;
  locationType?: PackageLocationType;
  bufferMinutes?: number;
  minLeadHours?: number;
  paymentPlans?: PaymentPlan[];
  contractUrl?: string | null;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.create(input);
    revalidatePath(PATH);
    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/store");
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
  kind?: PackageKind;
  locationType?: PackageLocationType;
  bufferMinutes?: number;
  minLeadHours?: number;
  paymentPlans?: PaymentPlan[];
  contractUrl?: string | null;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.update(input);
    revalidatePath(PATH);
    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/store");
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

// Storefront visibility toggle — flips `active` without archiving.
// Used by the storefront product card's Show / Hide control.
export async function setPackageActive(input: {
  id: string;
  active: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.setActive(input);
    revalidatePath(PATH);
    revalidatePath("/dashboard/profile");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Duplicate a product. The copy starts hidden (active=false) so the
// producer can edit it before exposing it on the public page.
export async function duplicatePackage(input: {
  id: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.duplicate(input);
    revalidatePath(PATH);
    revalidatePath("/dashboard/profile");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Archive (soft-delete). Distinct from deactivate / setActive — this
// removes the product from the dashboard list entirely. Re-exposed
// here so the storefront kebab menu doesn't import the
// "deactivatePackage" name (which is the legacy alias).
export async function archivePackage(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.archive(input);
    revalidatePath(PATH);
    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/store");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// restorePackage — Undo for the Phase-2 delete flow. Resurrects a
// soft-deleted product by clearing archivedAt and forcing active=false
// (returns hidden so the producer reviews before re-publishing). Pair
// with the 4.5s toast action surfaced from <StoreScreen>.
export async function restorePackage(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.packages.restore(input);
    revalidatePath(PATH);
    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/store");
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

// Producer-level booking settings surfaced on the Sessions tab:
// default session duration, auto-confirm toggle, cancellation policy.
// Kept as a single action so UI rows and the duration picker can share
// a write path. Partial — every field is optional so each control can
// commit independently without clobbering the others.
export async function updateAvailabilitySettings(input: {
  defaultSessionMin?: number;
  autoConfirmBookings?: boolean;
  cancellationPolicyHours?: number;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.availability.updateSettings(input);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ─── Blackouts ──────────────────────────────────────────────────────

export async function addBlackoutAction(input: {
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.blackouts.create(input);
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function removeBlackoutAction(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.blackouts.remove(input);
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
