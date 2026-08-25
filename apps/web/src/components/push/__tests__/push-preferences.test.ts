import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { confirmBrowserPushUnsubscribe } from "~/lib/push/browser-subscription";

const preferences = readFileSync(new URL("../push-preferences.tsx", import.meta.url), "utf8");
const producerSettings = readFileSync(
  new URL("../../../app/(producer)/dashboard/settings/settings-client.tsx", import.meta.url),
  "utf8",
);
const artistSettings = readFileSync(
  new URL("../../../app/(artist)/artist/settings/page.tsx", import.meta.url),
  "utf8",
);
const artistSettingsActions = readFileSync(
  new URL("../../../app/(artist)/artist/settings/actions.ts", import.meta.url),
  "utf8",
);
const artistSettingsClient = readFileSync(
  new URL("../../artist/settings/artist-settings-client.tsx", import.meta.url),
  "utf8",
);
const producerShell = readFileSync(new URL("../../shell/app-shell.tsx", import.meta.url), "utf8");
const artistShell = readFileSync(
  new URL("../../artist/artist-app-shell.tsx", import.meta.url),
  "utf8",
);

describe("SK-112 contextual push preferences", () => {
  it.each([
    { outcome: "true success", result: true, expected: true },
    { outcome: "false result", result: false, expected: false },
    { outcome: "rejection", result: new Error("unsubscribe failed"), expected: false },
  ])("confirms only a $outcome from browser unsubscribe", async ({ result, expected }) => {
    const unsubscribe = vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    );

    await expect(confirmBrowserPushUnsubscribe({ unsubscribe })).resolves.toBe(expected);
  });

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
    const finalDisableStart = preferences.indexOf("if (next.length === 0)");
    const finalDisableEnd = preferences.indexOf(
      "const input = subscriptionInput",
      finalDisableStart,
    );
    const finalDisable = preferences.slice(finalDisableStart, finalDisableEnd);
    const browserInvalidation = finalDisable.indexOf(
      "await confirmBrowserPushUnsubscribe(subscription)",
    );
    const failedInvalidation = finalDisable.indexOf("if (!browserUnsubscribed)");
    const clearSubscription = finalDisable.indexOf(
      "setBrowser((current) => ({ ...current, subscription: null }))",
    );
    const clearCategories = finalDisable.indexOf("setCategories([])");
    expect(browserInvalidation).toBeGreaterThan(-1);
    expect(failedInvalidation).toBeGreaterThan(browserInvalidation);
    expect(finalDisable).toContain("Push notifications could not be updated. Try again.");
    expect(clearSubscription).toBeGreaterThan(failedInvalidation);
    expect(clearCategories).toBeGreaterThan(failedInvalidation);
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

  it("offers a one-tap master enable that turns on every category (SK-276)", () => {
    expect(preferences).toContain('"Turn on notifications"');
    expect(preferences).toContain("enableAllPushCategories(browser.publicKey)");
    expect(preferences).toContain("categories.length === 0");
    // The master handler lives after toggle and never re-implements the
    // permission prompt — the shared flow owns it.
    const toggleStart = preferences.indexOf("const toggle = useCallback");
    const masterStart = preferences.indexOf("const enableAll = useCallback");
    expect(masterStart).toBeGreaterThan(toggleStart);
    expect(preferences.slice(masterStart)).not.toContain("requestPermission");
  });

  it("renders role-aware copy from a single component (SK-276)", () => {
    expect(preferences).toContain("pushCategoryCopyForRole(role)");
    expect(preferences).toContain('role = "producer"');
  });

  it("swaps to Home-Screen install guidance on iPhone Safari (SK-276)", () => {
    expect(preferences).toContain("isAppleMobileDevice");
    expect(preferences).toContain("isStandaloneDisplay()");
    expect(preferences).toContain("requestInstallGuidance()");
    expect(preferences).toContain("Add Skitza to your Home Screen");
  });

  it("keeps producer push and gives artists global in-app/email preferences", () => {
    expect(producerSettings).toContain("<PushPreferences />");
    expect(producerSettings).not.toMatch(/notificationPrefs|notifyEmail|notifyInApp/);

    expect(artistSettings).toContain("<ArtistSettingsClient");
    expect(artistSettings).toContain(
      "initialPreferences={profile.notificationPreferences}",
    );
    expect(artistSettingsClient).toContain(
      "saveArtistNotificationPreferencesAction",
    );
    expect(artistSettingsClient).toContain('"inApp" | "transactionalEmail" | "activityEmail"');
    expect(artistSettingsClient).toContain("Save notifications");
    expect(artistSettingsActions).toContain(
      "caller.artistPlatform.profile.updateNotifications(input)",
    );
    expect(artistSettings).not.toContain("PushPreferences");
    expect(artistSettingsClient).not.toContain("PushPreferences");
    expect(artistSettingsClient).not.toContain("Notification.requestPermission");
  });

  it("places each accessible switch before its flexible copy on the left without overflow", () => {
    const rowsStart = preferences.indexOf("{PUSH_CATEGORIES.map");
    const rowsEnd = preferences.indexOf("{error ?", rowsStart);
    const rows = preferences.slice(rowsStart, rowsEnd);
    const switchPosition = rows.indexOf('role="switch"');
    const copyPosition = rows.indexOf('<div className="min-w-0 flex-1">');

    expect(rowsStart).toBeGreaterThan(-1);
    expect(rowsEnd).toBeGreaterThan(rowsStart);
    expect(switchPosition).toBeGreaterThan(-1);
    expect(copyPosition).toBeGreaterThan(switchPosition);
    expect(rows).toContain("flex min-h-14 items-center gap-3 px-4 py-2.5");
    expect(rows).toContain("h-11 w-12 shrink-0");
    expect(rows).toContain("absolute top-1 left-0 h-4 w-4");
    expect(rows).toContain("aria-checked={enabled}");
    expect(rows).toContain("disabled={");
    expect(rows).toContain("void toggle(category)");
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
