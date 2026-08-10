import { SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import {
  RETURNING_DEVICE_COOKIE,
  shouldRedirectReturningDeviceToSignIn,
  signInSwitchHref,
} from "~/server/auth/returning-device";
import { postSignInResolverHref } from "~/server/auth/post-sign-in";

type Props = {
  params: Promise<{ "sign-up"?: string[] }>;
  searchParams: Promise<{
    intent?: string | string[];
    redirect_url?: string | string[];
  }>;
};

// Default producer sign-up. The landing-page CTAs + direct /sign-up
// visits end up here. Post-signup we want the new Producer on the
// dashboard so /onboarding can greet them.
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
  const requestedHref =
    typeof query.redirect_url === "string" ? query.redirect_url : null;
  const intent = typeof query.intent === "string" ? query.intent : undefined;

  // A restored or prefetched landing-page signup URL can be mounted after
  // Clerk has already authenticated the account. Never render <SignUp> in
  // that state: Clerk would honor its stale `redirect_url=/onboarding`
  // directly and bypass Skitza's membership-aware resolver.
  if (session.userId) {
    redirect(postSignInResolverHref(requestedHref));
  }

  if (
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

  return (
    <div className="sk-auth-page" data-auth-page="sign-up">
      <AuthHero
        eyebrow="Join Skitza"
        title="Build your hall"
        blurb="Free to start. No card. Three minutes to your first booking link."
      />
      <SignUp signInUrl={signInHref} fallbackRedirectUrl="/dashboard" />
    </div>
  );
}
