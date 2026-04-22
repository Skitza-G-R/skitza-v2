import * as Sentry from "@sentry/nextjs";

// Next.js 15 instrumentation hook. Runs once on server boot (Node
// runtime) or edge boot. Dynamically imports the runtime-specific
// Sentry config so each env gets its own init call.
//
// 2026-04-22 — audit Task 14 (observability). Replaces the legacy
// sentry.{server,edge}.config approach that Next 15 deprecated.
// See https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture errors thrown from Server Components, middleware, route
// handlers, and proxies. Requires @sentry/nextjs ≥ v8.28.0 + Next 15.
export const onRequestError = Sentry.captureRequestError;
