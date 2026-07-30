import { describe, expect, it } from "vitest";

import { isDevGalleryAvailable } from "./dev-gallery-access";

describe("isDevGalleryAvailable", () => {
  it("allows local development", () => {
    expect(
      isDevGalleryAvailable({
        nodeEnv: "development",
      }),
    ).toBe(true);
  });

  it("allows a Vercel Preview build even though NODE_ENV is production", () => {
    expect(
      isDevGalleryAvailable({
        nodeEnv: "production",
        vercelEnv: "preview",
      }),
    ).toBe(true);
  });

  it("allows Vercel development", () => {
    expect(
      isDevGalleryAvailable({
        nodeEnv: "production",
        vercelEnv: "development",
      }),
    ).toBe(true);
  });

  it("always rejects Vercel Production", () => {
    expect(
      isDevGalleryAvailable({
        nodeEnv: "development",
        vercelEnv: "production",
      }),
    ).toBe(false);
  });

  it("rejects non-Vercel production and unknown environments", () => {
    expect(isDevGalleryAvailable({ nodeEnv: "production" })).toBe(false);
    expect(isDevGalleryAvailable({})).toBe(false);
  });
});
