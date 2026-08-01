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
import { joinSignInHref } from "~/server/auth/post-sign-in";

function requireJoinAction(action: string): JoinIntentAction {
  if (action !== "book" && action !== "unlock") notFound();
  return action;
}

export async function continueAsArtist(
  slug: string,
  rawAction: string,
): Promise<never> {
  const action = requireJoinAction(rawAction);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const { userId } = await auth();
  if (!userId) redirect(joinSignInHref(slug, action));

  clearJoinIntentCookie(
    await cookies(),
    process.env.NODE_ENV === "production",
  );

  const target = await findJoinTargetProducer(dbUrl, slug);
  if (!target) notFound();

  try {
    const bookingHref = await connectCurrentUserForJoin({ dbUrl, userId, target });
    redirect(action === "book" ? bookingHref : joinArtistHref(target));
  } catch (error) {
    if (error instanceof JoinContinuationError && error.code === "SELF_JOIN") {
      redirect(`/join/${encodeURIComponent(slug)}`);
    }
    throw error;
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
  clearJoinIntentCookie(
    cookieStore,
    process.env.NODE_ENV === "production",
  );

  const target = await findJoinTargetProducer(dbUrl, slug);
  if (!target) notFound();
  const memberships = await fetchUserAccountMemberships({ dbUrl, userId });
  if (memberships.producer.status !== "none") {
    redirect(`/join/${encodeURIComponent(slug)}/continue?action=${action}`);
  }

  try {
    const bookingHref = await connectCurrentUserForJoin({ dbUrl, userId, target });
    redirect(action === "book" ? bookingHref : joinArtistHref(target));
  } catch (error) {
    if (error instanceof JoinContinuationError && error.code === "SELF_JOIN") {
      redirect(`/join/${encodeURIComponent(slug)}`);
    }
    throw error;
  }
}
