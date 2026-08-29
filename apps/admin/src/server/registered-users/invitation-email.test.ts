import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminInvitationEmailConfigurationError,
  createResendInvitationEmailSender,
  InvitationEmailError,
  renderProducerInvitationEmail,
  resolveAdminInvitationEmailConfig,
} from "./invitation-email";

const ACCEPT_URL = "https://clerk.skitza.app/v1/tickets/accept?ticket=jwt-token";

const environment = {
  ADMIN_LIVE_INVITE_FROM: "Gili from Skitza <gili@skitza.app>",
  ADMIN_LIVE_INVITE_REPLY_TO: "gili@skitza.app",
  ADMIN_LIVE_RESEND_API_KEY: "re_live_abcdefgh",
} as const;

describe("invitation email configuration", () => {
  it("resolves the live binding and signs off with the sender's first name", () => {
    expect(resolveAdminInvitationEmailConfig(environment)).toEqual({
      apiKey: "re_live_abcdefgh",
      from: "Gili from Skitza <gili@skitza.app>",
      replyTo: "gili@skitza.app",
      signature: "Gili",
    });
  });

  it("ignores leftover Test bindings instead of demanding them", () => {
    // SK-288 removed the Live/Test split. A stale ADMIN_TEST_* value left in
    // the deployment must never be required, and must never be sent from.
    expect(
      resolveAdminInvitationEmailConfig({
        ...environment,
        ADMIN_TEST_INVITE_FROM: "Someone Else <nobody@example.test>",
        ADMIN_TEST_RESEND_API_KEY: "re_test_abcdefgh",
      }).apiKey,
    ).toBe("re_live_abcdefgh");
  });

  it.each([
    ["ADMIN_LIVE_RESEND_API_KEY", ""],
    ["ADMIN_LIVE_RESEND_API_KEY", "sk_live_not_a_resend_key"],
    ["ADMIN_LIVE_INVITE_REPLY_TO", "not-an-email"],
    // A bare address reads as machine mail — the display name is required.
    ["ADMIN_LIVE_INVITE_FROM", "gili@skitza.app"],
    ["ADMIN_LIVE_INVITE_FROM", "<gili@skitza.app>"],
  ])("rejects an invalid %s: %s", (name, value) => {
    expect(() =>
      resolveAdminInvitationEmailConfig({ ...environment, [name]: value }),
    ).toThrow(AdminInvitationEmailConfigurationError);
  });

});

describe("invitation email body", () => {
  const message = renderProducerInvitationEmail({
    acceptUrl: ACCEPT_URL,
    signature: "Gili",
  });

  it("carries the accept link exactly once in each part", () => {
    expect(message.text.split(ACCEPT_URL)).toHaveLength(2);
    expect(message.html.split(ACCEPT_URL)).toHaveLength(2);
  });

  it("sends a plain-text alternative alongside the HTML", () => {
    expect(message.text).toContain("Gili");
    expect(message.text).not.toContain("<");
    expect(message.subject).toBe("Your Skitza account is ready");
  });

  // Each of these is a signal Gmail's tab classifier reads as bulk
  // marketing. They are what put Clerk's own invitation in Promotions.
  // `<img` and `<table` are deliberately absent — the branded layout needs
  // both, and Outlook has no flexbox. The rest still hold.
  it.each(["unsubscribe", "background:", "linear-gradient", "©"])(
    "keeps the promotional marker %s out of the HTML",
    (marker) => {
      expect(message.html.toLowerCase()).not.toContain(marker.toLowerCase());
    },
  );

  // The single allowed image. Small, sized so it cannot reflow, and given
  // alt text so a client that blocks images shows the brand name rather
  // than a broken box. More than one image would be a masthead.
  it("carries exactly one logo image, sized and with alt text", () => {
    expect(message.html.split("<img")).toHaveLength(2);
    expect(message.html).toContain('src="cid:skitzalockup"');
    expect(message.html).toContain('alt="Skitza"');
    expect(message.html).toContain('width="172" height="53"');
  });

  it("is a complete document rather than a fragment clients have to wrap", () => {
    expect(message.html.startsWith("<!doctype html>")).toBe(true);
    expect(message.html.trimEnd().endsWith("</html>")).toBe(true);
  });

  // The lockup PNG carries #0e0d08 baked in. Any other band colour draws a
  // visible rectangle around the image.
  it("matches the header band to the lockup's own background", () => {
    expect(message.html).toContain("background-color:#0e0d08");
  });

  it("re-introduces Skitza in both parts, for invitees who signed up months ago", () => {
    for (const part of [message.html, message.text]) {
      expect(part).toContain("You signed up for early access");
      for (const lead of ["One link for your client.", "Everything in one place.", "No chasing."]) {
        expect(part).toContain(lead);
      }
    }
  });

  // The lockup alone left most of the band as dead space.
  it("carries the product tagline in the lockup band", () => {
    expect(message.html).toContain("One app. Your whole studio.");
  });

  // `width:520px` + `max-width:100%` leaves the table hanging off the right
  // edge of a 390px phone. The reverse is what actually reflows, and the mso
  // ghost table pins the width for Outlook, which ignores max-width.
  it("sizes the container so a 390px phone does not overflow", () => {
    expect(message.html).toContain("width:100%;max-width:520px");
    expect(message.html).not.toContain("width:520px;max-width:100%");
    expect(message.html).toContain("<!--[if mso]>");
  });

  it("escapes the accept link into the href", () => {
    const escaped = renderProducerInvitationEmail({
      acceptUrl: "https://clerk.skitza.app/a?t=1&b=2",
      signature: "Gili",
    });
    expect(escaped.html).toContain('href="https://clerk.skitza.app/a?t=1&amp;b=2"');
  });
});

describe("resend invitation sender", () => {
  const fetchMock = vi.fn();
  const sender = createResendInvitationEmailSender({
    apiKey: "re_live_abcdefgh",
    from: "Gili from Skitza <gili@skitza.app>",
    replyTo: "gili@skitza.app",
    signature: "Gili",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the invitation to Resend with a working reply path", async () => {
    await sender.send({ acceptUrl: ACCEPT_URL, to: "producer@example.com" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_live_abcdefgh");

    const payload = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(payload.from).toBe("Gili from Skitza <gili@skitza.app>");
    expect(payload.reply_to).toBe("gili@skitza.app");
    expect(payload.to).toEqual(["producer@example.com"]);
    expect(payload.text).toContain(ACCEPT_URL);
    // Marking transactional mail as bulk would file it under Promotions.
    expect(Object.keys(payload)).not.toContain("headers");
  });

  it("attaches the lockup inline so the cid: reference resolves", async () => {
    await sender.send({ acceptUrl: ACCEPT_URL, to: "producer@example.com" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as Record<string, unknown>;
    const attachments = payload.attachments as {
      content: string;
      content_id: string;
      filename: string;
    }[];
    const [logo] = attachments as [(typeof attachments)[number]];

    expect(attachments).toHaveLength(1);
    expect(logo.content_id).toBe("skitzalockup");
    expect(logo.filename).toBe("skitza.png");
    expect(logo.content.length).toBeGreaterThan(1000);
  });

  it.each([
    ["a rejected request", () => fetchMock.mockResolvedValueOnce({ ok: false } as Response)],
    ["a network failure", () => fetchMock.mockRejectedValueOnce(new Error("offline"))],
    [
      "an oversized accept link",
      () => {
        /* exercised through the argument below */
      },
    ],
  ])("surfaces %s as an InvitationEmailError", async (label, arrange) => {
    arrange();
    const acceptUrl =
      label === "an oversized accept link" ? `https://x/${"a".repeat(2100)}` : ACCEPT_URL;
    await expect(sender.send({ acceptUrl, to: "producer@example.com" })).rejects.toBeInstanceOf(
      InvitationEmailError,
    );
  });
});
