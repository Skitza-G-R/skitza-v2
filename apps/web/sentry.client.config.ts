import * as Sentry from "@sentry/nextjs";

import {
  filterCurrentBrowserPublicSongTelemetry,
  redactPublicSongTelemetry,
} from "./src/lib/observability/public-song-telemetry";

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
    // rate-limiting / abuse prevention. Public-song bearer authorities
    // are scrubbed by every payload hook below.
    sendDefaultPii: true,

    beforeSend: filterCurrentBrowserPublicSongTelemetry,
    beforeSendTransaction: filterCurrentBrowserPublicSongTelemetry,
    beforeSendSpan: redactPublicSongTelemetry,
    beforeBreadcrumb: filterCurrentBrowserPublicSongTelemetry,
    beforeSendLog: filterCurrentBrowserPublicSongTelemetry,
    beforeSendMetric: filterCurrentBrowserPublicSongTelemetry,

    // Capture 100% of transactions in dev, 10% in prod. Adjust
    // downward as traffic grows; Skitza's free-tier Sentry budget
    // is ~5k events/mo.
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

    // Replay is disabled for the public-launch release. SDK 10.49 can retain a
    // raw client-navigation URL in Replay metadata before page code can stop
    // recording. Keep the event processor above as defense in depth, but do
    // not initialize or sample Replay until a no-flush transition is proven.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Environment tag lets us filter production vs preview in the
    // Sentry dashboard. Preview deployments get `preview`, prod gets
    // `production`.
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });

  // Replay keeps its own navigation URL list, outside the ordinary beforeSend
  // hooks. Sentry's documented event processor is the last-mile scrubber for
  // replay_event.urls and any non-plain URL/Error values normalized afterward.
  Sentry.addEventProcessor(redactPublicSongTelemetry);
}
