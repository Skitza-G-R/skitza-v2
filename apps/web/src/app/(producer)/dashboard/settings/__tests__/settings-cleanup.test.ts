import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Settings page — Integrations branch must NOT host Services or
// Availability anymore. Both moved to their canonical homes:
//   - Services → Storefront (`/dashboard/profile?tab=store`)
//   - Availability → Calendar (`/dashboard/calendar?tab=availability`)
//
// What stays under Integrations: Stripe (Payments) + Autopilot
// (automation rules). The legacy `?section=services` /
// `?section=availability` URL params now redirect to the new homes
// so existing bookmarks resolve cleanly instead of landing on a
// section that no longer exists.

const here = dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = join(here, "..");
const pageSource = readFileSync(join(SETTINGS_DIR, "page.tsx"), "utf8");

describe("Settings page — Integrations branch slimmed", () => {
  it("does NOT mount <ServicesSection> anywhere in the page", () => {
    // Catch both `<ServicesSection ` (props) and `<ServicesSection/>`
    // (no props). A pure occurrence-count assertion ('not contain
    // ServicesSection') would fire on JSDoc / comments referencing
    // the moved component too — we want to allow comments while
    // forbidding the live JSX usage.
    expect(pageSource).not.toMatch(/<ServicesSection[\s/>]/);
  });

  it("does NOT mount <AvailabilitySection> anywhere in the page", () => {
    expect(pageSource).not.toMatch(/<AvailabilitySection[\s/>]/);
  });

  it("still mounts <StripeCard> in the Integrations branch", () => {
    // Negative-only assertions risk masking a complete deletion —
    // pin the surviving content so the page can't accidentally turn
    // into an empty branch.
    expect(pageSource).toMatch(/<StripeCard\b/);
  });

  it("still mounts <AutopilotSection> in the Integrations branch", () => {
    expect(pageSource).toMatch(/<AutopilotSection\b/);
  });
});

describe("Settings page — legacy ?section= redirects to new homes", () => {
  it("redirects ?section=services to the Storefront's Store tab", () => {
    // The hard-coded redirect target must point to the new home,
    // not the Settings/Integrations branch (which no longer hosts
    // Services). Pinning the target string prevents a future
    // refactor from silently sending the user back to Settings.
    expect(pageSource).toMatch(
      /redirect\(\s*[`"']\/dashboard\/profile\?tab=store[`"']\s*\)/,
    );
  });

  it("redirects ?section=availability to the Calendar's Availability tab", () => {
    expect(pageSource).toMatch(
      /redirect\(\s*[`"']\/dashboard\/calendar\?tab=availability[`"']\s*\)/,
    );
  });
});
