import { render } from "@react-email/components";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock("../../client", () => ({
  FROM_ADDRESS: "Skitza <test@skitza.test>",
  SITE_URL: "https://skitza.test",
  getResend: () => ({ emails: { send: sendEmail } }),
}));

import { sendPaymentReminderEmail } from "../../send";
import {
  PaymentReminderToArtist,
  type PaymentReminderToArtistProps,
} from "../payment-reminder-to-artist";

const reminderProps: PaymentReminderToArtistProps = {
  artistName: "Ada",
  producerName: "Gili",
  purchaseName: "Neon Signs Mix",
  refNumber: "SK-97-0042",
  currency: "USD",
  amountCents: 12_550,
  dueAt: new Date("2026-08-01T00:30:00.000Z"),
  producerTimezone: "America/Los_Angeles",
  paymentUrl: "https://skitza.test/artist/payments/purchase-42",
};

describe("PaymentReminderToArtist", () => {
  it("renders the accepted purchase, amount, payment URL, and due date in producer time", async () => {
    const html = await render(<PaymentReminderToArtist {...reminderProps} />);

    expect(html).toContain("Neon Signs Mix");
    expect(html).toContain("SK-97-0042");
    expect(html).toContain("$125.50");
    expect(html).toContain("Friday, July 31, 2026");
    expect(html).toContain("America/Los_Angeles");
    expect(html).toContain("https://skitza.test/artist/payments/purchase-42");
    expect(html).toContain("View payment details");
    expect(html).not.toContain("Join on Skitza");
    expect(html).not.toContain("Saturday, August 1, 2026");
  });

  it("asks a client without a Skitza account to join through the producer's link", async () => {
    const html = await render(
      <PaymentReminderToArtist
        {...reminderProps}
        paymentUrl="https://skitza.test/join/gili-asraf"
        joinRequired
      />,
    );

    expect(html).toContain("https://skitza.test/join/gili-asraf");
    expect(html).not.toContain("/artist/payments/");
    expect(html).toContain("Join on Skitza");
    expect(html).toContain("with this email address");
    expect(html).not.toContain("View payment details");
  });
});

describe("sendPaymentReminderEmail", () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue({
      data: { id: "email_payment_42" },
      error: null,
    });
  });

  it("uses Resend's idempotency option and returns the provider message id", async () => {
    await expect(
      sendPaymentReminderEmail(
        "ada@example.com",
        reminderProps,
        "payment-reminder:installment-42:due",
      ),
    ).resolves.toBe("email_payment_42");

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Skitza <test@skitza.test>",
        to: "ada@example.com",
        subject: "Payment reminder · Neon Signs Mix",
      }),
      { idempotencyKey: "payment-reminder:installment-42:due" },
    );
    const payload: unknown = sendEmail.mock.calls[0]?.[0];
    if (
      payload === null ||
      typeof payload !== "object" ||
      !("html" in payload) ||
      typeof payload.html !== "string"
    ) {
      throw new Error("Expected the rendered email payload");
    }
    expect(payload.html).toContain("SK-97-0042");
  });

  it("rejects a provider error even when the response includes an id", async () => {
    sendEmail.mockResolvedValueOnce({
      data: { id: "email_should_not_be_logged" },
      error: { message: "provider rejection", name: "validation_error" },
    });

    await expect(
      sendPaymentReminderEmail(
        "ada@example.com",
        reminderProps,
        "payment-reminder:installment-42:error",
      ),
    ).rejects.toEqual(new Error("Email delivery failed"));
  });

  it("rejects a provider response without a message id", async () => {
    sendEmail.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      sendPaymentReminderEmail(
        "ada@example.com",
        reminderProps,
        "payment-reminder:installment-42:missing-id",
      ),
    ).rejects.toEqual(new Error("Email delivery failed"));
  });
});
