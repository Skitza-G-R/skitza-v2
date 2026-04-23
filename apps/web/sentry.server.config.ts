import * as Sentry from "@sentry/nextjs";

// Server-side (Node runtime) Sentry init. Loaded from
// `instrumentation.ts` via dynamic import when NEXT_RUNTIME === "nodejs".
// Captures errors from Server Components, tRPC procedures, server
// actions, and API route handlers.
//
// 2026-04-22 — audit Task 14 (observability). This is the one that
// would have told us WHY today's artist-welcome server action wasn't
// running — Sentry would have shown whether joinArtistWorkspace
// entered, threw, or was never called.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: true,

    // Capture 100% of transactions in dev, 10% in prod. Server-side
    // sampling is what feeds the performance dashboard + the
    // request-by-request trace view.
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
}
