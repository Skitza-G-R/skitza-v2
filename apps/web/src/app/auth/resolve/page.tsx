import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { postSignInDestination } from "~/server/auth/post-sign-in";
import { fetchUserAccountMemberships } from "~/server/auth/role";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Opening Skitza",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AuthResolvePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const query = await searchParams;
  const requestedTarget =
    typeof query.next === "string" ? query.next : null;
  const memberships = await fetchUserAccountMemberships({ dbUrl, userId });

  redirect(postSignInDestination(memberships, requestedTarget));
}
