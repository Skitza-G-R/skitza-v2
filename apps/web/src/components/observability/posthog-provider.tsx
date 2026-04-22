"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";

// Client-side PostHog provider. Wraps the authenticated app tree at
// the root layout. Handles:
//   1. SDK init (once, idempotent) — only if NEXT_PUBLIC_POSTHOG_KEY
//      is set. Missing key = no-op (clean dev experience).
//   2. Pageview tracking on client-side route changes — App Router
//      doesn't fire a full page load on nav, so $pageview won't fire
//      automatically the way it does in SPA-of-yore frameworks.
//   3. Identity linking — once Clerk resolves the user, call
//      posthog.identify() with their userId so events across the
//      session attach to their profile.
//
// 2026-04-22 — audit Task 14 (observability). Pair to Sentry (which
// covers errors/traces); PostHog covers product analytics — signup
// funnel, feature usage, retention.

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    // Check idempotency — if already initialised (e.g. after a soft
    // nav in dev with HMR), skip re-init.
    if (typeof window !== "undefined" && !posthog.__loaded) {
      posthog.init(POSTHOG_KEY, {
        // Route through /ingest (Next rewrites set in next.config.ts)
        // so ad-blockers that kill *.posthog.com don't kneecap analytics.
        api_host: "/ingest",
        // Tell PostHog the REAL host so its internal feature-flag + session-
        // replay endpoints resolve correctly behind the proxy.
        ui_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.posthog.com",
        // We fire $pageview manually from the effect below (App Router
        // doesn't send one automatically on route changes).
        capture_pageview: false,
        // Respect Do Not Track. Belt-and-braces for the privacy posture
        // in PRD §19 (privacy-first, no per-visitor IPs).
        respect_dnt: true,
        // Reduce default-heavy payload. We can flip these on later
        // as the analytics needs grow.
        capture_pageleave: true,
      });
    }
  }, []);

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
        <PostHogIdentify />
      </Suspense>
      {children}
    </PHProvider>
  );
}

// Fires $pageview on every client-side route change. App Router
// navigations don't trigger a full page load, so PostHog's default
// auto-capture misses them. Manually capture on pathname + search
// change.
function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (!POSTHOG_KEY || !pathname) return;
    const search = searchParams.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    ph.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams, ph]);

  return null;
}

// Once Clerk resolves the signed-in user, link their PostHog session
// to their Clerk user id. Includes a single `$set` of stable user
// properties (email, first name) so the PostHog persons UI is useful.
// On sign-out (Clerk returns isSignedIn=false after a logout), clear
// the identity so future events go to a fresh anonymous profile.
function PostHogIdentify() {
  const { isLoaded, isSignedIn, user } = useUser();
  const ph = usePostHog();

  useEffect(() => {
    if (!POSTHOG_KEY || !isLoaded) return;
    if (isSignedIn) {
      ph.identify(user.id, {
        email: user.emailAddresses[0]?.emailAddress,
        first_name: user.firstName,
      });
    } else {
      // Called after sign-out — PostHog keeps the anonymous distinct_id
      // but breaks the link to the previous authed user. New events
      // after this point are anonymous until the next identify().
      ph.reset();
    }
  }, [isLoaded, isSignedIn, user, ph]);

  return null;
}
