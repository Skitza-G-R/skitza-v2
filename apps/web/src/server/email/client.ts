import {
  approvedSk102Runtime,
  assertSk102EmailRecipients,
  type Sk102EmailKind,
} from "@skitza/db/sk102-runtime";
import { type CreateEmailOptions, type CreateEmailRequestOptions, Resend } from "resend";

export type EmailMessage = CreateEmailOptions;
export type EmailRequestOptions = CreateEmailRequestOptions;

// Lazy Resend client. We can't construct it at module load because
// `RESEND_API_KEY` is only present at runtime (Vercel env), not during
// `next build` of unrelated routes. The cached instance keeps cold
// path overhead to one allocation per process.
let _client: Resend | null = null;

export function getResend(): Resend {
  if (approvedSk102Runtime()) {
    throw new Error("SK102_EMAIL_PROVIDER_FORBIDDEN");
  }
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
  approvedSk102Runtime()?.emailFrom ?? process.env.RESEND_FROM ?? "Skitza <hello@skitza.app>";

// Hint for templates that want to drop in a bare host. Default falls
// back to the canonical brand origin so misconfigured envs still send
// producers + artists to the right host.
export const SITE_URL =
  approvedSk102Runtime()?.siteUrl ?? process.env.SITE_URL ?? "https://skitza.app";

function recipientList(value: string | readonly string[] | undefined): string[] {
  if (!value) return [];
  return typeof value === "string" ? [value] : [...value];
}

/**
 * Deliver normally outside SK-102. In SK-102, capture the rendered message in
 * the approved private R2 docs bucket and never construct a Resend client.
 */
export async function sendEmail(
  kind: Sk102EmailKind,
  message: EmailMessage,
  options?: EmailRequestOptions,
) {
  const runtime = approvedSk102Runtime();
  if (!runtime) {
    return options ? getResend().emails.send(message, options) : getResend().emails.send(message);
  }

  assertSk102EmailRecipients([
    ...recipientList(message.to),
    ...recipientList(message.cc),
    ...recipientList(message.bcc),
    ...recipientList(message.replyTo),
  ]);
  const { captureSk102Email } = await import("./sk102-capture");
  return captureSk102Email({
    runtime,
    kind,
    message,
    ...(options ? { options } : {}),
  });
}
