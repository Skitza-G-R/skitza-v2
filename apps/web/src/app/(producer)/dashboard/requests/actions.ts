"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

const REQUESTS_PATH = "/dashboard/requests";

export type PurchaseRequestActionResult =
  | { ok: true; status: "pending" | "declined" }
  | { ok: true; status: "approved"; undoableUntilIso: string }
  | { ok: false; error: string };

async function callerOrError(): Promise<
  { ok: true; caller: ReturnType<typeof appRouter.createCaller> } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Check the request and try again.";
  }

  if (error instanceof TRPCError) {
    if (error.cause instanceof ZodError) {
      return error.cause.issues[0]?.message ?? "Check the request and try again.";
    }
    if (error.code === "UNAUTHORIZED") return "Please sign in to continue.";
    if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND") {
      return "This purchase request is no longer available.";
    }
    if (error.code === "CONFLICT" || error.code === "BAD_REQUEST") {
      return error.message || "This request changed. Refresh and try again.";
    }
  }

  return "Something went wrong. Please try again.";
}

function revalidateRequestSurfaces(id: string) {
  revalidatePath("/dashboard");
  revalidatePath(REQUESTS_PATH);
  revalidatePath(`${REQUESTS_PATH}/${id}`);
  revalidatePath("/artist", "layout");
}

export async function approvePurchaseRequest(input: {
  id: string;
}): Promise<PurchaseRequestActionResult> {
  const result = await callerOrError();
  if (!result.ok) return result;

  try {
    const transition = await result.caller.producer.purchase.approve({ id: input.id });
    revalidateRequestSurfaces(input.id);
    return {
      ok: true,
      status: "approved",
      undoableUntilIso: transition.undoableUntil.toISOString(),
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function declinePurchaseRequest(input: {
  id: string;
  reason?: string;
}): Promise<PurchaseRequestActionResult> {
  const result = await callerOrError();
  if (!result.ok) return result;

  try {
    const reason = input.reason?.trim();
    await result.caller.producer.purchase.decline({
      id: input.id,
      ...(reason ? { reason } : {}),
    });
    revalidateRequestSurfaces(input.id);
    return { ok: true, status: "declined" };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function undoPurchaseApproval(input: {
  id: string;
}): Promise<PurchaseRequestActionResult> {
  const result = await callerOrError();
  if (!result.ok) return result;

  try {
    await result.caller.producer.purchase.undoApproval({ id: input.id });
    revalidateRequestSurfaces(input.id);
    return { ok: true, status: "pending" };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function correctPurchaseTarget(input: {
  purchaseRequestId: string;
  projectId: string | null;
}): Promise<{ ok: true; projectId: string | null } | { ok: false; error: string }> {
  const result = await callerOrError();
  if (!result.ok) return result;

  try {
    const corrected = await result.caller.producer.purchase.correctTarget(input);
    revalidateRequestSurfaces(input.purchaseRequestId);
    return { ok: true, projectId: corrected.projectId };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
