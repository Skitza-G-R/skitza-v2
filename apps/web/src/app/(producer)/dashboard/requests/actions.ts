"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

const REQUESTS_PATH = "/dashboard/requests";

export type PurchaseRequestActionResult = { ok: true } | { ok: false; error: string };

async function callerOrError(): Promise<
  | { ok: true; caller: ReturnType<typeof appRouter.createCaller> }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

function toMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Invalid input.";
  if (error instanceof TRPCError) {
    switch (error.code) {
      case "UNAUTHORIZED":
        return "Please sign in to continue.";
      case "FORBIDDEN":
      case "NOT_FOUND":
        return "This purchase request is no longer available.";
      case "CONFLICT":
      case "BAD_REQUEST":
        return error.message || "This request changed. Refresh and try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

function revalidateRequestSurfaces(id: string) {
  // The dashboard banner, hub, and open detail must all re-read after
  // Gate 1 changes. Artist pages are dynamic, but invalidating their
  // home route also makes an already-visited artist view refresh to S7.
  revalidatePath("/dashboard");
  revalidatePath(REQUESTS_PATH, "layout");
  revalidatePath(`${REQUESTS_PATH}/${id}`);
  revalidatePath("/artist");
}

export async function approvePurchaseRequest(input: {
  id: string;
}): Promise<PurchaseRequestActionResult> {
  const result = await callerOrError();
  if (!result.ok) return result;
  try {
    await result.caller.producer.purchase.approve({ id: input.id });
    revalidateRequestSurfaces(input.id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
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
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
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
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}
