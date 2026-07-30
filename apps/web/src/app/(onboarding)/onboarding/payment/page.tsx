import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";

import { decideOnboardingRedirect } from "../decide-redirect";
import { PaymentStepClient } from "./payment-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

const EMPTY_PAYMENT_INSTRUCTIONS = {
  bankTransfer: "",
  bitPhone: "",
  note: "",
};

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
    return <PaymentStepClient previewMode initialInstructions={EMPTY_PAYMENT_INSTRUCTIONS} />;
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

  const caller = appRouter.createCaller({ userId });
  const paymentInstructions = await caller.producer.purchase.paymentInstructions.get();

  return (
    <PaymentStepClient
      initialInstructions={{
        bankTransfer: paymentInstructions.bankTransfer ?? "",
        bitPhone: paymentInstructions.bitPhone ?? "",
        note: paymentInstructions.note ?? "",
      }}
    />
  );
}
