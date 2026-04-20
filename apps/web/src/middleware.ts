import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { LOCALE_COOKIE, isValidLocale } from "~/i18n/config";
import { detectLocaleFromCountry } from "~/i18n/locale-detect";

const isProtected = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/settings(.*)",
  "/onboarding(.*)",
  "/artist(.*)",
  "/artist-welcome(.*)",
]);

// Legacy → new-shape redirect map. Keys are EXACT paths (no regex) plus
// a dynamic-segment fallback for ID-based routes. Everything in this
// table was a top-level dashboard nav item before the 4-screen
// refactor and is now either a sub-tab of Project Room, a filtered
// view on Today, or merged into Setup. Emailed links + bookmarks
// land here — returning a 301 keeps them working.
const STATIC_REDIRECTS: Record<string, string> = {
  "/dashboard/pipeline":  "/dashboard",
  "/dashboard/clients":   "/dashboard",
  "/dashboard/leads":     "/dashboard",
  "/dashboard/bookings":  "/dashboard",  // plural — never existed but listed for safety
  "/dashboard/contracts": "/dashboard",
  "/dashboard/invoices":  "/dashboard",
  "/dashboard/inbox":     "/dashboard",
  "/dashboard/library":   "/dashboard/music",
  "/dashboard/portfolio": "/dashboard/settings?section=portfolio",
};

// Dynamic paths — /dashboard/contracts/<id> etc. We collapse them all
// to /dashboard (the user lands on Today and can search for what they
// wanted). Joining contracts → projects in the middleware would require
// a DB round-trip on every redirect, which is bad. The simpler
// fallback is "land on Today, use ⌘K or the search if you need to
// find something specific." The PR doc mentions this as a conscious
// trade-off.
const DYNAMIC_PREFIXES = [
  "/dashboard/contracts/",
  "/dashboard/leads/",
  "/dashboard/clients/",
  "/dashboard/deals/",      // legacy — predates the projects rename
];

export function resolveLegacyRedirect(pathname: string): string | null {
  if (STATIC_REDIRECTS[pathname] !== undefined) {
    return STATIC_REDIRECTS[pathname];
  }
  for (const prefix of DYNAMIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return "/dashboard";
  }
  return null;
}

// Cookie lifetime for NEXT_LOCALE — matches the language-switcher
// client-side writer (1 year). Long enough that the user's choice
// doesn't vanish on a routine browser cache clear, short enough that
// a stale preference on a shared machine gets reset within a year.
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// Set NEXT_LOCALE on the response when the incoming request doesn't
// already carry one. We DO NOT overwrite an existing cookie here —
// that's the switcher's job, and stomping on it would undo the user's
// explicit choice.
//
// Country header: Vercel's `x-vercel-ip-country` (ISO 3166-1 alpha-2
// upper). On non-Vercel hosts (local dev, self-hosted) the header is
// absent and `detectLocaleFromCountry` returns the default locale,
// which is what we want.
function applyLocaleCookie(
  req: import("next/server").NextRequest,
  res: NextResponse,
): void {
  const existing = req.cookies.get(LOCALE_COOKIE)?.value;
  if (existing && isValidLocale(existing)) return;
  const country = req.headers.get("x-vercel-ip-country");
  const detected = detectLocaleFromCountry(country);
  res.cookies.set(LOCALE_COOKIE, detected, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });
}

// Clerk v7's `auth.protect()` returns 404 by default for unsigned visitors
// (a security choice — don't leak existence of protected routes). For
// Skitza's app routes we prefer a clean redirect to /sign-in, preserving
// the original path as redirect_url so the visitor lands back where they
// started post-auth. This makes any shared deep-link (e.g. an artist
// sharing /artist/music/<id> with their manager) work correctly: the
// manager clicks → redirects to sign-in → post-sign-in lands on the
// deep-link. Without this, shared links 404 and look broken.
export default clerkMiddleware(async (auth, req) => {
  // Legacy redirects BEFORE auth gating — returning a 301 is cheap and
  // the target is always inside /dashboard which is also protected.
  // We still stamp the locale cookie on legacy redirects so the target
  // page's first render already knows the locale (avoids a two-hop
  // cookie set where the 301 target would then do the detection).
  const legacy = resolveLegacyRedirect(req.nextUrl.pathname);
  if (legacy !== null) {
    const url = new URL(legacy, req.url);
    // Preserve any incoming query string (utm_*, ref, gclid, etc.) when the
    // redirect target didn't set one of its own. This keeps attribution +
    // future deep-link params intact across the legacy→new migration.
    if (!url.search && req.nextUrl.search) {
      url.search = req.nextUrl.search;
    }
    const res = NextResponse.redirect(url, 301);
    applyLocaleCookie(req, res);
    return res;
  }

  if (isProtected(req)) {
    const target = req.nextUrl.pathname + req.nextUrl.search;
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", target);
    await auth.protect({ unauthenticatedUrl: signInUrl.toString() });
  }

  // Pass-through path: mutate the Next response to include the
  // locale cookie when missing. `NextResponse.next()` is cheap; Clerk
  // already composed an auth-aware response for us via `auth.protect`
  // but when the route isn't protected we need to build our own so
  // the `Set-Cookie` header actually leaves the middleware.
  const passthrough = NextResponse.next();
  applyLocaleCookie(req, passthrough);
  return passthrough;
});

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
