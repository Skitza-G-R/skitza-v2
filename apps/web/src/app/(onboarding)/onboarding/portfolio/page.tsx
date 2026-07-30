import { auth } from "@clerk/nextjs/server";
import { asc, createDb, eq, producerExternalLinks } from "@skitza/db";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { PortfolioStepClient } from "./portfolio-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// Optional post-publish portfolio task. Re-export constants so the server page
// stays the stable import boundary for its contract tests.

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
    return <PortfolioStepClient previewMode />;
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

  const db = createDb(dbUrl);
  const initialLinks = await db
    .select({
      platform: producerExternalLinks.platform,
      url: producerExternalLinks.url,
      title: producerExternalLinks.title,
    })
    .from(producerExternalLinks)
    .where(eq(producerExternalLinks.producerId, role.producer.id))
    .orderBy(asc(producerExternalLinks.position));

  return <PortfolioStepClient initialLinks={initialLinks} />;
}
