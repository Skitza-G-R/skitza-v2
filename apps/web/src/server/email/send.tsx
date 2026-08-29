import { render } from "@react-email/components";
import type { ErrorResponse } from "resend";

import { FROM_ADDRESS, getResend, SITE_URL } from "./client";
import { EmailDeliveryError } from "./delivery-error";
import { BetaActivationHelp, type BetaActivationHelpProps } from "./templates/beta-activation-help";
import { BetaSignupReminder, type BetaSignupReminderProps } from "./templates/beta-signup-reminder";
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
  PaymentReminderToArtist,
  type PaymentReminderToArtistProps,
} from "./templates/payment-reminder-to-artist";
import {
  ProducerRepliedToComment,
  type ProducerRepliedToCommentProps,
} from "./templates/producer-replied-to-comment";
import {
  PrivateOfferNotification,
  type PrivateOfferNotificationProps,
} from "./templates/private-offer-notification";
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

// SK-287 — Resend resolves with `{ data: null, error }` instead of rejecting
// when the API refuses a send, so a discarded return value made a refused send
// look exactly like a delivered one: the cron sweeps stamped their reminder
// rows and reported success for mail that was never created. Every sender
// routes its result through here so a refusal reaches the caller's existing
// try/catch — and the sweeps' unclaim-and-retry path works again.
function assertResendAccepted(result: { error: ErrorResponse | null }): void {
  if (!result.error) return;
  throw new EmailDeliveryError({
    name: result.error.name,
    message: result.error.message,
    statusCode: result.error.statusCode,
  });
}

export async function sendBookingRequestEmail(
  to: string,
  props: Omit<BookingRequestReceivedProps, "reviewUrl"> & {
    reviewUrl?: string;
  },
): Promise<void> {
  const reviewUrl = props.reviewUrl ?? `${SITE_URL}/dashboard/booking?tab=upcoming`;
  const html = await render(<BookingRequestReceived {...props} reviewUrl={reviewUrl} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `New session request from ${props.artistName}`,
    html,
  });
  assertResendAccepted(result);
}

export async function sendBookingConfirmedEmail(
  to: string,
  props: BookingConfirmedToArtistProps,
): Promise<void> {
  const html = await render(<BookingConfirmedToArtist {...props} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Your session with ${props.producerName} is confirmed`,
    html,
  });
  assertResendAccepted(result);
}

export async function sendSessionReminder24h(
  to: string,
  props: SessionReminder24hProps,
): Promise<void> {
  const html = await render(<SessionReminder24h {...props} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Reminder · session tomorrow with ${props.counterpartName}`,
    html,
  });
  assertResendAccepted(result);
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
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `New mix from ${props.producerName} · ${props.versionLabel}`,
    html,
  });
  assertResendAccepted(result);
}

export async function sendProducerRepliedToCommentEmail(
  to: string,
  props: ProducerRepliedToCommentProps,
): Promise<void> {
  const html = await render(<ProducerRepliedToComment {...props} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `${props.producerName} replied · ${props.trackTitle}`,
    html,
  });
  assertResendAccepted(result);
}

export async function sendNewCommentFromArtistEmail(
  to: string,
  props: NewCommentFromArtistProps,
): Promise<void> {
  const html = await render(<NewCommentFromArtist {...props} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `New comment from ${props.artistName} · ${props.trackTitle}`,
    html,
  });
  assertResendAccepted(result);
}

export async function sendBookingCancelledOrRescheduledEmail(
  to: string,
  props: BookingCancelledOrRescheduledProps,
): Promise<void> {
  const html = await render(<BookingCancelledOrRescheduled {...props} />);
  const verb = props.status === "cancelled" ? "cancelled" : "rescheduled";
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Session ${verb} · ${props.productName}`,
    html,
  });
  assertResendAccepted(result);
}

// Producer sends a Client an intentional Skitza invitation. The durable
// invitation outbox owns retries and provider evidence, so provider failures
// intentionally throw back into that state machine. A returned id proves only
// that Resend accepted the request; it does not claim inbox delivery.
export async function sendClientInviteEmail(
  to: string,
  props: ClientInviteProps,
  idempotencyKey: string,
): Promise<string> {
  const html = await render(<ClientInvite {...props} />);
  const result = await getResend().emails.send(
    {
      from: FROM_ADDRESS,
      to,
      subject: `${props.producerName} invited you to Skitza`,
      html,
    },
    { idempotencyKey },
  );

  if (result.error) {
    throw new EmailDeliveryError({
      name: result.error.name,
      message: result.error.message,
      statusCode: result.error.statusCode,
    });
  }
  const responseData: unknown = result.data;
  if (
    responseData === null ||
    typeof responseData !== "object" ||
    !("id" in responseData) ||
    typeof responseData.id !== "string" ||
    responseData.id.length === 0
  ) {
    throw new Error("Email delivery failed");
  }
  return responseData.id;
}

export type PrivateOfferNotificationSendProps = Omit<PrivateOfferNotificationProps, "openUrl"> & {
  producerSlug: string;
  offerId: string;
};

/**
 * Notify an invited recipient without putting offer terms or a public offer
 * token in email. The producer join route handles new and existing artists;
 * the offer itself remains visible only after verified-email account binding.
 */
export async function sendPrivateOfferNotificationEmail(
  to: string,
  props: PrivateOfferNotificationSendProps,
): Promise<void> {
  const openUrl = `${SITE_URL}/sign-up/join/${encodeURIComponent(props.producerSlug)}/offer/${encodeURIComponent(props.offerId)}`;
  const html = await render(
    <PrivateOfferNotification
      recipientName={props.recipientName}
      producerName={props.producerName}
      openUrl={openUrl}
      kind={props.kind}
    />,
  );
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject:
      props.kind === "updated"
        ? "Your private offer was updated"
        : `${props.producerName} sent you a private offer`,
    html,
  });

  if (result.error) {
    throw new Error("Email delivery failed");
  }
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
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `${props.producerName} approved your request`,
    html,
  });
  assertResendAccepted(result);
}

export async function sendProofVerifiedEmail(
  to: string,
  props: ProofVerifiedToArtistProps,
): Promise<void> {
  const html = await render(<ProofVerifiedToArtist {...props} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: props.paidInFull
      ? `Paid in full — ${props.productName}`
      : `Payment confirmed — ${props.productName}`,
    html,
  });
  assertResendAccepted(result);
}

export async function sendProofRejectedEmail(
  to: string,
  props: ProofRejectedToArtistProps,
): Promise<void> {
  const html = await render(<ProofRejectedToArtist {...props} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Action needed on your payment — ${props.productName}`,
    html,
  });
  assertResendAccepted(result);
}

export async function sendPaymentReminderEmail(
  to: string,
  props: PaymentReminderToArtistProps,
  idempotencyKey: string,
): Promise<string> {
  const html = await render(<PaymentReminderToArtist {...props} />);
  const result = await getResend().emails.send(
    {
      from: FROM_ADDRESS,
      to,
      subject: `Payment reminder · ${props.purchaseName}`,
      html,
    },
    { idempotencyKey },
  );

  if (result.error) {
    throw new Error("Email delivery failed");
  }

  const responseData: unknown = result.data;
  if (
    responseData === null ||
    typeof responseData !== "object" ||
    !("id" in responseData) ||
    typeof responseData.id !== "string" ||
    responseData.id.length === 0
  ) {
    throw new Error("Email delivery failed");
  }

  return responseData.id;
}

export type SendSessionCalendarEmailInput = Readonly<{
  to: string;
  method: "REQUEST" | "CANCEL";
  summary: string;
  organizerName: string;
  icsContent: string;
  idempotencyKey: string;
}>;

function calendarEmailSubjectText(value: string): string {
  return (
    value
      .replace(/[\r\n]+/gu, " ")
      .trim()
      .slice(0, 160) || "Session"
  );
}

export async function sendSessionCalendarEmail(
  input: SendSessionCalendarEmailInput,
): Promise<string> {
  const summary = calendarEmailSubjectText(input.summary);
  const organizerName = calendarEmailSubjectText(input.organizerName);
  const isCancellation = input.method === "CANCEL";
  const result = await getResend().emails.send(
    {
      from: FROM_ADDRESS,
      to: input.to,
      subject: `${isCancellation ? "Calendar cancellation" : "Calendar invitation"} · ${summary}`,
      text: isCancellation
        ? `${organizerName} cancelled ${summary}. The calendar cancellation is attached.`
        : `${organizerName} confirmed ${summary}. The calendar invitation is attached.`,
      attachments: [
        {
          filename: "session.ics",
          content: input.icsContent,
          contentType: `text/calendar; charset=utf-8; method=${input.method}`,
        },
      ],
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (result.error) throw new Error("Email delivery failed");
  const responseData: unknown = result.data;
  if (
    responseData === null ||
    typeof responseData !== "object" ||
    !("id" in responseData) ||
    typeof responseData.id !== "string" ||
    responseData.id.length === 0
  ) {
    throw new Error("Email delivery failed");
  }
  return responseData.id;
}

export async function sendPurchaseDeclinedEmail(
  to: string,
  props: PurchaseDeclinedToArtistProps,
): Promise<void> {
  const html = await render(<PurchaseDeclinedToArtist {...props} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Update on your request to ${props.producerName}`,
    html,
  });
  assertResendAccepted(result);
}

// SK-273 — one-shot beta nudges, fired only by the beta-nudges cron. The
// cron stamps `*SentAt` right after each successful send, so a thrown send
// here surfaces as a cron warning and retries on the next daily run.
export async function sendBetaSignupReminderEmail(
  to: string,
  props: BetaSignupReminderProps,
): Promise<void> {
  const html = await render(<BetaSignupReminder {...props} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "Your Skitza beta invite is waiting",
    html,
  });
  assertResendAccepted(result);
}

export async function sendBetaActivationHelpEmail(
  to: string,
  props: Omit<BetaActivationHelpProps, "dashboardUrl"> & { dashboardUrl?: string },
): Promise<void> {
  const dashboardUrl = props.dashboardUrl ?? `${SITE_URL}/dashboard`;
  const html = await render(<BetaActivationHelp {...props} dashboardUrl={dashboardUrl} />);
  const result = await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "Need a hand getting set up on Skitza?",
    html,
  });
  assertResendAccepted(result);
}

// Re-export SITE_URL for callers who build deep-link URLs themselves.
export { SITE_URL };
