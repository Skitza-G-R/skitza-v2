import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";

import { decideOnboardingRedirect } from "../decide-redirect";
import { AvailabilityStepClient } from "./availability-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// Step 4 (availability) — simplified to a 7-day grid.
//
// Re-export every constants.ts entry from the page so the existing
// test imports (`from "../page"`) keep working without modification.
// Named (not `export *`) so Next.js's static page-module analysis has
// a finite export list — `export *` makes Next probe for the special
// metadata exports (generateMetadata/generateViewport/
// generateImageMetadata) and the build emits import-error warnings
// when they're absent.
export {
  AVAILABILITY_STEP_INDEX,
  AVAILABILITY_STEP_TITLE,
  AVAILABILITY_STEP_SUBTITLE,
  ONBOARDING_STEP_NAME,
  AVAILABILITY_CONTINUE_ALWAYS_ENABLED,
  nextRouteAfterAvailability,
  routeOnSkipFromAvailability,
  routeOnBackFromAvailability,
} from "./constants";

type StoredBlock = { weekday: number; startMin: number; endMin: number };

async function fetchAvailabilityBlocks(userId: string): Promise<StoredBlock[]> {
  const caller = appRouter.createCaller({ userId });
  const rows = await caller.booking.availability.list();
  return rows.map((b) => ({
    weekday: b.weekday,
    startMin: b.startMin,
    endMin: b.endMin,
  }));
}

export default async function AvailabilityStepPage() {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") {
    return null;
  }
  if (!userId) return null;

  const blocks = await fetchAvailabilityBlocks(userId);

  return <AvailabilityStepClient blocks={blocks} />;
}
