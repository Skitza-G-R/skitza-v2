import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createActiveWorkImportBatch,
  deleteActiveWorkImportRow,
  loadActiveWorkImportBatch,
  loadLatestOpenActiveWorkImportBatch,
  saveActiveWorkImportRow,
} from "~/server/domain/active-work-import/db";
import {
  activeWorkImportSetupRepository,
  activeWorkImportSetupOptions,
  loadActiveWorkImportSetupScope,
  runActiveWorkImportSetup,
} from "~/server/domain/active-work-import/setup";
import { ActiveWorkImportAgreementPdfCapabilityError } from "~/server/domain/active-work-import/agreement-pdf-capability";
import { ActiveWorkImportProofCapabilityError } from "~/server/domain/active-work-import/proof-capability";
import { ActiveWorkImportDomainError } from "~/server/domain/active-work-import/service";
import {
  assessActiveWorkImportRowForCreation,
  materializeActiveWorkImportRow,
  materializeActiveWorkImportRows,
  prepareActiveWorkImportAgreementPdf,
  prepareActiveWorkImportProof,
  publicActiveWorkImportAssessment,
} from "~/server/domain/active-work-import/workflow";
import { ClientInvitationDomainError } from "~/server/domain/client-invitations/service";
import {
  MAX_PROOF_BYTES,
  MAX_PROOF_FILE_NAME_LENGTH,
  PROOF_CONTENT_TYPES,
} from "~/server/domain/payment-proofs/policy";
import {
  AGREEMENT_PDF_CONTENT_TYPE,
  MAX_AGREEMENT_PDF_BYTES,
  MAX_AGREEMENT_PDF_FILE_NAME_LENGTH,
} from "~/lib/agreement-pdf";
import { SITE_URL, sendClientInviteEmail } from "~/server/email/send";
import { configuredCapabilitySecrets } from "~/server/security/capability-secrets";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

const operationKeySchema = z.string().trim().min(1).max(200);
const idSchema = z.string().uuid();
const creationDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

function actorId(userId: string | null): string {
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

function mapDomainError(error: unknown): never {
  // Auth and configuration failures are already exact tRPC errors.
  if (error instanceof TRPCError) throw error;
  if (
    error instanceof ActiveWorkImportDomainError ||
    error instanceof ClientInvitationDomainError
  ) {
    if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
    if (error.code === "CONFLICT" || error.code === "OPERATION_KEY_CONFLICT") {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    if (error.code === "INVALID_INPUT") {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }
  if (
    error instanceof ActiveWorkImportProofCapabilityError ||
    error instanceof ActiveWorkImportAgreementPdfCapabilityError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  console.error("[active-work-import] unexpected failure", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : String(error),
    code: typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
    stack: error instanceof Error ? error.stack : undefined,
  });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong on our side. Your draft is safe.",
    cause: error,
  });
}

export const activeWorkImportRouter = router({
  createBatch: producerProcedure
    .input(z.object({ operationKey: operationKeySchema }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await createActiveWorkImportBatch(ctx.db, {
          producerId: ctx.producerId,
          clerkUserId: actorId(ctx.userId),
          operationKey: input.operationKey,
        });
      } catch (error) {
        mapDomainError(error);
      }
    }),

  latestOpenBatch: producerProcedure.query(async ({ ctx }) => {
    try {
      return await loadLatestOpenActiveWorkImportBatch(ctx.db, {
        producerId: ctx.producerId,
      });
    } catch (error) {
      mapDomainError(error);
    }
  }),

  loadBatch: producerProcedure
    .input(z.object({ batchId: idSchema }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await loadActiveWorkImportBatch(ctx.db, {
          producerId: ctx.producerId,
          batchId: input.batchId,
        });
      } catch (error) {
        mapDomainError(error);
      }
    }),

  saveRow: producerProcedure
    .input(
      z
        .object({
          batchId: idSchema,
          rowOperationKey: operationKeySchema,
          expectedRevision: z.number().int().positive().nullable(),
          draftPayload: z.record(z.string(), z.unknown()),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await saveActiveWorkImportRow(ctx.db, {
          producerId: ctx.producerId,
          ...input,
        });
      } catch (error) {
        mapDomainError(error);
      }
    }),

  deleteRow: producerProcedure
    .input(z.object({ batchId: idSchema, rowId: idSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteActiveWorkImportRow(ctx.db, {
          producerId: ctx.producerId,
          ...input,
        });
      } catch (error) {
        mapDomainError(error);
      }
    }),

  assessRow: producerProcedure
    .input(z.object({ batchId: idSchema, rowId: idSchema }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return publicActiveWorkImportAssessment(
          await assessActiveWorkImportRowForCreation(ctx.db, {
            producerId: ctx.producerId,
            ...input,
            verificationSecrets: configuredCapabilitySecrets().verification,
          }),
        );
      } catch (error) {
        mapDomainError(error);
      }
    }),

  prepareProof: producerProcedure
    .input(
      z
        .object({
          batchId: idSchema,
          rowId: idSchema,
          paymentOperationKey: operationKeySchema,
          originalFileName: z.string().min(1).max(MAX_PROOF_FILE_NAME_LENGTH),
          contentType: z.enum(PROOF_CONTENT_TYPES),
          sizeBytes: z.number().int().positive().max(MAX_PROOF_BYTES),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await prepareActiveWorkImportProof(ctx.db, {
          producerId: ctx.producerId,
          ...input,
          serverSecret: configuredCapabilitySecrets().active,
        });
      } catch (error) {
        mapDomainError(error);
      }
    }),

  prepareAgreementPdf: producerProcedure
    .input(
      z
        .object({
          batchId: idSchema,
          rowId: idSchema,
          originalFileName: z.string().min(1).max(MAX_AGREEMENT_PDF_FILE_NAME_LENGTH),
          contentType: z.literal(AGREEMENT_PDF_CONTENT_TYPE),
          sizeBytes: z.number().int().positive().max(MAX_AGREEMENT_PDF_BYTES),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await prepareActiveWorkImportAgreementPdf(ctx.db, {
          producerId: ctx.producerId,
          ...input,
          serverSecret: configuredCapabilitySecrets().active,
        });
      } catch (error) {
        mapDomainError(error);
      }
    }),

  materializeRow: producerProcedure
    .input(
      z
        .object({
          batchId: idSchema,
          rowId: idSchema,
          expectedCreationDigest: creationDigestSchema,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await materializeActiveWorkImportRow(ctx.db, {
          producerId: ctx.producerId,
          clerkUserId: actorId(ctx.userId),
          ...input,
          verificationSecrets: configuredCapabilitySecrets().verification,
        });
      } catch (error) {
        mapDomainError(error);
      }
    }),

  materializeRows: producerProcedure
    .input(
      z
        .object({
          batchId: idSchema,
          rows: z
            .array(
              z
                .object({
                  rowId: idSchema,
                  expectedCreationDigest: creationDigestSchema,
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await materializeActiveWorkImportRows(ctx.db, {
          producerId: ctx.producerId,
          clerkUserId: actorId(ctx.userId),
          ...input,
          verificationSecrets: configuredCapabilitySecrets().verification,
        });
      } catch (error) {
        mapDomainError(error);
      }
    }),

  setupOptions: producerProcedure
    .input(z.object({ batchId: idSchema }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return activeWorkImportSetupOptions(
          await loadActiveWorkImportSetupScope(ctx.db, {
            producerId: ctx.producerId,
            batchId: input.batchId,
          }),
        );
      } catch (error) {
        mapDomainError(error);
      }
    }),

  finishSetup: producerProcedure
    .input(
      z
        .object({
          batchId: idSchema,
          operationKey: operationKeySchema,
          expectedSetupDigest: creationDigestSchema,
          selectedClientContactIds: z.array(idSchema).max(500),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await runActiveWorkImportSetup(
          activeWorkImportSetupRepository(ctx.db, ({ message, idempotencyKey }) =>
            sendClientInviteEmail(
              message.to,
              {
                clientName: message.artistName,
                producerName: message.producerName,
                inviteUrl: message.inviteUrl,
              },
              idempotencyKey,
            ),
          ),
          {
            producerId: ctx.producerId,
            clerkUserId: actorId(ctx.userId),
            batchId: input.batchId,
            operationKey: input.operationKey,
            expectedSetupDigest: input.expectedSetupDigest,
            selectedClientContactIds: input.selectedClientContactIds,
            siteUrl: SITE_URL,
          },
        );
      } catch (error) {
        mapDomainError(error);
      }
    }),
});
