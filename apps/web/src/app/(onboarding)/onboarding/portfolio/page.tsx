import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { PortfolioStepClient } from "./portfolio-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

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

// Re-export every constants.ts entry so existing test imports
// (`from "../page"`) keep working without modification. The client
// component imports directly from ./constants to skip this re-export
// and avoid the server bundle.
export * from "./constants";

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
