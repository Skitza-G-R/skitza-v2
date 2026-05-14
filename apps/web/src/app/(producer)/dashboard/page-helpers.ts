// Pure helpers for the Overview dashboard.
//
// Extracted into a plain `.ts` module — no `"use client"` directive,
// no React, no Next.js APIs — so the server-rendered page.tsx can
// import them safely. The April 2026 mistake log has the canonical
// rule (audit Task 18): "Never export non-component (lowercase)
// functions from a 'use client' file if any server component imports
// them." Hence the dedicated module.
//
// Tested directly in __tests__/page-rebuild.test.ts.

/**
 * Greeting date — "Friday, April 25" style. en-US format only (the
 * landing-and-public surfaces are English-only per CLAUDE.md i18n
 * rules; the dashboard greeting falls under the same producer-app
 * surface that doesn't need translation for v1). Translation is a
 * later wave.
 *
 * Uses `Intl.DateTimeFormat` so the weekday + month names are
 * locale-aware once we do roll Hebrew translation forward, but the
 * locale tag is hardcoded to en-US for now.
 */
export function formatGreetingDate(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

/**
 * One-line summary under the date.
 *
 * - 0 → "All quiet today." (a calm signal, not a "nothing to do" void)
 * - 1 → "1 thing needs you."
 * - N → "N things need you."
 *
 * Singular vs plural is locked by test (`formatGreetingSummary` line
 * in __tests__/page-rebuild.test.ts). The N count comes from the
 * existing producer.today payload's `unresolvedItems` (sum of unpaid
 * invoices + open comments — same source as the prior KPI strip's
 * "Unresolved" tile, now folded into the Pulse card footer).
 */
export function formatGreetingSummary(unresolvedItems: number): string {
  if (unresolvedItems === 0) return "All quiet today.";
  const noun = unresolvedItems === 1 ? "thing needs" : "things need";
  return `${String(unresolvedItems)} ${noun} you.`;
}
