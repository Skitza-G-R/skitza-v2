import { Resend } from "resend";

import { EmailDeliveryError } from "./delivery-error";

// Lazy Resend client. We can't construct it at module load because
// `RESEND_API_KEY` is only present at runtime (Vercel env), not during
// `next build` of unrelated routes. The cached instance keeps cold
// path overhead to one allocation per process.
let _client: Resend | null = null;

// The key travels in the `Authorization` header, and `fetch` rejects header
// values outside Latin-1 with a raw TypeError. A key that picked up a stray
// character while being pasted (seen in production: "→") must read as a
// configuration problem, not as an unexplained crash.
function headerSafeKey(key: string): boolean {
  return key.trim() === key && /^[\x21-\x7e]+$/.test(key);
}

export function getResend(): Resend {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("Missing RESEND_API_KEY — cannot send transactional email");
  }
  if (!headerSafeKey(key)) {
    throw new EmailDeliveryError({
      name: "configuration_error",
      message: "RESEND_API_KEY contains characters that cannot be sent in a request header",
      statusCode: null,
    });
  }
  _client = new Resend(key);
  return _client;
}

// Default from-address. The Vercel env should override this with a
// verified-domain sender once the producer's marketing DNS is wired;
// the fallback uses the launch domain so dev still works.
export const FROM_ADDRESS = process.env.RESEND_FROM ?? "Skitza <hello@skitza.app>";

// Hint for templates that want to drop in a bare host. Default falls
// back to the canonical brand origin so misconfigured envs still send
// producers + artists to the right host.
export const SITE_URL = process.env.SITE_URL ?? "https://skitza.app";
