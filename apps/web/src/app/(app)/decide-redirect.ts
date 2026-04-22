import { isAutoSlug } from "~/lib/slug";

// Pure routing-decision for the (app) layout. Given what we know
// about the authed user + their DB state, return where they should
// be redirected (or null to render /dashboard as-is).
//
// Extracted from the layout so we can unit-test the policy without
// mocking Clerk + Drizzle + next/navigation.
//
// See docs/audit-report.md Task 15 for the 2026-04-22 bug this
// function closes: an artist who self-serves via /join/<slug> has NO
// producers row (the webhook correctly skipped it) but DOES have a
// client_contacts row. Before the fix, they'd land at /dashboard,
// hit this layout, find no producer row, and get funneled into
// producer onboarding. The `hasClientContacts` branch below sends
// them to /artist instead.

export type ProducerRow = {
  displayName: string | null;
  slug: string;
  email: string;
};

export type AppLayoutRedirect = "/sign-in" | "/onboarding" | "/artist" | null;

export function decideAppLayoutRedirect(params: {
  userId: string | null;
  producerRow: ProducerRow | null;
  hasClientContacts: boolean;
}): AppLayoutRedirect {
  const { userId, producerRow, hasClientContacts } = params;

  // No Clerk session — kick back to sign-in. Middleware should have
  // caught this already; this is belt-and-braces for direct-render
  // paths (e.g. server-side pre-render attempts).
  if (!userId) return "/sign-in";

  // No producers row — this user is either an artist (client_contacts
  // exists) or a brand-new signup whose webhook hasn't landed yet.
  if (!producerRow) {
    // Artist: send to /artist. The (artist) layout handles its own
    // "no studios yet → /artist-welcome" redirect downstream, so we
    // don't duplicate that logic here.
    if (hasClientContacts) return "/artist";
    // Orphan or webhook-race: /onboarding is the safe default. The
    // onboarding server action itself no-ops until the producer row
    // exists, so this waits for the webhook gracefully.
    return "/onboarding";
  }

  // Producer row exists — check completeness. A row seeded by the
  // Clerk webhook has a null displayName and an auto-generated slug;
  // the wizard fills both in. Either missing → send through the wizard.
  const incomplete =
    producerRow.displayName === null ||
    isAutoSlug(producerRow.slug, producerRow.email);
  if (incomplete) return "/onboarding";

  // Complete producer — render /dashboard.
  return null;
}
