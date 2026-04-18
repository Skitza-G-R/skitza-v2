import { render } from "@react-email/components";

import { FROM_ADDRESS, getResend, SITE_URL } from "./client";
import {
  BookingConfirmedToArtist,
  type BookingConfirmedToArtistProps,
} from "./templates/booking-confirmed-to-artist";
import {
  BookingRequestReceived,
  type BookingRequestReceivedProps,
} from "./templates/booking-request-received";
import {
  SessionReminder1h,
  type SessionReminder1hProps,
} from "./templates/session-reminder-1h";
import {
  SessionReminder24h,
  type SessionReminder24hProps,
} from "./templates/session-reminder-24h";

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
  const reviewUrl =
    props.reviewUrl ?? `${SITE_URL}/dashboard/booking?tab=requests`;
  const html = await render(
    <BookingRequestReceived {...props} reviewUrl={reviewUrl} />,
  );
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
