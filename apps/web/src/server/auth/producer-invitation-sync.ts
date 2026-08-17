import { clerkClient } from "@clerk/nextjs/server";

import { claimProducerInvitationGrant } from "./producer-invitation-grant";
import { selectAcceptedProducerInvitation } from "./producer-invitation";

export type ProducerInvitationSyncResult =
  | Readonly<{ status: "not_authenticated" }>
  | Readonly<{ status: "not_invited" }>
  | Readonly<{ status: "created" | "already_granted" }>
  | Readonly<{ status: "conflict" }>;

function requiredCutoff(environment: NodeJS.ProcessEnv): Date {
  const raw = environment.PRODUCER_INVITATION_CUTOFF?.trim();
  if (!raw) throw new Error("missing PRODUCER_INVITATION_CUTOFF");
  const cutoff = new Date(raw);
  if (!Number.isFinite(cutoff.getTime()) || cutoff.toISOString() !== raw) {
    throw new Error("invalid PRODUCER_INVITATION_CUTOFF");
  }
  return cutoff;
}

function requiredInstanceId(environment: NodeJS.ProcessEnv): string {
  const instanceId = environment.CLERK_INSTANCE_ID?.trim();
  if (!instanceId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(instanceId)) {
    throw new Error("missing CLERK_INSTANCE_ID");
  }
  return instanceId;
}

/**
 * Reconciles an authenticated account with accepted Clerk invitations. This is
 * deliberately called only at explicit auth/access resolver boundaries, not
 * on every protected request.
 */
export async function syncAcceptedProducerInvitation(input: {
  dbUrl: string;
  userId: string | null;
  providerUserId: string | null;
  environment?: NodeJS.ProcessEnv;
}): Promise<ProducerInvitationSyncResult> {
  if (!input.userId && !input.providerUserId) return { status: "not_authenticated" };
  if (!input.userId || !input.providerUserId) {
    throw new Error("INCOMPLETE_CLERK_IDENTITY");
  }

  const environment = input.environment ?? process.env;
  const cutoff = requiredCutoff(environment);
  const clerkInstanceId = requiredInstanceId(environment);
  const client = await clerkClient();

  // A configured instance id is only an assertion until the Backend API key
  // proves which Clerk instance it actually belongs to. Never let a swapped
  // Test/Live secret turn an accepted invitation from one environment into a
  // grant in the other environment's database.
  const instance = await client.instance.get();
  if (instance.id !== clerkInstanceId) {
    throw new Error("CLERK_INSTANCE_MISMATCH");
  }

  const user = await client.users.getUser(input.providerUserId);
  const verifiedEmails = [
    ...new Set(
      user.emailAddresses
        .filter((address) => address.verification?.status === "verified")
        .map((address) => address.emailAddress.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  if (verifiedEmails.length === 0) return { status: "not_invited" };

  const invitations = (
    await Promise.all(
      verifiedEmails.map((emailAddress) =>
        client.invitations.getInvitationList({
          limit: 100,
          offset: 0,
          orderBy: "-created_at",
          query: emailAddress,
          status: "accepted",
        }),
      ),
    )
  ).flatMap((response) =>
    response.data.map((invitation) => ({
      id: invitation.id,
      emailAddress: invitation.emailAddress,
      status: invitation.status,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      revoked: invitation.revoked,
    })),
  );

  const selection = selectAcceptedProducerInvitation({
    clerkUser: user,
    expectedClerkUserId: input.providerUserId,
    invitations,
    cutoff,
  });
  if (selection.status === "no_match") return { status: "not_invited" };

  return claimProducerInvitationGrant(input.dbUrl, {
    ...selection.invitation,
    providerClerkUserId: selection.invitation.clerkUserId,
    clerkUserId: input.userId,
    clerkInstanceId,
  });
}
