import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";

import { decideOnboardingRedirect } from "../decide-redirect";
import { AvailabilityStepClient } from "./availability-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// Step 3 (availability / "When you work"). May 2026 redesign — was
// Step 4 of 6; now Step 3 of 5.
//
// Re-export every constants entry so the existing test imports
// (`from "../page"`) keep working without modification.
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

export default async function AvailabilityStepPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);

  if (isPreview) {
    return <AvailabilityStepClient blocks={[]} />;
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
  if (!userId) return null;

  // Parallel fetch — blocks for the day rows, producer profile for the
  // week-start preference (DB-backed since the Settings redesign so the
  // value follows the producer across devices + surfaces).
  const caller = appRouter.createCaller({ userId });
  const [blocks, profile] = await Promise.all([
    fetchAvailabilityBlocks(userId),
    caller.producer.me(),
  ]);
  const initialWeekStart =
    profile.weekStart === "monday" ? "monday" : "sunday";

  return (
    <AvailabilityStepClient blocks={blocks} initialWeekStart={initialWeekStart} />
  );
}
