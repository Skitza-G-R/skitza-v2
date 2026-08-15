import { auth } from "~/server/auth/clerk-identity";
import { createDb } from "@skitza/db";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import { Button } from "~/components/ui/button";
import {
  JOIN_INTENT_COOKIE,
  type JoinContinuationAction,
  type JoinIntentAction,
  joinIntentVerificationSecrets,
  verifyJoinIntentToken,
} from "~/server/auth/join-intent";
import { joinSignInHref } from "~/server/auth/post-sign-in";
import { fetchUserAccountMemberships } from "~/server/auth/role";
import { currentVerifiedEmailHashes } from "~/server/auth/verified-email";
import { findJoinTargetProducer, isSelfJoin } from "~/server/contacts/join-continuation";
import {
  JOIN_ACCOUNT_CONFLICT,
  JOIN_CONNECTION_PENDING,
  JOIN_UNVERIFIED_EMAIL,
} from "~/server/contacts/join-recovery";
import { getPrivateOfferJoinAccess } from "~/server/domain/private-offers/db";

import { continueAsArtist } from "./actions";
import { JoinAccountSwitchButton } from "./join-account-switch-button";
import { JoinContinuationShell } from "./join-continuation-shell";
import { ResumeTrustedJoin } from "./resume-trusted-join";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    action?: string | string[];
    offerId?: string | string[];
    problem?: string | string[];
  }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasProducerProfile(
  memberships: Awaited<ReturnType<typeof fetchUserAccountMemberships>>,
): boolean {
  return memberships.producer.status === "complete" || memberships.producer.status === "incomplete";
}

export default async function JoinContinuationPage({ params, searchParams }: Props) {
  const [{ slug }, query, session] = await Promise.all([params, searchParams, auth()]);
  if (
    query.action !== "book" &&
    query.action !== "unlock" &&
    query.action !== "home" &&
    query.action !== "store" &&
    query.action !== "offer"
  ) {
    notFound();
  }
  const requestedAction: JoinContinuationAction = query.action === "store" ? "home" : query.action;
  const offerId =
    requestedAction === "offer" &&
    typeof query.offerId === "string" &&
    UUID_PATTERN.test(query.offerId)
      ? query.offerId
      : undefined;
  if (requestedAction === "offer" && !offerId) notFound();
  if (!session.userId) redirect(joinSignInHref(slug, requestedAction, offerId));

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const [target, memberships] = await Promise.all([
    findJoinTargetProducer(dbUrl, slug),
    fetchUserAccountMemberships({ dbUrl, userId: session.userId }),
  ]);
  if (!target) notFound();
  if (requestedAction === "offer" && offerId) {
    const access = await getPrivateOfferJoinAccess(createDb(dbUrl), {
      clerkUserId: session.userId,
      verifiedEmailHashes: await currentVerifiedEmailHashes(session.userId),
      producerId: target.id,
      offerId,
      now: new Date(),
    });
    if (access === "unavailable") notFound();
    if (access === "authorized") redirect(`/artist/offers/${offerId}`);
    if (access === "wrong_account") {
      return (
        <JoinContinuationShell>
          <div data-auth-page="private-offer-account-recovery">
            <AuthHero
              eyebrow="Private offer"
              title="This offer was sent to another email"
              blurb="Switch accounts and sign in with the verified email that received it."
            />
            <JoinAccountSwitchButton slug={slug} action="offer" offerId={offerId} />
          </div>
        </JoinContinuationShell>
      );
    }
  }
  if (isSelfJoin(session.userId, target)) {
    redirect(`/join/${encodeURIComponent(slug)}`);
  }

  const producerConfirmation = hasProducerProfile(memberships);
  const cookieStore = await cookies();
  const trustedAction: JoinIntentAction | null =
    requestedAction === "offer" ? null : requestedAction;
  const trustedIntent =
    trustedAction !== null &&
    !producerConfirmation &&
    verifyJoinIntentToken({
      token: cookieStore.get(JOIN_INTENT_COOKIE)?.value,
      expectedSlug: slug,
      expectedAction: trustedAction,
      secret: joinIntentVerificationSecrets(),
    });
  const producerBackHref =
    memberships.producer.status === "incomplete" ? "/onboarding" : "/dashboard";
  const studioName = target.displayName ?? "this studio";
  const publicStudioHref = `/join/${encodeURIComponent(slug)}`;
  const action = continueAsArtist.bind(null, slug, requestedAction, offerId);
  const retryProblem =
    query.problem === JOIN_UNVERIFIED_EMAIL || query.problem === JOIN_CONNECTION_PENDING
      ? query.problem
      : null;

  if (
    requestedAction === "offer" &&
    (query.problem === JOIN_ACCOUNT_CONFLICT || query.problem === JOIN_UNVERIFIED_EMAIL)
  ) {
    return (
      <JoinContinuationShell>
        <div data-auth-page="private-offer-account-recovery">
          <AuthHero
            eyebrow="Private offer"
            title="This offer was sent to another email"
            blurb="Switch accounts and sign in with the verified email that received it."
          />
          <JoinAccountSwitchButton slug={slug} action="offer" {...(offerId ? { offerId } : {})} />
        </div>
      </JoinContinuationShell>
    );
  }

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
            <JoinAccountSwitchButton
              slug={slug}
              action={requestedAction}
              {...(offerId ? { offerId } : {})}
            />
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
              needsVerifiedEmail ? "Verify your email, then retry" : "Connection is still finishing"
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
              <JoinAccountSwitchButton
                slug={slug}
                action={requestedAction}
                {...(offerId ? { offerId } : {})}
              />
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

  if (trustedIntent) {
    return (
      <JoinContinuationShell>
        <div data-auth-page="join-resume">
          <AuthHero
            eyebrow={
              requestedAction === "book"
                ? "Booking"
                : requestedAction === "unlock"
                  ? "Your music"
                  : requestedAction === "offer"
                    ? "Private offer"
                    : "Artist Home"
            }
            title={`Opening ${studioName}…`}
            blurb={
              requestedAction === "book"
                ? "Taking you straight to booking."
                : requestedAction === "unlock"
                  ? "Opening your Artist workspace and unlocked tracks."
                  : "Opening your Artist Home with this studio selected."
            }
            showAccentPeriod={false}
          />
          <ResumeTrustedJoin slug={slug} action={trustedAction} />
        </div>
      </JoinContinuationShell>
    );
  }

  return (
    <JoinContinuationShell>
      <div data-auth-page="join-confirmation">
        <AuthHero
          eyebrow={
            producerConfirmation
              ? "Artist mode"
              : requestedAction === "book"
                ? "Booking"
                : requestedAction === "unlock"
                  ? "Your music"
                  : "Artist Home"
          }
          title={
            producerConfirmation
              ? `Join ${studioName} as an Artist?`
              : requestedAction === "book"
                ? "Continue to booking"
                : requestedAction === "unlock"
                  ? `Continue to ${studioName}`
                  : requestedAction === "offer"
                    ? "Review private offer"
                    : "Continue to Artist Home"
          }
          blurb={
            producerConfirmation
              ? "Your Producer workspace will stay exactly as it is. You can switch back anytime."
              : requestedAction === "book"
                ? "Your original booking intent expired. Continue to reconnect and open booking."
                : requestedAction === "unlock"
                  ? "Your unlock request expired. Continue to open this studio in your Artist workspace."
                  : requestedAction === "offer"
                    ? "Continue with the verified account that received this private offer."
                    : `Continue to connect with ${studioName} and open your Artist Home.`
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
                  : requestedAction === "unlock"
                    ? "Continue to your studio"
                    : requestedAction === "offer"
                      ? "Review private offer"
                      : "Continue to Artist Home"}
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
