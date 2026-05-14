import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { CompleteScreenClient } from "./complete-screen-client";

// Done — post-Step 5 celebration screen. May 2026 redesign — wrapped
// in WizardChrome with all 5 rail rows marked completed.
//
// Producer-complete renders; producer-incomplete bounces back to
// /onboarding/studio (handled by decideOnboardingRedirect's existing
// non-studio rule).

export default async function CompleteScreenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);

  if (isPreview) {
    return <CompleteScreenClient slug="preview-studio" />;
  }

  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, "complete");
  if (redirectTo) redirect(redirectTo);

  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") {
    return null;
  }

  // Pull the slug fresh from the producers row so the join link is
  // accurate even if the producer renamed their studio mid-flow.
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ slug: producers.slug })
    .from(producers)
    .where(eq(producers.id, role.producer.id))
    .limit(1);

  const slug = row?.slug ?? role.producer.slug;
  return <CompleteScreenClient slug={slug} />;
}
