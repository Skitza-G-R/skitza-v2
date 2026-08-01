import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const NEXT_CONFIG = readFileSync(
  fileURLToPath(new URL("../../../next.config.ts", import.meta.url)),
  "utf8",
);
const GLOBALS_CSS = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");
const DASHBOARD_PAGE = readFileSync(
  fileURLToPath(new URL("../(producer)/dashboard/page.tsx", import.meta.url)),
  "utf8",
);
const PAYMENTS_PAGE = readFileSync(
  fileURLToPath(new URL("../(producer)/dashboard/payments/page.tsx", import.meta.url)),
  "utf8",
);
const ONBOARDING_DETECTOR = readFileSync(
  fileURLToPath(new URL("../(producer)/dashboard/onboarding/detect.ts", import.meta.url)),
  "utf8",
);
const PRODUCER_SHELL = readFileSync(
  fileURLToPath(new URL("../../components/shell/app-shell.tsx", import.meta.url)),
  "utf8",
);
const ARTIST_SHELL = readFileSync(
  fileURLToPath(new URL("../../components/artist/artist-app-shell.tsx", import.meta.url)),
  "utf8",
);
const ARTIST_LAYOUT = readFileSync(
  fileURLToPath(new URL("../(artist)/artist/layout.tsx", import.meta.url)),
  "utf8",
);
const ARTIST_RUNTIME_PROVIDER = readFileSync(
  fileURLToPath(
    new URL("../../components/runtime-state/artist-runtime-state-provider.tsx", import.meta.url),
  ),
  "utf8",
);
const ARTIST_STUDIO_PREFERENCE = readFileSync(
  fileURLToPath(new URL("../../server/artist/studio-preference.ts", import.meta.url)),
  "utf8",
);
const RUNTIME_NAVIGATION_BRIDGE = readFileSync(
  fileURLToPath(
    new URL("../../components/runtime-state/runtime-navigation-bridge.tsx", import.meta.url),
  ),
  "utf8",
);
const NATIVE_APP_RUNTIME = readFileSync(
  fileURLToPath(new URL("../../components/shell/sw-register.tsx", import.meta.url)),
  "utf8",
);

describe("SK-122 client Router Cache policy", () => {
  it("keeps ordinary dynamic reuse short and explicit warm routes bounded", () => {
    expect(NEXT_CONFIG).toMatch(/staleTimes:\s*\{\s*dynamic:\s*0,\s*static:\s*180,\s*\}/);
  });

  it("documents that foreground checks preserve the session-only warm payload", () => {
    expect(NEXT_CONFIG).toContain("Foreground and reconnect checks");
    expect(NEXT_CONFIG).toContain("preserve the warm Router Cache");
    expect(NEXT_CONFIG).toContain("RuntimeNavigationBridge replaces its readiness");
    expect(NEXT_CONFIG).toContain("not durable or");
    expect(NEXT_CONFIG).toContain("cleared by a full page reload");
  });
});

describe("SK-122 warm-arrival motion policy", () => {
  const warmRule = GLOBALS_CSS.match(
    /html\[data-sk-nav-source="warm"\]\s*#main-content\s*:is\(([\s\S]*?)\)\s*\{([\s\S]*?)\}/,
  );

  it("uses the durable warm source marker rather than pending state", () => {
    expect(warmRule).not.toBeNull();
    expect(warmRule?.[0]).not.toContain("data-sk-nav-state");
  });

  it.each([
    ".sk-page-enter",
    ".sk-stagger-item",
    ".reveal-up",
    ".reveal-up-delay-1",
    ".reveal-up-delay-2",
    ".reveal-up-delay-3",
    ".reveal-up-delay-4",
  ])("settles %s immediately on a warm signed-in arrival", (selector) => {
    expect(warmRule?.[1]).toContain(selector);
    expect(warmRule?.[2]).toContain("animation: none !important");
    expect(warmRule?.[2]).toContain("opacity: 1 !important");
    expect(warmRule?.[2]).toContain("transform: none !important");
  });

  it("does not suppress marketing scroll reveals or ambient interaction motion", () => {
    expect(warmRule?.[1]).not.toContain(".sk-reveal");
    expect(warmRule?.[1]).not.toContain(".sk-soft-pulse");
    expect(warmRule?.[1]).not.toContain(".sk-press");
  });

  it("keeps the normal cold route-entry animation declarations", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-page-enter\s*\{\s*animation:\s*skitza-page-enter 240ms/);
    expect(GLOBALS_CSS).toMatch(/\.reveal-up\s*\{\s*animation:\s*skitza-reveal-up 0\.6s/);
  });

  it("remembers a completed main-route visit as warm for the next switch", () => {
    expect(RUNTIME_NAVIGATION_BRIDGE).toContain("navigationCache.markReady(currentMainHref)");
  });
});

describe("SK-122 accepted-target feedback", () => {
  it("reuses the existing pressed treatment only for the accepted pending link", () => {
    expect(GLOBALS_CSS).toMatch(
      /\.sk-press:active,\s*\.sk-press\[data-sk-nav-pending\]\s*\{[\s\S]*?transform:\s*scale\(0\.97\);[\s\S]*?filter:\s*brightness\(0\.96\);/,
    );
  });

  it("removes pending transforms and filters when reduced motion is requested", () => {
    const reducedMotion = GLOBALS_CSS.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n {2}\}/,
    );
    expect(reducedMotion?.[1]).toContain(".sk-press[data-sk-nav-pending]");
    expect(reducedMotion?.[1]).toContain("transform: none !important");
    expect(reducedMotion?.[1]).toContain("filter: none !important");
  });

  it("clears accepted-link feedback on commit, fallback, timeout, and bridge cleanup", () => {
    expect(
      RUNTIME_NAVIGATION_BRIDGE.match(/clearRuntimeMainNavigationPendingTargets/g),
    ).toHaveLength(6);
    expect(RUNTIME_NAVIGATION_BRIDGE).toMatch(
      /if \(!targetHref \|\| targetHref === currentHrefRef\.current\) \{\s*clearNavigationElementState\(root\);\s*warmSourcePathname\.current = null;/,
    );
  });
});

describe("SK-122 dashboard caller reuse", () => {
  it("uses one tRPC caller and avoids a serial onboarding probe", () => {
    expect(DASHBOARD_PAGE.match(/appRouter\.createCaller/g)).toHaveLength(1);
    expect(DASHBOARD_PAGE).not.toContain("detectOnboardingState(userId, caller)");
    expect(DASHBOARD_PAGE).toContain(
      "skipOnboarding ? caller.booking.packages.list() : Promise.resolve(null)",
    );
    expect(ONBOARDING_DETECTOR).toContain(
      "caller: AppRouterCaller = appRouter.createCaller({ userId })",
    );
  });
});

describe("SK-122 Router Cache invalidation contract", () => {
  it("marks only the public launch bootstrap for durable document caching", () => {
    expect(NEXT_CONFIG).toContain('source: "/launch"');
    expect(NEXT_CONFIG).toContain('key: "X-Skitza-Public-Bootstrap"');
    expect(NEXT_CONFIG).toContain('value: "1"');
  });

  it("does not discard the full warm cache on foreground or reconnect", () => {
    expect(NATIVE_APP_RUNTIME).toContain("NATIVE_REFRESH_EVENT");
    expect(NATIVE_APP_RUNTIME).toContain("registration?.update()");
    expect(NATIVE_APP_RUNTIME).not.toContain("router.refresh()");
    expect(NATIVE_APP_RUNTIME).not.toContain("useRouter");
  });

  it("keeps the artist studio recorder behind the account-exit write fence", () => {
    expect(ARTIST_RUNTIME_PROVIDER).toContain("captureAccountPrivateWriteGeneration");
    expect(ARTIST_RUNTIME_PROVIDER).toContain(
      "isAccountPrivateRuntimeWriteAllowed(writeGeneration)",
    );
  });

  it("keeps a queryless artist shell on the user-bound saved studio and safe roster fallback", () => {
    expect(ARTIST_LAYOUT).toContain("readArtistStudioPreference(userId)");
    expect(ARTIST_LAYOUT).toContain("resolveArtistStudioId(studios, null, savedStudioId)");
    expect(ARTIST_STUDIO_PREFERENCE).toContain("artistStudioPreferenceForUser(");
    expect(ARTIST_STUDIO_PREFERENCE).toMatch(
      /artistStudioPreferenceForUser\([\s\S]*?,\s*userId,\s*\)/,
    );
    expect(ARTIST_RUNTIME_PROVIDER).toMatch(
      /resolveArtistStudioId\([\s\S]*?requestedStudioId,\s*initialStudioId,\s*\)/,
    );
    expect(ARTIST_RUNTIME_PROVIDER).toContain(
      "writeArtistStudioPreferenceCookie(identity.userId, identity.contextId)",
    );
  });

  it("uses the full producer proof scope for the Payments polling revision", () => {
    expect(PAYMENTS_PAGE).toMatch(/pendingProofIds = model\.projects\.flatMap/);
    expect(PAYMENTS_PAGE).not.toMatch(
      /pendingProofIds = model\.producerBuckets\.needs_review\.projects\.flatMap/,
    );
    expect(PAYMENTS_PAGE).toContain('kind="payment-proofs"');
    expect(PAYMENTS_PAGE).not.toMatch(
      /<ProofQueueRefresh[\s\S]*?enabled=\{model\.producerBuckets\.needs_review/,
    );
  });

  it("replaces custom readiness when either persistent server shell refreshes", () => {
    expect(PRODUCER_SHELL).toContain("const runtimeCacheEpoch = Date.now()");
    expect(PRODUCER_SHELL).toContain("<RuntimeNavigationBridge cacheEpoch={runtimeCacheEpoch} />");
    expect(ARTIST_SHELL).toContain("const runtimeCacheEpoch = Date.now()");
    expect(ARTIST_SHELL).toContain("cacheEpoch={runtimeCacheEpoch}");
    expect(ARTIST_RUNTIME_PROVIDER).toContain(
      "<RuntimeNavigationBridge cacheEpoch={cacheEpoch} />",
    );
  });

  it("skips the seeded current route initially and warms it after a proven refresh", () => {
    expect(RUNTIME_NAVIGATION_BRIDGE).toContain("const initialCacheEpoch = useRef(cacheEpoch)");
    expect(RUNTIME_NAVIGATION_BRIDGE).toContain(
      "warmCurrent: cacheEpoch !== initialCacheEpoch.current",
    );
  });
});
