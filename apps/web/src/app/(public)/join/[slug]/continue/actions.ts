"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  clearJoinIntentCookie,
  JOIN_INTENT_COOKIE,
  type JoinIntentAction,
  joinIntentSecret,
  verifyJoinIntentToken,
} from "~/server/auth/join-intent";
import { fetchUserAccountMemberships } from "~/server/auth/role";
import {
  connectCurrentUserForJoin,
  findJoinTargetProducer,
  joinArtistHref,
  JoinContinuationError,
} from "~/server/contacts/join-continuation";
import { isJoinAccountConflict, joinAccountConflictHref } from "~/server/contacts/join-recovery";
import { joinSignInHref } from "~/server/auth/post-sign-in";

function requireJoinAction(action: string): JoinIntentAction {
  if (action !== "book" && action !== "unlock") notFound();
  return action;
}

function redirectForKnownJoinError(error: unknown, slug: string, action: JoinIntentAction): never {
  if (error instanceof JoinContinuationError && error.code === "SELF_JOIN") {
    redirect(`/join/${encodeURIComponent(slug)}`);
  }
  if (isJoinAccountConflict(error)) {
    redirect(joinAccountConflictHref(slug, action));
  }
  throw error;
}

export async function continueAsArtist(slug: string, rawAction: string): Promise<never> {
  const action = requireJoinAction(rawAction);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const { userId } = await auth();
  if (!userId) redirect(joinSignInHref(slug, action));

  const target = await findJoinTargetProducer(dbUrl, slug);
  if (!target) notFound();

  try {
    const bookingHref = await connectCurrentUserForJoin({ dbUrl, userId, target });
    clearJoinIntentCookie(await cookies(), process.env.NODE_ENV === "production");
    redirect(action === "book" ? bookingHref : joinArtistHref(target));
  } catch (error) {
    redirectForKnownJoinError(error, slug, action);
  }
}

export async function resumeTrustedJoinIntent(
  slug: string,
  rawAction: string,
): Promise<{ ok: false }> {
  const action = requireJoinAction(rawAction);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const { userId } = await auth();
  if (!userId) redirect(joinSignInHref(slug, action));

  const cookieStore = await cookies();
  const token = cookieStore.get(JOIN_INTENT_COOKIE)?.value;
  if (
    !verifyJoinIntentToken({
      token,
      expectedSlug: slug,
      expectedAction: action,
      secret: joinIntentSecret(),
    })
  ) {
    return { ok: false };
  }
  const target = await findJoinTargetProducer(dbUrl, slug);
  if (!target) notFound();
  const memberships = await fetchUserAccountMemberships({ dbUrl, userId });
  if (memberships.producer.status !== "none") {
    redirect(`/join/${encodeURIComponent(slug)}/continue?action=${action}`);
  }

  try {
    const bookingHref = await connectCurrentUserForJoin({ dbUrl, userId, target });
    clearJoinIntentCookie(cookieStore, process.env.NODE_ENV === "production");
    redirect(action === "book" ? bookingHref : joinArtistHref(target));
  } catch (error) {
    redirectForKnownJoinError(error, slug, action);
  }
}
