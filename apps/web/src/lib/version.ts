export const APP_VERSION = "0.0.0";
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
