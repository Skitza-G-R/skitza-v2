import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const onboardingDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (step: string, file: string) =>
  readFileSync(join(onboardingDir, step, file), "utf8");

const availability = source("availability", "availability-step-client.tsx");
const studio = source("studio", "studio-step-client.tsx");
const portfolio = source("portfolio", "portfolio-step-client.tsx");
const payment = source("payment", "payment-step-client.tsx");
const review = source("review", "review-step-client.tsx");
const legacyServices = source("services", "page.tsx");

describe("onboarding live-action boundaries", () => {
  it("uses the shared online boundary in every producer write step", () => {
    for (const step of [availability, studio, portfolio, payment, review]) {
      expect(step).toContain("useOnlineStatus");
      expect(step).toMatch(/if \(!online\) \{[\s\S]*?Reconnect to/);
    }
  });

  it("saves hours only on Continue and leaves Skip write-free", () => {
    expect(availability).toMatch(
      /const saveAndContinue = \(\) => \{[\s\S]*if \(!online\)[\s\S]*await setAvailabilityWeek/,
    );
    expect(availability).toContain(": routeOnSkipFromAvailability()");
  });

  it("keeps studio input recoverable when its action rejects", () => {
    expect(studio).toMatch(
      /function handleContinue\(\) \{[\s\S]*if \(!online\)[\s\S]*try \{[\s\S]*await completeStudio[\s\S]*catch \(\w+\) \{[\s\S]*setError/,
    );
  });

  it("publishes only from the final review through the owned action", () => {
    expect(review).toMatch(
      /if \(!online\)[\s\S]*await setPackageActive\(\{[\s\S]*active: true,[\s\S]*requireAvailability: true/,
    );
  });

  it("keeps legacy services as a compatibility redirect", () => {
    expect(legacyServices).toContain("/onboarding/service");
    expect(legacyServices).not.toContain("saveServiceRoles");
  });
});
