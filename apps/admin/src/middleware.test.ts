import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server.js";
import { describe, expect, it, vi } from "vitest";

import {
  config,
  handleAdminMiddleware,
  protectVerifiedAccessRoute,
} from "./middleware";

function request(pathname: string): NextRequest {
  return new NextRequest(`https://admin.skitza.app${pathname}`);
}

describe("admin middleware Cloudflare Access gate", () => {
  it.each([
    "/",
    "/sign-in",
    "/unlock",
    "/mfa-required",
    "/api/admin/context",
    "/api/admin/session/unlock",
    "/_next/data/build-id/admin.json",
    "/_next/image?url=%2Flogo.png&w=640&q=75",
  ])(
    "fails closed before Clerk for the dynamic route %s",
    async (pathname) => {
      const continueWithClerk = vi.fn();
      const verifyAccess = vi
        .fn()
        .mockRejectedValue(new Error("sensitive verifier detail"));

      const response = await handleAdminMiddleware(
        request(pathname),
        continueWithClerk,
        verifyAccess,
      );

      expect(verifyAccess).toHaveBeenCalledOnce();
      expect(continueWithClerk).not.toHaveBeenCalled();
      expect(response).toBeInstanceOf(Response);
      expect(response?.status).toBe(401);
      expect(response?.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(response?.headers.get("content-type")).toContain(
        "application/json",
      );
      const body: unknown = await response?.json();
      expect(body).toEqual({ error: "unauthorized" });
      expect(JSON.stringify(body)).not.toContain("sensitive");
    },
  );

  it("verifies Access before handing the request to Clerk", async () => {
    const order: string[] = [];
    const verifyAccess = vi.fn(() => {
      order.push("access");
      return Promise.resolve();
    });
    const continueWithClerk = vi.fn(() => {
      order.push("clerk");
    });

    await handleAdminMiddleware(
      request("/"),
      continueWithClerk,
      verifyAccess,
    );

    expect(order).toEqual(["access", "clerk"]);
  });

  it("composes valid Access with the exact signed-out Clerk redirect", async () => {
    const protectedRequest = request(
      "/environment?environment=test",
    );
    const expectedSignInUrl =
      "https://admin.skitza.app/sign-in?redirect_url=" +
      encodeURIComponent("/environment?environment=test");
    const order: string[] = [];
    const verifyAccess = vi.fn(() => {
      order.push("access");
      return Promise.resolve();
    });
    const protect = vi.fn(
      ({ unauthenticatedUrl }: { unauthenticatedUrl: string }) => {
        order.push("clerk");
        throw new Error(`NEXT_REDIRECT:${unauthenticatedUrl}`);
      },
    );

    await expect(
      handleAdminMiddleware(
        protectedRequest,
        () =>
          protectVerifiedAccessRoute(
            { protect },
            protectedRequest,
          ),
        verifyAccess,
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:${expectedSignInUrl}`);

    expect(order).toEqual(["access", "clerk"]);
    expect(verifyAccess).toHaveBeenCalledOnce();
    expect(protect).toHaveBeenCalledOnce();
    expect(protect).toHaveBeenCalledWith({
      unauthenticatedUrl: expectedSignInUrl,
    });
  });
});

describe("Clerk routing after verified Access", () => {
  it.each(["/sign-in", "/sign-in/factor-one", "/api", "/api/admin/context"])(
    "allows only the post-Access Clerk/API exception for %s",
    async (pathname) => {
      const protect = vi.fn();

      await protectVerifiedAccessRoute({ protect }, request(pathname));

      expect(protect).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/",
    "/unlock",
    "/mfa-required",
    "/environment",
    "/apiary",
  ])(
    "requires Clerk authentication for the post-Access page %s",
    async (pathname) => {
      const protect = vi.fn().mockResolvedValue(undefined);

      await protectVerifiedAccessRoute({ protect }, request(pathname));

      expect(protect).toHaveBeenCalledOnce();
      expect(protect).toHaveBeenCalledWith({
        unauthenticatedUrl:
          "https://admin.skitza.app/sign-in?redirect_url=" +
          encodeURIComponent(pathname),
      });
    },
  );

  it("preserves the full requested page path when redirecting to Clerk", async () => {
    const protect = vi.fn().mockResolvedValue(undefined);

    await protectVerifiedAccessRoute(
      { protect },
      request("/unlock?return_to=%2F"),
    );

    expect(protect).toHaveBeenCalledWith({
      unauthenticatedUrl:
        "https://admin.skitza.app/sign-in?redirect_url=" +
        encodeURIComponent("/unlock?return_to=%2F"),
    });
  });
});

describe("admin middleware matcher", () => {
  it.each([
    ["/", true],
    ["/sign-in", true],
    ["/unlock", true],
    ["/mfa-required", true],
    ["/api/admin/context", true],
    ["/_next/data/build-id/dashboard.json", true],
    ["/manifest.webmanifest", true],
    ["/admin.css", true],
    ["/favicon.ico/nested", true],
    ["/robots.txt/nested", true],
    ["/sitemap.xml/nested", true],
    ["/_next/static/chunks/admin.js", false],
    ["/_next/image", true],
    ["/_next/image?url=%2Flogo.png&w=640&q=75", true],
    ["/favicon.ico", false],
    ["/robots.txt", false],
    ["/sitemap.xml", false],
  ])(
    "uses immutable framework assets and exact metadata files as the sole public exceptions: %s",
    (pathname, expected) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `https://admin.skitza.app${pathname}`,
        }),
      ).toBe(expected);
    },
  );
});
