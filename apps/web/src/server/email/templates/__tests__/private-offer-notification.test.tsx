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

import { sendClientInviteEmail, sendPrivateOfferNotificationEmail } from "../../send";
import { ClientInvite } from "../client-invite";
import { PrivateOfferNotification } from "../private-offer-notification";

describe("private offer notification email", () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue({ data: { id: "email_1" }, error: null });
  });

  it("contains only a private sign-in prompt and the producer join route", async () => {
    const html = await render(
      <PrivateOfferNotification
        recipientName="Ada"
        producerName="Gili"
        openUrl="https://skitza.test/sign-up/join/gili-asraf"
      />,
    );

    expect(html).toContain("Ada");
    expect(html).toContain("Gili");
    expect(html).toContain("private offer");
    expect(html).toContain("same email address");
    expect(html).toContain("https://skitza.test/sign-up/join/gili-asraf");
    expect(html).not.toContain("/artist/offers/");
    expect(html).not.toMatch(/Price|Royalty|Deliverables|Agreement/);
    expect(html).toContain("color:#1A1407");
  });

  it("derives a token-free join URL from the producer slug when sending", async () => {
    await sendPrivateOfferNotificationEmail("ada@example.com", {
      recipientName: "Ada",
      producerName: "Gili",
      producerSlug: "gili-asraf",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0]?.[0] as
      | { from?: string; to?: string; subject?: string; html?: string }
      | undefined;

    expect(message).toMatchObject({
      from: "Skitza <test@skitza.test>",
      to: "ada@example.com",
      subject: "Gili sent you a private offer",
    });
    expect(message?.html).toContain("https://skitza.test/sign-up/join/gili-asraf");
    expect(message?.html).not.toContain("/artist/offers/");
  });

  it("throws a generic error when Resend rejects the private-offer delivery", async () => {
    sendEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "provider-only rejection detail", name: "validation_error" },
    });

    await expect(
      sendPrivateOfferNotificationEmail("ada@example.com", {
        recipientName: "Ada",
        producerName: "Gili",
        producerSlug: "gili-asraf",
      }),
    ).rejects.toEqual(new Error("Email delivery failed"));
  });
});

describe("client invite email delivery", () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue({ data: { id: "email_1" }, error: null });
  });

  it("sends the normal client invite with an accessible CTA", async () => {
    const html = await render(
      <ClientInvite
        clientName="Ada"
        producerName="Gili"
        inviteUrl="https://skitza.test/sign-up/join/gili-asraf"
      />,
    );

    expect(html).toContain("color:#1A1407");

    await expect(
      sendClientInviteEmail("ada@example.com", {
        clientName: "Ada",
        producerName: "Gili",
        inviteUrl: "https://skitza.test/sign-up/join/gili-asraf",
      }),
    ).resolves.toBeUndefined();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      from: "Skitza <test@skitza.test>",
      to: "ada@example.com",
      subject: "Gili invited you to Skitza",
    });
  });

  it("throws a generic error when Resend rejects the client-invite delivery", async () => {
    sendEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "provider-only rejection detail", name: "validation_error" },
    });

    await expect(
      sendClientInviteEmail("ada@example.com", {
        clientName: "Ada",
        producerName: "Gili",
        inviteUrl: "https://skitza.test/sign-up/join/gili-asraf",
      }),
    ).rejects.toEqual(new Error("Email delivery failed"));
  });
});
