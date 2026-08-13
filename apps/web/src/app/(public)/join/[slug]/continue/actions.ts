"use server";

import { auth } from "~/server/auth/clerk-identity";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  clearJoinIntentCookie,
  JOIN_INTENT_COOKIE,
  type JoinContinuationAction,
  type JoinIntentAction,
  joinIntentVerificationSecrets,
  verifyJoinIntentToken,
} from "~/server/auth/join-intent";
import { fetchUserAccountMemberships } from "~/server/auth/role";
import {
  connectCurrentUserForJoin,
  findJoinTargetProducer,
  joinArtistHref,
  JoinContinuationError,
} from "~/server/contacts/join-continuation";
import {
  isJoinAccountConflict,
  joinAccountConflictHref,
  joinRetryHref,
  joinRetryProblem,
} from "~/server/contacts/join-recovery";
import { joinSignInHref } from "~/server/auth/post-sign-in";

function requireJoinAction(action: string): JoinIntentAction {
  if (action !== "book" && action !== "unlock" && action !== "home" && action !== "store") {
    notFound();
  }
  return action === "store" ? "home" : action;
}

function requireTrustedJoinAction(action: string): JoinIntentAction {
  if (action !== "book" && action !== "unlock" && action !== "home") notFound();
  return action;
}

function completedJoinHref(
  action: JoinIntentAction,
  target: Parameters<typeof joinArtistHref>[0],
  bookingHref: string,
): string {
  if (action === "book") return bookingHref;
  return joinArtistHref(target);
}

function redirectForKnownJoinError(
  error: unknown,
  slug: string,
  action: JoinContinuationAction,
): never {
  if (error instanceof JoinContinuationError && error.code === "SELF_JOIN") {
    redirect(`/join/${encodeURIComponent(slug)}`);
  }
  const retryProblem = joinRetryProblem(error);
  if (retryProblem) {
    redirect(joinRetryHref(slug, action, retryProblem));
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

  const { userId, providerUserId } = await auth();
  if (!userId) redirect(joinSignInHref(slug, action));

  const target = await findJoinTargetProducer(dbUrl, slug);
  if (!target) notFound();

  try {
    const bookingHref = await connectCurrentUserForJoin({ dbUrl, userId, providerUserId, target });
    clearJoinIntentCookie(await cookies(), process.env.NODE_ENV === "production");
    redirect(completedJoinHref(action, target, bookingHref));
  } catch (error) {
    redirectForKnownJoinError(error, slug, action);
  }
}

export async function resumeTrustedJoinIntent(
  slug: string,
  rawAction: string,
): Promise<{ ok: false }> {
  const action = requireTrustedJoinAction(rawAction);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const { userId, providerUserId } = await auth();
  if (!userId) redirect(joinSignInHref(slug, action));

  const cookieStore = await cookies();
  const token = cookieStore.get(JOIN_INTENT_COOKIE)?.value;
  if (
    !verifyJoinIntentToken({
      token,
      expectedSlug: slug,
      expectedAction: action,
      secret: joinIntentVerificationSecrets(),
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
    const bookingHref = await connectCurrentUserForJoin({ dbUrl, userId, providerUserId, target });
    clearJoinIntentCookie(cookieStore, process.env.NODE_ENV === "production");
    redirect(completedJoinHref(action, target, bookingHref));
  } catch (error) {
    redirectForKnownJoinError(error, slug, action);
  }
}
