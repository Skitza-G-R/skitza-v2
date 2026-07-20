import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { audioDeliveryRepository } from "~/server/domain/audio-delivery/db";
import { AudioDeliveryDomainError } from "~/server/domain/audio-delivery/policy";
import {
  readDownloadOverrideState,
  setDownloadOverride,
} from "~/server/domain/audio-delivery/service";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

const OverrideScope = z
  .object({
    purchaseId: z.string().uuid(),
    versionId: z.string().uuid(),
  })
  .strict();

function mapAudioDeliveryError(error: unknown): never {
  if (!(error instanceof AudioDeliveryDomainError)) throw error;
  switch (error.code) {
    case "NOT_FOUND":
      throw new TRPCError({ code: "NOT_FOUND" });
    case "INVALID_INPUT":
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    case "CONFLICT":
    case "OPERATION_KEY_CONFLICT":
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    case "PAYMENT_REQUIRED":
      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    case "INTEGRITY_ERROR":
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }
}

export const audioDeliveryRouter = router({
  overrideState: producerProcedure.input(OverrideScope).query(async ({ ctx, input }) => {
    if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    try {
      return await readDownloadOverrideState(audioDeliveryRepository(ctx.db), {
        producerId: ctx.producerId,
        actorClerkUserId: ctx.userId,
        purchaseId: input.purchaseId,
        versionId: input.versionId,
      });
    } catch (error) {
      mapAudioDeliveryError(error);
    }
  }),

  setDownloadOverride: producerProcedure
    .input(
      OverrideScope.extend({
        enabled: z.boolean(),
        operationKey: z.string().trim().min(1).max(200),
        expectedUnpaidAmountCents: z.number().int().nonnegative(),
      }).strict(),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      try {
        return await setDownloadOverride(audioDeliveryRepository(ctx.db), {
          producerId: ctx.producerId,
          actorClerkUserId: ctx.userId,
          purchaseId: input.purchaseId,
          versionId: input.versionId,
          enabled: input.enabled,
          operationKey: input.operationKey,
          expectedUnpaidAmountCents: input.expectedUnpaidAmountCents,
          occurredAt: new Date(),
        });
      } catch (error) {
        mapAudioDeliveryError(error);
      }
    }),
});
