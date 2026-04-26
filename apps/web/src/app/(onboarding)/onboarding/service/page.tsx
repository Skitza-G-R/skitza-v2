import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { ServiceStepClient } from "./service-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

// The producer's default currency was set in Step 1 (completeStudio
// inferred it from x-vercel-ip-country / accept-language). NewPackageForm
// would otherwise default to USD even for an Israeli producer whose
// producers.default_currency is ILS — fetch it here so the form's
// currency dropdown opens with the right value pre-selected.
type SupportedCurrency = "USD" | "EUR" | "GBP" | "ILS";
const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set([
  "USD",
  "EUR",
  "GBP",
  "ILS",
]);

async function fetchProducerDefaultCurrency(
  dbUrl: string,
  producerId: string,
): Promise<SupportedCurrency | undefined> {
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ defaultCurrency: producers.defaultCurrency })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1);
  if (!row) return undefined;
  // schema.ts stores default_currency as plain text (no enum) so we
  // narrow defensively. Anything outside the supported 4 falls through
  // and the form picks its own USD fallback.
  return SUPPORTED_CURRENCIES.has(row.defaultCurrency)
    ? (row.defaultCurrency as SupportedCurrency)
    : undefined;
}

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

  // Only producer-{complete,incomplete} reach this point (the role
  // matrix in decide-redirect proves it; the layout's gate redirects
  // the rest). Both shapes carry a populated `producer` field.
  const producerId =
    role.kind === "producer-complete" || role.kind === "producer-incomplete"
      ? role.producer.id
      : null;
  const defaultCurrency = producerId
    ? await fetchProducerDefaultCurrency(dbUrl, producerId)
    : undefined;

  // Spread to satisfy exactOptionalPropertyTypes — passing undefined to
  // an `?:` field is rejected by tsc; conditional spread mirrors the
  // pattern shell.tsx uses for its optional handlers.
  return (
    <ServiceStepClient {...(defaultCurrency ? { initialCurrency: defaultCurrency } : {})} />
  );
}
