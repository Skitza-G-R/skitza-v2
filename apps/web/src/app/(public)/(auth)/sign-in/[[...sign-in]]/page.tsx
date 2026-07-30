import { SignIn } from "@clerk/nextjs";

import { AuthHero } from "~/components/auth/auth-hero";
import { signUpSwitchHref } from "~/server/auth/returning-device";
import { postSignInResolverHref } from "~/server/auth/post-sign-in";

type Props = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};

// Shared producer + artist app entrance. The route marker lets the auth shell
// stay focused here while `/sign-up` keeps its marketing-led desktop layout.
export default async function Page({ searchParams }: Props) {
  const query = await searchParams;
  const requestedHref = typeof query.redirect_url === "string" ? query.redirect_url : null;
  const resolverHref = postSignInResolverHref(requestedHref);
  const signUpHref = signUpSwitchHref(requestedHref);

  return (
    <div className="sk-auth-page" data-auth-page="sign-in">
      <AuthHero eyebrow="Sign in" title="Welcome back" blurb="Sign in to continue to Skitza." />
      <SignIn
        signUpUrl={signUpHref}
        fallbackRedirectUrl={resolverHref}
        forceRedirectUrl={resolverHref}
      />
    </div>
  );
}
