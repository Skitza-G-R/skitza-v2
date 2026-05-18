import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";

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
  // P2-A-7: /booking → /calendar (booking shell still exists for now,
  // but the canonical home for session/availability work is the new
  // Calendar page); /revenue collapsed back into Today; /projects
  // renamed to /clients-projects to match the PRD §4 producer surface.
  "/dashboard/booking":   "/dashboard/calendar",
  "/dashboard/revenue":   "/dashboard",
  "/dashboard/projects":  "/dashboard/clients-projects",
  "/dashboard/contracts": "/dashboard",
  "/dashboard/invoices":  "/dashboard",
  "/dashboard/inbox":     "/dashboard",
  "/dashboard/library":   "/dashboard/music",
  // /dashboard/portfolio was redirected into settings while portfolio
  // lived as a settings tab. As of PR #142 (2026-05-18) the route is
  // the canonical Portfolio page (two-column showcase canvas, exposed
  // as a sidebar entry), so the redirect is intentionally absent —
  // re-adding it would land Portfolio clicks on Settings → Profile.
  // 2026-05-06 — Services + Availability moved out of Settings:
  //   - Services CRUD is now part of the Storefront page (PRD v3
  //     §4.5). Producers create + edit products on the same surface
  //     they curate the public store, so the create/edit flow no
  //     longer punts them to Settings mid-task.
  //   - Availability is a Calendar tab (PRD v3 §4.4). Hours +
  //     blackouts + booking policies live next to the schedule grid.
  // The legacy /dashboard/services and /dashboard/availability paths
  // 301 to the new homes so any prior bookmarks resolve cleanly.
  "/dashboard/services":     "/dashboard/profile?tab=store",
  "/dashboard/availability": "/dashboard/calendar?tab=availability",
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
// Link-only access gate (pre-launch). Anything that isn't an API/tRPC route
// must present either a `?t=<ACCESS_TOKEN>` query param (which we then stamp
// into a cookie) or the `skitza-access` cookie. Otherwise we 404 — same shape
// Clerk uses for protected routes, so we don't leak existence either.
//
// Lives OUTSIDE the clerkMiddleware wrapper because Clerk's dev "keyless
// mode" short-circuits the wrapper and skips the user callback when keys
// are missing. The gate must run unconditionally, so we evaluate it first
// and only delegate to Clerk when access is allowed.
const ACCESS_COOKIE = "skitza-access";

function isAccessGated(pathname: string): boolean {
  // API + tRPC routes are excluded so server-to-server callers and webhooks
  // (Clerk, Stripe, Resend) keep working without the token.
  if (pathname.startsWith("/api/") || pathname === "/api") return false;
  if (pathname.startsWith("/trpc/") || pathname === "/trpc") return false;
  // /get-started is the public funnel entry — always reachable without the gate.
  if (pathname === "/get-started" || pathname.startsWith("/get-started/")) return false;
  return true;
}

const clerk = clerkMiddleware(async (auth, req) => {
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

  // Dev-only bypass for visual review of the onboarding wizard. Gated
  // by NODE_ENV=development AND ?__preview=1 in the request's query
  // string. Vercel sets NODE_ENV="production" on every deployed
  // environment, so this branch is unreachable from any deployed URL.
  // See lib/onboarding/dev-preview.ts for the gate logic + tests.
  const isOnboardingPreview =
    req.nextUrl.pathname.startsWith("/onboarding") &&
    isDevPreviewBypass(req.nextUrl.searchParams);

  if (isProtected(req) && !isOnboardingPreview) {
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
  //
  // Forward x-pathname for /onboarding/* so the (onboarding) layout's
  // role gate can be step-aware (Story 04). Server components have no
  // built-in way to read the current path; the canonical Next.js
  // workaround is "middleware sets the header, layout reads via
  // next/headers". Limit the header injection to /onboarding/* so the
  // rest of the app keeps the bare `NextResponse.next()` shape and we
  // don't pay the Headers-clone cost on every request.
  //
  // (onboarding) is intentionally its own route group — nesting it inside
  // (producer) would loop producer-incomplete users. It will be merged
  // into (producer)/dashboard/onboarding when the wizard is rebuilt in
  // Phase 3.
  if (req.nextUrl.pathname.startsWith("/onboarding")) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", req.nextUrl.pathname);
    // Forward the dev-preview bypass signal so the (onboarding) layout
    // can short-circuit its role gate (and skip the DB round-trip
    // fetchUserRole would otherwise do). Server components can't read
    // search params from the URL directly, so we hop the signal across
    // the request/response boundary as a header. Same NODE_ENV +
    // ?__preview=1 gate as above — see lib/onboarding/dev-preview.ts.
    if (isOnboardingPreview) {
      requestHeaders.set("x-onboarding-preview-bypass", "1");
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return NextResponse.next();
});

export default async function middleware(
  req: Parameters<typeof clerk>[0],
  ev: Parameters<typeof clerk>[1],
) {
  const accessToken = process.env.ACCESS_TOKEN;
  if (accessToken && isAccessGated(req.nextUrl.pathname)) {
    const queryToken = req.nextUrl.searchParams.get("t");
    const cookieToken = req.cookies.get(ACCESS_COOKIE)?.value;

    if (queryToken !== accessToken && cookieToken !== accessToken) {
      return new Response("Not found.", { status: 404 });
    }

    if (queryToken === accessToken) {
      // Delegate to Clerk so its auth context attaches, then stamp the
      // cookie on whatever response Clerk produces. Returning NextResponse
      // .next() directly here would skip Clerk and break any downstream
      // page that calls auth().
      const res = await clerk(req, ev);
      const finalRes =
        res instanceof NextResponse ? res : NextResponse.next();
      finalRes.cookies.set({
        name: ACCESS_COOKIE,
        value: accessToken,
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      return finalRes;
    }
  }

  return clerk(req, ev);
}

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
