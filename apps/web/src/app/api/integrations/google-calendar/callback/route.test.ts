import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  complete: vi.fn(),
  createCaller: vi.fn(),
  isConfigured: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("~/server/google-calendar/config", () => ({
  isGoogleCalendarServerConfigured: mocks.isConfigured,
  loadGoogleCalendarServerConfig: mocks.loadConfig,
}));
vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: { createCaller: mocks.createCaller },
}));

import { GET } from "./route";

function request(query: string): Promise<Response> {
  return GET(new Request(`https://skitza.test/api/integrations/google-calendar/callback?${query}`));
}

function expectCalendarRedirect(response: Response, code: string): void {
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe(
    `https://skitza.test/dashboard/calendar?tab=availability&google=${code}`,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

describe("Google Calendar OAuth callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockReturnValue(true);
    mocks.loadConfig.mockReturnValue({
      redirectUri: "https://skitza.test/api/integrations/google-calendar/callback",
    });
    mocks.auth.mockResolvedValue({ userId: "user_123" });
    mocks.complete.mockResolvedValue({ status: "needs_selection" });
    mocks.createCaller.mockReturnValue({
      googleCalendar: { oauth: { complete: mocks.complete } },
    });
  });

  it.each(["disabled", "production"])(
    "hard-404s before auth or database work when the %s gate is closed",
    async () => {
      mocks.isConfigured.mockReturnValue(false);

      const response = await request("state=signed-state&code=provider-code");

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(mocks.auth).not.toHaveBeenCalled();
      expect(mocks.createCaller).not.toHaveBeenCalled();
    },
  );

  it("requires a signed-in user before processing callback values", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await request("state=signed-state&code=provider-code");

    expect(response.status).toBe(401);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([
    ["needs_selection", "selection"],
    ["connected", "connected"],
  ] as const)("maps safe completion status %s to %s", async (status, safeCode) => {
    mocks.complete.mockResolvedValue({ status });

    const response = await request(
      "state=signed-state&code=provider-code&returnTo=https%3A%2F%2Fevil.test%2Fsteal",
    );

    expect(mocks.createCaller).toHaveBeenCalledWith({ userId: "user_123" });
    expect(mocks.complete).toHaveBeenCalledWith({
      stateToken: "signed-state",
      code: "provider-code",
    });
    expectCalendarRedirect(response, safeCode);
    expect(response.headers.get("Location")).not.toContain("evil.test");
  });

  it("passes a bounded provider denial only to the server and returns safe copy", async () => {
    mocks.complete.mockRejectedValue(
      new TRPCError({
        code: "BAD_REQUEST",
        message: "Google Calendar authorization was cancelled",
      }),
    );

    const response = await request("state=signed-state&error=access_denied");

    expect(mocks.complete).toHaveBeenCalledWith({
      stateToken: "signed-state",
      providerError: "access_denied",
    });
    expectCalendarRedirect(response, "denied");
    expect(response.headers.get("Location")).not.toContain("access_denied");
  });

  it.each([
    [
      new TRPCError({
        code: "CONFLICT",
        message: "Choose the Google account already connected to Skitza",
      }),
      "wrong-account",
    ],
    [
      new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Google Calendar needs to be reconnected",
      }),
      "reconnect",
    ],
    [new Error("raw provider payload with a secret code"), "error"],
  ] as const)("maps only a safe tRPC result to %s", async (failure, safeCode) => {
    mocks.complete.mockRejectedValue(failure);

    const response = await request("state=signed-state&code=provider-code");

    expectCalendarRedirect(response, safeCode);
    expect(response.headers.get("Location")).not.toContain("raw");
    expect(response.headers.get("Location")).not.toContain("secret");
  });

  it.each([
    ["state missing", "code=provider-code"],
    ["duplicate state", "state=one&state=two&code=provider-code"],
    ["state too long", `state=${"s".repeat(1_025)}&code=provider-code`],
    ["code too long", `state=signed-state&code=${"c".repeat(4_097)}`],
    ["multibyte code too long", `state=signed-state&code=${"🔐".repeat(1_025)}`],
    ["error too long", `state=signed-state&error=${"e".repeat(129)}`],
    ["duplicate code", "state=signed-state&code=one&code=two"],
    ["duplicate error", "state=signed-state&error=one&error=two"],
    ["code and error together", "state=signed-state&code=one&error=access_denied"],
  ])("rejects %s before tRPC and uses only the fixed safe redirect", async (_label, query) => {
    const response = await request(query);

    expect(mocks.complete).not.toHaveBeenCalled();
    expectCalendarRedirect(response, "error");
  });

  it("never reflects an unknown callback value or raw failure", async () => {
    mocks.complete.mockRejectedValue(new Error("provider said: private-code"));

    const response = await request(
      "state=signed-state&error=unexpected_provider_value&error_description=private-code",
    );

    expectCalendarRedirect(response, "error");
    expect(response.headers.get("Location")).not.toContain("unexpected_provider_value");
    expect(response.headers.get("Location")).not.toContain("private-code");
  });

  it("redirects only to the configured Skitza origin", async () => {
    const response = await GET(
      new Request(
        "https://attacker.test/api/integrations/google-calendar/callback?state=signed-state&code=provider-code",
      ),
    );

    expectCalendarRedirect(response, "selection");
    expect(response.headers.get("Location")).not.toContain("attacker.test");
  });
});
