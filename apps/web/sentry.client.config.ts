import * as Sentry from "@sentry/nextjs";

// Client-side Sentry init. Loaded automatically by @sentry/nextjs
// when rendering pages in the browser. DSN is optional — if unset
// (e.g. local dev without credentials), the SDK no-ops cleanly
// rather than throwing.
//
// 2026-04-22 — audit Task 14 (observability). Primary motivation:
// today's 8h "artist-welcome ping-pong" happened because we were
// flying blind in production. Sentry captures runtime errors,
// unhandled promise rejections, and TRPCError bubbles so future
// bugs have diagnosable signal.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Adds request headers + client IP to events. Privacy-reviewed
    // against our PRD §19 stance: we already collect these for
    // rate-limiting / abuse prevention, and Sentry lets us scrub
    // sensitive fields via `beforeSend` if we need to later.
    sendDefaultPii: true,

    // Capture 100% of transactions in dev, 10% in prod. Adjust
    // downward as traffic grows; Skitza's free-tier Sentry budget
    // is ~5k events/mo.
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

    // Session Replay — record 10% of sessions + 100% of sessions
    // that hit an error. Most valuable signal-to-noise ratio for
    // "why did this user get stuck" investigations like the
    // artist-welcome bug we burned on today.
    integrations: [Sentry.replayIntegration()],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Environment tag lets us filter production vs preview in the
    // Sentry dashboard. Preview deployments get `preview`, prod gets
    // `production`.
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
}
