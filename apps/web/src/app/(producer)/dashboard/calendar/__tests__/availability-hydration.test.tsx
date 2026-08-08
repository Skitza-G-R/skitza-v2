import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AvailabilityPanel } from "../availability-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const ORIGINAL_TZ = process.env.TZ;

function renderAvailability(processTimeZone: string, initialNow: string): string {
  process.env.TZ = processTimeZone;

  const props = {
    blocks: [],
    blackouts: [],
    settings: {
      autoConfirmBookings: false,
      cancellationPolicyHours: 12,
      maxSessionsPerDay: null,
    },
    initialWeekStart: "sunday" as const,
    timeZone: "Asia/Jerusalem",
    initialNow,
  };

  return renderToStaticMarkup(<AvailabilityPanel {...props} />);
}

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

describe("Availability hydration", () => {
  it.each([
    ["summer", "2026-08-06T06:00:00.000Z", "GMT+3"],
    ["winter", "2026-01-06T07:00:00.000Z", "GMT+2"],
  ])(
    "renders the producer timezone identically on the server and browser in %s",
    (_season, initialNow, expectedOffset) => {
      const serverHtml = renderAvailability("UTC", initialNow);
      const browserHtml = renderAvailability("Asia/Jerusalem", initialNow);

      expect(serverHtml).toContain(`Asia/Jerusalem · ${expectedOffset}`);
      expect(browserHtml).toContain(`Asia/Jerusalem · ${expectedOffset}`);
      expect(serverHtml).toBe(browserHtml);
    },
  );
});
