type DevGalleryEnvironment = Readonly<{
  nodeEnv?: string | undefined;
  vercelEnv?: string | undefined;
}>;

/**
 * Preview galleries are available in local development and Vercel Preview.
 * Vercel Production is an explicit deny even if another environment value is
 * misconfigured.
 */
export function isDevGalleryAvailable(
  environment: DevGalleryEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  },
): boolean {
  if (environment.vercelEnv === "production") return false;
  if (environment.vercelEnv === "preview" || environment.vercelEnv === "development") {
    return true;
  }
  return environment.nodeEnv === "development";
}
