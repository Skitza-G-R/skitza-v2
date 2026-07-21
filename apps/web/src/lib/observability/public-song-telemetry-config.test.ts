import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type InitOptions = Record<string, unknown>;
type TelemetryHook = (payload: unknown, hint?: unknown) => unknown;

const sentryMocks = vi.hoisted(() => ({
  init: vi.fn<(options: InitOptions) => void>(),
  replayIntegration: vi.fn<(options?: InitOptions) => { name: string }>(() => ({ name: "Replay" })),
  getReplay: vi.fn<() => undefined>(() => undefined),
}));

vi.mock("@sentry/nextjs", () => sentryMocks);

const POSTHOG_PROVIDER_SOURCE = readFileSync(
  new URL("../../components/observability/posthog-provider.tsx", import.meta.url),
  "utf8",
);

const RAW_LINK_TOKEN = "live-public-link.payload-signature";
const RAW_CAPABILITY = "live-audio-capability.payload-signature";
const SENTRY_HOOK_NAMES = [
  "beforeSend",
  "beforeSendTransaction",
  "beforeSendSpan",
  "beforeBreadcrumb",
  "beforeSendLog",
  "beforeSendMetric",
] as const;

function sentryOptions(): InitOptions {
  expect(sentryMocks.init).toHaveBeenCalledOnce();
  const options = sentryMocks.init.mock.calls[0]?.[0];
  expect(options).toBeDefined();
  return options ?? {};
}

function expectEverySentryPayloadHookToRedact(options: InitOptions): void {
  for (const hookName of SENTRY_HOOK_NAMES) {
    const hook = options[hookName];
    expect(hook, `${hookName} must be configured`).toBeTypeOf("function");

    const result = (hook as TelemetryHook)({
      request: {
        url: `https://skitza.app/listen/${RAW_LINK_TOKEN}`,
        query_string: `token=${RAW_LINK_TOKEN}&cap=${RAW_CAPABILITY}`,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(RAW_LINK_TOKEN);
    expect(serialized).not.toContain(RAW_CAPABILITY);
    expect(serialized).toContain("[redacted]");
  }
}

describe("public-song telemetry configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    sentryMocks.init.mockClear();
    sentryMocks.replayIntegration.mockClear();
    sentryMocks.getReplay.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.invalid/1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redacts every Sentry client payload channel and Replay custom event", async () => {
    await import("../../../sentry.client.config");
    const options = sentryOptions();

    expectEverySentryPayloadHookToRedact(options);
    expect(sentryMocks.replayIntegration).toHaveBeenCalledOnce();
    const replayOptions = sentryMocks.replayIntegration.mock.calls[0]?.[0] ?? {};
    const replayHook = replayOptions.beforeAddRecordingEvent as TelemetryHook;
    const replayResult = replayHook({
      data: { href: `https://skitza.app/listen/${RAW_LINK_TOKEN}` },
    });
    expect(JSON.stringify(replayResult)).not.toContain(RAW_LINK_TOKEN);
  });

  it("redacts every Sentry server payload channel", async () => {
    await import("../../../sentry.server.config");
    expectEverySentryPayloadHookToRedact(sentryOptions());
  });

  it("redacts every Sentry edge payload channel", async () => {
    await import("../../../sentry.edge.config");
    expectEverySentryPayloadHookToRedact(sentryOptions());
  });

  it("disables PostHog collection and both replay recorders on listen routes", () => {
    expect(POSTHOG_PROVIDER_SOURCE).toContain(
      "before_send: filterCurrentBrowserPublicSongTelemetry",
    );
    expect(POSTHOG_PROVIDER_SOURCE).toContain(
      "if (!POSTHOG_KEY || isBrowserPublicSongListenPage()) return",
    );
    expect(POSTHOG_PROVIDER_SOURCE).toMatch(
      /isPublicSongListenPath\(pathname\)[\s\S]*stopSessionRecording\(\)[\s\S]*getReplay\(\)\?\.stop\(\)/,
    );
    expect(POSTHOG_PROVIDER_SOURCE).toContain(
      "$current_url: redactPublicSongTelemetryString(url)",
    );
  });
});
