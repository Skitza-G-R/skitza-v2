import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { runtimeLaunchHrefForMemberships } from "~/lib/runtime-state/launch-role";
import { fetchUserAccountMemberships } from "~/server/auth/role";

export const dynamic = "force-dynamic";

export default async function ResolveLaunchRolePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const query = await searchParams;
  const requestedHref =
    typeof query.next === "string" ? query.next : null;
  const memberships = await fetchUserAccountMemberships({ dbUrl, userId });
  redirect(runtimeLaunchHrefForMemberships(memberships, requestedHref));
}
