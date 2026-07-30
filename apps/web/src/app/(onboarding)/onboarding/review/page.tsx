import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import { inferCurrency } from "~/lib/onboarding/derive";
import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { coerceTaxMode } from "~/lib/tax-mode";
import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";

import { decideOnboardingRedirect } from "../decide-redirect";
import { reviewReadiness } from "./readiness";
import { ReviewStepClient, type OnboardingReviewProduct } from "./review-step-client";

const PREVIEW_PRODUCT: Omit<OnboardingReviewProduct, "currency"> = {
  id: "onboarding-preview-product",
  name: "Signature production",
  tagline: "From the first idea to a release-ready master.",
  priceCents: 180000,
  pricingModel: "flat",
  volumeTiers: [],
  durationMin: 60,
  sessionCount: 3,
  deliverables: ["Production", "Mix", "Master"],
  revisions: 2,
  unlimitedRevisions: false,
  paymentPlans: [{ kind: "split_50_50" }],
  royaltyTerms: {
    master: { mode: "none" },
    composition: { mode: "none" },
  },
  agreementText: "",
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const previewMode = isDevPreviewBypass(params);

  if (previewMode) {
    const requestHeaders = await headers();
    const previewCurrency = inferCurrency(
      requestHeaders.get("x-vercel-ip-country"),
      requestHeaders.get("accept-language"),
    );

    return (
      <ReviewStepClient
        producerName="Maya Stone"
        product={{ ...PREVIEW_PRODUCT, currency: previewCurrency }}
        hoursNotNeeded={false}
        taxMode="tax_free"
        taxRatePct={18}
        previewMode
      />
    );
  }

  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, "review");
  if (redirectTo) redirect(redirectTo);
  if (!userId || role.kind !== "producer-complete") return null;

  const caller = appRouter.createCaller({ userId });
  const [products, availability, profile] = await Promise.all([
    caller.booking.packages.list(),
    caller.booking.availability.list(),
    caller.producer.me(),
  ]);
  const firstProduct = products[0] ?? null;
  const readiness = reviewReadiness({
    product: firstProduct
      ? {
          active: firstProduct.active,
          durationMin: firstProduct.durationMin,
        }
      : null,
    availabilityCount: availability.length,
  });
  if (!readiness.ready) redirect(readiness.redirect);
  if (readiness.alreadyPublished) redirect("/onboarding/complete");
  if (!firstProduct) return null;

  const decoded = decodeDescription(firstProduct.description);
  const product: OnboardingReviewProduct = {
    id: firstProduct.id,
    name: firstProduct.name,
    tagline: decoded.tagline,
    priceCents: firstProduct.priceCents,
    currency: firstProduct.currency,
    pricingModel: firstProduct.pricingModel === "per_song" ? "per_song" : "flat",
    volumeTiers: firstProduct.volumeTiers ?? [],
    durationMin: firstProduct.durationMin,
    sessionCount: firstProduct.sessionCount,
    deliverables: firstProduct.deliverables ?? [],
    revisions: decoded.revisions,
    unlimitedRevisions: decoded.unlimitedRevisions,
    paymentPlans: firstProduct.paymentPlans,
    royaltyTerms: firstProduct.royaltyTerms,
    agreementText: firstProduct.agreementText ?? decoded.contractText,
  };
  const taxRatePct =
    typeof profile.taxRatePct === "number" && Number.isFinite(profile.taxRatePct)
      ? Math.max(0, Math.min(100, Math.round(profile.taxRatePct)))
      : 18;

  return (
    <ReviewStepClient
      producerName={profile.displayName ?? "Your studio"}
      product={product}
      hoursNotNeeded={readiness.hoursNotNeeded}
      taxMode={coerceTaxMode(profile.taxMode)}
      taxRatePct={taxRatePct}
    />
  );
}
