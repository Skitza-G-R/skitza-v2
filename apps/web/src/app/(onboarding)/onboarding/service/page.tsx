import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { redirect } from "next/navigation";

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

async function fetchProducerSetup(
  dbUrl: string,
  producerId: string,
): Promise<{
  defaultCurrency: SupportedCurrency;
  serviceRoles: string[];
}> {
  const db = createDb(dbUrl);
  const [row] = await db
    .select({
      defaultCurrency: producers.defaultCurrency,
      serviceRoles: producers.serviceRoles,
    })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1);
  const currency =
    row && SUPPORTED_CURRENCIES.has(row.defaultCurrency)
      ? (row.defaultCurrency as SupportedCurrency)
      : "USD";
  const roles = row?.serviceRoles ?? [];
  return { defaultCurrency: currency, serviceRoles: roles };
}

// Re-export every constants.ts entry from the page so the test suite's
// `from "../page"` imports keep working without modification.
export {
  SERVICE_STEP_INDEX,
  SERVICE_STEP_TITLE,
  SERVICE_STEP_SUBTITLE,
  ONBOARDING_STEP_NAME,
  nextRouteAfterService,
  routeOnBackFromService,
  routeOnSkipFromService,
} from "./constants";

export default async function ServiceStepPage() {
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

  const { defaultCurrency, serviceRoles } = await fetchProducerSetup(
    dbUrl,
    producerId,
  );

  return (
    <ServiceStepClient
      defaultCurrency={defaultCurrency}
      serviceRoles={serviceRoles}
    />
  );
}
