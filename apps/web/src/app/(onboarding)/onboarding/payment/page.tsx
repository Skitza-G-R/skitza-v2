import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { PaymentStepClient } from "./payment-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// Step 5 (payment / "Get paid"). May 2026 redesign — payout method
// picker. All three options (Stripe Connect / PayPal / Bank transfer)
// remain v1 placeholders per PRD.

export {
  PAYMENT_STEP_INDEX,
  PAYMENT_STEP_TITLE,
  PAYMENT_STEP_SUBTITLE,
  ONBOARDING_STEP_NAME,
  nextRouteAfterPayment,
  routeOnBackFromPayment,
  routeOnSkipFromPayment,
} from "./constants";

export default async function PaymentStepPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);

  if (isPreview) {
    return <PaymentStepClient />;
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

  return <PaymentStepClient />;
}
