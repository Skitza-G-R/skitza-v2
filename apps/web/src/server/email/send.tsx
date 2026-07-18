import { render } from "@react-email/components";

import { FROM_ADDRESS, getResend, SITE_URL } from "./client";
import {
  BookingCancelledOrRescheduled,
  type BookingCancelledOrRescheduledProps,
} from "./templates/booking-cancelled-or-rescheduled";
import {
  BookingConfirmedToArtist,
  type BookingConfirmedToArtistProps,
} from "./templates/booking-confirmed-to-artist";
import {
  BookingRequestReceived,
  type BookingRequestReceivedProps,
} from "./templates/booking-request-received";
import { ClientInvite, type ClientInviteProps } from "./templates/client-invite";
import {
  NewCommentFromArtist,
  type NewCommentFromArtistProps,
} from "./templates/new-comment-from-artist";
import {
  ProducerRepliedToComment,
  type ProducerRepliedToCommentProps,
} from "./templates/producer-replied-to-comment";
import {
  ProofRejectedToArtist,
  type ProofRejectedToArtistProps,
} from "./templates/proof-rejected-to-artist";
import {
  ProofVerifiedToArtist,
  type ProofVerifiedToArtistProps,
} from "./templates/proof-verified-to-artist";
import {
  PurchaseApprovedToArtist,
  type PurchaseApprovedToArtistProps,
} from "./templates/purchase-approved-to-artist";
import {
  PurchaseDeclinedToArtist,
  type PurchaseDeclinedToArtistProps,
} from "./templates/purchase-declined-to-artist";
import { SessionReminder1h, type SessionReminder1hProps } from "./templates/session-reminder-1h";
import { SessionReminder24h, type SessionReminder24hProps } from "./templates/session-reminder-24h";
import {
  TrackVersionUploaded,
  type TrackVersionUploadedProps,
} from "./templates/track-version-uploaded";

// All four send helpers share the same shape: render the template,
// hand the HTML to Resend. Callers MUST wrap each invocation in
// try/catch + console.warn so a transient email failure never breaks
// the primary flow (booking insert, status transition, etc.).
//
// `reviewUrl` defaults to the dashboard requests tab on SITE_URL when
// the caller doesn't pass one — saves repeating that string everywhere.

export async function sendBookingRequestEmail(
  to: string,
  props: Omit<BookingRequestReceivedProps, "reviewUrl"> & {
    reviewUrl?: string;
  },
): Promise<void> {
  const reviewUrl = props.reviewUrl ?? `${SITE_URL}/dashboard/booking?tab=upcoming`;
  const html = await render(<BookingRequestReceived {...props} reviewUrl={reviewUrl} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `New session request from ${props.artistName}`,
    html,
  });
}

export async function sendBookingConfirmedEmail(
  to: string,
  props: BookingConfirmedToArtistProps,
): Promise<void> {
  const html = await render(<BookingConfirmedToArtist {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Your session with ${props.producerName} is confirmed`,
    html,
  });
}

export async function sendSessionReminder24h(
  to: string,
  props: SessionReminder24hProps,
): Promise<void> {
  const html = await render(<SessionReminder24h {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Reminder · session tomorrow with ${props.counterpartName}`,
    html,
  });
}

export async function sendSessionReminder1h(
  to: string,
  props: SessionReminder1hProps,
): Promise<void> {
  const html = await render(<SessionReminder1h {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Starting soon · session with ${props.counterpartName}`,
    html,
  });
}

// ─── 2026-04-22 — audit Task 13: the 8 additional templates ──────
// Each follows the same render-then-send idiom so callers can drop
// one-liners at the right event hook without touching Resend client.
//
// All send functions can throw on Resend error. Callers MUST wrap
// in try/catch (the existing booking routes already do). See also
// src/server/email/SITE_URL — used as the base for deep-link URLs
// when the caller doesn't pass its own.

export async function sendTrackVersionUploadedEmail(
  to: string,
  props: TrackVersionUploadedProps,
): Promise<void> {
  const html = await render(<TrackVersionUploaded {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `New mix from ${props.producerName} · ${props.versionLabel}`,
    html,
  });
}

export async function sendProducerRepliedToCommentEmail(
  to: string,
  props: ProducerRepliedToCommentProps,
): Promise<void> {
  const html = await render(<ProducerRepliedToComment {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `${props.producerName} replied · ${props.trackTitle}`,
    html,
  });
}

export async function sendNewCommentFromArtistEmail(
  to: string,
  props: NewCommentFromArtistProps,
): Promise<void> {
  const html = await render(<NewCommentFromArtist {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `New comment from ${props.artistName} · ${props.trackTitle}`,
    html,
  });
}

export async function sendBookingCancelledOrRescheduledEmail(
  to: string,
  props: BookingCancelledOrRescheduledProps,
): Promise<void> {
  const html = await render(<BookingCancelledOrRescheduled {...props} />);
  const verb = props.status === "cancelled" ? "cancelled" : "rescheduled";
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Session ${verb} · ${props.productName}`,
    html,
  });
}

// Clients & Projects v3 redesign — Phase 1 Task 13. Producer sends a
// contact an invite from the LinkPill "Invite to app" CTA. Subject is
// the same shape as the other transactional sends so the producer's
// inbox stays consistent. Caller MUST wrap in try/catch + console.warn
// so a transient Resend failure doesn't break the primary write
// (invited_at stamp).
export async function sendClientInviteEmail(to: string, props: ClientInviteProps): Promise<void> {
  const html = await render(<ClientInvite {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `${props.producerName} invited you to Skitza`,
    html,
  });
}

// ─── Purchase flow (SK-37 / BE-1) ───────────────────────────────────
// Artist-facing Gate-1 outcome emails. Callers MUST wrap in try/catch +
// console.error so a transient Resend failure never breaks the
// approve/decline status transition.

export async function sendPurchaseApprovedEmail(
  to: string,
  props: PurchaseApprovedToArtistProps,
): Promise<void> {
  const html = await render(<PurchaseApprovedToArtist {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `${props.producerName} approved your request`,
    html,
  });
}

export async function sendProofVerifiedEmail(
  to: string,
  props: ProofVerifiedToArtistProps,
): Promise<void> {
  const html = await render(<ProofVerifiedToArtist {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: props.paidInFull
      ? `Paid in full — ${props.productName}`
      : `Payment confirmed — ${props.productName}`,
    html,
  });
}

export async function sendProofRejectedEmail(
  to: string,
  props: ProofRejectedToArtistProps,
): Promise<void> {
  const html = await render(<ProofRejectedToArtist {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Action needed on your payment — ${props.productName}`,
    html,
  });
}

export async function sendPurchaseDeclinedEmail(
  to: string,
  props: PurchaseDeclinedToArtistProps,
): Promise<void> {
  const html = await render(<PurchaseDeclinedToArtist {...props} />);
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Update on your request to ${props.producerName}`,
    html,
  });
}

// Re-export SITE_URL for callers who build deep-link URLs themselves.
export { SITE_URL };
