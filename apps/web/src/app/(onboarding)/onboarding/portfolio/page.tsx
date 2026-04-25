import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect, type OnboardingStep } from "../decide-redirect";
import { PortfolioStepClient } from "./portfolio-step-client";

// Story 08 (α-trimmed) — Step 4: portfolio links page.
//
// The original Story 08 plan composed two children: <ExternalLinksEditor>
// (Story 06, shipped) + <PortfolioUploaderCard> (Story 07, deferred).
// Story 07 was deferred because of a schema FK blocker — track_versions.
// trackId is hardwired to projectTracks (NOT portfolioTracks), so the
// existing AudioUploader pipeline can't be reused for portfolio uploads
// without architectural work. Producers upload tracks via Setup →
// Portfolio for now (existing surface, working flow).
//
// So Step 4 is now: <ExternalLinksEditor /> + a one-line helper copy
// directing producers to Setup for track uploads. Continue saves any
// typed links via saveExternalLinks then routes to /dashboard. Skip
// routes to /dashboard immediately.
//
// Why server + client split (mirrors Stories 04 + 05):
//   • The default export is a Server Component because the role gate
//     uses auth() + Drizzle (fetchUserRole) — server-only.
//   • <OnboardingShell> + <ExternalLinksEditor> + saveExternalLinks's
//     calling site need useState + useRouter + useTransition — the
//     shell-and-editor pair must be hosted by a client component.
//   • The split lets us add a defense-in-depth role re-check at the
//     page level even though the layout already enforces the matrix
//     via decideOnboardingRedirect(role, "portfolio").
//
// The pure constants + helpers consumed by the test suite are exported
// below, mirroring Stories 04 + 05's pattern. The repo runs vitest in
// `node` env (no jsdom) so tests assert the constants + route helpers
// directly — no JSX render.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const PORTFOLIO_STEP_INDEX: 1 | 2 | 3 | 4 = 4;

/** H1 displayed by the shell. Pinned by tests + architecture §6. */
export const PORTFOLIO_STEP_TITLE = "Show your work.";

/**
 * Subtitle copy. Reassures the producer they don't need to fill every
 * platform — and surfaces the deferred upload flow so Step 4 doesn't
 * feel incomplete. Pin a substring (later/setup/skip/portfolio) so a
 * future copy edit that drops the upload-from-Setup mention forces a
 * deliberate update.
 */
export const PORTFOLIO_STEP_SUBTITLE =
  "Add your streaming links — you can upload tracks later from Setup → Portfolio.";

/**
 * One-line helper copy rendered above the link inputs. Shorter than
 * the subtitle; reinforces the "this is optional" framing. Tests pin
 * a substring to catch copy regressions.
 */
export const PORTFOLIO_HELPER_COPY =
  "All three are optional — fill what you have, skip what you don't.";

/**
 * OnboardingStep tag for this page. Passed to decideOnboardingRedirect
 * so the wire-format "portfolio" string lives in exactly one place. A
 * typo here would silently fall back to the default-arg "studio" branch
 * in the redirect helper, which is the kind of failure that's easy to
 * miss in manual QA — pinning it via a test catches it.
 */
export const ONBOARDING_STEP_NAME: OnboardingStep = "portfolio";

/**
 * Continue route after the (optional) save. Pinned to /dashboard — Step
 * 4 is the last step, so Continue ends the wizard. Telemetry will fire
 * step_completed before the navigate; routing stays the same regardless.
 */
export function routeOnContinueFromPortfolio(): "/dashboard" {
  return "/dashboard";
}

/**
 * Skip ghost link target. Identical to the Continue destination — Skip
 * just elides the saveExternalLinks call. The distinction is telemetry-
 * only (step_skipped vs step_completed), not navigation.
 *
 * Kept as its own helper (rather than re-exporting routeOnContinueFromPortfolio)
 * so a future divergence (e.g. Skip jumps to /dashboard?postOnboarding=skipped)
 * is a single-line change and the test asserts the current invariant.
 */
export function routeOnSkipFromPortfolio(): "/dashboard" {
  return "/dashboard";
}

/**
 * Step 4 → Step 3 route for the Back button. The wizard is a strict
 * 4-step linear flow; Back from Step 4 lands on Step 3 (availability).
 */
export function routeOnBackFromPortfolio(): "/onboarding/availability" {
  return "/onboarding/availability";
}

export default async function PortfolioStepPage() {
  // Page-level role guard. The layout already enforces the role wall
  // (artist + unauth + producer-incomplete-on-non-studio), but Stories
  // 04 + 05 established the page-level re-check as defense in depth.
  // If the layout ever drops its role check, the wizard pages still
  // self-protect.
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  // Only producer-{complete,incomplete} reach this point (the role
  // matrix in decide-redirect proves it). The orphan branch redirected
  // to /onboarding/studio above; producer-complete on /onboarding/
  // portfolio returned null (render). The layout's same-step guard
  // already redirected the rest.
  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") {
    return null;
  }

  // No data fetch needed — links are saved on Continue, not loaded.
  // (Re-entering the wizard mid-flow with already-saved links would be
  // a Setup → Portfolio concern, not onboarding's; Step 4's role here
  // is the first-time capture, not the edit.)
  return <PortfolioStepClient />;
}
