import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmailDeliveryError } from "../delivery-error";

// SK-287 — the Resend SDK does NOT reject when the API refuses a send; it
// resolves with `{ data: null, error }`. Every sender that dropped that return
// value reported success for mail that was never created, which in turn killed
// the cron sweeps' unclaim-and-retry safety net. These tests pin the contract:
// a refused send throws, an accepted send does not.
const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("../client", () => ({
  getResend: () => ({ emails: { send: mocks.send } }),
  FROM_ADDRESS: "Skitza <hello@send.skitza.test>",
  SITE_URL: "https://skitza.test",
}));

import {
  sendBetaActivationHelpEmail,
  sendBetaSignupReminderEmail,
  sendBookingCancelledOrRescheduledEmail,
  sendBookingConfirmedEmail,
  sendBookingRequestEmail,
  sendNewCommentFromArtistEmail,
  sendProducerRepliedToCommentEmail,
  sendProofRejectedEmail,
  sendProofVerifiedEmail,
  sendPurchaseApprovedEmail,
  sendPurchaseDeclinedEmail,
  sendSessionReminder24h,
  sendTrackVersionUploadedEmail,
} from "../send";

const TO = "artist@example.test";
const STARTS_AT = new Date("2026-09-01T18:00:00Z");

// Shape copied from the provider: a well-formed key that the API rejects
// resolves exactly like this, with no thrown error anywhere.
const REFUSED = {
  data: null,
  error: { name: "validation_error", message: "API key is invalid", statusCode: 401 },
  headers: null,
};
const ACCEPTED = { data: { id: "re_123" }, error: null, headers: null };

const SENDERS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  [
    "sendBookingRequestEmail",
    () =>
      sendBookingRequestEmail(TO, {
        producerName: "Gili Asraf",
        artistName: "Ada",
        productName: "Mixing session",
        startsAt: STARTS_AT,
        producerTimezone: "UTC",
        currency: "ILS",
        priceCents: 40000,
        depositCents: 10000,
      }),
  ],
  [
    "sendBookingConfirmedEmail",
    () =>
      sendBookingConfirmedEmail(TO, {
        artistName: "Ada",
        producerName: "Gili Asraf",
        productName: "Mixing session",
        startsAt: STARTS_AT,
        producerTimezone: "UTC",
      }),
  ],
  [
    "sendSessionReminder24h",
    () =>
      sendSessionReminder24h(TO, {
        recipientName: "Ada",
        recipientRole: "artist",
        counterpartName: "Gili Asraf",
        productName: "Mixing session",
        startsAt: STARTS_AT,
        producerTimezone: "UTC",
      }),
  ],
  [
    "sendTrackVersionUploadedEmail",
    () =>
      sendTrackVersionUploadedEmail(TO, {
        artistName: "Ada",
        producerName: "Gili Asraf",
        projectName: "Summer EP",
        versionLabel: "Mix v2",
        reviewUrl: "https://skitza.test/artist/music/p1",
      }),
  ],
  [
    "sendProducerRepliedToCommentEmail",
    () =>
      sendProducerRepliedToCommentEmail(TO, {
        artistName: "Ada",
        producerName: "Gili Asraf",
        trackTitle: "Track 03",
        replyBody: "Boosted the vocals at 0:34.",
        threadUrl: "https://skitza.test/artist/music/p1#c42",
      }),
  ],
  [
    "sendNewCommentFromArtistEmail",
    () =>
      sendNewCommentFromArtistEmail(TO, {
        producerName: "Gili Asraf",
        artistName: "Ada",
        trackTitle: "Track 03",
        commentBody: "The bridge hits.",
        threadUrl: "https://skitza.test/dashboard/clients-projects/p1#c42",
      }),
  ],
  [
    "sendBookingCancelledOrRescheduledEmail",
    () =>
      sendBookingCancelledOrRescheduledEmail(TO, {
        recipientName: "Ada",
        counterpartName: "Gili Asraf",
        productName: "Mixing session",
        status: "cancelled",
        oldStartsAt: STARTS_AT,
        newStartsAt: null,
        producerTimezone: "UTC",
        reason: "Studio equipment failure.",
      }),
  ],
  [
    "sendPurchaseApprovedEmail",
    () =>
      sendPurchaseApprovedEmail(TO, {
        artistName: "Ada",
        producerName: "Gili Asraf",
        productName: "Mixing session",
        refNumber: "SK-1001",
        currency: "ILS",
        subtotalCents: 40000,
        taxMode: "tax_free",
        taxRatePct: 0,
        taxCents: 0,
        totalCents: 40000,
      }),
  ],
  [
    "sendProofVerifiedEmail",
    () =>
      sendProofVerifiedEmail(TO, {
        artistName: "Ada",
        producerName: "Gili Asraf",
        productName: "Mixing session",
        refNumber: "SK-1001",
        currency: "ILS",
        amountCents: 20000,
        paidCents: 20000,
        totalCents: 40000,
        paidInFull: false,
      }),
  ],
  [
    "sendProofRejectedEmail",
    () =>
      sendProofRejectedEmail(TO, {
        artistName: "Ada",
        producerName: "Gili Asraf",
        productName: "Mixing session",
        refNumber: "SK-1001",
        note: "The screenshot was unreadable.",
      }),
  ],
  [
    "sendPurchaseDeclinedEmail",
    () =>
      sendPurchaseDeclinedEmail(TO, {
        artistName: "Ada",
        producerName: "Gili Asraf",
        productName: "Mixing session",
        refNumber: "SK-1001",
      }),
  ],
  ["sendBetaSignupReminderEmail", () => sendBetaSignupReminderEmail(TO, { name: "Ada" })],
  ["sendBetaActivationHelpEmail", () => sendBetaActivationHelpEmail(TO, { name: "Ada" })],
];

describe("transactional senders surface a refused send", () => {
  beforeEach(() => {
    mocks.send.mockReset();
  });

  it.each(SENDERS)("%s throws when the provider refuses the send", async (_name, invoke) => {
    mocks.send.mockResolvedValue(REFUSED);
    await expect(invoke()).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it.each(SENDERS)("%s resolves when the provider accepts the send", async (_name, invoke) => {
    mocks.send.mockResolvedValue(ACCEPTED);
    await expect(invoke()).resolves.not.toThrow();
  });

  it("carries the provider name, message and status code onto the error", async () => {
    mocks.send.mockResolvedValue(REFUSED);

    let caught: unknown;
    try {
      await sendSessionReminder24h(TO, {
        recipientName: "Ada",
        recipientRole: "artist",
        counterpartName: "Gili Asraf",
        productName: "Mixing session",
        startsAt: STARTS_AT,
        producerTimezone: "UTC",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EmailDeliveryError);
    expect((caught as EmailDeliveryError).provider).toEqual({
      name: "validation_error",
      message: "API key is invalid",
      statusCode: 401,
    });
  });
});
