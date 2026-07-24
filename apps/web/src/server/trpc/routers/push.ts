import { TRPCError } from "@trpc/server";
import { createDb } from "@skitza/db";
import { z } from "zod";

import { PUSH_CATEGORIES } from "~/lib/push/categories";
import { webPushConfig } from "~/server/push/config";
import {
  currentPushCategories,
  InvalidPushSubscriptionError,
  PushEndpointOwnershipError,
  registerPushSubscription,
  unsubscribePushSubscription,
} from "~/server/push/subscription-service";
import { DrizzlePushSubscriptionStore } from "~/server/push/store";

import { publicProcedure, router } from "../init";

const PushCategory = z.enum(PUSH_CATEGORIES);
const Endpoint = z.string().min(1).max(2048);
const BrowserSubscription = z.object({
  endpoint: Endpoint,
  p256dh: z.string().min(32).max(256),
  auth: z.string().min(8).max(128),
  categories: z
    .array(PushCategory)
    .max(PUSH_CATEGORIES.length)
    .refine((values) => new Set(values).size === values.length, {
      message: "Duplicate push category",
    }),
  expirationTime: z.number().finite().positive().nullable(),
});

const pushProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "missing DATABASE_URL",
    });
  }
  return next({
    ctx: {
      ...ctx,
      clerkUserId: ctx.userId,
      db: createDb(dbUrl),
    },
  });
});

function inputError(error: unknown): never {
  if (error instanceof PushEndpointOwnershipError) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This push subscription belongs to another account.",
    });
  }
  if (error instanceof InvalidPushSubscriptionError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid push subscription.",
    });
  }
  throw error;
}

export const pushRouter = router({
  status: pushProcedure
    .input(z.object({ endpoint: Endpoint.nullable() }))
    .query(async ({ ctx, input }) => {
      const config = webPushConfig();
      let categories: (typeof PUSH_CATEGORIES)[number][] = [];
      try {
        categories = await currentPushCategories(
          new DrizzlePushSubscriptionStore(ctx.db),
          ctx.clerkUserId,
          input.endpoint,
        );
      } catch (error) {
        inputError(error);
      }
      return {
        configured: config !== null,
        publicKey: config?.publicKey ?? null,
        categories,
      };
    }),

  subscribe: pushProcedure.input(BrowserSubscription).mutation(async ({ ctx, input }) => {
    if (!webPushConfig()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Push notifications are not configured.",
      });
    }
    try {
      const row = await registerPushSubscription(
        new DrizzlePushSubscriptionStore(ctx.db),
        ctx.clerkUserId,
        input,
      );
      return { categories: row.categories };
    } catch (error) {
      inputError(error);
    }
  }),

  unsubscribe: pushProcedure
    .input(z.object({ endpoint: Endpoint }))
    .mutation(async ({ ctx, input }) => {
      try {
        const removed = await unsubscribePushSubscription(
          new DrizzlePushSubscriptionStore(ctx.db),
          ctx.clerkUserId,
          input.endpoint,
        );
        return { removed };
      } catch (error) {
        inputError(error);
      }
    }),
});
