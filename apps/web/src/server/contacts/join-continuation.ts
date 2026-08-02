import { currentUser } from "@clerk/nextjs/server";
import {
  and,
  clientContacts,
  createDb,
  eq,
  isNull,
  producers,
} from "@skitza/db";

import { verifiedEmailHashesFromUser } from "~/server/auth/verified-email";
import type { UserAccountMemberships } from "~/server/auth/role";

import { connectVerifiedArtistToProducer } from "./connect-artist";

export type JoinTargetProducer = Readonly<{
  id: string;
  clerkUserId: string;
  displayName: string | null;
  slug: string;
}>;

export class JoinContinuationError extends Error {
  constructor(
    readonly code:
      | "UNAUTHENTICATED"
      | "SELF_JOIN"
      | "UNVERIFIED_EMAIL"
      | "CONNECTION_NOT_CONFIRMED",
  ) {
    super(code);
    this.name = "JoinContinuationError";
  }
}

export async function findJoinTargetProducer(
  dbUrl: string,
  slug: string,
): Promise<JoinTargetProducer | null> {
  const db = createDb(dbUrl);
  const [producer] = await db
    .select({
      id: producers.id,
      clerkUserId: producers.clerkUserId,
      displayName: producers.displayName,
      slug: producers.slug,
    })
    .from(producers)
    .where(eq(producers.slug, slug))
    .limit(1);
  return producer ?? null;
}

export function isSelfJoin(userId: string, target: JoinTargetProducer): boolean {
  return target.clerkUserId === userId;
}

export function joinBookingHref(target: JoinTargetProducer): string {
  return `/artist/book?${new URLSearchParams({ studio: target.id }).toString()}`;
}

export function joinArtistHref(target: JoinTargetProducer): string {
  return `/artist?${new URLSearchParams({ studio: target.id }).toString()}`;
}

export function joinEntryMode(
  memberships: UserAccountMemberships,
): "direct" | "producer-confirmation" {
  return memberships.producer.status === "none"
    ? "direct"
    : "producer-confirmation";
}

/**
 * Complete a join intent with verified Clerk identity and then prove that the
 * active contact belongs to this exact Clerk user before returning a booking
 * destination. The public slug never grants Artist access on its own.
 */
export async function connectCurrentUserForJoin(input: {
  dbUrl: string;
  userId: string | null;
  target: JoinTargetProducer;
}): Promise<string> {
  if (!input.userId) throw new JoinContinuationError("UNAUTHENTICATED");
  if (isSelfJoin(input.userId, input.target)) {
    throw new JoinContinuationError("SELF_JOIN");
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress.trim().toLowerCase() ?? null;
  const verifiedEmailHashes = user
    ? verifiedEmailHashesFromUser(user, input.userId)
    : [];
  if (!user || !email || verifiedEmailHashes.length === 0) {
    throw new JoinContinuationError("UNVERIFIED_EMAIL");
  }

  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    email.split("@")[0] ||
    "Artist";
  const db = createDb(input.dbUrl);

  await connectVerifiedArtistToProducer(db, {
    producerId: input.target.id,
    primaryEmail: email,
    verifiedEmailHashes,
    name,
    clerkUserId: input.userId,
  });

  const [confirmed] = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.producerId, input.target.id),
        eq(clientContacts.clerkUserId, input.userId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  if (!confirmed) {
    throw new JoinContinuationError("CONNECTION_NOT_CONFIRMED");
  }

  return joinBookingHref(input.target);
}
