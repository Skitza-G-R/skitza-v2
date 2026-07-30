import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MobileTodayFeed } from "../mobile-today-feed";

describe("MobileTodayFeed setup nudge", () => {
  it("links Finish setup to the canonical onboarding flow", () => {
    const html = renderToStaticMarkup(
      <MobileTodayFeed
        displayName="Gili"
        pendingApprovals={[]}
        pendingPurchaseRequests={[]}
        pendingPaymentProofs={[]}
        followUps={[]}
        payments={[]}
        todaySession={null}
        urgentProjects={[]}
        activity={[]}
        showSetupNudge
        now={new Date("2026-07-30T09:00:00.000Z")}
      />,
    );

    expect(html).toContain('href="/onboarding"');
    expect(html).toContain("Finish setup");
    expect(html).not.toContain('href="/dashboard/onboarding"');
  });
});
