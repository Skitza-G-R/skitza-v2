"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "~/server/auth/clerk-identity";

import { appRouter } from "~/server/trpc/routers/_app";
import { sessionStartFromLocalSlot } from "~/server/booking";
import { REDUCED_PROTECTION_REVIEW_MESSAGE } from "~/server/google-calendar/booking-protection";

export type ActionResult = { ok: true } | { ok: false; error: string };
type ReducedProtectionReviewError = {
  ok: false;
  error: string;
  requiresReducedGoogleProtectionReview: true;
};

const CALENDAR_PATH = "/dashboard/calendar";

async function callerOrError(): Promise<
  { ok: true; caller: ReturnType<typeof appRouter.createCaller> } | { ok: false; error: string }
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
    // tRPC wraps input-validation failures with the raw JSON issue dump
    // as the message — surface the underlying Zod issue instead.
    if (err.cause instanceof ZodError) return toMessage(err.cause);
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Please sign in to continue.";
      case "NOT_FOUND":
        return "Booking not found.";
      case "FORBIDDEN":
        return "You don't have access to that booking.";
      case "BAD_REQUEST":
      case "PRECONDITION_FAILED":
      case "CONFLICT":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

function reducedProtectionReviewError(err: unknown): ReducedProtectionReviewError | null {
  if (!(err instanceof TRPCError) || err.message !== REDUCED_PROTECTION_REVIEW_MESSAGE) {
    return null;
  }
  return {
    ok: false,
    error: REDUCED_PROTECTION_REVIEW_MESSAGE,
    requiresReducedGoogleProtectionReview: true,
  };
}

export async function confirmBooking(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.confirm({
      id: input.id,
      operationKey: `producer-confirm:${input.id}:v1`,
    });
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function rejectBooking(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.reject({
      id: input.id,
      operationKey: `producer-reject:${input.id}:v1`,
    });
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function cancelSession(input: {
  id: string;
  reason: string;
  note?: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const reason = [input.reason.trim(), input.note?.trim()].filter(Boolean).join(": ");
    await c.caller.booking.cancel({
      id: input.id,
      operationKey: `producer-cancel:${input.id}:v1`,
      ...(reason ? { reason } : {}),
    });
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function setSessionTitle(input: { id: string; title: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.setTitle({ id: input.id, title: input.title.trim() });
    revalidatePath(CALENDAR_PATH);
    revalidatePath("/artist/sessions");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function completeSession(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.complete({
      id: input.id,
      operationKey: `producer-complete:${input.id}:v1`,
    });
    revalidatePath(CALENDAR_PATH);
    revalidatePath("/artist/sessions");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function markSessionNoShow(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.noShow({
      id: input.id,
      operationKey: `producer-no-show:${input.id}:v1`,
    });
    revalidatePath(CALENDAR_PATH);
    revalidatePath("/artist/sessions");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function recordLateArtistCancel(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.recordLateCancellation({
      id: input.id,
      operationKey: `producer-late-cancel:${input.id}:v1`,
    });
    revalidatePath(CALENDAR_PATH);
    revalidatePath("/artist/sessions");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function decideSessionChangeRequest(input: {
  requestId: string;
  decision: "approved" | "rejected";
  operationKey: string;
  acknowledgedReducedGoogleProtection?: boolean;
}): Promise<
  | { ok: true; googleCalendarProtection: "active" | "reduced" }
  | ReducedProtectionReviewError
  | { ok: false; error: string }
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const result = await c.caller.booking.changeRequest.decide(input);
    revalidatePath(CALENDAR_PATH);
    revalidatePath("/artist/sessions");
    return { ok: true, googleCalendarProtection: result.googleCalendarProtection };
  } catch (err) {
    const review = reducedProtectionReviewError(err);
    if (review) return review;
    return { ok: false, error: toMessage(err) };
  }
}

export type ManualBillingTreatment = "included" | "complimentary" | "billable_extra";
export type ProducerSchedulingWarningCode =
  | "OUTSIDE_AVAILABILITY"
  | "BLACKOUT"
  | "BUFFER_CONFLICT"
  | "DAILY_LIMIT";
export type ManualWarningCode = ProducerSchedulingWarningCode | "GOOGLE_BUSY";

export type ManualSessionFormInput = {
  clientId: string;
  projectId: string;
  studioDate: string;
  studioStartMin: number;
  startsAtIso?: string;
  title?: string;
  billingTreatment?: ManualBillingTreatment;
};

async function exactManualStart(
  caller: ReturnType<typeof appRouter.createCaller>,
  input: Pick<ManualSessionFormInput, "studioDate" | "studioStartMin" | "startsAtIso">,
): Promise<Date> {
  if (input.startsAtIso !== undefined) {
    const startsAt = new Date(input.startsAtIso);
    if (Number.isNaN(startsAt.getTime()) || startsAt.toISOString() !== input.startsAtIso) {
      throw new Error("The selected session time is invalid.");
    }
    return startsAt;
  }
  const profile = await caller.producer.me();
  return sessionStartFromLocalSlot({
    date: input.studioDate,
    startMin: input.studioStartMin,
    producerTimeZone: profile.timezone,
  });
}

export type ProducerRescheduleInput = {
  id: string;
  studioDate: string;
  studioStartMin: number;
  startsAtIso?: string;
};

export type ProducerExactSessionAvailability = Readonly<{
  studioTimeZone: string;
  durationMin: number;
  today: string;
  // SK-280: false when the underlying project/purchase/allowance no longer
  // allows booking — the sheet explains that instead of rendering every day
  // as "Full". Unset for manual availability (its options list pre-filters).
  canBook?: boolean;
  googleCalendarProtection: "active" | "reduced";
  days: readonly Readonly<{
    date: string;
    slots: readonly Readonly<{
      startsAt: string;
      endsAt: string;
      studioDate: string;
      studioStartMin: number;
    }>[];
  }>[];
}>;

function serializeExactSessionAvailability(input: {
  studioTimeZone: string;
  durationMin: number;
  today: string;
  canBook?: boolean;
  googleCalendarProtection: "active" | "reduced";
  days: readonly Readonly<{
    date: string;
    slots: readonly Readonly<{
      startsAt: string;
      endsAt: string;
      studioDate: string;
      studioStartMin: number;
    }>[];
  }>[];
}): ProducerExactSessionAvailability {
  return {
    studioTimeZone: input.studioTimeZone,
    durationMin: input.durationMin,
    today: input.today,
    ...(input.canBook === undefined ? {} : { canBook: input.canBook }),
    googleCalendarProtection: input.googleCalendarProtection,
    days: input.days.map((day) => ({
      date: day.date,
      slots: day.slots.map((slot) => ({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        studioDate: slot.studioDate,
        studioStartMin: slot.studioStartMin,
      })),
    })),
  };
}

export async function getManualSessionAvailability(input: {
  clientId: string;
  projectId: string;
}): Promise<
  { ok: true; availability: ProducerExactSessionAvailability } | { ok: false; error: string }
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const availability = await c.caller.booking.manual.availability(input);
    return { ok: true, availability: serializeExactSessionAvailability(availability) };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function getSessionRescheduleAvailability(input: {
  id: string;
}): Promise<
  { ok: true; availability: ProducerExactSessionAvailability } | { ok: false; error: string }
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const availability = await c.caller.booking.reschedule.availability(input);
    return { ok: true, availability: serializeExactSessionAvailability(availability) };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function previewSessionReschedule(input: ProducerRescheduleInput): Promise<
  | {
      ok: true;
      preview: Awaited<
        ReturnType<ReturnType<typeof appRouter.createCaller>["booking"]["reschedule"]["preview"]>
      >;
    }
  | { ok: false; error: string }
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const startsAt = await exactManualStart(c.caller, input);
    const preview = await c.caller.booking.reschedule.preview({ id: input.id, startsAt });
    return { ok: true, preview };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function rescheduleSession(
  input: ProducerRescheduleInput & {
    operationKey: string;
    acknowledgedWarnings: ManualWarningCode[];
    acknowledgedReducedGoogleProtection: boolean;
  },
): Promise<
  | { ok: true; googleCalendarProtection: "active" | "reduced" }
  | { ok: false; error: string }
  | ReducedProtectionReviewError
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const startsAt = await exactManualStart(c.caller, input);
    const result = await c.caller.booking.reschedule.create({
      id: input.id,
      startsAt,
      acknowledgedWarnings: input.acknowledgedWarnings,
      acknowledgedReducedGoogleProtection: input.acknowledgedReducedGoogleProtection,
      operationKey: input.operationKey,
    });
    revalidatePath(CALENDAR_PATH);
    revalidatePath("/artist/sessions");
    return { ok: true, googleCalendarProtection: result.googleCalendarProtection };
  } catch (err) {
    const review = reducedProtectionReviewError(err);
    if (review) return review;
    return { ok: false, error: toMessage(err) };
  }
}

export async function previewManualSession(input: ManualSessionFormInput): Promise<
  | {
      ok: true;
      preview: Awaited<
        ReturnType<ReturnType<typeof appRouter.createCaller>["booking"]["manual"]["preview"]>
      >;
    }
  | { ok: false; error: string }
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const startsAt = await exactManualStart(c.caller, input);
    const preview = await c.caller.booking.manual.preview({
      clientId: input.clientId,
      projectId: input.projectId,
      startsAt,
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      ...(input.billingTreatment ? { billingTreatment: input.billingTreatment } : {}),
    });
    return { ok: true, preview };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function createManualSession(
  input: ManualSessionFormInput & {
    billingTreatment: ManualBillingTreatment;
    operationKey: string;
    acknowledgedWarnings: ManualWarningCode[];
    acknowledgedReducedGoogleProtection: boolean;
  },
): Promise<
  | {
      ok: true;
      session: Awaited<
        ReturnType<ReturnType<typeof appRouter.createCaller>["booking"]["manual"]["create"]>
      >;
    }
  | { ok: false; error: string }
  | ReducedProtectionReviewError
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const startsAt = await exactManualStart(c.caller, input);
    const session = await c.caller.booking.manual.create({
      clientId: input.clientId,
      projectId: input.projectId,
      startsAt,
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      billingTreatment: input.billingTreatment,
      operationKey: input.operationKey,
      acknowledgedWarnings: input.acknowledgedWarnings,
      acknowledgedReducedGoogleProtection: input.acknowledgedReducedGoogleProtection,
    });
    revalidatePath(CALENDAR_PATH);
    return { ok: true, session };
  } catch (err) {
    const review = reducedProtectionReviewError(err);
    if (review) return review;
    return { ok: false, error: toMessage(err) };
  }
}

// Availability + blackouts wrappers — mirror the booking-page actions
// but revalidate the calendar path so updates surface here without a
// hard refresh. tRPC procs are shared so behaviour is identical.

export async function setAvailabilityWeek(input: {
  blocks: { weekday: number; startMin: number; endMin: number }[];
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.availability.setWeek(input);
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function updateAvailabilitySettings(input: {
  defaultSessionMin?: number;
  autoConfirmBookings?: boolean;
  cancellationPolicyHours?: number;
  maxSessionsPerDay?: number | null;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.availability.updateSettings(input);
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addBlackout(input: {
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.blackouts.create(input);
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function removeBlackout(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.blackouts.remove(input);
    revalidatePath(CALENDAR_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
