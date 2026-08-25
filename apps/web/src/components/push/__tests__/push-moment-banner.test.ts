import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const banner = readFileSync(new URL("../push-moment-banner.tsx", import.meta.url), "utf8");
const sessions = readFileSync(
  new URL("../../artist/sessions/my-sessions-screen.tsx", import.meta.url),
  "utf8",
);
const proof = readFileSync(
  new URL("../../artist/purchase/proof-record-screen.tsx", import.meta.url),
  "utf8",
);
const complete = readFileSync(
  new URL(
    "../../../app/(onboarding)/onboarding/complete/complete-screen-client.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("SK-276 push moment banner", () => {
  it("reuses the shared eligibility, dismissal, and enable-all flow", () => {
    expect(banner).toContain("pushInviteEligible");
    expect(banner).toContain("readPushInviteDismissedAt()");
    expect(banner).toContain("dismissPushInvite()");
    expect(banner).toContain("enableAllPushCategories(");
    expect(banner).toContain("getPushStatusAction(null)");
    // The shared flow owns the permission prompt — the banner never does.
    expect(banner).not.toContain("requestPermission");
  });

  it("checks cheap local eligibility before calling the server", () => {
    const eligibility = banner.indexOf("pushInviteEligible");
    const serverStatus = banner.indexOf("getPushStatusAction(null)");
    expect(eligibility).toBeGreaterThan(-1);
    expect(serverStatus).toBeGreaterThan(eligibility);
  });

  it("swaps to install guidance on iPhone Safari and offers a quiet Not now", () => {
    expect(banner).toContain("isAppleMobileDevice");
    expect(banner).toContain("isStandaloneDisplay()");
    expect(banner).toContain("requestInstallGuidance()");
    expect(banner).toContain("Not now");
    expect(banner).toContain("Turn on");
  });

  it("mounts at the three smart moments", () => {
    const hero = sessions.indexOf("<ConfirmationHero");
    const sessionsBanner = sessions.indexOf("<PushMomentBanner");
    expect(hero).toBeGreaterThan(-1);
    expect(sessionsBanner).toBeGreaterThan(hero);

    expect(proof).toContain("<PushMomentBanner");
    expect(complete).toContain("<PushMomentBanner");
  });
});
