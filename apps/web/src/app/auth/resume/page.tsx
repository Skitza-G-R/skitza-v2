import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  isGenuineDualRoleAccount,
  postSignInDestination,
} from "~/server/auth/post-sign-in";
import { fetchUserAccountMemberships } from "~/server/auth/role";

import { ResumeLastRole } from "./resume-client";

export const dynamic = "force-dynamic";

export default async function ResumeRolePage() {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const memberships = await fetchUserAccountMemberships({ dbUrl, userId });
  if (!userId || !isGenuineDualRoleAccount(memberships)) {
    redirect(postSignInDestination(memberships));
  }

  return <ResumeLastRole userId={userId} />;
}
