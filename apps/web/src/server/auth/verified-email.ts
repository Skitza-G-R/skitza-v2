import { currentUser } from "@clerk/nextjs/server";

import { emailHashFor } from "~/server/artist/identity";
import { auth } from "~/server/auth/clerk-identity";

type ClerkEmailAddress = Readonly<{
  emailAddress: string;
  verification?: Readonly<{ status?: string | null }> | null;
}>;

type ClerkEmailOwner = Readonly<{
  id: string;
  emailAddresses: readonly ClerkEmailAddress[];
}>;

/**
 * Returns only the verified email identities owned by the expected Clerk user.
 * Private invitations use these hashes together with the stable Clerk id so an
 * edited contact email can never transfer an offer to a different account.
 */
export function verifiedEmailHashesFromUser(
  user: ClerkEmailOwner | null,
  expectedClerkUserId: string,
): string[] {
  if (!user || user.id !== expectedClerkUserId) return [];

  return [
    ...new Set(
      user.emailAddresses
        .filter((address) => address.verification?.status === "verified")
        .map((address) => emailHashFor(address.emailAddress)),
    ),
  ];
}

export async function currentVerifiedEmailHashes(expectedClerkUserId: string): Promise<string[]> {
  const { userId, providerUserId } = await auth();
  if (userId !== expectedClerkUserId || !providerUserId) return [];
  return verifiedEmailHashesFromUser(await currentUser(), providerUserId);
}
