/**
 * Dev-only preview bypass for the producer onboarding wizard.
 *
 * Lets a developer (or Claude in the preview tool) visually verify
 * each onboarding step without needing a fresh-producer Clerk session
 * each time. The bypass is gated by TWO independent conditions that
 * must both hold:
 *
 *   1. `process.env.NODE_ENV === "development"` — Vercel sets
 *      NODE_ENV="production" on every deployed environment (preview +
 *      production), so this branch is genuinely unreachable from any
 *      URL pointed at the deployed app.
 *
 *   2. The request carries `?__preview=1` in its query string. Opt-in
 *      per request — there is no global "auth is off" mode, and an
 *      accidental visit to /onboarding/welcome doesn't trip it.
 *
 * Used by:
 *   - middleware.ts (skips Clerk auth.protect for the request)
 *   - each onboarding step's page.tsx (skips the role redirect so an
 *     already-completed producer can still see the step UI for review)
 *
 * Tested in dev-preview.test.ts.
 */
export function isDevPreviewBypass(
  searchParams:
    | Record<string, string | string[] | undefined>
    | URLSearchParams,
): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get("__preview") === "1";
  }
  return searchParams.__preview === "1";
}
