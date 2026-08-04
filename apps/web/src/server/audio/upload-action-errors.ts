import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

import { uploadStageFailure, type UploadFailureStage } from "~/lib/audio/upload-stage-errors";

function zodMessage(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid upload details.";
  const field = first.path.join(".");
  return field ? `${field}: ${first.message}` : first.message;
}

function safeUploadDetail(error: unknown): string | undefined {
  if (error instanceof ZodError) return zodMessage(error);
  if (!(error instanceof TRPCError)) return undefined;
  if (error.cause instanceof ZodError) return zodMessage(error.cause);

  switch (error.code) {
    case "UNAUTHORIZED":
      return "Please sign in to continue.";
    case "FORBIDDEN":
      return "You don't have access to this Song.";
    case "NOT_FOUND":
      return "We couldn't find this Song or upload.";
    case "BAD_REQUEST":
    case "CONFLICT":
    case "PRECONDITION_FAILED":
      return error.message || undefined;
    default:
      return undefined;
  }
}

function classifiedUploadStage(
  fallbackStage: UploadFailureStage,
  error: unknown,
): UploadFailureStage {
  if (
    fallbackStage === "initiation" &&
    error instanceof TRPCError &&
    error.code === "PRECONDITION_FAILED" &&
    error.message === uploadStageFailure("presign")
  ) {
    return "presign";
  }
  return fallbackStage;
}

/**
 * Upload actions may receive provider and signed-request errors. Only known
 * application errors are included; unknown details stay server-side.
 */
export function toSafeUploadStageError(stage: UploadFailureStage, error: unknown): string {
  return uploadStageFailure(classifiedUploadStage(stage, error), safeUploadDetail(error));
}
