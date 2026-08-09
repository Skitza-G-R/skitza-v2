import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock("./client", () => ({
  FROM_ADDRESS: "Skitza <test@skitza.test>",
  SITE_URL: "https://skitza.test",
  getResend: () => ({ emails: { send: sendEmail } }),
}));

import { sendSessionCalendarEmail } from "./send";

describe("sendSessionCalendarEmail", () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue({ data: { id: "email_calendar_42" }, error: null });
  });

  it("sends an RFC5545 attachment with the stable provider idempotency key", async () => {
    await expect(
      sendSessionCalendarEmail({
        to: "ari@example.com",
        method: "REQUEST",
        summary: "Mix review",
        organizerName: "Gili",
        icsContent: "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n",
        idempotencyKey: "calendar:skitza-use-42:3",
      }),
    ).resolves.toBe("email_calendar_42");

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      {
        from: "Skitza <test@skitza.test>",
        to: "ari@example.com",
        subject: "Calendar invitation · Mix review",
        text: "Gili confirmed Mix review. The calendar invitation is attached.",
        attachments: [
          {
            filename: "session.ics",
            content: "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n",
            contentType: "text/calendar; charset=utf-8; method=REQUEST",
          },
        ],
      },
      { idempotencyKey: "calendar:skitza-use-42:3" },
    );
  });

  it("uses cancellation copy and strips subject header injection", async () => {
    await sendSessionCalendarEmail({
      to: "ari@example.com",
      method: "CANCEL",
      summary: "Mix review\r\nBCC:evil@example.com",
      organizerName: "Gili\nProducer",
      icsContent: "cancel",
      idempotencyKey: "calendar:skitza-use-42:4",
    });

    expect(sendEmail).toHaveBeenCalledWith(
      {
        from: "Skitza <test@skitza.test>",
        to: "ari@example.com",
        subject: "Calendar cancellation · Mix review BCC:evil@example.com",
        text: "Gili Producer cancelled Mix review BCC:evil@example.com. The calendar cancellation is attached.",
        attachments: [
          {
            filename: "session.ics",
            content: "cancel",
            contentType: "text/calendar; charset=utf-8; method=CANCEL",
          },
        ],
      },
      { idempotencyKey: "calendar:skitza-use-42:4" },
    );
  });

  it("rejects provider errors and malformed success responses", async () => {
    sendEmail.mockResolvedValueOnce({
      data: { id: "must-not-complete" },
      error: { name: "validation_error", message: "invalid" },
    });
    await expect(
      sendSessionCalendarEmail({
        to: "ari@example.com",
        method: "REQUEST",
        summary: "Mix review",
        organizerName: "Gili",
        icsContent: "request",
        idempotencyKey: "calendar:error",
      }),
    ).rejects.toEqual(new Error("Email delivery failed"));

    sendEmail.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      sendSessionCalendarEmail({
        to: "ari@example.com",
        method: "REQUEST",
        summary: "Mix review",
        organizerName: "Gili",
        icsContent: "request",
        idempotencyKey: "calendar:missing-id",
      }),
    ).rejects.toEqual(new Error("Email delivery failed"));
  });
});
