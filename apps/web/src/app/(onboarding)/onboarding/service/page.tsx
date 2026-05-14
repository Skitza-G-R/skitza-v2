import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { ServiceStepClient } from "./service-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

type SupportedCurrency = "USD" | "EUR" | "GBP" | "ILS";
const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set([
  "USD",
  "EUR",
  "GBP",
  "ILS",
]);

async function fetchProducerCurrency(
  dbUrl: string,
  producerId: string,
): Promise<SupportedCurrency> {
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ defaultCurrency: producers.defaultCurrency })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1);
  return row && SUPPORTED_CURRENCIES.has(row.defaultCurrency)
    ? (row.defaultCurrency as SupportedCurrency)
    : "USD";
}

// Re-export every constants entry from the page so the existing test
// imports (`from "../page"`) keep working without modification.
export {
  SERVICE_STEP_INDEX,
  SERVICE_STEP_TITLE,
  SERVICE_STEP_SUBTITLE,
  ONBOARDING_STEP_NAME,
  nextRouteAfterService,
  routeOnBackFromService,
  routeOnSkipFromService,
} from "./constants";

export default async function ServiceStepPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);

  if (isPreview) {
    return <ServiceStepClient defaultCurrency="USD" />;
  }

  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  const producerId =
    role.kind === "producer-complete" || role.kind === "producer-incomplete"
      ? role.producer.id
      : null;
  if (!producerId) return null;

  const defaultCurrency = await fetchProducerCurrency(dbUrl, producerId);

  return <ServiceStepClient defaultCurrency={defaultCurrency} />;
}
