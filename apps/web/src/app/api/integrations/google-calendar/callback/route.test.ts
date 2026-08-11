import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeOAuth: vi.fn(),
  createDb: vi.fn(),
  createProvider: vi.fn(),
  createRepository: vi.fn(),
  createService: vi.fn(),
  isConfigured: vi.fn(),
  loadConfig: vi.fn(),
}));

const BROWSER_BINDING = "a".repeat(43);

vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("~/server/google-calendar/config", () => ({
  isGoogleCalendarServerConfigured: mocks.isConfigured,
  loadGoogleCalendarServerConfig: mocks.loadConfig,
}));
vi.mock("~/server/google-calendar/provider", () => ({
  createGoogleCalendarProvider: mocks.createProvider,
}));
vi.mock("~/server/google-calendar/repository-drizzle", () => ({
  createGoogleCalendarRepository: mocks.createRepository,
}));
vi.mock("~/server/google-calendar/service", async (importOriginal) => ({
  ...(await importOriginal()),
  createGoogleCalendarService: mocks.createService,
}));

import { GoogleCalendarServiceError } from "~/server/google-calendar/service";
import { GET } from "./route";

function request(query: string): Promise<Response> {
  return GET(
    new Request(`https://skitza.test/api/integrations/google-calendar/callback?${query}`, {
      headers: { Cookie: `skitza_gcal_oauth_txn=${BROWSER_BINDING}` },
    }),
  );
}

function expectCalendarRedirect(response: Response, code: string): void {
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe(
    `https://skitza.test/dashboard/calendar?tab=availability&google=${code}`,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Set-Cookie")).toContain("skitza_gcal_oauth_txn=");
  expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(response.headers.get("Set-Cookie")).toContain("Secure");
  expect(response.headers.get("Set-Cookie")).toContain("SameSite=lax");
  expect(response.headers.get("Set-Cookie")).toContain(
    "Path=/api/integrations/google-calendar/callback",
  );
  expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
}

describe("Google Calendar OAuth callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockReturnValue(true);
    mocks.loadConfig.mockReturnValue({
      redirectUri: "https://skitza.test/api/integrations/google-calendar/callback",
    });
    process.env.DATABASE_URL = "postgresql://test/test";
    mocks.completeOAuth.mockResolvedValue({ status: "needs_selection" });
    mocks.createService.mockReturnValue({ completeOAuth: mocks.completeOAuth });
  });

  it.each(["disabled", "production"])(
    "hard-404s before auth or database work when the %s gate is closed",
    async () => {
      mocks.isConfigured.mockReturnValue(false);

      const response = await request("state=signed-state&code=provider-code");

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(mocks.createService).not.toHaveBeenCalled();
    },
  );

  it("completes from verified state when the Clerk session is unavailable", async () => {
    const response = await request("state=signed-state&code=provider-code");

    expect(mocks.completeOAuth).toHaveBeenCalledWith({
      stateToken: "signed-state",
      code: "provider-code",
      browserBinding: BROWSER_BINDING,
    });
    expectCalendarRedirect(response, "selection");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "short"],
    ["ambiguous", `${BROWSER_BINDING}; skitza_gcal_oauth_txn=${"b".repeat(43)}`],
  ])("rejects a %s initiating-browser cookie before completion", async (_label, cookieValue) => {
    const response = await GET(
      new Request(
        "https://skitza.test/api/integrations/google-calendar/callback?state=signed-state&code=provider-code",
        cookieValue === undefined
          ? undefined
          : { headers: { Cookie: `skitza_gcal_oauth_txn=${cookieValue}` } },
      ),
    );

    expect(mocks.completeOAuth).not.toHaveBeenCalled();
    expectCalendarRedirect(response, "error");
  });

  it.each([
    ["needs_selection", "selection"],
    ["connected", "connected"],
  ] as const)("maps safe completion status %s to %s", async (status, safeCode) => {
    mocks.completeOAuth.mockResolvedValue({ status });

    const response = await request(
      "state=signed-state&code=provider-code&returnTo=https%3A%2F%2Fevil.test%2Fsteal",
    );

    expect(mocks.completeOAuth).toHaveBeenCalledWith({
      stateToken: "signed-state",
      code: "provider-code",
      browserBinding: BROWSER_BINDING,
    });
    expectCalendarRedirect(response, safeCode);
    expect(response.headers.get("Location")).not.toContain("evil.test");
  });

  it("passes a bounded provider denial only to the server and returns safe copy", async () => {
    mocks.completeOAuth.mockRejectedValue(
      new GoogleCalendarServiceError("authorization_cancelled"),
    );

    const response = await request("state=signed-state&error=access_denied");

    expect(mocks.completeOAuth).toHaveBeenCalledWith({
      stateToken: "signed-state",
      providerError: "access_denied",
      browserBinding: BROWSER_BINDING,
    });
    expectCalendarRedirect(response, "denied");
    expect(response.headers.get("Location")).not.toContain("access_denied");
  });

  it.each([
    [new GoogleCalendarServiceError("wrong_account"), "wrong-account"],
    [new GoogleCalendarServiceError("reconnect_required"), "reconnect"],
    [new Error("raw provider payload with a secret code"), "error"],
  ] as const)("maps only a safe completion result to %s", async (failure, safeCode) => {
    mocks.completeOAuth.mockRejectedValue(failure);

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
  ])(
    "rejects %s before completion and uses only the fixed safe redirect",
    async (_label, query) => {
      const response = await request(query);

      expect(mocks.completeOAuth).not.toHaveBeenCalled();
      expectCalendarRedirect(response, "error");
    },
  );

  it("never reflects an unknown callback value or raw failure", async () => {
    mocks.completeOAuth.mockRejectedValue(new Error("provider said: private-code"));

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
        { headers: { Cookie: `skitza_gcal_oauth_txn=${BROWSER_BINDING}` } },
      ),
    );

    expectCalendarRedirect(response, "selection");
    expect(response.headers.get("Location")).not.toContain("attacker.test");
  });
});
