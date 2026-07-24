"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import type { PushCategory } from "~/lib/push/categories";
import { appRouter } from "~/server/trpc/routers/_app";

type ActionError = { ok: false; error: string };

function message(error: unknown): string {
  if (error instanceof TRPCError) {
    if (error.code === "UNAUTHORIZED") return "Please sign in to continue.";
    if (error.code === "FORBIDDEN") {
      return "This browser notification belongs to another account.";
    }
    if (error.code === "PRECONDITION_FAILED") {
      return "Push notifications are not available yet.";
    }
  }
  return "Push notifications could not be updated. Try again.";
}

async function caller() {
  const { userId } = await auth();
  return userId ? appRouter.createCaller({ userId }) : null;
}

export async function getPushStatusAction(endpoint: string | null): Promise<
  | {
      ok: true;
      configured: boolean;
      publicKey: string | null;
      categories: PushCategory[];
    }
  | ActionError
> {
  const push = await caller();
  if (!push) return { ok: false, error: "Please sign in to continue." };
  try {
    const status = await push.push.status({ endpoint });
    return { ok: true, ...status };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function savePushSubscriptionAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  categories: PushCategory[];
  expirationTime: number | null;
}): Promise<{ ok: true; categories: PushCategory[] } | ActionError> {
  const push = await caller();
  if (!push) return { ok: false, error: "Please sign in to continue." };
  try {
    const result = await push.push.subscribe(input);
    return {
      ok: true,
      categories: [...result.categories] as PushCategory[],
    };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function unsubscribePushAction(
  endpoint: string,
): Promise<{ ok: true; removed: boolean } | ActionError> {
  const push = await caller();
  if (!push) return { ok: false, error: "Please sign in to continue." };
  try {
    const result = await push.push.unsubscribe({ endpoint });
    return { ok: true, removed: result.removed };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
