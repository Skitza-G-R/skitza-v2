import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { ServiceStepClient } from "./service-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// Story 04 — Step 2: first service via NewPackageForm reuse.
//
// The pure constants + route helpers live in ./constants — both this
// Server Component and ./service-step-client (a "use client" module)
// import from there. Without that split, the client bundle would
// transitively pull in this file's server-only deps (auth, fetchUserRole,
// next/headers via the appRouter chain) and Vercel's build would fail
// with an RSC boundary violation. See CLAUDE.md mistake log 2026-04-23.

// Re-export every constants.ts entry from the page so existing test
// imports (`from "../page"`) keep working without modification. The
// client component imports directly from ./constants to skip this
// re-export and avoid the server bundle.
export * from "./constants";

export default async function ServiceStepPage() {
  // Page-level role guard. The layout already enforces the artist +
  // unauthenticated walls (story 04 doesn't change that), but the
  // layout's call defaults `currentStep="studio"` which redirects
  // producer-complete users to /dashboard. Re-run with the
  // step-aware arg so producer-complete on /onboarding/service is
  // allowed to render (mid-flow continuation after Step 1).
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  return <ServiceStepClient />;
}
