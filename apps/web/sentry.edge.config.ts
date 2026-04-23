import * as Sentry from "@sentry/nextjs";

// Edge-runtime Sentry init. Loaded from `instrumentation.ts` via
// dynamic import when NEXT_RUNTIME === "edge". Covers middleware
// (apps/web/src/middleware.ts) and any route handlers we move to
// the edge runtime (none currently, but future-proof).
//
// 2026-04-22 — audit Task 14 (observability).

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: true,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
}
