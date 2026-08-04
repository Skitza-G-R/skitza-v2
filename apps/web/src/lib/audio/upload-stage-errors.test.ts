import { describe, expect, it } from "vitest";

import { uploadStageFailure, uploadTransferFailure } from "./upload-stage-errors";

describe("upload stage errors", () => {
  it("keeps browser transfer failures specific without exposing a signed URL", () => {
    expect(uploadTransferFailure()).toBe(
      "Audio transfer failed. Check your connection and try again.",
    );
    expect(uploadTransferFailure({ partNumber: 2 })).toBe(
      "Audio transfer failed on part 2. Check your connection and try again.",
    );
    expect(uploadTransferFailure({ partNumber: 2, status: 403 })).toBe(
      "Audio transfer failed on part 2 (HTTP 403). Please try again.",
    );
  });

  it("names a failed durable cancellation and retained recovery state", () => {
    expect(uploadStageFailure("cancellation")).toBe(
      "Upload cancellation failed. Skitza kept the recovery record; please try again.",
    );
  });
});
