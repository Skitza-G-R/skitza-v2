import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

import { OnboardingWizard } from "./onboarding-wizard";

// Onboarding page — first-run 4-step wizard. Redirected to from
// /dashboard when the detect-heuristic says "this producer hasn't
// started". Rendered inside (app) so the Clerk middleware + producer
// provisioning still apply. No AppShell — the wizard wants the full
// viewport and its own header.
export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const me = await caller.producer.me();

  // Derive the public URL origin from the incoming request so it works
  // across environments (localhost, preview, prod) without an env var.
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "skitza.app";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const appOrigin = `${proto}://${host}`;

  const publicUrl = `${appOrigin}/p/${me.slug}/book`;

  return (
    <OnboardingWizard
      initial={{
        displayName: me.displayName ?? "",
        slug: me.slug,
        defaultCurrency: me.defaultCurrency,
        publicUrl,
        appOrigin,
      }}
    />
  );
}
