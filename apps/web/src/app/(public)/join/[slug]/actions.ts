"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  issueJoinIntentToken,
  JOIN_INTENT_COOKIE,
  type JoinIntentAction,
  joinIntentCookieOptions,
  joinIntentSecret,
} from "~/server/auth/join-intent";
import { joinContinuationHref } from "~/server/auth/post-sign-in";
import { fetchUserAccountMemberships } from "~/server/auth/role";
import {
  connectCurrentUserForJoin,
  findJoinTargetProducer,
  isSelfJoin,
  joinArtistHref,
  joinEntryMode,
} from "~/server/contacts/join-continuation";
import { isJoinAccountConflict, joinAccountConflictHref } from "~/server/contacts/join-recovery";

async function startJoinAction(slug: string, action: JoinIntentAction): Promise<never> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const target = await findJoinTargetProducer(dbUrl, slug);
  if (!target) notFound();

  const { userId } = await auth();
  if (!userId) {
    const token = issueJoinIntentToken({
      slug: target.slug,
      action,
      secret: joinIntentSecret(),
    });
    if (!token) notFound();
    const cookieStore = await cookies();
    cookieStore.set(
      JOIN_INTENT_COOKIE,
      token,
      joinIntentCookieOptions(process.env.NODE_ENV === "production"),
    );
    redirect(
      `/sign-up/join/${encodeURIComponent(target.slug)}${
        action === "book" ? "/book" : "/unlock"
      }`,
    );
  }

  if (isSelfJoin(userId, target)) {
    redirect(`/join/${encodeURIComponent(target.slug)}`);
  }
  const memberships = await fetchUserAccountMemberships({ dbUrl, userId });
  if (joinEntryMode(memberships) === "producer-confirmation") {
    redirect(joinContinuationHref(target.slug, action));
  }

  try {
    const bookingHref = await connectCurrentUserForJoin({ dbUrl, userId, target });
    redirect(action === "book" ? bookingHref : joinArtistHref(target));
  } catch (error) {
    if (isJoinAccountConflict(error)) {
      redirect(joinAccountConflictHref(target.slug, action));
    }
    throw error;
  }
}

export async function startJoinBooking(slug: string): Promise<never> {
  return startJoinAction(slug, "book");
}

export async function startJoinUnlock(slug: string): Promise<never> {
  return startJoinAction(slug, "unlock");
}
