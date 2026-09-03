import { auth } from "~/server/auth/clerk-identity";
import { createDb, eq, producers } from "@skitza/db";
import { redirect } from "next/navigation";

import { PREVIEW_SIMULATION_INPUT } from "~/components/onboarding/first-artist-simulation/simulation-model";
import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";

import { decideOnboardingRedirect } from "../decide-redirect";
import { CompleteScreenClient } from "./complete-screen-client";
import { toSimulationInput, type CompletionPaymentInstructions } from "./simulation-input";

export default async function CompleteScreenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);

  if (isPreview) {
    return (
      <CompleteScreenClient
        slug="preview-studio"
        previewMode
        simulation={PREVIEW_SIMULATION_INPUT}
      />
    );
  }

  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, "complete");
  if (redirectTo) redirect(redirectTo);

  if (!userId || (role.kind !== "producer-complete" && role.kind !== "producer-incomplete")) {
    return null;
  }

  const caller = appRouter.createCaller({ userId });
  const [packages, profile] = await Promise.all([
    caller.booking.packages.list(),
    caller.producer.me(),
  ]);
  if (!packages.some((product) => product.active)) {
    redirect("/onboarding");
  }
  const liveProduct = packages.find((product) => product.active) ?? null;

  // The producer's own bank/Bit details make the simulation's payment frame
  // real; a producer who skipped that optional step sees a labelled example.
  let paymentInstructions: CompletionPaymentInstructions | null = null;
  try {
    paymentInstructions = await caller.producer.purchase.paymentInstructions.get();
  } catch {
    paymentInstructions = null;
  }

  const db = createDb(dbUrl);
  const [row] = await db
    .select({ slug: producers.slug })
    .from(producers)
    .where(eq(producers.id, role.producer.id))
    .limit(1);

  const slug = row?.slug ?? role.producer.slug;
  const simulation = liveProduct
    ? toSimulationInput({
        product: liveProduct,
        profile: {
          displayName: profile.displayName,
          taxMode: profile.taxMode,
          taxRatePct: profile.taxRatePct,
          logoUrl: profile.brand.logoUrl ?? null,
          timezone: profile.timezone,
        },
        paymentInstructions,
      })
    : null;

  return <CompleteScreenClient slug={slug} simulation={simulation} />;
}
