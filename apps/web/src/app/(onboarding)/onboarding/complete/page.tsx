import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { CompleteScreenClient } from "./complete-screen-client";

// T8 — completion screen. NOT wrapped by OnboardingShell (no progress
// bar, no header eyebrow, no action bar) — this is the post-wizard
// celebration moment. The role gate still runs: producer-complete
// renders, producer-incomplete bounces back to /onboarding/studio
// (handled by decideOnboardingRedirect's existing non-studio rule).

export default async function CompleteScreenPage() {
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
