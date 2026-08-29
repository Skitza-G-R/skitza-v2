import type { AdminEnvironmentMap } from "~/server/environment";
import {
  INVITE_LOGO_CID,
  INVITE_LOGO_FILENAME,
  INVITE_LOGO_HEIGHT,
  INVITE_LOGO_PNG_BASE64,
  INVITE_LOGO_WIDTH,
} from "./invite-logo";

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
// Design (Gili, 25 Aug 2026): branded, in Skitza's own email palette — the
// dark lockup band, a cream card and the amber CTA — because a bare message
// did not read as official to a beta list that signed up months ago.
//
// Tab placement is MEASURED, not assumed. Sent to giasraf+tag@gmail.com:
//   Clerk's own invitation ........ Promotions
//   our plain-text version ........ Primary
//   plain + small logo + reminder . Primary
// Re-check after editing this template. In Gmail, an empty result for
// `category:promotions from:<sender>` means it is not in Promotions, and
// `category:primary from:<sender>` confirms where it did land.
//
// The properties still doing the work, which must survive any redesign:
// our own verified sending domain, a From carrying a human display name, a
// real Reply-To, and exactly ONE link. Deliberately no List-Unsubscribe
// header — it marks transactional mail as bulk — and no tracking pixel, no
// click tracking, no second copy of the link.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const MAX_ACCEPT_URL_LENGTH = 2000;

const RESEND_KEY_NAME = "ADMIN_LIVE_RESEND_API_KEY";
const FROM_NAME = "ADMIN_LIVE_INVITE_FROM";
const REPLY_TO_NAME = "ADMIN_LIVE_INVITE_REPLY_TO";

// "Gili from Skitza <gili@skitza.app>" — the display name is required, not
// cosmetic: a bare address reads as machine mail to Gmail and to a human
// skimming a crowded inbox.
const FROM_PATTERN = /^(?<displayName>[^<>"]{1,100}?)\s+<(?<mailbox>[^\s@<>]+@[^\s@<>]+)>$/;
const MAILBOX_PATTERN = /^[^\s@<>]+@[^\s@<>]+$/;

// Skitza's email palette, shared with the templates in apps/web. BAND must
// stay #0e0d08: the lockup PNG carries that exact background, so any other
// value shows a seam around the image.
const BAND = "#0e0d08";
const PAGE = "#F4EFE7";
const CARD = "#FBF7F0";
const INK = "#1A1714";
const MUTED = "#6B6158";
const HEADING = "#A25A28";
const AMBER = "#C98A0A";
const ON_AMBER = "#1A1407";
const RULE = "#E8E2D9";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Secondary type on the dark band. Flattened from the hero's
// rgba(242,237,230,0.42) — email clients cannot be trusted with alpha.
const BAND_MUTED = "#847E75";

// Borrowed from the landing hero so the email reads as the same product:
// the tagline, and the amber "kicker" bar that closes a headline block.
// The hero's rule is one deliberate accent per block, not scattered
// punctuation — so the kicker and the CTA are the only amber here.
const TAGLINE = "One app. Your whole studio.";

// These invitees signed up for early access months ago, so the message has
// to re-introduce Skitza before it asks for anything. Three scannable rows
// rather than one paragraph — a wall of text is what made the first draft
// read as empty. One source of truth keeps HTML and plain text in step.
const INTRO =
  "You signed up for early access a couple of months ago, so here is the short version of what Skitza does.";

const VALUE_ROWS = [
  ["One link for your client.", "They listen to your tracks, book a session and pay you."],
  ["Everything in one place.", "Projects, agreements, payment records and delivery history."],
  ["No chasing.", "Skitza tracks what is due and sends the reminders for you."],
] as const;

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
 * Resolves the Resend credentials and sender identity. SK-288 removed the
 * Live/Test split, so there is one key and one From address; every shape
 * check that guarded them stays, because a malformed From is what puts a
 * message in Promotions.
 */
export function resolveAdminInvitationEmailConfig(
  environment: AdminEnvironmentMap,
): AdminInvitationEmailConfig {
  const apiKey = required(environment, RESEND_KEY_NAME);
  const from = required(environment, FROM_NAME);
  const replyTo = required(environment, REPLY_TO_NAME);

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

  return {
    apiKey,
    from,
    replyTo,
    // Sign off with the first word of the From display name, so the copy
    // stays personal without another environment variable to keep in sync.
    signature: displayName.split(/\s+/)[0] ?? displayName,
  };
}

/**
 * The invitation body, in Skitza's email palette. One link, one image,
 * and no unsubscribe footer — see the tab-placement note at the top.
 */
export function renderProducerInvitationEmail(
  input: Readonly<{ acceptUrl: string; signature: string }>,
): Readonly<{ html: string; subject: string; text: string }> {
  const href = escapeHtml(input.acceptUrl);
  const signature = escapeHtml(input.signature);
  const subject = "Your Skitza account is ready";

  // Run-in heads with a hairline between, the way the landing page sets a
  // list. `font-size:0;line-height:0` on the rule keeps Outlook from
  // padding it into a visible gap.
  const rows = VALUE_ROWS.map(([lead, rest], index) =>
    [
      index === 0
        ? ""
        : `<tr><td style="padding:14px 0 0;"><div style="border-top:1px solid ${RULE};font-size:0;line-height:0;">&nbsp;</div></td></tr>`,
      `<tr><td style="padding:${index === 0 ? "0" : "14px"} 0 0;font-size:16px;line-height:1.55;color:${INK};">`,
      `<strong style="font-weight:600;">${escapeHtml(lead)}</strong> ${escapeHtml(rest)}`,
      "</td></tr>",
    ].join(""),
  ).join("\n");

  return {
    // Tables and inline styles are not a stylistic choice — Outlook has no
    // flexbox and every client strips <style> blocks differently.
    html: [
      "<!doctype html>",
      '<html lang="en"><head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="color-scheme" content="light">',
      `<title>${escapeHtml(subject)}</title>`,
      "</head>",
      `<body style="margin:0;padding:0;background-color:${PAGE};">`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE};">`,
      '<tr><td align="center" style="padding:24px 12px;">',
      // `width:100%` + `max-width` is the pattern that actually reflows;
      // `width:520px` with `max-width:100%` leaves the table overflowing a
      // 390px phone. Outlook ignores max-width entirely, hence the ghost
      // table that pins it to 520 there and nowhere else.
      '<!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:520px;margin:0 auto;">',

      // Lockup band. Cell colour is cream so an images-off client shows the
      // word "Skitza" rather than a gap, and the tagline keeps the band
      // from reading as empty space beside the logo.
      `<tr><td style="background-color:${BAND};border-radius:12px 12px 0 0;padding:26px 28px 22px;color:${PAGE};font-family:${SANS};font-size:18px;font-weight:700;">`,
      `<img src="cid:${INVITE_LOGO_CID}" alt="Skitza" width="${String(INVITE_LOGO_WIDTH)}" height="${String(INVITE_LOGO_HEIGHT)}" style="display:block;border:0;">`,
      `<div style="margin:14px 0 0;font-family:${SANS};font-size:14px;font-weight:400;letter-spacing:0.01em;color:${BAND_MUTED};">${TAGLINE}</div>`,
      "</td></tr>",

      `<tr><td style="background-color:${CARD};border-radius:0 0 12px 12px;padding:30px 28px 28px;font-family:${SANS};font-size:16px;line-height:1.55;color:${INK};">`,
      `<h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:27px;line-height:1.2;color:${HEADING};">You&rsquo;re in</h1>`,

      // The kicker bar — the hero's signature punctuation, and the only
      // amber in the message besides the CTA.
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;"><tr><td style="width:56px;height:4px;background-color:${AMBER};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`,

      '<p style="margin:22px 0 0;">Hi — your Skitza account is ready to set up.</p>',
      `<p style="margin:14px 0 22px;color:${MUTED};">${escapeHtml(INTRO)}</p>`,

      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">',
      rows,
      "</table>",

      // Bulletproof button: colour on the cell, padding on the anchor.
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr>',
      `<td style="background-color:${AMBER};border-radius:8px;">`,
      `<a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:16px;font-weight:600;color:${ON_AMBER};text-decoration:none;">Finish setting up your account</a>`,
      "</td></tr></table>",

      `<p style="margin:20px 0 0;font-size:14px;color:${MUTED};">The link works for the next 7 days and only from this email address.</p>`,
      '<p style="margin:22px 0 0;">If it gives you any trouble, just reply — this comes straight to me.</p>',
      `<p style="margin:20px 0 0;line-height:1.4;">— ${signature}<br><span style="font-size:14px;color:${MUTED};">Founder, Skitza</span></p>`,
      `<hr style="border:0;border-top:1px solid ${RULE};margin:26px 0 0;">`,
      `<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">You are getting this because you signed up for early access at skitza.app.</p>`,
      "</td></tr>",

      "</table>",
      "<!--[if mso]></td></tr></table><![endif]-->",
      "</td></tr></table>",
      "</body></html>",
    ].join("\n"),
    subject,
    text: [
      "Hi — your Skitza account is ready to set up.",
      "",
      INTRO,
      "",
      ...VALUE_ROWS.map(([lead, rest]) => `* ${lead} ${rest}`),
      "",
      "Finish setting up your account here:",
      input.acceptUrl,
      "",
      "The link works for the next 7 days and only from this email address.",
      "",
      "If it gives you any trouble, just reply — this comes straight to me.",
      "",
      `— ${input.signature}`,
      "Founder, Skitza",
      "",
      "You are getting this because you signed up for early access at skitza.app.",
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
            attachments: [
              {
                content: INVITE_LOGO_PNG_BASE64,
                content_id: INVITE_LOGO_CID,
                filename: INVITE_LOGO_FILENAME,
              },
            ],
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
