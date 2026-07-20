export type SongUploadPublicExposure = "none" | "link" | "portfolio" | "link_and_portfolio";

export type SongUploadPublicState = Readonly<{
  linkEnabled: boolean;
  portfolioPublished: boolean;
}>;

export class SongUploadPublicExposureError extends Error {
  readonly code = "PUBLIC_EXPOSURE_NOT_ACKNOWLEDGED" as const;

  constructor() {
    super("This song is public. Review the public-version warning before completing the upload.");
    this.name = "SongUploadPublicExposureError";
  }
}

export function classifySongUploadPublicExposure(
  state: SongUploadPublicState,
): SongUploadPublicExposure {
  if (state.linkEnabled && state.portfolioPublished) return "link_and_portfolio";
  if (state.linkEnabled) return "link";
  if (state.portfolioPublished) return "portfolio";
  return "none";
}

/**
 * A completed upload immediately becomes the newest audio on every active
 * public surface. The producer must therefore have seen the warning for the
 * exact locked public state before the upload may cross its completion
 * boundary.
 */
export function requireSongUploadPublicExposureAcknowledgement(
  input: SongUploadPublicState & Readonly<{ acknowledged: boolean }>,
): SongUploadPublicExposure {
  const exposure = classifySongUploadPublicExposure(input);
  if (exposure !== "none" && !input.acknowledged) {
    throw new SongUploadPublicExposureError();
  }
  return exposure;
}
