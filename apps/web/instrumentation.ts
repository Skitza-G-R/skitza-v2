import * as Sentry from "@sentry/nextjs";
import { assertSk102EdgeRuntime } from "~/server/sk102-edge-runtime";

// Next.js 15 instrumentation hook. Runs once on server boot (Node
// runtime) or edge boot. Dynamically imports the runtime-specific
// Sentry config so each env gets its own init call.
//
// 2026-04-22 — audit Task 14 (observability). Replaces the legacy
// sentry.{server,edge}.config approach that Next 15 deprecated.
// See https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { approvedSk102Runtime } = await import("@skitza/db/sk102-runtime");
    approvedSk102Runtime();
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    assertSk102EdgeRuntime();
    await import("./sentry.edge.config");
  }
}

// Capture errors thrown from Server Components, middleware, route
// handlers, and proxies. Requires @sentry/nextjs ≥ v8.28.0 + Next 15.
export const onRequestError = Sentry.captureRequestError;
