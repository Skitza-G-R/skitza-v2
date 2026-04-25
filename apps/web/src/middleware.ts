import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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
  // Services + Availability were never live as their own routes, but
  // pre-flatten the Setup tabs cross-linked into /dashboard/booking.
  // Per the PRD §4.4 delta we promise bookmarks / pasted email links
  // to these "natural" URLs keep working — they redirect to the
  // matching Setup sub-tab.
  "/dashboard/services":     "/dashboard/settings?section=services",
  "/dashboard/availability": "/dashboard/settings?section=availability",
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
  const legacy = resolveLegacyRedirect(req.nextUrl.pathname);
  if (legacy !== null) {
    const url = new URL(legacy, req.url);
    // Preserve any incoming query string (utm_*, ref, gclid, etc.) when the
    // redirect target didn't set one of its own. This keeps attribution +
    // future deep-link params intact across the legacy→new migration.
    if (!url.search && req.nextUrl.search) {
      url.search = req.nextUrl.search;
    }
    return NextResponse.redirect(url, 301);
  }

  if (isProtected(req)) {
    const target = req.nextUrl.pathname + req.nextUrl.search;
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", target);
    await auth.protect({ unauthenticatedUrl: signInUrl.toString() });
  }

  // No locale cookie stamping here: the NEXT_LOCALE cookie is written
  // exclusively by the in-app language switcher (see
  // ~/components/shell/language-switcher.tsx). Everyone defaults to
  // English; Hebrew is explicit opt-in from inside the authenticated
  // app. IP-based auto-switching was the wrong UX — users in IL don't
  // necessarily want Hebrew, and the landing page has no "switch to
  // English" surface (by product decision, landing is English-only).
  return NextResponse.next();
});

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
