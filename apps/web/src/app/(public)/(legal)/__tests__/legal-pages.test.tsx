import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AboutPage from "../about/page";
import PrivacyPage from "../privacy/page";
import TermsPage from "../terms/page";

describe("public legal pages", () => {
  it("describes Google Calendar access, use, storage, sharing, and deletion", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain("Google Calendar data");
    expect(html).toContain("What we access");
    expect(html).toContain("What we store");
    expect(html).toContain("How Google data is used and shared");
    expect(html).toContain("Disconnecting or deleting Google data");
    expect(html).toContain("Busy and free time");
    expect(html).toContain("event permission covers the calendars you can access");
    expect(html).toContain("watch, and reconcile");
    expect(html).toContain("Producer and Artist names and email addresses");
    expect(html).toContain("other attendees already on that event");
    expect(html).toContain("does not save those other attendees in its database");
    expect(html).toContain("calendar invitations and updates");
    expect(html).toContain("encrypted access and refresh tokens");
    expect(html).toContain("do not read Google user data unless");
    expect(html).toContain("Limited Use requirements");
    expect(html).toContain(
      'href="https://developers.google.com/terms/api-services-user-data-policy"',
    );
    expect(html).toContain('href="mailto:privacy@skitza.app"');
  });

  it("names the real analytics and service-provider behavior", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    for (const provider of [
      "Clerk",
      "Neon",
      "Vercel",
      "Cloudflare R2",
      "Resend",
      "Namecheap",
      "Google",
      "PostHog",
      "Sentry",
    ]) {
      expect(html).toContain(provider);
    }
    expect(html).toContain("session replay is currently disabled");
    expect(html).not.toContain("Make — delivery");
    expect(html).toContain("We do not sell personal information");
  });

  it("removes stale privacy promises and removed magic-link behavior", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).not.toContain("/m/&lt;token&gt;");
    expect(html).not.toContain("No third-party analytics");
    expect(html).not.toContain("within 7 days");
    expect(html).not.toContain("Placeholder privacy policy");
  });

  it("publishes the confirmed operator, age, response, and retention details", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain("Gili Asraf");
    expect(html).toContain("315016071");
    expect(html).toContain("Ein Gedi 7, Hadera, Israel");
    expect(html).toContain("aged 18 or older");
    expect(html).toContain("initial response within 7 business days");
    expect(html).toContain("Google event or watch identifiers");
    expect(html).toContain("Gmail for receiving and storing forwarded legal and privacy requests");
    expect(html).toContain("pass through Namecheap email forwarding");
    expect(html).toContain("sender&#x27;s name and email address");
    expect(html).toContain("Legal, privacy, and support messages");
    expect(html).toContain("within 30 days");
    expect(html).toContain("up to 90 days");
    expect(html).toContain("up to 12 months");
    expect(html).toContain("up to 7 years");
  });

  it("states the current invitation, beta, and external-payment terms", () => {
    const html = renderToStaticMarkup(<TermsPage />);

    expect(html).toContain("Producer access is invitation-only");
    expect(html).toContain("Payments happen outside Skitza");
    expect(html).toContain("does not take, hold, route, split, refund, or process money");
    expect(html).toContain("free during the beta");
    expect(html).toContain("1 GB");
    expect(html).toContain("Google Calendar");
    expect(html).toContain('href="mailto:legal@skitza.app"');
  });

  it("does not publish placeholder terms or removed product claims", () => {
    const html = renderToStaticMarkup(<TermsPage />);

    expect(html).not.toContain("smart lead links");
    expect(html).not.toContain("magic links");
    expect(html).not.toContain("to be formalised");
    expect(html).not.toContain("replaced by formal terms");
    expect(html).not.toContain("Stripe handles");
  });

  it("publishes the confirmed contracting party, eligibility, and dispute rules", () => {
    const html = renderToStaticMarkup(<TermsPage />);

    expect(html).toContain("Gili Asraf");
    expect(html).toContain("315016071");
    expect(html).toContain("Ein Gedi 7, Hadera, Israel");
    expect(html).toContain("at least 18 years old");
    expect(html).toContain("offered only to users in Israel");
    expect(html).not.toContain("parent or guardian consent");
    expect(html).toContain("Israeli law governs these Terms");
    expect(html).toContain("mandatory consumer protection");
    expect(html).toContain("resolve the dispute in writing");
    expect(html).toContain("Tel Aviv–Jaffa");
    expect(html).toContain("do not require arbitration");
  });

  it("keeps the About page on the invitation-only Producer flow", () => {
    const html = renderToStaticMarkup(<AboutPage />);

    expect(html).toContain("Producer access is invitation-only");
    expect(html).toContain('href="/producer-access"');
    expect(html).not.toContain("/sign-up?redirect_url=%2Fonboarding");
    expect(html).not.toContain("Three minutes to your first booking link");
  });
});
