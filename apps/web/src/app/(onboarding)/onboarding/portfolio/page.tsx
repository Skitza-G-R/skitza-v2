import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { PortfolioStepClient } from "./portfolio-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// Step 4 (portfolio / "A taste"). May 2026 redesign — was Step 6 of 6
// in the legacy flow; now Step 4 of 5 (redesign reorders portfolio
// BEFORE payment).
//
// Re-export every constants entry so existing test imports
// (`from "../page"`) keep working.

export {
  PORTFOLIO_STEP_INDEX,
  PORTFOLIO_STEP_TITLE,
  PORTFOLIO_STEP_SUBTITLE,
  PORTFOLIO_HELPER_COPY,
  ONBOARDING_STEP_NAME,
  routeOnContinueFromPortfolio,
  routeOnSkipFromPortfolio,
  routeOnBackFromPortfolio,
} from "./constants";

export default async function PortfolioStepPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);

  if (isPreview) {
    return <PortfolioStepClient />;
  }

  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") {
    return null;
  }

  return <PortfolioStepClient />;
}
