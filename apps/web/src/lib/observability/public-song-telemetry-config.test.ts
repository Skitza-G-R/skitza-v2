import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type InitOptions = Record<string, unknown>;
type TelemetryHook = (payload: unknown, hint?: unknown) => unknown;

const sentryMocks = vi.hoisted(() => ({
  addEventProcessor: vi.fn<(processor: TelemetryHook) => void>(),
  init: vi.fn<(options: InitOptions) => void>(),
  replayIntegration: vi.fn<(options?: InitOptions) => { name: string }>(() => ({ name: "Replay" })),
}));

vi.mock("@sentry/nextjs", () => sentryMocks);

const POSTHOG_PROVIDER_SOURCE = readFileSync(
  new URL("../../components/observability/posthog-provider.tsx", import.meta.url),
  "utf8",
);
const NEXT_CONFIG_SOURCE = readFileSync(
  new URL("../../../next.config.ts", import.meta.url),
  "utf8",
);

const RAW_LINK_TOKEN = "live-public-link.payload-signature";
const RAW_CAPABILITY = "live-audio-capability.payload-signature";
const RAW_INVITATION_TICKET = "clerk-invitation-ticket-secret";
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
        query_string:
          `token=${RAW_LINK_TOKEN}&cap=${RAW_CAPABILITY}` +
          `&__clerk_ticket=${RAW_INVITATION_TICKET}`,
      },
      __Clerk_Ticket: RAW_INVITATION_TICKET,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(RAW_LINK_TOKEN);
    expect(serialized).not.toContain(RAW_CAPABILITY);
    expect(serialized).not.toContain(RAW_INVITATION_TICKET);
    expect(serialized).toContain("[redacted]");
  }
}

describe("public-song telemetry configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    sentryMocks.init.mockClear();
    sentryMocks.addEventProcessor.mockClear();
    sentryMocks.replayIntegration.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.invalid/1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redacts every Sentry client payload channel and Replay custom event", async () => {
    await import("../../../sentry.client.config");
    const options = sentryOptions();

    expectEverySentryPayloadHookToRedact(options);
    expect(sentryMocks.addEventProcessor).toHaveBeenCalledOnce();
    const replayEventProcessor = sentryMocks.addEventProcessor.mock.calls[0]?.[0];
    expect(replayEventProcessor).toBeTypeOf("function");
    const processedReplayEvent = replayEventProcessor?.({
      type: "replay_event",
      urls: [`https://skitza.app/sign-up?__clerk%5fticket=${RAW_INVITATION_TICKET}`],
    });
    expect(JSON.stringify(processedReplayEvent)).not.toContain(RAW_INVITATION_TICKET);
    expect(JSON.stringify(processedReplayEvent)).toContain("[redacted]");
    expect(sentryMocks.replayIntegration).not.toHaveBeenCalled();
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
  });

  it("redacts every Sentry server payload channel", async () => {
    await import("../../../sentry.server.config");
    expectEverySentryPayloadHookToRedact(sentryOptions());
  });

  it("redacts every Sentry edge payload channel", async () => {
    await import("../../../sentry.edge.config");
    expectEverySentryPayloadHookToRedact(sentryOptions());
  });

  it("disables PostHog collection on sensitive authority routes", () => {
    expect(POSTHOG_PROVIDER_SOURCE).toContain(
      "before_send: filterCurrentBrowserPublicSongTelemetry",
    );
    expect(POSTHOG_PROVIDER_SOURCE).toContain(
      "if (!POSTHOG_KEY || isBrowserSensitiveAuthorityPage()) return",
    );
    expect(POSTHOG_PROVIDER_SOURCE).toMatch(
      /isSensitiveAuthorityLocation\(pathname, search\)[\s\S]*stopSessionRecording\(\)/,
    );
    expect(POSTHOG_PROVIDER_SOURCE).toContain("$current_url: redactPublicSongTelemetryString(url)");
  });

  it("prevents authority URLs from leaking after direct or client-side navigation", () => {
    expect(NEXT_CONFIG_SOURCE).toContain('{ key: "Referrer-Policy", value: "no-referrer" }');
    expect(NEXT_CONFIG_SOURCE).not.toContain("strict-origin-when-cross-origin");
  });
});
