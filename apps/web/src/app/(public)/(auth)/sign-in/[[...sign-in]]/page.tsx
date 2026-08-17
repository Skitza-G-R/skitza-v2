import { SignIn } from "@clerk/nextjs";
import { headers } from "next/headers";

import { AuthHero } from "~/components/auth/auth-hero";
import { DesktopSocialSignInControl } from "~/components/auth/desktop-social-sign-in-control";
import { signInSwitchHref, signUpSwitchHref } from "~/server/auth/returning-device";
import {
  joinSignUpMetadataFromTarget,
  normalizeSameOriginPostSignInTarget,
  postSignInResolverHref,
  postSignUpResolverHref,
  trustedAuthRequestOrigin,
} from "~/server/auth/post-sign-in";
import { InvitationSignInHandoff } from "./invitation-sign-in-handoff";

type Props = {
  searchParams: Promise<{
    invitation_complete?: string | string[];
    invitation_handoff?: string | string[];
    redirect_url?: string | string[];
  }>;
};

// Shared producer + artist app entrance. The route marker lets the auth shell
// stay focused here while `/sign-up` keeps its marketing-led desktop layout.
export default async function Page({ searchParams }: Props) {
  const [query, requestHeaders] = await Promise.all([searchParams, headers()]);
  const rawRequestedHref = typeof query.redirect_url === "string" ? query.redirect_url : null;
  const requestOrigin = trustedAuthRequestOrigin({
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
    host: requestHeaders.get("host"),
  });
  const requestedHref = normalizeSameOriginPostSignInTarget(rawRequestedHref, requestOrigin);
  const resolverHref = postSignInResolverHref(requestedHref);
  const signUpResolverHref = postSignUpResolverHref(requestedHref);
  const signUpHref = signUpSwitchHref(requestedHref);
  const joinMetadata = joinSignUpMetadataFromTarget(requestedHref);

  const invitationHandoffToken =
    typeof query.invitation_handoff === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(query.invitation_handoff)
      ? query.invitation_handoff
      : null;

  if (query.invitation_complete === "1" && invitationHandoffToken) {
    return (
      <div className="sk-auth-page" data-auth-page="sign-in">
        <AuthHero
          eyebrow="Invitation accepted"
          title="Now sign in"
          blurb="Your account is ready. We’re opening a fresh sign-in so Skitza can finish your Producer setup."
        />
        <InvitationSignInHandoff
          handoffToken={invitationHandoffToken}
          signInHref={signInSwitchHref(requestedHref)}
        />
      </div>
    );
  }

  return (
    <div className="sk-auth-page" data-auth-page="sign-in">
      <AuthHero eyebrow="Sign in" title="Welcome back" blurb="Sign in to continue to Skitza." />
      <DesktopSocialSignInControl>
        <SignIn
          signUpUrl={signUpHref}
          {...(joinMetadata ? { unsafeMetadata: joinMetadata } : {})}
          fallbackRedirectUrl={resolverHref}
          forceRedirectUrl={resolverHref}
          signUpFallbackRedirectUrl={signUpResolverHref}
          signUpForceRedirectUrl={signUpResolverHref}
        />
      </DesktopSocialSignInControl>
    </div>
  );
}
