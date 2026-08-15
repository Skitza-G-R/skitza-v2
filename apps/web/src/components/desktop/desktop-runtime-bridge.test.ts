// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { DESKTOP_CAPABILITIES, type DesktopBridgeDetection } from "~/lib/desktop/bridge";
import {
  desktopSessionCacheAccess,
  resetDesktopSessionValidationForTests,
} from "~/lib/desktop/session-validation";

const mocks = vi.hoisted(() => ({
  clearMediaForRevokedAccount: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/components/audio/app-media-runtime", () => ({
  clearMediaForRevokedAccount: mocks.clearMediaForRevokedAccount,
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ isLoaded: true, userId: "user-a" }) }));

import {
  cancelLiveDesktopSessionValidation,
  isProtectedDesktopAuthorizationFailure,
  requestLiveDesktopSessionValidation,
} from "./desktop-runtime-bridge";

const reportSessionValidation = vi.fn();
const detection: DesktopBridgeDetection = {
  kind: "supported",
  bridge: {
    protocolVersion: 1,
    capabilities: [DESKTOP_CAPABILITIES.sessionValidation],
    listen: () => () => undefined,
    reportSessionValidation,
  },
};

afterEach(() => {
  cancelLiveDesktopSessionValidation();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetDesktopSessionValidationForTests();
});

describe("desktop live session validation", () => {
  it("reports unknown to native and locks web cache after a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await requestLiveDesktopSessionValidation("user-a", detection);
    expect(reportSessionValidation).toHaveBeenCalledWith({
      accountMatches: false,
      status: "unknown",
      validatedAt: null,
    });
    expect(desktopSessionCacheAccess("user-a", true, Date.now(), detection)).toMatchObject({
      allowed: false,
      reason: "unknown",
    });
  });

  it("never lets an older success reopen cache after a newer revocation", async () => {
    let resolveOlder: ((response: Response) => void) | undefined;
    const olderResponse = new Promise<Response>((resolve) => {
      resolveOlder = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() => olderResponse)
        .mockResolvedValueOnce(new Response(null, { status: 403 })),
    );

    const olderRequest = requestLiveDesktopSessionValidation("user-a", detection);
    await requestLiveDesktopSessionValidation("user-a", detection);
    resolveOlder?.(
      new Response(JSON.stringify({ active: true, accountId: "user-a" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await olderRequest;

    expect(desktopSessionCacheAccess("user-a", true, Date.now(), detection)).toMatchObject({
      allowed: false,
      reason: "revoked",
    });
    expect(reportSessionValidation).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "valid" }),
    );
  });

  it("recognizes only same-origin protected 401/403 responses", () => {
    const unauthorized = new Response(null, { status: 401 });
    const forbidden = new Response(null, { status: 403 });
    expect(isProtectedDesktopAuthorizationFailure("/api/trpc/project.list", unauthorized)).toBe(
      true,
    );
    expect(
      isProtectedDesktopAuthorizationFailure(
        "/api/audio/stream/00000000-0000-4000-8000-000000000001",
        forbidden,
      ),
    ).toBe(true);
    expect(
      isProtectedDesktopAuthorizationFailure("/api/runtime/queue-version", unauthorized),
    ).toBe(true);
    expect(isProtectedDesktopAuthorizationFailure("/api/health", unauthorized)).toBe(false);
    expect(
      isProtectedDesktopAuthorizationFailure("https://other.example/api/trpc/x", unauthorized),
    ).toBe(false);
  });
});
