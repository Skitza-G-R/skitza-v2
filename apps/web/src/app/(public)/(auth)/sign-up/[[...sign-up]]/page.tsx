import { createHash } from "node:crypto";

import { SignIn, SignUp } from "@clerk/nextjs";
import { auth } from "~/server/auth/clerk-identity";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import { InvitationSignupMarker } from "~/components/auth/invitation-signup-marker";
import {
  invitationSignInHandoffHref,
  RETURNING_DEVICE_COOKIE,
  shouldRedirectReturningDeviceToSignIn,
  signInSwitchHref,
} from "~/server/auth/returning-device";
import { postSignInResolverHref } from "~/server/auth/post-sign-in";

import { InvitationAccountSwitchButton } from "./invitation-account-switch-button";

type Props = {
  params: Promise<{ "sign-up"?: string[] }>;
  searchParams: Promise<{
    __clerk_ticket?: string | string[];
    __clerk_status?: string | string[];
    intent?: string | string[];
    redirect_url?: string | string[];
  }>;
};

// Producer entry. A direct visit explains that access is invitation-only.
// Clerk's invitation link appends `__clerk_ticket` and `__clerk_status`.
// Only a verified `sign_in` or `sign_up` status starts the matching Clerk
// component. The ticket is never treated as authorization here: every
// completed flow is forced through `/auth/resolve`, where the accepted
// invitation is re-read from Clerk and claimed server-side. Any safe requested
// destination is nested inside that resolver URL instead of bypassing it.
//
// AuthHero copy mirrors `/tmp/skitza-design/tabs/auth.jsx`
// `SignUpScreen` ("Build your hall." + the no-card-needed blurb).
export default async function Page({ params, searchParams }: Props) {
  const [route, query, session, cookieStore] = await Promise.all([
    params,
    searchParams,
    auth(),
    cookies(),
  ]);
  const requestedHref = typeof query.redirect_url === "string" ? query.redirect_url : null;
  const invitationTicket =
    typeof query.__clerk_ticket === "string" && query.__clerk_ticket.length > 0
      ? query.__clerk_ticket
      : null;
  const invitationStatus =
    query.__clerk_status === "sign_in" ||
    query.__clerk_status === "sign_up" ||
    query.__clerk_status === "complete"
      ? query.__clerk_status
      : null;
  const intent = typeof query.intent === "string" ? query.intent : undefined;
  const resolverHref = postSignInResolverHref(requestedHref);

  // A normal restored or prefetched signup URL mounted after authentication
  // must return through the membership-aware resolver. An invitation URL is
  // different: Clerk cannot consume its ticket while another session is
  // active, so give the visitor an explicit safe account switch that returns
  // to this untouched local URL after sign-out.
  if (session.userId && !invitationTicket) {
    redirect(resolverHref);
  }

  // Clerk reports `complete` only after it has accepted the ticket for the
  // active account. The resolver still proves the accepted invitation and
  // applies the Producer grant on the server.
  if (session.userId && invitationTicket && invitationStatus === "complete") {
    redirect(resolverHref);
  }

  if (
    session.userId &&
    invitationTicket &&
    (invitationStatus === "sign_in" || invitationStatus === "sign_up")
  ) {
    return (
      <div className="sk-auth-page" data-auth-page="sign-up">
        <AuthHero
          eyebrow="Producer invitation"
          title="Switch accounts to accept"
          blurb="Sign out, then continue with the account that uses the email invited by Skitza. Your invitation will stay with you."
        />
        <InvitationAccountSwitchButton />
      </div>
    );
  }

  if (
    !invitationTicket &&
    shouldRedirectReturningDeviceToSignIn({
      userId: session.userId,
      cookieValue: cookieStore.get(RETURNING_DEVICE_COOKIE)?.value,
      intent,
      routeSegments: route["sign-up"],
    })
  ) {
    redirect(signInSwitchHref(requestedHref));
  }

  const signInHref = signInSwitchHref(requestedHref);
  const invitationHandoffToken = invitationTicket
    ? createHash("sha256").update(invitationTicket).digest("base64url")
    : "";
  const invitationHandoffHref = invitationSignInHandoffHref(
    invitationHandoffToken,
    requestedHref,
  );

  if (!invitationTicket) {
    return (
      <div className="sk-auth-page" data-auth-page="sign-up">
        <AuthHero
          eyebrow="Producer access"
          title="Producer access is invitation-only"
          blurb="Use the invitation email sent by Skitza. If the link expired or opened under another account, sign out and reopen the email, or ask Skitza for a new invitation."
        />
        <div className="grid gap-3">
          <Link
            href="/producer-access"
            className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 font-semibold text-[rgb(var(--fg-on-brand))]"
          >
            How Producer invitations work
          </Link>
          <Link
            href={signInHref}
            className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-default))] px-4 font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))]"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  // Clerk's ticket verifier explicitly tells us which authentication flow is
  // valid. Never guess from an email address (or from the mere presence of a
  // ticket), because that can both leak account state and start the wrong
  // Clerk flow.
  if (!invitationStatus || invitationStatus === "complete") {
    return (
      <div className="sk-auth-page" data-auth-page="sign-up">
        <AuthHero
          eyebrow="Producer invitation"
          title="This invitation link cannot continue"
          blurb="Open the latest invitation email again. If the link expired, ask Skitza for a new invitation."
        />
        <Link
          href="/producer-access"
          className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-default))] px-4 font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))]"
        >
          Producer invitation help
        </Link>
      </div>
    );
  }

  return (
    <div className="sk-auth-page" data-auth-page="sign-up">
      <AuthHero
        eyebrow="Producer invitation"
        title="Accept your invitation"
        blurb="Create or open the account that uses the email invited by Skitza. If another account is open, sign out first."
      />
      {invitationStatus === "sign_in" ? (
        <SignIn fallbackRedirectUrl={resolverHref} forceRedirectUrl={resolverHref} />
      ) : (
        <>
          <InvitationSignupMarker handoffToken={invitationHandoffToken} />
          <SignUp
            signInUrl={signInHref}
            fallbackRedirectUrl={invitationHandoffHref}
            forceRedirectUrl={invitationHandoffHref}
          />
        </>
      )}
    </div>
  );
}
