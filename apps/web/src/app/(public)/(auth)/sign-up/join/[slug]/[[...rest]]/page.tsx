import { SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AuthHero } from "~/components/auth/auth-hero";
import {
  joinContinuationHref,
  joinSignInHref,
} from "~/server/auth/post-sign-in";

// Dedicated optional catch-all for the /join/<slug> Artist flow. The catch-all
// keeps Clerk verification and OAuth sub-routes under this path. Both auth-mode
// switches and every successful auth completion retain the strict join
// continuation; that route revalidates the slug and requires an explicit POST
// before connecting the account.

type Props = { params: Promise<{ slug: string; rest?: string[] }> };

export default async function JoinSignUpPage({ params }: Props) {
  const { slug, rest } = await params;
  const action = rest?.[0] === "unlock" ? "unlock" : "book";
  const signUpPath = `/sign-up/join/${slug}${
    action === "unlock" ? "/unlock" : ""
  }`;
  const { userId } = await auth();
  const continuationHref = joinContinuationHref(slug, action);
  const signInHref = joinSignInHref(slug, action);
  if (userId) redirect(continuationHref);

  // `path` must NOT be URL-encoded — Clerk uses it as-is for
  // navigation. Slugs are validated upstream as kebab-case ASCII
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
        fallbackRedirectUrl={continuationHref}
        forceRedirectUrl={continuationHref}
        unsafeMetadata={{ signupOrigin: "join", producerSlug: slug }}
      />
    </div>
  );
}
