import { Resend } from "resend";

// Lazy Resend client. We can't construct it at module load because
// `RESEND_API_KEY` is only present at runtime (Vercel env), not during
// `next build` of unrelated routes. The cached instance keeps cold
// path overhead to one allocation per process.
let _client: Resend | null = null;

export function getResend(): Resend {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("Missing RESEND_API_KEY — cannot send transactional email");
  }
  _client = new Resend(key);
  return _client;
}

// Default from-address. The Vercel env should override this with a
// verified-domain sender once the producer's marketing DNS is wired;
// the fallback uses the launch domain so dev still works.
export const FROM_ADDRESS =
  process.env.RESEND_FROM ?? "Skitza <hello@skitza.app>";

// Hint for templates that want to drop in a bare host. Default falls
// back to the canonical brand origin so misconfigured envs still send
// producers + artists to the right host.
export const SITE_URL =
  process.env.SITE_URL ?? "https://skitza.app";
