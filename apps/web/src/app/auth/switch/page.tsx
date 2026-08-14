import { auth } from "~/server/auth/clerk-identity";
import { redirect } from "next/navigation";

import { chosenRoleDestination, type AuthPlatform } from "~/server/auth/post-sign-in";
import { fetchUserAccountMemberships } from "~/server/auth/role";

export const dynamic = "force-dynamic";

export default async function SwitchRolePage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string | string[];
    next?: string | string[];
  }>;
}) {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const query = await searchParams;
  const chosenRole: AuthPlatform = query.role === "artist" ? "artist" : "producer";
  const requestedTarget = typeof query.next === "string" ? query.next : null;
  const memberships = await fetchUserAccountMemberships({ dbUrl, userId });

  redirect(chosenRoleDestination(memberships, chosenRole, requestedTarget));
}
