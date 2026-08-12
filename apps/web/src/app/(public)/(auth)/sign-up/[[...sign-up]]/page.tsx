import { SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import {
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
    intent?: string | string[];
    redirect_url?: string | string[];
  }>;
};

// Producer entry. A direct visit explains that access is invitation-only.
// Clerk's invitation link appends `__clerk_ticket`; only that entry renders
// Clerk's sign-up flow. The ticket is never treated as authorization here —
// the accepted invitation is re-read from Clerk and claimed server-side after
// authentication.
//
// 2026-04-22 — Dropped `forceRedirectUrl` (see docs/audit-report.md
// Task 15). `forceRedirectUrl` unconditionally overrides any
// `redirect_url` query param, which silently broke the /join →
// artist-welcome flow: even when `SignupCta` passed
// `?redirect_url=/artist-welcome/<slug>` to /sign-up, this page
// force-sent the user to /dashboard anyway.
//
// With only `fallbackRedirectUrl`: /dashboard is still the default,
// but any explicit redirect_url the user arrived with is honored.
// Defense in depth — the /join signup flow now lives on its own
// dedicated route at /sign-up/join/<slug>, but if someone hits
// /sign-up with a redirect_url we respect it rather than ignoring it.
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
  const intent = typeof query.intent === "string" ? query.intent : undefined;

  // A normal restored or prefetched signup URL mounted after authentication
  // must return through the membership-aware resolver. An invitation URL is
  // different: Clerk cannot consume its ticket while another session is
  // active, so give the visitor an explicit safe account switch that returns
  // to this untouched local URL after sign-out.
  if (session.userId && !invitationTicket) {
    redirect(postSignInResolverHref(requestedHref));
  }

  if (session.userId && invitationTicket) {
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

  return (
    <div className="sk-auth-page" data-auth-page="sign-up">
      <AuthHero
        eyebrow="Producer invitation"
        title="Accept your invitation"
        blurb="Create or open the account that uses the email invited by Skitza. If another account is open, sign out first."
      />
      <SignUp signInUrl={signInHref} fallbackRedirectUrl="/auth/resolve" />
    </div>
  );
}
