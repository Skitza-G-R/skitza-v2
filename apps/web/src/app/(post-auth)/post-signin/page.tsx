import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { fetchUserRole } from "~/server/auth/role";

// Post-signin router — Bug B fix.
//
// Clerk's dashboard "After sign-in fallback" is set to `/post-signin`,
// and the component-level `forceRedirectUrl` was removed from
// <SignIn>. Every successful sign-in lands here so the role resolver
// makes the destination decision exactly once, eliminating the
// "every user flashes through /dashboard before bouncing" UX.
//
// No polling: a sign-in caller has, by definition, signed up before.
// Their webhook has already run; their producers / client_contacts
// row exists. An "orphan" classification at sign-in means the
// original sign-up webhook silently failed — that's a production bug,
// not a polite race window. Surface it to Sentry and route the user
// to the auth screen with an error code so they can re-attempt or
// reach support.

export const dynamic = "force-dynamic";

export default async function PostSigninPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });

  // `redirect()` is typed `never`, but ESLint's `no-fallthrough` rule
  // doesn't infer that — using `return redirect(...)` satisfies both
  // the type system and the linter while preserving terminate-on-match
  // semantics in every case.
  switch (role.kind) {
    case "producer-complete":
      return redirect("/dashboard");
    case "producer-incomplete":
      return redirect("/onboarding");
    case "artist":
      return redirect("/artist");
    case "orphan":
      Sentry.captureMessage("post-signin: orphan user (webhook never ran)", {
        level: "error",
        tags: { feature: "auth", flow: "post-signin" },
        extra: { clerkUserId: userId },
      });
      return redirect("/sign-in?error=account_setup_incomplete");
    case "unauthenticated":
      // Defensive — userId was non-null above. Reaching this branch
      // means fetchUserRole disagreed with auth() in the same request,
      // which would indicate a Clerk SDK regression worth knowing about.
      Sentry.captureMessage(
        "post-signin: auth/fetchUserRole disagreement",
        { level: "warning" },
      );
      return redirect("/sign-in");
  }
}
