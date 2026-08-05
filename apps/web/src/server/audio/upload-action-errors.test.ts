import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { toSafeUploadStageError } from "./upload-action-errors";

describe("safe upload action errors", () => {
  it("identifies each upload stage without exposing unknown provider details", () => {
    const providerError = new Error(
      "request failed for https://storage.invalid/?X-Amz-Credential=private-token",
    );

    expect(toSafeUploadStageError("initiation", providerError)).toBe(
      "Upload setup failed. Please try again.",
    );
    expect(toSafeUploadStageError("presign", providerError)).toBe(
      "Upload link preparation failed. Please try again.",
    );
    expect(toSafeUploadStageError("completion", providerError)).toBe(
      "Upload completion failed. Please try again.",
    );
    expect(toSafeUploadStageError("cancellation", providerError)).toBe(
      "Upload cancellation failed. Skitza kept the recovery record; please try again.",
    );
  });

  it("keeps safe lifecycle guidance from expected application conflicts", () => {
    expect(
      toSafeUploadStageError(
        "presign",
        new TRPCError({ code: "CONFLICT", message: "This upload was canceled." }),
      ),
    ).toBe("Upload link preparation failed. This upload was canceled.");
  });

  it("classifies the first-Version safe signing marker as presign, not initiation", () => {
    expect(
      toSafeUploadStageError(
        "initiation",
        new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Upload link preparation failed. Please try again.",
        }),
      ),
    ).toBe("Upload link preparation failed. Please try again.");
  });
});
