import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Settings redesign (2026-05-14) — pins the page structure so future
// edits can't silently regress the design's scope discipline.
//
// What the new page is allowed to mount (live render targets):
//   - <SettingsClient>            (the client shell with 5 sections)
//   - <PaymentCard> + <StripeCard> (passed THROUGH SettingsClient into
//                                   IntegrationsSection — but the page
//                                   itself doesn't import them anymore;
//                                   the client component does. These
//                                   assertions live in the client file
//                                   instead.)
//
// What the new page MUST NOT mount (intentionally cut per the design
// spec — they belong on /dashboard/public-page when that surface lands,
// or were dropped entirely):
//   - <AutopilotSection>
//   - <ServicesSection>
//   - <AvailabilitySection>
//   - <PortfolioSection>
//   - <MarketingSection>
//   - <SettingsBranches>          (the 2-branch chip bar; replaced by
//                                   the 5-section sub-nav inside the
//                                   client component)
//   - <SettingsForm>              (the old long-scroll form)
//
// Legacy URL redirects that still need to fire (pinned strings so a
// refactor can't silently send the user to the wrong home):
//   - ?section=services      → /dashboard/profile?tab=store
//   - ?section=availability  → /dashboard/calendar?tab=availability

const here = dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = join(here, "..");
const pageSource = readFileSync(join(SETTINGS_DIR, "page.tsx"), "utf8");
const clientSource = readFileSync(
  join(SETTINGS_DIR, "settings-client.tsx"),
  "utf8",
);

describe("Settings page — redesign render shape", () => {
  it("mounts <SettingsClient> as the single render target", () => {
    // The whole page is a thin server wrapper around the client
    // component. If this assertion ever fails, the server page has
    // probably grown its own ad-hoc render code — which usually means
    // the design discipline has slipped.
    expect(pageSource).toMatch(/<SettingsClient\b/);
  });

  it("does NOT mount any of the removed sections", () => {
    // PortfolioSection, MarketingSection, AutopilotSection still exist
    // as files (PortfolioSection is reused by /dashboard/portfolio).
    // The discipline is that they don't render on the Settings page.
    const forbidden = [
      /<AutopilotSection[\s/>]/,
      /<ServicesSection[\s/>]/,
      /<AvailabilitySection[\s/>]/,
      /<PortfolioSection[\s/>]/,
      /<MarketingSection[\s/>]/,
      /<SettingsBranches[\s/>]/,
      /<SettingsForm[\s/>]/,
    ];
    for (const pattern of forbidden) {
      expect(pageSource).not.toMatch(pattern);
    }
  });
});

describe("Settings page — legacy redirects", () => {
  it("redirects ?section=services to the Storefront's Store tab", () => {
    expect(pageSource).toMatch(
      /\/dashboard\/profile\?tab=store/,
    );
  });

  it("redirects ?section=availability to the Calendar's Availability tab", () => {
    expect(pageSource).toMatch(
      /\/dashboard\/calendar\?tab=availability/,
    );
  });
});

describe("Settings client — integrations cards", () => {
  it("mounts <PaymentCard> inside the Integrations section", () => {
    // Tranzila terminal request form lives in payment-card.tsx. The
    // client component embeds it under the consolidated "Payments" row.
    expect(clientSource).toMatch(/<PaymentCard\b/);
  });

  it("mounts <StripeCard> inside the Integrations section", () => {
    // Stripe Connect onboarding lives in stripe-card.tsx. Same parent
    // — the IntegrationsSection — so both regional payment paths are
    // reachable from one place.
    expect(clientSource).toMatch(/<StripeCard\b/);
  });
});

describe("Settings client — section list", () => {
  it("does NOT render a Studio section (intentionally deferred)", () => {
    // The reference HTML had a Studio section (business name + city +
    // country + tax id). Skitza's producer table has none of those
    // columns yet, so the section is held back until a future task
    // adds the schema. If a Studio section sneaks in without a brief,
    // this test fires.
    expect(clientSource).not.toMatch(/<StudioSection\b/);
    expect(clientSource).not.toMatch(/Studio name/);
    expect(clientSource).not.toMatch(/Tax ID/);
  });
});
