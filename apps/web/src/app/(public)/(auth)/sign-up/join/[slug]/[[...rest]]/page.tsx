import { SignUp } from "@clerk/nextjs";
import { auth } from "~/server/auth/clerk-identity";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import { joinContinuationHref, joinSignInHref } from "~/server/auth/post-sign-in";
import {
  RETURNING_DEVICE_COOKIE,
  shouldRedirectReturningDeviceToSignIn,
} from "~/server/auth/returning-device";
import { findJoinTargetProducer } from "~/server/contacts/join-continuation";

// Dedicated optional catch-all for the /join/<slug> Artist flow. The catch-all
// keeps Clerk verification and OAuth sub-routes under this path. Both auth-mode
// switches and every successful auth completion retain the strict join
// continuation; that route revalidates the slug and requires an explicit POST
// before connecting the account.

type Props = {
  params: Promise<{ slug: string; rest?: string[] }>;
  searchParams: Promise<{ intent?: string | string[] }>;
};

export default async function JoinSignUpPage({ params, searchParams }: Props) {
  const [{ slug, rest }, query] = await Promise.all([params, searchParams]);
  const explicitAction =
    rest?.[0] === "book"
      ? "book"
      : rest?.[0] === "unlock"
        ? "unlock"
        : rest?.[0] === "home"
          ? "home"
          : null;
  // Before Home had its own route marker, normal client invitations used the
  // bare dedicated signup URL. Keep those already-issued links useful by
  // treating the unmarked route as Home. Public Book now carries /book.
  const action = explicitAction ?? "home";
  const clerkRouteSegments = explicitAction ? rest?.slice(1) : rest;
  const continuationHref = joinContinuationHref(slug, action);
  const postSignUpContinuationHref = continuationHref;
  if (continuationHref === "/") notFound();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const [target, session, cookieStore] = await Promise.all([
    findJoinTargetProducer(dbUrl, slug),
    auth(),
    cookies(),
  ]);
  if (!target) notFound();
  if (session.userId) redirect(continuationHref);

  const intent = typeof query.intent === "string" ? query.intent : undefined;
  if (
    shouldRedirectReturningDeviceToSignIn({
      userId: session.userId,
      cookieValue: cookieStore.get(RETURNING_DEVICE_COOKIE)?.value,
      intent,
      routeSegments: clerkRouteSegments,
    })
  ) {
    redirect(joinSignInHref(slug, action));
  }

  const signUpPath = `/sign-up/join/${slug}${
    explicitAction === "book"
      ? "/book"
      : explicitAction === "unlock"
        ? "/unlock"
        : explicitAction === "home"
          ? "/home"
          : ""
  }`;
  const signInHref = joinSignInHref(slug, action);

  // `path` must NOT be URL-encoded — Clerk uses it as-is for
  // navigation. Slugs are validated before lookup as kebab-case ASCII
  // (^[a-z0-9-]+$), so percent-encoding is a no-op for us and
  // passing the raw slug avoids double-encoding when Clerk appends
  // sub-paths like "/verify-email-address".
  //
  return (
    <div className="space-y-5 sm:space-y-6">
      <AuthHero
        eyebrow="Join Skitza"
        title="Make it official"
        blurb="One last step — your inbox stays clean and your producer keeps your tracks tight."
      />
      <SignUp
        path={signUpPath}
        signInUrl={signInHref}
        fallbackRedirectUrl={postSignUpContinuationHref}
        forceRedirectUrl={postSignUpContinuationHref}
        unsafeMetadata={{ signupOrigin: "join", producerSlug: slug }}
      />
    </div>
  );
}
