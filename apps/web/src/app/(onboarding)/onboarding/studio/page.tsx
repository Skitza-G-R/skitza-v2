import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { inferCurrency } from "~/lib/onboarding/derive";
import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import {
  StudioStepClient,
  defaultTimezone,
  isContinueAllowed,
  nextRouteAfterStudio,
  STUDIO_STEP_INDEX,
  STUDIO_STEP_SUBTITLE,
  STUDIO_STEP_TITLE,
} from "./studio-step-client";

export {
  defaultTimezone,
  isContinueAllowed,
  nextRouteAfterStudio,
  STUDIO_STEP_INDEX,
  STUDIO_STEP_SUBTITLE,
  STUDIO_STEP_TITLE,
};

export default async function StudioStepPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);
  const isCreateStudioIntent = params.intent === "create-studio";
  const requestHeaders = await headers();
  const inferredCurrency = inferCurrency(
    requestHeaders.get("x-vercel-ip-country"),
    requestHeaders.get("accept-language"),
  );

  if (isPreview) {
    return (
      <StudioStepClient
        initialDisplayName=""
        initialSlug=""
        initialCurrency={inferredCurrency}
        initialTimezone="UTC"
        previewMode
      />
    );
  }

  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, "studio", {
    allowArtistCreateStudio: isCreateStudioIntent,
  });
  if (redirectTo) redirect(redirectTo);

  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") {
    return (
      <StudioStepClient
        initialDisplayName=""
        initialSlug=""
        initialCurrency={inferredCurrency}
        initialTimezone="UTC"
        createStudioIntent={isCreateStudioIntent}
      />
    );
  }

  const db = createDb(dbUrl);
  const [producer] = await db
    .select({
      displayName: producers.displayName,
      slug: producers.slug,
      defaultCurrency: producers.defaultCurrency,
      timezone: producers.timezone,
    })
    .from(producers)
    .where(eq(producers.id, role.producer.id))
    .limit(1);

  const supportedCurrency =
    producer?.defaultCurrency === "EUR" ||
    producer?.defaultCurrency === "GBP" ||
    producer?.defaultCurrency === "ILS" ||
    producer?.defaultCurrency === "USD"
      ? producer.defaultCurrency
      : inferredCurrency;

  return (
    <StudioStepClient
      initialDisplayName={producer?.displayName ?? ""}
      initialSlug={producer?.slug ?? role.producer.slug}
      initialCurrency={supportedCurrency}
      initialTimezone={producer?.timezone ?? "UTC"}
      canExit={role.kind === "producer-complete"}
      createStudioIntent={isCreateStudioIntent}
    />
  );
}
