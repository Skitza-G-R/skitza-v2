import { SignIn } from "@clerk/nextjs";
import { AuthHero } from "~/components/auth/auth-hero";

// Producer + artist sign-in surface. The split-screen chrome lives in
// `(public)/(auth)/layout.tsx`; this page just stacks the locked-
// design hero on top of Clerk's `<SignIn>` widget.
//
// `forceRedirectUrl="/dashboard"` is preserved (a known producer-vs-
// artist limitation tracked in CLAUDE.md — out of scope for the polish
// pass). The AuthHero copy mirrors `/tmp/skitza-design/tabs/auth.jsx`
// `SignInScreen`.
export default function Page() {
  return (
    <div className="space-y-6">
      <AuthHero
        eyebrow="Sign in"
        title="Welcome back"
        blurb="Pick up where you left off — your hall is exactly as you left it."
      />
      <SignIn
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
        forceRedirectUrl="/dashboard"
      />
    </div>
  );
}
