import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  auth: vi.fn(),
  createDb: vi.fn(),
  createStore: vi.fn(),
  eq: vi.fn(() => "where"),
  issue: vi.fn(),
  isNull: vi.fn(() => "is-null"),
}));

vi.mock("@skitza/db", () => ({
  and: mocks.and,
  createDb: mocks.createDb,
  eq: mocks.eq,
  isNull: mocks.isNull,
  producers: { clerkUserId: "clerk_user_id", closedAt: "closed_at", id: "id" },
}));
vi.mock("~/server/auth/clerk-identity", () => ({ auth: mocks.auth }));
vi.mock("~/server/auth/desktop-social-auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/server/auth/desktop-social-auth")>();
  return {
    ...original,
    createDesktopSocialAuthStore: mocks.createStore,
    issueDesktopAuthorizationCode: mocks.issue,
  };
});

import { GET } from "./route";

const STATE = "s".repeat(43);
const CHALLENGE = "c".repeat(43);
const CODE = "a".repeat(43);

function request(extra = ""): Promise<Response> {
  return GET(
    new Request(
      `https://proof.skitza.app/api/desktop/auth/start?state=${STATE}` +
        `&code_challenge=${CHALLENGE}&code_challenge_method=S256${extra}`,
    ),
  );
}

function dbWithProducer(id: string | null) {
  const limit = vi.fn().mockResolvedValue(id ? [{ id }] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { select: vi.fn(() => ({ from })) };
}

describe("desktop social-auth start route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SITE_URL = "https://proof.skitza.app";
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    mocks.auth.mockResolvedValue({ providerUserId: "provider-user-1", userId: "canonical-user-1" });
    mocks.createDb.mockReturnValue(dbWithProducer("producer-1"));
    mocks.createStore.mockReturnValue({ consume: vi.fn(), issue: vi.fn() });
    mocks.issue.mockResolvedValue(CODE);
  });

  it("rejects a non-exact start request before auth or database work", async () => {
    const response = await request("&extra=1");

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.createDb).not.toHaveBeenCalled();
  });

  it("sends an unauthenticated system browser through the trusted sign-in surface", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await request();
    const location = new URL(response.headers.get("Location") ?? "");

    expect(response.status).toBe(303);
    expect(location.origin).toBe("https://proof.skitza.app");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("redirect_url")).toBe(
      `/api/desktop/auth/start?state=${STATE}` +
        `&code_challenge=${CHALLENGE}&code_challenge_method=S256`,
    );
    expect(mocks.createDb).not.toHaveBeenCalled();
  });

  it("issues one producer-bound code and returns code plus state only", async () => {
    const store = { consume: vi.fn(), issue: vi.fn() };
    mocks.createStore.mockReturnValue(store);

    const response = await request();
    const location = new URL(response.headers.get("Location") ?? "");

    expect(mocks.issue).toHaveBeenCalledWith({
      codeChallenge: CHALLENGE,
      producerId: "producer-1",
      state: STATE,
      store,
    });
    expect(mocks.eq).toHaveBeenCalledWith("clerk_user_id", "canonical-user-1");
    expect(mocks.isNull).toHaveBeenCalledWith("closed_at");
    expect(response.status).toBe(303);
    expect(location.protocol).toBe("skitza:");
    expect(location.host).toBe("auth");
    expect(location.pathname).toBe("/callback");
    expect(Array.from(location.searchParams.keys())).toEqual(["code", "state"]);
    expect(location.searchParams.get("code")).toBe(CODE);
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("does not issue a desktop handoff for a non-producer account", async () => {
    mocks.createDb.mockReturnValue(dbWithProducer(null));

    const response = await request();

    expect(response.status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("does not issue a desktop handoff for a closed producer account", async () => {
    mocks.createDb.mockReturnValue(dbWithProducer(null));

    const response = await request();

    expect(response.status).toBe(403);
    expect(mocks.isNull).toHaveBeenCalledWith("closed_at");
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("fails closed when the provider identity cannot resolve", async () => {
    mocks.auth.mockRejectedValue(new Error("IDENTITY_RELINK_REQUIRED"));

    const response = await request();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Desktop authentication is unavailable");
    expect(mocks.createDb).not.toHaveBeenCalled();
  });
});
