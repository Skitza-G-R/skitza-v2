import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/settings(.*)",
  "/onboarding(.*)",
  "/artist(.*)",
  "/artist-welcome(.*)",
]);

// Clerk v7's `auth.protect()` returns 404 by default for unsigned visitors
// (a security choice — don't leak existence of protected routes). For
// Skitza's app routes we prefer a clean redirect to /sign-in, preserving
// the original path as redirect_url so the visitor lands back where they
// started post-auth. This makes any shared deep-link (e.g. an artist
// sharing /artist/music/<id> with their manager) work correctly: the
// manager clicks → redirects to sign-in → post-sign-in lands on the
// deep-link. Without this, shared links 404 and look broken.
export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) {
    const target = req.nextUrl.pathname + req.nextUrl.search;
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", target);
    await auth.protect({ unauthenticatedUrl: signInUrl.toString() });
  }
});

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
