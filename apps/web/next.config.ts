import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// next-intl integration — threads the request-config loader so RSCs
// can call `useTranslations` / `getTranslations` without the provider
// being mounted inside each page. Points at our src/i18n/request.ts
// where locale + messages are resolved per request.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Security headers. CSP is deliberately permissive for Clerk + Vercel
// live-region rendering (both need inline styles/scripts and connect
// back to their own origins). Tighten post-launch once we have a real
// inventory of third parties.
//
// Notes on why each header exists:
// * Strict-Transport-Security — enforce HTTPS via browser pinning.
// * X-Content-Type-Options: nosniff — stop MIME confusion attacks.
// * X-Frame-Options: DENY — never render inside an iframe (clickjacking).
// * Referrer-Policy — don't leak magic-link URLs via Referer to third
//   parties; same-origin lets the dwell beacon still work.
// * Permissions-Policy — explicit off-switches for APIs we never use;
//   keep the surface small if any third-party script loads later.
// * X-DNS-Prefetch-Control — opt in, small perf win, no privacy cost
//   because DNS prefetches leak less than the sites we already embed.
// * X-Robots-Tag — broad allow for the marketing surface; robots.ts
//   handles per-route exclusions.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=(self)",
      "usb=()",
      "magnetometer=()",
      "accelerometer=()",
      "gyroscope=()",
    ].join(", "),
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Moved out of `experimental` in Next 15.5. Keeps the typed <Link /> so
  // typos in href strings fail the typecheck instead of shipping.
  typedRoutes: true,

  // Hide the X-Powered-By banner — one less fingerprinting bit.
  poweredByHeader: false,

  // Next 15 auto-optimises images from remote hosts only when listed here.
  // Producers paste external artwork URLs for now (R2 comes in weeks 6-8);
  // the remotePatterns below cover the common MP3 / artwork sources we
  // expect during beta without going full wildcard.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "i.scdn.co" }, // Spotify artwork CDN
      { protocol: "https", hostname: "p.scdn.co" }, // Spotify preview CDN
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "**.vercel.app" },
    ],
  },

  async headers() {
    // The /get-started ad funnel embeds the founder's standalone demo
    // (apps/web/public/landing/demo.html) inside an <iframe>. The
    // global X-Frame-Options: DENY in SECURITY_HEADERS would block
    // even same-origin framing — so we override it for landing assets
    // with SAMEORIGIN. CSP frame-ancestors would be cleaner long-term,
    // but X-Frame-Options is the legacy header older browsers honor.
    const SECURITY_HEADERS_LANDING_FRAMEABLE = SECURITY_HEADERS.map((h) =>
      h.key === "X-Frame-Options" ? { ...h, value: "SAMEORIGIN" } : h,
    );
    return [
      {
        // Catch-all FIRST — every route gets the strict security
        // headers by default.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Then override for /landing/* — Next.js applies header rules
        // in array order and the LAST matching rule wins per header
        // name, so this swaps X-Frame-Options to SAMEORIGIN for the
        // demo iframe asset.
        source: "/landing/:path*",
        headers: SECURITY_HEADERS_LANDING_FRAMEABLE,
      },
    ];
  },

  // PostHog proxy rewrites. Routes /ingest/* to PostHog's
  // ingestion endpoints so the browser talks to our own origin
  // instead of app.posthog.com — bypasses aggressive ad-blockers
  // that kill product analytics on /i.posthog.com. See PostHog's
  // recommended Next.js pattern.
  //
  // NEXT_PUBLIC_POSTHOG_HOST should be the REGION host — e.g.
  // https://us.i.posthog.com (US) or https://eu.i.posthog.com (EU).
  // If unset, rewrites degrade to passthroughs (won't break anything).
  async rewrites() {
    const host =
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
    return [
      { source: "/ingest/static/:path*", destination: `${host}/static/:path*` },
      { source: "/ingest/:path*", destination: `${host}/:path*` },
      {
        source: "/ingest/decide",
        destination: `${host}/decide`,
      },
    ];
  },
  // PostHog needs trailing-slash handling flipped so the rewrites
  // above don't hit the default 308 redirect before reaching PostHog.
  skipTrailingSlashRedirect: true,
};

// Compose: next-intl on the inside, Sentry on the outside. Sentry's
// build-time source-map upload hooks into the Next.js webpack config,
// which next-intl's wrapper also touches. Nesting in this order means
// both plugins see the final config object.
//
// 2026-04-22 — audit Task 14 (observability). If SENTRY_AUTH_TOKEN
// and org/project slugs aren't set (local dev, preview without
// secrets), withSentryConfig silently skips the source-map upload
// step but still produces a working build.
// Compose the Sentry options via conditional spread so undefined env
// vars don't clash with `exactOptionalPropertyTypes: true` in tsconfig.
// Only include each field when it's actually set.
const sentryBuildOptions = {
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT
    ? { project: process.env.SENTRY_PROJECT }
    : {}),
  ...(process.env.SENTRY_AUTH_TOKEN
    ? { authToken: process.env.SENTRY_AUTH_TOKEN }
    : {}),
  // Keeps bundle small by stripping Sentry's internal debug logging.
  disableLogger: true,
  // Don't fail the build if source-map upload errors. Sentry
  // recommends this for CI reliability — missing source maps
  // degrade error-readability but don't block deploys.
  silent: !process.env.CI,
  // Tunnel client-side SDK requests through our origin for the
  // same ad-blocker-bypass reason as the PostHog rewrites.
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
};

export default withSentryConfig(withNextIntl(config), sentryBuildOptions);
