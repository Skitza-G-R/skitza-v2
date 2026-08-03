import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import { Button } from "~/components/ui/button";
import {
  JOIN_INTENT_COOKIE,
  type JoinIntentAction,
  joinIntentSecret,
  verifyJoinIntentToken,
} from "~/server/auth/join-intent";
import { joinSignInHref } from "~/server/auth/post-sign-in";
import { fetchUserAccountMemberships } from "~/server/auth/role";
import { findJoinTargetProducer, isSelfJoin } from "~/server/contacts/join-continuation";
import {
  JOIN_ACCOUNT_CONFLICT,
  JOIN_CONNECTION_PENDING,
  JOIN_UNVERIFIED_EMAIL,
} from "~/server/contacts/join-recovery";

import { continueAsArtist } from "./actions";
import { JoinAccountSwitchButton } from "./join-account-switch-button";
import { JoinContinuationShell } from "./join-continuation-shell";
import { ResumeTrustedJoin } from "./resume-trusted-join";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    action?: string | string[];
    problem?: string | string[];
  }>;
};

function hasProducerProfile(
  memberships: Awaited<ReturnType<typeof fetchUserAccountMemberships>>,
): boolean {
  return memberships.producer.status === "complete" || memberships.producer.status === "incomplete";
}

export default async function JoinContinuationPage({ params, searchParams }: Props) {
  const [{ slug }, query, session] = await Promise.all([params, searchParams, auth()]);
  if (query.action !== "book" && query.action !== "unlock") notFound();
  const requestedAction: JoinIntentAction = query.action;
  if (!session.userId) redirect(joinSignInHref(slug, requestedAction));

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const [target, memberships] = await Promise.all([
    findJoinTargetProducer(dbUrl, slug),
    fetchUserAccountMemberships({ dbUrl, userId: session.userId }),
  ]);
  if (!target) notFound();
  if (isSelfJoin(session.userId, target)) {
    redirect(`/join/${encodeURIComponent(slug)}`);
  }

  const producerConfirmation = hasProducerProfile(memberships);
  const cookieStore = await cookies();
  const trustedIntent =
    !producerConfirmation &&
    verifyJoinIntentToken({
      token: cookieStore.get(JOIN_INTENT_COOKIE)?.value,
      expectedSlug: slug,
      expectedAction: requestedAction,
      secret: joinIntentSecret(),
    });
  const producerBackHref =
    memberships.producer.status === "incomplete" ? "/onboarding" : "/dashboard";
  const studioName = target.displayName ?? "this studio";
  const publicStudioHref = `/join/${encodeURIComponent(slug)}`;
  const action = continueAsArtist.bind(null, slug, requestedAction);
  const retryProblem =
    query.problem === JOIN_UNVERIFIED_EMAIL ||
    query.problem === JOIN_CONNECTION_PENDING
      ? query.problem
      : null;

  if (query.problem === JOIN_ACCOUNT_CONFLICT) {
    return (
      <JoinContinuationShell>
        <div data-auth-page="join-account-conflict">
          <AuthHero
            eyebrow="Account already connected"
            title="Use another account"
            blurb={
              <>
                This email is already connected to another Skitza account. Sign out, then sign in
                with that account to continue with {studioName}.
              </>
            }
          />
          <div className="space-y-3">
            <JoinAccountSwitchButton slug={slug} action={requestedAction} />
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-auto min-h-12 w-full rounded-[var(--radius-lg)] py-3 text-center [overflow-wrap:anywhere] whitespace-normal"
            >
              <Link href={publicStudioHref}>Back to {studioName}</Link>
            </Button>
          </div>
        </div>
      </JoinContinuationShell>
    );
  }

  if (retryProblem) {
    const needsVerifiedEmail = retryProblem === JOIN_UNVERIFIED_EMAIL;
    return (
      <JoinContinuationShell>
        <div data-auth-page="join-verification-recovery">
          <AuthHero
            eyebrow={needsVerifiedEmail ? "Verification needed" : "Almost connected"}
            title={
              needsVerifiedEmail
                ? "Verify your email, then retry"
                : "Connection is still finishing"
            }
            blurb={
              needsVerifiedEmail
                ? `Skitza needs a verified email before it can safely connect this Artist account to ${studioName}. Verify the email on this account, then retry.`
                : `Skitza has not confirmed the connection to ${studioName} yet. Nothing was reassigned. Retry to check it again.`
            }
          />
          <div className="space-y-3">
            <form action={action}>
              <Button
                type="submit"
                size="lg"
                className="sk-cta-shine w-full rounded-[var(--radius-lg)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] text-[#0C0A07]"
              >
                Retry
              </Button>
            </form>
            {needsVerifiedEmail ? (
              <JoinAccountSwitchButton slug={slug} action={requestedAction} />
            ) : null}
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-auto min-h-12 w-full rounded-[var(--radius-lg)] py-3 text-center [overflow-wrap:anywhere] whitespace-normal"
            >
              <Link href={publicStudioHref}>Back to {studioName}</Link>
            </Button>
          </div>
        </div>
      </JoinContinuationShell>
    );
  }

  if (!producerConfirmation && trustedIntent) {
    return (
      <JoinContinuationShell>
        <div data-auth-page="join-resume">
          <AuthHero
            eyebrow={requestedAction === "book" ? "Booking" : "Your music"}
            title={`Opening ${studioName}…`}
            blurb={
              requestedAction === "book"
                ? "Taking you straight to booking."
                : "Opening your Artist workspace and unlocked tracks."
            }
            showAccentPeriod={false}
          />
          <ResumeTrustedJoin slug={slug} action={requestedAction} />
        </div>
      </JoinContinuationShell>
    );
  }

  return (
    <JoinContinuationShell>
      <div data-auth-page="join-confirmation">
        <AuthHero
          eyebrow={producerConfirmation ? "Artist mode" : "Booking"}
          title={
            producerConfirmation
              ? `Join ${studioName} as an Artist?`
              : requestedAction === "book"
                ? "Continue to booking"
                : `Continue to ${studioName}`
          }
          blurb={
            producerConfirmation
              ? "Your Producer workspace will stay exactly as it is. You can switch back anytime."
              : requestedAction === "book"
                ? "Your original booking intent expired. Continue to reconnect and open booking."
                : "Your unlock request expired. Continue to open this studio in your Artist workspace."
          }
          showAccentPeriod={!producerConfirmation}
        />
        <div className="space-y-3">
          <form action={action}>
            <Button
              type="submit"
              size="lg"
              className="sk-cta-shine w-full rounded-[var(--radius-lg)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] text-[#0C0A07]"
            >
              {producerConfirmation
                ? "Continue as Artist"
                : requestedAction === "book"
                  ? "Continue to booking"
                  : "Continue to your studio"}
            </Button>
          </form>
          {producerConfirmation ? (
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-auto min-h-12 w-full rounded-[var(--radius-lg)] py-3 text-center [overflow-wrap:anywhere] whitespace-normal"
            >
              <Link href={producerBackHref}>Back to my studio</Link>
            </Button>
          ) : (
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-auto min-h-12 w-full rounded-[var(--radius-lg)] py-3 text-center [overflow-wrap:anywhere] whitespace-normal"
            >
              <Link href={publicStudioHref}>Back to {studioName}</Link>
            </Button>
          )}
        </div>
      </div>
    </JoinContinuationShell>
  );
}
