import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clerkClient: vi.fn(),
  consume: vi.fn(),
  createDb: vi.fn(),
  createStore: vi.fn(),
  createSignInToken: vi.fn(),
  resolveProviderUserId: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: mocks.clerkClient }));
vi.mock("@skitza/db", () => ({
  createDb: mocks.createDb,
  resolveActiveProviderClerkUserIdWithDb: mocks.resolveProviderUserId,
}));
vi.mock("~/server/auth/desktop-social-auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/server/auth/desktop-social-auth")>();
  return {
    ...original,
    consumeDesktopAuthorizationCode: mocks.consume,
    createConfiguredDesktopSocialAuthStore: mocks.createStore,
  };
});

import { POST } from "./route";

const CODE = "c".repeat(43);
const VERIFIER = "v".repeat(43);
const TICKET = "clerk-ticket-one-use";

function request(body: unknown, url = "https://proof.skitza.app/api/desktop/auth/exchange") {
  return POST(
    new Request(url, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

describe("desktop social-auth exchange route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SITE_URL = "https://proof.skitza.app";
    process.env.CLERK_INSTANCE_ID = "instance-production";
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    mocks.createDb.mockReturnValue({ identityDb: true });
    mocks.createStore.mockReturnValue({ consume: vi.fn(), issue: vi.fn() });
    mocks.consume.mockResolvedValue({ clerkUserId: "canonical-user-1" });
    mocks.resolveProviderUserId.mockResolvedValue("provider-user-1");
    mocks.createSignInToken.mockResolvedValue({ token: TICKET });
    mocks.clerkClient.mockResolvedValue({
      signInTokens: { createSignInToken: mocks.createSignInToken },
    });
  });

  it.each([
    { body: { code: CODE }, label: "missing verifier" },
    {
      body: { code: CODE, codeVerifier: VERIFIER, extra: true },
      label: "extra key",
    },
  ])("rejects a malformed body without creating a Clerk ticket: $label", async ({ body }) => {
    const response = await request(body);

    expect(response.status).toBe(400);
    expect(mocks.createSignInToken).not.toHaveBeenCalled();
  });

  it("rejects a malformed code through the same invalid-grant boundary", async () => {
    mocks.consume.mockResolvedValue(null);

    const response = await request({ code: "short", codeVerifier: VERIFIER });

    expect(response.status).toBe(401);
    expect(mocks.createSignInToken).not.toHaveBeenCalled();
  });

  it("rejects a non-exact or non-HTTPS exchange endpoint", async () => {
    const response = await request(
      { code: CODE, codeVerifier: VERIFIER },
      "http://proof.skitza.app/api/desktop/auth/exchange",
    );

    expect(response.status).toBe(400);
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("does not consume a code when identity configuration is missing", async () => {
    delete process.env.CLERK_INSTANCE_ID;

    const response = await request({ code: CODE, codeVerifier: VERIFIER });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.createSignInToken).not.toHaveBeenCalled();
  });

  it("atomically consumes code plus verifier before creating a sixty-second ticket", async () => {
    const store = { consume: vi.fn(), issue: vi.fn() };
    mocks.createStore.mockReturnValue(store);

    const response = await request({ code: CODE, codeVerifier: VERIFIER });

    expect(mocks.consume).toHaveBeenCalledWith({
      code: CODE,
      codeVerifier: VERIFIER,
      store,
    });
    expect(mocks.createSignInToken).toHaveBeenCalledWith({
      userId: "provider-user-1",
      expiresInSeconds: 60,
    });
    expect(mocks.resolveProviderUserId).toHaveBeenCalledWith(
      { identityDb: true },
      {
        canonicalClerkUserId: "canonical-user-1",
        clerkInstanceId: "instance-production",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ protocolVersion: 1, ticket: TICKET });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("makes replay or a wrong verifier fail without minting another ticket", async () => {
    mocks.consume.mockResolvedValue(null);

    const response = await request({ code: CODE, codeVerifier: VERIFIER });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
    expect(mocks.createSignInToken).not.toHaveBeenCalled();
  });

  it("never includes a failed Clerk response or ticket in an error body", async () => {
    mocks.createSignInToken.mockRejectedValue(new Error("raw Clerk response with ticket"));

    const response = await request({ code: CODE, codeVerifier: VERIFIER });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("fails closed without minting a ticket when no active provider identity exists", async () => {
    mocks.resolveProviderUserId.mockRejectedValue(new Error("IDENTITY_RELINK_REQUIRED"));

    const response = await request({ code: CODE, codeVerifier: VERIFIER });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(mocks.createSignInToken).not.toHaveBeenCalled();
  });
});
