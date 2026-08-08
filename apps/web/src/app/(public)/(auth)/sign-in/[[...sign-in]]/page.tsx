import { SignIn } from "@clerk/nextjs";
import { headers } from "next/headers";

import { AuthHero } from "~/components/auth/auth-hero";
import { signUpSwitchHref } from "~/server/auth/returning-device";
import {
  joinSignUpMetadataFromTarget,
  normalizeSameOriginPostSignInTarget,
  postSignInResolverHref,
  postSignUpResolverHref,
  trustedAuthRequestOrigin,
} from "~/server/auth/post-sign-in";

type Props = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};

// Shared producer + artist app entrance. The route marker lets the auth shell
// stay focused here while `/sign-up` keeps its marketing-led desktop layout.
export default async function Page({ searchParams }: Props) {
  const [query, requestHeaders] = await Promise.all([searchParams, headers()]);
  const rawRequestedHref =
    typeof query.redirect_url === "string" ? query.redirect_url : null;
  const requestOrigin = trustedAuthRequestOrigin({
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
    host: requestHeaders.get("host"),
  });
  const requestedHref = normalizeSameOriginPostSignInTarget(
    rawRequestedHref,
    requestOrigin,
  );
  const resolverHref = postSignInResolverHref(requestedHref);
  const signUpResolverHref = postSignUpResolverHref(requestedHref);
  const signUpHref = signUpSwitchHref(requestedHref);
  const joinMetadata = joinSignUpMetadataFromTarget(requestedHref);

  return (
    <div className="sk-auth-page" data-auth-page="sign-in">
      <AuthHero eyebrow="Sign in" title="Welcome back" blurb="Sign in to continue to Skitza." />
      <SignIn
        signUpUrl={signUpHref}
        {...(joinMetadata ? { unsafeMetadata: joinMetadata } : {})}
        fallbackRedirectUrl={resolverHref}
        forceRedirectUrl={resolverHref}
        signUpFallbackRedirectUrl={signUpResolverHref}
        signUpForceRedirectUrl={signUpResolverHref}
      />
    </div>
  );
}
