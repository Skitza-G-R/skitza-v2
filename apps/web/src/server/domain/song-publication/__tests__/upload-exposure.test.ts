import { describe, expect, it } from "vitest";

import {
  classifySongUploadPublicExposure,
  requireSongUploadPublicExposureAcknowledgement,
  SongUploadPublicExposureError,
} from "../upload-exposure";

describe("song upload public exposure", () => {
  it.each([
    [{ linkEnabled: false, portfolioPublished: false }, "none"],
    [{ linkEnabled: true, portfolioPublished: false }, "link"],
    [{ linkEnabled: false, portfolioPublished: true }, "portfolio"],
    [{ linkEnabled: true, portfolioPublished: true }, "link_and_portfolio"],
  ] as const)("classifies %o as %s", (state, expected) => {
    expect(classifySongUploadPublicExposure(state)).toBe(expected);
  });

  it.each([
    { linkEnabled: true, portfolioPublished: false },
    { linkEnabled: false, portfolioPublished: true },
    { linkEnabled: true, portfolioPublished: true },
  ])("requires acknowledgement before completing an upload for %o", (state) => {
    expect(() => {
      requireSongUploadPublicExposureAcknowledgement({ ...state, acknowledged: false });
    }).toThrow(SongUploadPublicExposureError);
  });

  it("accepts an upload after the producer acknowledged every active public surface", () => {
    expect(
      requireSongUploadPublicExposureAcknowledgement({
        linkEnabled: true,
        portfolioPublished: true,
        acknowledged: true,
      }),
    ).toBe("link_and_portfolio");
  });

  it("does not demand a warning for a disabled link and private portfolio", () => {
    expect(
      requireSongUploadPublicExposureAcknowledgement({
        linkEnabled: false,
        portfolioPublished: false,
        acknowledged: false,
      }),
    ).toBe("none");
  });

  it("returns a stable, metadata-free error for a missing acknowledgement", () => {
    try {
      requireSongUploadPublicExposureAcknowledgement({
        linkEnabled: true,
        portfolioPublished: false,
        acknowledged: false,
      });
      throw new Error("Expected the public upload to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(SongUploadPublicExposureError);
      expect(error).toMatchObject({ code: "PUBLIC_EXPOSURE_NOT_ACKNOWLEDGED" });
      expect((error as Error).message).toBe(
        "This song is public. Review the public-version warning before completing the upload.",
      );
    }
  });
});
