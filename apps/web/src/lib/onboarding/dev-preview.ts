/**
 * Non-production preview bypass for the producer onboarding wizard.
 *
 * Lets a developer (or Claude in the preview tool) visually verify
 * each onboarding step without needing a fresh-producer Clerk session
 * each time. The bypass is gated by TWO independent conditions that
 * must both hold:
 *
 *   1. The app is running locally in development or in Vercel's
 *      isolated preview environment. Production deployments never pass.
 *
 *   2. The request carries `?__preview=1` in its query string. Opt-in
 *      per request — there is no global "auth is off" mode, and an
 *      accidental visit to /onboarding/welcome doesn't trip it.
 *
 * Used by:
 *   - middleware.ts (skips Clerk auth.protect for the request)
 *   - the preview deployment homepage (lands one-click share links
 *     on the onboarding walkthrough after Vercel sets its access cookie)
 *   - each onboarding step's page.tsx (skips the role redirect so an
 *     already-completed producer can still see the step UI for review)
 *
 * Tested in dev-preview.test.ts.
 */
export function isDevPreviewBypass(
  searchParams: Record<string, string | string[] | undefined> | URLSearchParams,
): boolean {
  const previewEnvironment =
    process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview";
  if (!previewEnvironment) return false;
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get("__preview") === "1";
  }
  return searchParams.__preview === "1";
}
