import { describe, expect, it, vi } from "vitest";

import { copyPublicLink } from "../public-link-strip";

describe("copyPublicLink", () => {
  it("reports success only after the clipboard write resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyPublicLink("https://skitza.app/join/gili", writeText)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://skitza.app/join/gili");
  });

  it("reports failure for rejected or unavailable clipboard writes", async () => {
    const rejectedWrite = vi.fn().mockRejectedValue(new Error("denied"));

    await expect(copyPublicLink("https://skitza.app/join/gili", rejectedWrite)).resolves.toBe(
      false,
    );
    await expect(copyPublicLink("https://skitza.app/join/gili", undefined)).resolves.toBe(false);
  });
});
