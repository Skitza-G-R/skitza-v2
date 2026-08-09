import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  begin: vi.fn(),
  createCaller: vi.fn(),
  isConfigured: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("~/server/google-calendar/config", () => ({
  isGoogleCalendarServerConfigured: mocks.isConfigured,
}));
vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: { createCaller: mocks.createCaller },
}));

import { GET } from "./route";

function request(query = "intent=connect"): Promise<Response> {
  return GET(
    new Request(
      `https://skitza.test/api/integrations/google-calendar/connect${query ? `?${query}` : ""}`,
    ),
  );
}

describe("Google Calendar OAuth connect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ userId: "user_123" });
    mocks.begin.mockResolvedValue({
      authorizationUrl: "https://accounts.google.test/o/oauth2/auth?state=signed-state",
    });
    mocks.createCaller.mockReturnValue({
      googleCalendar: { oauth: { begin: mocks.begin } },
    });
  });

  it.each(["disabled", "production"])(
    "hard-404s before auth or database work when the %s gate is closed",
    async () => {
      mocks.isConfigured.mockReturnValue(false);

      const response = await request();

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(mocks.auth).not.toHaveBeenCalled();
      expect(mocks.createCaller).not.toHaveBeenCalled();
    },
  );

  it("requires a signed-in user", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await request();

    expect(response.status).toBe(401);
    expect(mocks.createCaller).not.toHaveBeenCalled();
  });

  it.each([
    ["connect", { intent: "connect" }],
    ["reconnect", { intent: "reconnect" }],
    ["switch_account", { intent: "switch_account", switchConfirmed: true }],
  ] as const)(
    "starts the exact %s intent and redirects only to the service URL",
    async (intent, input) => {
      const response = await request(`intent=${intent}`);

      expect(mocks.createCaller).toHaveBeenCalledWith({ userId: "user_123" });
      expect(mocks.begin).toHaveBeenCalledWith(input);
      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(
        "https://accounts.google.test/o/oauth2/auth?state=signed-state",
      );
      expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    },
  );

  it.each(["", "intent=unknown", "intent=connect&intent=switch_account", "intent=connect%00"])(
    "rejects an invalid or ambiguous intent without calling tRPC: %s",
    async (query) => {
      const response = await request(query);

      expect(response.status).toBe(400);
      expect(mocks.begin).not.toHaveBeenCalled();
    },
  );

  it("returns fixed safe copy when OAuth start fails", async () => {
    mocks.begin.mockRejectedValue(new Error("raw state and provider response"));

    const response = await request();

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Google Calendar is unavailable");
    expect(response.headers.get("Location")).toBeNull();
  });
});
