import { auth } from "~/server/auth/clerk-identity";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { resolveOnboardingResume } from "~/lib/onboarding/resume";
import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function OnboardingIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (isDevPreviewBypass(params)) {
    redirect("/onboarding/welcome?__preview=1");
  }

  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  if (role.kind === "unauthenticated") redirect("/sign-in");
  if (role.kind === "artist") redirect("/artist");

  const identityComplete = role.kind === "producer-complete";
  if (!identityComplete || !userId) {
    redirect(
      resolveOnboardingResume({
        identityComplete: false,
        firstNonArchivedProduct: null,
        availabilityCount: 0,
      }),
    );
  }

  const caller = appRouter.createCaller({ userId });
  const [products, availability] = await Promise.all([
    caller.booking.packages.list(),
    caller.booking.availability.list(),
  ]);
  const firstProduct = products[0] ?? null;

  redirect(
    resolveOnboardingResume({
      identityComplete: true,
      firstNonArchivedProduct: firstProduct
        ? {
            active: firstProduct.active,
            bookingEnabled: firstProduct.bookingEnabled,
          }
        : null,
      availabilityCount: availability.length,
    }),
  );
}
