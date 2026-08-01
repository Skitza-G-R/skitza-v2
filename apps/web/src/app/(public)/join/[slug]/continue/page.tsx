import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import {
  JOIN_INTENT_COOKIE,
  type JoinIntentAction,
  joinIntentSecret,
  verifyJoinIntentToken,
} from "~/server/auth/join-intent";
import { joinSignInHref } from "~/server/auth/post-sign-in";
import { fetchUserAccountMemberships } from "~/server/auth/role";
import {
  findJoinTargetProducer,
  isSelfJoin,
} from "~/server/contacts/join-continuation";

import { continueAsArtist } from "./actions";
import { ResumeTrustedJoin } from "./resume-trusted-join";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ action?: string | string[] }>;
};

function hasProducerProfile(
  memberships: Awaited<ReturnType<typeof fetchUserAccountMemberships>>,
): boolean {
  return (
    memberships.producer.status === "complete" ||
    memberships.producer.status === "incomplete"
  );
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
    memberships.producer.status === "incomplete"
      ? "/onboarding"
      : "/dashboard";
  const studioName = target.displayName ?? "this studio";
  const action = continueAsArtist.bind(null, slug, requestedAction);

  if (!producerConfirmation && trustedIntent) {
    return (
      <div data-auth-page="join-resume" className="space-y-5 sm:space-y-6">
        <AuthHero
          eyebrow={requestedAction === "book" ? "Booking" : "Your music"}
          title={`Opening ${studioName}…`}
          blurb={
            requestedAction === "book"
              ? "Taking you straight to booking."
              : "Opening your Artist workspace and unlocked tracks."
          }
        />
        <ResumeTrustedJoin slug={slug} action={requestedAction} />
      </div>
    );
  }

  return (
    <div data-auth-page="join-confirmation" className="space-y-5 sm:space-y-6">
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
      />
      <div className="space-y-3">
        <form action={action}>
          <button
            type="submit"
            className="sk-press sk-cta-shine inline-flex min-h-12 w-full items-center justify-center rounded-[var(--radius-lg)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-6 py-3 text-sm font-semibold text-[#0C0A07] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))] focus-visible:outline-none"
          >
            {producerConfirmation
              ? "Continue as Artist"
              : requestedAction === "book"
                ? "Continue to booking"
                : "Continue to your studio"}
          </button>
        </form>
        {producerConfirmation ? (
          <Link
            href={producerBackHref}
            className="sk-press inline-flex min-h-12 w-full items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-transparent px-6 py-3 text-sm font-semibold text-[rgb(var(--fg-primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))] focus-visible:outline-none"
          >
            Back to my studio
          </Link>
        ) : null}
      </div>
    </div>
  );
}
