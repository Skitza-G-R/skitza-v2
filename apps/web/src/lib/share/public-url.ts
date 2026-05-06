// Single source of truth for producer-facing share URLs.
//
// A producer's `/join/<slug>` link is a brand-canonical artifact —
// it goes in their IG bio, on their socials, in their portfolio.
// It MUST always read as `skitza.app/join/<slug>` regardless of
// which deployment the producer happens to be viewing the dashboard
// from (production, preview, or local dev).
//
// The pre-2026-05-06 surfaces threaded an env-driven `publicBaseUrl`
// (NEXT_PUBLIC_SITE_URL → SITE_URL → fallback) all the way down to
// PublicLinkStrip + SidebarShareChip + storefront. That meant a
// misconfigured env var in Vercel produced share links pointing at
// the preview host (`skitza-v2-web.vercel.app/...`). On v3-clean the
// PublicLinkStrip ALSO hardcoded `/p/<slug>` — a deprecated route
// (PRD §6.6 / Story 03 deletion) that 404s. Producers' "Copy" button
// was therefore copying a URL that was both wrong-domain AND broken-
// path. Hard-coding the brand origin + path here removes both bugs at
// once.
//
// IMPORTANT: this is for producer-facing share URLs only. Stripe
// redirect URLs, magic-link routes, email deep-links, and Stripe
// Connect callbacks legitimately need to be env-overridable so dev
// and preview deployments route locally — those continue to use
// `getSiteUrl()` from `~/server/stripe/client` and `SITE_URL` from
// `~/server/email/client`.

export const PUBLIC_BRAND_ORIGIN = "https://skitza.app" as const;

export function buildJoinUrl(slug: string): string {
  return `${PUBLIC_BRAND_ORIGIN}/join/${slug}`;
}
