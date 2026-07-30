import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { StoreProduct } from "~/app/(producer)/dashboard/store/store-screen";
import { inferCurrency } from "~/lib/onboarding/derive";
import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { coerceTaxMode } from "~/lib/tax-mode";
import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";

import { decideOnboardingRedirect } from "../decide-redirect";
import { ONBOARDING_STEP_NAME } from "./constants";
import { ServiceStepClient } from "./service-step-client";

type SupportedCurrency = "USD" | "EUR" | "GBP" | "ILS";
const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set(["USD", "EUR", "GBP", "ILS"]);

function toStoreProduct(
  product: Awaited<
    ReturnType<ReturnType<typeof appRouter.createCaller>["booking"]["packages"]["list"]>
  >[number],
): StoreProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceCents: product.priceCents,
    currency: product.currency,
    active: product.active,
    kind: product.kind,
    durationMin: product.durationMin,
    sessionCount: product.sessionCount,
    paymentPlans: product.paymentPlans,
    locationType: product.locationType,
    bufferMinutes: product.bufferMinutes,
    minLeadHours: product.minLeadHours,
    contractUrl: product.contractUrl,
    royaltyTerms: product.royaltyTerms,
    agreementText: product.agreementText,
    deliverables: product.deliverables ?? [],
    pricingModel: product.pricingModel,
    volumeTiers: product.volumeTiers,
    removalAction: product.removalAction,
  };
}

export {
  SERVICE_STEP_INDEX,
  SERVICE_STEP_TITLE,
  SERVICE_STEP_SUBTITLE,
  ONBOARDING_STEP_NAME,
  nextRouteAfterService,
  routeOnBackFromService,
} from "./constants";

export default async function ServiceStepPage({
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
      <ServiceStepClient
        product={null}
        defaultCurrency={previewCurrency}
        taxMode="tax_free"
        taxRatePct={18}
        producerName="Maya Stone"
        previewMode
      />
    );
  }

  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);
  if (!userId || role.kind !== "producer-complete") return null;

  const caller = appRouter.createCaller({ userId });
  const [packages, profile] = await Promise.all([
    caller.booking.packages.list(),
    caller.producer.me(),
  ]);
  const defaultCurrency = SUPPORTED_CURRENCIES.has(profile.defaultCurrency)
    ? (profile.defaultCurrency as SupportedCurrency)
    : "USD";
  const taxRatePct =
    typeof profile.taxRatePct === "number" && Number.isFinite(profile.taxRatePct)
      ? Math.max(0, Math.min(100, Math.round(profile.taxRatePct)))
      : 18;

  return (
    <ServiceStepClient
      product={packages[0] ? toStoreProduct(packages[0]) : null}
      defaultCurrency={defaultCurrency}
      taxMode={coerceTaxMode(profile.taxMode)}
      taxRatePct={taxRatePct}
      producerName={profile.displayName ?? "Your studio"}
    />
  );
}
