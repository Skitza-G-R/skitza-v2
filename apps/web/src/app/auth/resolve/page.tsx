import { auth } from "~/server/auth/clerk-identity";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { postSignInDestination } from "~/server/auth/post-sign-in";
import {
  syncAcceptedProducerInvitation,
  type ProducerInvitationSyncResult,
} from "~/server/auth/producer-invitation-sync";
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
  const { userId, providerUserId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const query = await searchParams;
  const requestedTarget = typeof query.next === "string" ? query.next : null;
  let memberships = await fetchUserAccountMemberships({ dbUrl, userId });

  // Established Producers never need Clerk invitation reconciliation. For an
  // Artist or no-role account, a Clerk outage must deny only the new Producer
  // grant, not take away access they already have.
  if (memberships.producer.status === "none") {
    let sync: ProducerInvitationSyncResult | null = null;
    try {
      sync = await syncAcceptedProducerInvitation({ dbUrl, userId, providerUserId });
    } catch {
      console.error("[producer-invitation] reconciliation unavailable");
    }
    if (sync?.status === "created" || sync?.status === "already_granted") {
      memberships = await fetchUserAccountMemberships({ dbUrl, userId });
    }
    if (sync?.status === "created") redirect("/onboarding");
  }

  redirect(postSignInDestination(memberships, requestedTarget));
}
