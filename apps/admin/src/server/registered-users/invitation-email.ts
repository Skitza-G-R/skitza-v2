import type { AdminEnvironmentId, AdminEnvironmentMap } from "~/server/environment";

// SK-273 follow-up — every Clerk-sent invitation landed in Gmail's
// Promotions tab, so beta invitees never saw it. Clerk sends through its
// own shared SendGrid pool, and the message carries every fingerprint
// Gmail's tab classifier reads as bulk marketing: `X-SG-EID`/`X-SG-ID`
// tracking headers, a `clkmail.skitza.app` return path that does not
// match the From domain, a 600px nested-table layout with a gradient CTA
// button, a "(c) 2026 Skitza" footer, and the same tokenized accept link
// repeated twice.
//
// So we now create the Clerk invitation with `notify: false` and send the
// accept link ourselves through Resend: our own sending domain, a From
// that carries a human name, a real Reply-To, and a body that is plain
// prose around a single text link.
//
// Keep it plain. A styled button, an unsubscribe footer, a tracking
// pixel or a second copy of the link each push it back toward
// Promotions. This is transactional mail to someone who asked for it —
// deliberately do NOT add a List-Unsubscribe header, which marks a
// message as bulk.
//
// One deliberate exception (Gili, 25 Aug 2026): a single 48px logo above
// the text, because these invitees signed up months ago and the bare
// message did not read as official. It stays one left-aligned <img> with
// no header band, no table and no button, and the Promotions/Primary
// placement was re-tested after adding it. Do not let it grow into a
// masthead.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// The only image in this email. Served from the production site so it
// resolves for every recipient, and rendered small and left-aligned so it
// reads as a signature mark rather than a marketing header. The 128px
// source is downscaled to 48 so it stays sharp on retina screens.
const LOGO_URL = "https://skitza.app/icons/skitza-128.png";
const LOGO_DISPLAY_PX = 48;

// These invitees signed up for early access months ago, so the message has
// to re-introduce Skitza before it asks for anything. One source of truth
// keeps the HTML and plain-text parts from drifting apart.
const REMINDER =
  "You signed up for early access a couple of months ago, so a quick reminder of " +
  "what Skitza is: one app for your whole studio. You send a client one link — they " +
  "listen to your tracks, book a session and pay you — and every project, agreement " +
  "and payment stays in one place.";
const MAX_ACCEPT_URL_LENGTH = 2000;

const RESEND_KEY_NAMES = {
  live: "ADMIN_LIVE_RESEND_API_KEY",
  test: "ADMIN_TEST_RESEND_API_KEY",
} as const;

const FROM_NAMES = {
  live: "ADMIN_LIVE_INVITE_FROM",
  test: "ADMIN_TEST_INVITE_FROM",
} as const;

const REPLY_TO_NAMES = {
  live: "ADMIN_LIVE_INVITE_REPLY_TO",
  test: "ADMIN_TEST_INVITE_REPLY_TO",
} as const;

// "Gili from Skitza <gili@skitza.app>" — the display name is required, not
// cosmetic: a bare address reads as machine mail to Gmail and to a human
// skimming a crowded inbox.
const FROM_PATTERN = /^(?<displayName>[^<>"]{1,100}?)\s+<(?<mailbox>[^\s@<>]+@[^\s@<>]+)>$/;
const MAILBOX_PATTERN = /^[^\s@<>]+@[^\s@<>]+$/;

export type AdminInvitationEmailConfig = Readonly<{
  apiKey: string;
  from: string;
  replyTo: string;
  signature: string;
}>;

export class AdminInvitationEmailConfigurationError extends Error {
  constructor() {
    super("ADMIN_INVITATION_EMAIL_ENVIRONMENT_INVALID");
    this.name = "AdminInvitationEmailConfigurationError";
  }
}

export class InvitationEmailError extends Error {
  constructor() {
    super("INVITATION_EMAIL_FAILED");
    this.name = "InvitationEmailError";
  }
}

export interface InvitationEmailSender {
  send(input: Readonly<{ acceptUrl: string; to: string }>): Promise<void>;
}

function required(environment: AdminEnvironmentMap, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new AdminInvitationEmailConfigurationError();
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Resolves the Resend credentials and sender identity for one admin
 * environment. Live and Test must not share an API key or a From address,
 * so a Test wave can never go out over the Live domain's reputation.
 */
export function resolveAdminInvitationEmailConfig(
  environment: AdminEnvironmentMap,
  selected: AdminEnvironmentId,
): AdminInvitationEmailConfig {
  const apiKeys = {} as Record<AdminEnvironmentId, string>;
  const froms = {} as Record<AdminEnvironmentId, string>;
  const replyTos = {} as Record<AdminEnvironmentId, string>;
  const signatures = {} as Record<AdminEnvironmentId, string>;

  for (const environmentId of ["live", "test"] as const) {
    const apiKey = required(environment, RESEND_KEY_NAMES[environmentId]);
    const from = required(environment, FROM_NAMES[environmentId]);
    const replyTo = required(environment, REPLY_TO_NAMES[environmentId]);

    const parsedFrom = FROM_PATTERN.exec(from);
    const displayName = parsedFrom?.groups?.displayName?.trim();
    if (
      !/^re_[A-Za-z0-9_-]{8,}$/.test(apiKey) ||
      !displayName ||
      !MAILBOX_PATTERN.test(replyTo) ||
      replyTo.length > 320
    ) {
      throw new AdminInvitationEmailConfigurationError();
    }

    apiKeys[environmentId] = apiKey;
    froms[environmentId] = from;
    replyTos[environmentId] = replyTo;
    // Sign off with the first word of the From display name, so the copy
    // stays personal without a fourth environment variable to keep in sync.
    signatures[environmentId] = displayName.split(/\s+/)[0] ?? displayName;
  }

  if (apiKeys.live === apiKeys.test || froms.live === froms.test) {
    throw new AdminInvitationEmailConfigurationError();
  }

  return {
    apiKey: apiKeys[selected],
    from: froms[selected],
    replyTo: replyTos[selected],
    signature: signatures[selected],
  };
}

/**
 * The invitation body. Deliberately plain: one small logo, no table
 * layout, no button, no footer, one link that appears exactly once.
 */
export function renderProducerInvitationEmail(
  input: Readonly<{ acceptUrl: string; signature: string }>,
): Readonly<{ html: string; subject: string; text: string }> {
  const href = escapeHtml(input.acceptUrl);
  const signature = escapeHtml(input.signature);
  const size = String(LOGO_DISPLAY_PX);
  return {
    html: [
      `<p><img src="${LOGO_URL}" alt="Skitza" width="${size}" height="${size}"></p>`,
      "<p>Hi — your Skitza account is ready to set up.</p>",
      `<p>${escapeHtml(REMINDER)}</p>`,
      `<p><a href="${href}">Finish setting up your account</a></p>`,
      "<p>The link works for the next 7 days and only from this email address.</p>",
      "<p>If it gives you any trouble, just reply — this comes straight to me.</p>",
      `<p>— ${signature}</p>`,
    ].join("\n"),
    subject: "Your Skitza account is ready",
    text: [
      "Hi — your Skitza account is ready to set up.",
      "",
      REMINDER,
      "",
      "Finish setting up your account here:",
      input.acceptUrl,
      "",
      "The link works for the next 7 days and only from this email address.",
      "",
      "If it gives you any trouble, just reply — this comes straight to me.",
      "",
      `— ${input.signature}`,
    ].join("\n"),
  };
}

export function createResendInvitationEmailSender(
  config: AdminInvitationEmailConfig,
): InvitationEmailSender {
  return {
    async send(input) {
      if (input.acceptUrl.length > MAX_ACCEPT_URL_LENGTH) throw new InvitationEmailError();
      const message = renderProducerInvitationEmail({
        acceptUrl: input.acceptUrl,
        signature: config.signature,
      });

      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          body: JSON.stringify({
            from: config.from,
            html: message.html,
            reply_to: config.replyTo,
            subject: message.subject,
            text: message.text,
            to: [input.to],
          }),
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          method: "POST",
        });
      } catch {
        throw new InvitationEmailError();
      }
      if (!response.ok) throw new InvitationEmailError();
    },
  };
}
