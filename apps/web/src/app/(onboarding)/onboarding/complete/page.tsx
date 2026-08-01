import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";

import { decideOnboardingRedirect } from "../decide-redirect";
import { CompleteScreenClient } from "./complete-screen-client";

export default async function CompleteScreenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);

  if (isPreview) {
    return <CompleteScreenClient slug="preview-studio" previewMode />;
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
  const packages = await caller.booking.packages.list();
  if (!packages.some((product) => product.active)) {
    redirect("/onboarding");
  }

  const db = createDb(dbUrl);
  const [row] = await db
    .select({ slug: producers.slug })
    .from(producers)
    .where(eq(producers.id, role.producer.id))
    .limit(1);

  const slug = row?.slug ?? role.producer.slug;
  return <CompleteScreenClient slug={slug} />;
}
