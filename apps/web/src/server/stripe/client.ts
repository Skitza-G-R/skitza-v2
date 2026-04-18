import Stripe from "stripe";

// Lazy-initialized Stripe REST client. We avoid touching process.env at
// module load so static analysis (tests, type-check, lint) can import
// from this file without crashing on a missing key. The first runtime
// caller — typically a tRPC mutation or the webhook route — pays the
// cost. Keys are pulled from the environment so deployment-time secret
// rotation works without rebuilds.
let _client: Stripe | null = null;

export function getStripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  _client = new Stripe(key, {
    // Pin the API version so Stripe-side dashboard changes can't shift
    // response shapes underneath us. Bump deliberately when upgrading.
    apiVersion: "2026-03-25.dahlia",
    typescript: true,
  });
  return _client;
}

// Re-exported as constants (vs. accessor functions) because the
// webhook route reads them once at request time and the absence of a
// secret is a 500-class problem we want to surface immediately.
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
export const STRIPE_PUBLIC_KEY = process.env.STRIPE_PUBLIC_KEY;

// Public site origin used to build redirect URLs in account links and
// Checkout Sessions. Falls back to the canonical Vercel deployment so
// local-dev (without a configured base URL) still produces working
// links — Stripe-side redirects fail loudly if the URL is invalid.
export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://skitza-v2-web.vercel.app"
  );
}
