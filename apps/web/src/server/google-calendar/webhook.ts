import type {
  GoogleCalendarWebhookEnqueueResult,
  GoogleCalendarWebhookRepository,
} from "./webhook-repository";
import { parseGoogleCalendarWebhookHeaders } from "./watch";

export type GoogleCalendarWebhookResult =
  | GoogleCalendarWebhookEnqueueResult
  | Readonly<{ outcome: "invalid"; jobsEnqueued: 0; jobIds: readonly [] }>;

export async function acceptGoogleCalendarWebhook(
  input: Readonly<{
    headers: Headers;
    repository: GoogleCalendarWebhookRepository;
    receivedAt?: Date;
  }>,
): Promise<GoogleCalendarWebhookResult> {
  const notification = parseGoogleCalendarWebhookHeaders(input.headers);
  const receivedAt = input.receivedAt ?? new Date();
  if (!notification || Number.isNaN(receivedAt.getTime())) {
    return { outcome: "invalid", jobsEnqueued: 0, jobIds: [] };
  }
  return input.repository.enqueueVerifiedNotification({ ...notification, receivedAt });
}
