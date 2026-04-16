import { SignUp } from "@clerk/nextjs";

// `afterSignUpUrl` and `afterSignInUrl` send the user straight to the
// dashboard post-auth. Without them, Clerk dumps them back on `/` which
// redirects to `/dashboard` anyway — but that's an extra hop. Explicit.
export default function Page() {
  return (
    <SignUp
      signInUrl="/sign-in"
      fallbackRedirectUrl="/dashboard"
      forceRedirectUrl="/dashboard"
    />
  );
}
