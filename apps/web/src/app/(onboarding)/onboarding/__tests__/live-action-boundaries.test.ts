import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const onboardingDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (step: string, file: string) =>
  readFileSync(join(onboardingDir, step, file), "utf8");

const availability = source("availability", "availability-step-client.tsx");
const studio = source("studio", "page.tsx");
const service = source("service", "service-step-client.tsx");
const portfolio = source("portfolio", "portfolio-step-client.tsx");

describe("onboarding live-action boundaries", () => {
  it("uses the shared online boundary in every producer write step", () => {
    for (const step of [availability, studio, service, portfolio]) {
      expect(step).toContain("useOnlineStatus");
      expect(step).toMatch(/if \(!online\) \{[\s\S]*?Reconnect to/);
    }
  });

  it("keeps availability Continue and Skip behind one guarded save", () => {
    expect(availability).toMatch(
      /const advance = \(target: string\) => \{[\s\S]*if \(!online\)[\s\S]*try \{[\s\S]*await setAvailabilityWeek[\s\S]*catch \{/,
    );
    expect(availability).toContain("advance(routeOnSkipFromAvailability())");
    expect(availability).toContain("advance(nextRouteAfterAvailability())");
  });

  it("keeps studio input recoverable when its action rejects", () => {
    expect(studio).toMatch(
      /function handleContinue\(\) \{[\s\S]*if \(!online\)[\s\S]*try \{[\s\S]*await completeStudio[\s\S]*catch \(err\) \{[\s\S]*setError/,
    );
  });

  it("keeps the service draft in place when package creation rejects", () => {
    expect(service).toMatch(
      /function save\(\) \{[\s\S]*if \(!online\)[\s\S]*startTransition\(async \(\) => \{[\s\S]*try \{[\s\S]*await createPackage[\s\S]*catch \{/,
    );
  });

  it("guards portfolio saves while keeping its no-write Skip route", () => {
    expect(portfolio).toMatch(
      /const handleContinue = \(\) => \{[\s\S]*if \(!online\)[\s\S]*try \{[\s\S]*await saveExternalLinks[\s\S]*catch \(err\) \{/,
    );
    expect(portfolio).toContain("router.push(routeOnSkipFromPortfolio())");
  });
});
