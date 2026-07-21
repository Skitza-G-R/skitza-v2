import { describe, expect, it } from "vitest";

import { metadata } from "../page";

describe("public song page metadata", () => {
  it("is noindex, nofollow, no-cache, and does not forward its secret URL", () => {
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    });
    expect(metadata.referrer).toBe("no-referrer");
  });
});
