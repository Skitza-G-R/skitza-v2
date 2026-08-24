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

import { sendBetaActivationHelpEmail, sendBetaSignupReminderEmail } from "../../send";
import { BetaActivationHelp } from "../beta-activation-help";
import { BetaSignupReminder } from "../beta-signup-reminder";

describe("beta nudge emails", () => {
  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  it("signup reminder points back at the Clerk invitation email", async () => {
    const html = await render(<BetaSignupReminder name="Noa" />);

    expect(html).toMatch(/Hi (?:<!-- -->)?Noa/);
    expect(html).toContain("been invited");
    expect(html).toContain("expire");
    expect(html).toContain("one-time reminder");
  });

  it("greets politely when the invitee has no stored name", async () => {
    const html = await render(<BetaSignupReminder name={null} />);

    expect(html).toMatch(/Hi (?:<!-- -->)?there/);
  });

  it("activation help walks through the three setup steps into the dashboard", async () => {
    const html = await render(
      <BetaActivationHelp dashboardUrl="https://skitza.test/dashboard" name={null} />,
    );

    expect(html).toContain("Add your first artist");
    expect(html).toContain("Create their project");
    expect(html).toContain("Open your studio");
    expect(html).toContain("https://skitza.test/dashboard");
  });

  it("send helpers use the beta subjects and default the dashboard URL to SITE_URL", async () => {
    await sendBetaSignupReminderEmail("person@example.com", { name: null });
    await sendBetaActivationHelpEmail("person@example.com", { name: "Noa" });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      subject: "Your Skitza beta invite is waiting",
      to: "person@example.com",
    });
    const helpPayload = sendEmail.mock.calls[1]?.[0] as { html: string; subject: string };
    expect(helpPayload.subject).toBe("Need a hand getting set up on Skitza?");
    expect(helpPayload.html).toContain("https://skitza.test/dashboard");
  });
});
