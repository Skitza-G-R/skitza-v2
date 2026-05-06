import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { PaymentStepClient } from "./payment-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// T8 Step 5 — payment provider placeholder. Server component does the
// role gate; client component renders the disabled card.

export {
  PAYMENT_STEP_INDEX,
  PAYMENT_STEP_TITLE,
  PAYMENT_STEP_SUBTITLE,
  ONBOARDING_STEP_NAME,
  nextRouteAfterPayment,
  routeOnBackFromPayment,
  routeOnSkipFromPayment,
} from "./constants";

export default async function PaymentStepPage() {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") {
    return null;
  }

  return <PaymentStepClient />;
}
