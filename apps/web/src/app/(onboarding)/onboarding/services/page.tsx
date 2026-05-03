import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { ServicesStepClient } from "./services-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// T8 Step 2 — services (multi-select role chips). Server component
// owns the role gate + initial-roles fetch; the client component owns
// the chip UI + saveServiceRoles call.

export {
  SERVICES_STEP_INDEX,
  SERVICES_STEP_TITLE,
  SERVICES_STEP_SUBTITLE,
  SERVICE_ROLE_OPTIONS,
  ONBOARDING_STEP_NAME,
  isContinueAllowed,
  nextRouteAfterServices,
  routeOnBackFromServices,
  routeOnSkipFromServices,
} from "./constants";

export default async function ServicesStepPage() {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") {
    return null;
  }

  // Pre-seed the form with whatever the producer saved last time so
  // re-entry feels continuous (matches Setup's editing affordance).
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ serviceRoles: producers.serviceRoles })
    .from(producers)
    .where(eq(producers.id, role.producer.id))
    .limit(1);
  const initialRoles = row?.serviceRoles ?? [];

  return <ServicesStepClient initialRoles={initialRoles} />;
}
