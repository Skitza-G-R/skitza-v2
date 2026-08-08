"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";
import { sessionStartFromLocalSlot } from "~/server/booking";

export type ActionResult = { ok: true } | { ok: false; error: string };

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

export async function decideSessionChangeRequest(input: {
  requestId: string;
  decision: "approved" | "rejected";
  operationKey: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.booking.changeRequest.decide(input);
    revalidatePath(CALENDAR_PATH);
    revalidatePath("/artist/sessions");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export type ManualBillingTreatment = "included" | "complimentary" | "billable_extra";
export type ManualWarningCode =
  | "OUTSIDE_AVAILABILITY"
  | "BLACKOUT"
  | "BUFFER_CONFLICT"
  | "DAILY_LIMIT";

export type ManualSessionFormInput = {
  clientId: string;
  projectId: string;
  studioDate: string;
  studioStartMin: number;
  title?: string;
  billingTreatment?: ManualBillingTreatment;
};

async function exactManualStart(
  caller: ReturnType<typeof appRouter.createCaller>,
  input: Pick<ManualSessionFormInput, "studioDate" | "studioStartMin">,
): Promise<Date> {
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
};

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
  },
): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const startsAt = await exactManualStart(c.caller, input);
    await c.caller.booking.reschedule.create({
      id: input.id,
      startsAt,
      acknowledgedWarnings: input.acknowledgedWarnings,
      operationKey: input.operationKey,
    });
    revalidatePath(CALENDAR_PATH);
    revalidatePath("/artist/sessions");
    return { ok: true };
  } catch (err) {
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
  },
): Promise<
  | {
      ok: true;
      session: Awaited<
        ReturnType<ReturnType<typeof appRouter.createCaller>["booking"]["manual"]["create"]>
      >;
    }
  | { ok: false; error: string }
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
    });
    revalidatePath(CALENDAR_PATH);
    return { ok: true, session };
  } catch (err) {
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
