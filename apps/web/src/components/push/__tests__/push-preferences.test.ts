import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const preferences = readFileSync(new URL("../push-preferences.tsx", import.meta.url), "utf8");
const producerSettings = readFileSync(
  new URL("../../../app/(producer)/dashboard/settings/settings-client.tsx", import.meta.url),
  "utf8",
);
const artistSettings = readFileSync(
  new URL("../../../app/(artist)/artist/settings/page.tsx", import.meta.url),
  "utf8",
);
const producerShell = readFileSync(new URL("../../shell/app-shell.tsx", import.meta.url), "utf8");
const artistShell = readFileSync(
  new URL("../../artist/artist-app-shell.tsx", import.meta.url),
  "utf8",
);

describe("SK-112 contextual push preferences", () => {
  it("requests permission only inside the deliberate category click path", () => {
    const effectStart = preferences.indexOf("useEffect(() =>");
    const toggleStart = preferences.indexOf("const toggle = useCallback");
    const requestStart = preferences.indexOf("Notification.requestPermission()");
    expect(effectStart).toBeGreaterThan(-1);
    expect(toggleStart).toBeGreaterThan(effectStart);
    expect(requestStart).toBeGreaterThan(toggleStart);
    expect(preferences.slice(effectStart, toggleStart)).not.toContain("requestPermission");
    expect(preferences).toContain("onClick={() =>");
    expect(preferences).toContain("void toggle(category)");
  });

  it("starts every real category off and unsubscribes the final category", () => {
    expect(preferences).toContain(
      "const [categories, setCategories] = useState<PushCategory[]>([])",
    );
    expect(preferences).toContain("if (next.length === 0)");
    expect(preferences).toContain("unsubscribePushAction(subscription.endpoint)");
    expect(preferences).toContain("await subscription.unsubscribe()");
  });

  it("reloads browser state after account-exit subscription cleanup", () => {
    expect(preferences).toContain("PUSH_ACCOUNT_BOUNDARY_EVENT");
    expect(preferences).toContain("PUSH_SUBSCRIPTION_CLEARED_EVENT");
    expect(preferences).toContain(
      "window.addEventListener(PUSH_ACCOUNT_BOUNDARY_EVENT, onAccountBoundary)",
    );
    expect(preferences).toContain(
      "window.addEventListener(PUSH_SUBSCRIPTION_CLEARED_EVENT, onSubscriptionCleared)",
    );
    expect(preferences).toContain(
      "window.removeEventListener(PUSH_SUBSCRIPTION_CLEARED_EVENT, onSubscriptionCleared)",
    );
    expect(preferences).toContain("setBrowser((current) => ({ ...current, subscription: null }))");
    expect(preferences).toContain("setError(null)");
  });

  it("cannot let a pending old-account save resume suppressed delivery", () => {
    const trackedSave = preferences.indexOf("await runTrackedPushSubscriptionWrite");
    const save = preferences.indexOf("savePushSubscriptionAction", trackedSave);
    const staleGuard = preferences.indexOf("if (!boundaryIsCurrent())", save);
    const resume = preferences.indexOf(
      "await resumeBrowserPushDelivery(boundaryIsCurrent)",
      staleGuard,
    );
    expect(trackedSave).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(trackedSave);
    expect(staleGuard).toBeGreaterThan(save);
    expect(resume).toBeGreaterThan(staleGuard);
    expect(preferences).toContain("getPushAccountBoundaryGeneration()");
    expect(preferences).toContain("pushAccountBoundaryAllowsDelivery(boundaryGeneration)");
    expect(preferences).toContain("await discardCreatedSubscription()");
    expect(preferences).toContain("if (boundaryIsCurrent()) setPending(null)");
  });

  it("replaces fake settings switches with the delivery-backed control", () => {
    expect(producerSettings).toContain("<PushPreferences />");
    expect(artistSettings).toContain("<PushPreferences />");
    expect(producerSettings).not.toMatch(/notificationPrefs|notifyEmail|notifyInApp/);
  });
});

describe("SK-112 signed-in install-guidance mounts", () => {
  it("keeps producer guidance behind resolved account ownership", () => {
    expect(producerShell).toContain("if (!userId || !producerId) return shell;");
    expect(producerShell.indexOf('role="producer"')).toBeGreaterThan(
      producerShell.indexOf("if (!userId || !producerId) return shell;"),
    );
  });

  it("mounts artist guidance only inside the authenticated artist shell", () => {
    expect(artistShell).toContain('role="artist"');
    expect(artistShell).toContain("userId: string;");
  });
});
