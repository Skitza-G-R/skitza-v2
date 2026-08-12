import { emailHashFor } from "~/server/artist/identity";

type ClerkEmailAddress = Readonly<{
  emailAddress: string;
  verification?: Readonly<{ status?: string | null }> | null;
}>;

export type ProducerInvitationEmailOwner = Readonly<{
  id: string;
  emailAddresses: readonly ClerkEmailAddress[];
}>;

/**
 * The non-secret Clerk invitation fields needed to decide Producer access.
 * A Clerk Invitation object may contain an acceptance URL, but this selector
 * neither needs nor returns it.
 */
export type ProducerInvitationCandidate = Readonly<{
  id: string;
  emailAddress: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  revoked?: boolean | undefined;
}>;

export type AcceptedProducerInvitation = Readonly<{
  invitationId: string;
  clerkUserId: string;
  emailAddress: string;
  emailHash: string;
  createdAt: number;
  updatedAt: number;
}>;

export type ProducerInvitationSelection =
  | Readonly<{
      status: "matched";
      invitation: AcceptedProducerInvitation;
    }>
  | Readonly<{ status: "no_match" }>;

type SelectAcceptedProducerInvitationInput = Readonly<{
  clerkUser: ProducerInvitationEmailOwner | null;
  expectedClerkUserId: string;
  invitations: readonly ProducerInvitationCandidate[];
  cutoff: Date;
}>;

const NO_MATCH = { status: "no_match" } as const;

function normalizeEmail(emailAddress: string): string {
  return emailAddress.trim().toLowerCase();
}

function compareNewestInvitation(
  left: ProducerInvitationCandidate,
  right: ProducerInvitationCandidate,
): number {
  if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;

  // Clerk ids are opaque, so lexical order is only a stable tie-breaker. It
  // makes the result independent of API pagination/order for identical times.
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Finds the newest accepted Producer invitation that belongs to the signed-in
 * Clerk user. This is a domain decision only: callers still need to consume the
 * returned invitation id atomically in durable storage.
 */
export function selectAcceptedProducerInvitation({
  clerkUser,
  expectedClerkUserId,
  invitations,
  cutoff,
}: SelectAcceptedProducerInvitationInput): ProducerInvitationSelection {
  const cutoffMs = cutoff.getTime();
  if (
    !Number.isFinite(cutoffMs) ||
    expectedClerkUserId.length === 0 ||
    !clerkUser ||
    clerkUser.id !== expectedClerkUserId
  ) {
    return NO_MATCH;
  }

  const verifiedEmails = new Set(
    clerkUser.emailAddresses
      .filter((address) => address.verification?.status === "verified")
      .map((address) => normalizeEmail(address.emailAddress))
      .filter((emailAddress) => emailAddress.length > 0),
  );

  if (verifiedEmails.size === 0) return NO_MATCH;

  const invitation = invitations
    .filter((candidate) => {
      if (
        candidate.id.length === 0 ||
        candidate.status !== "accepted" ||
        candidate.revoked === true ||
        !Number.isFinite(candidate.createdAt) ||
        !Number.isFinite(candidate.updatedAt) ||
        candidate.updatedAt < candidate.createdAt ||
        candidate.createdAt < cutoffMs
      ) {
        return false;
      }

      return verifiedEmails.has(normalizeEmail(candidate.emailAddress));
    })
    .sort(compareNewestInvitation)[0];

  if (!invitation) return NO_MATCH;

  const emailAddress = normalizeEmail(invitation.emailAddress);
  return {
    status: "matched",
    invitation: {
      invitationId: invitation.id,
      clerkUserId: expectedClerkUserId,
      emailAddress,
      emailHash: emailHashFor(emailAddress),
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
    },
  };
}
