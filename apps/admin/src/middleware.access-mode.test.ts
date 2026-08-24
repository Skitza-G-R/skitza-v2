import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { AdminAccessModeError } from "./server/auth/access-mode";
import { handleAdminMiddleware } from "./middleware";

const request = { headers: new Headers() } as unknown as NextRequest;

describe("handleAdminMiddleware access modes", () => {
  it("verifies the Cloudflare assertion in cloudflare-access mode", async () => {
    const verifyAccess = vi.fn().mockResolvedValue(undefined);
    const continueWithClerk = vi.fn().mockResolvedValue("clerk-result");

    const result = await handleAdminMiddleware(
      request,
      continueWithClerk,
      verifyAccess,
      () => "cloudflare-access",
    );

    expect(verifyAccess).toHaveBeenCalledTimes(1);
    expect(continueWithClerk).toHaveBeenCalledTimes(1);
    expect(result).toBe("clerk-result");
  });

  it("skips the Cloudflare assertion in vercel-protection mode", async () => {
    const verifyAccess = vi.fn();
    const continueWithClerk = vi.fn().mockResolvedValue("clerk-result");

    const result = await handleAdminMiddleware(
      request,
      continueWithClerk,
      verifyAccess,
      () => "vercel-protection",
    );

    expect(verifyAccess).not.toHaveBeenCalled();
    expect(continueWithClerk).toHaveBeenCalledTimes(1);
    expect(result).toBe("clerk-result");
  });

  it("fails closed when the mode configuration is invalid", async () => {
    const verifyAccess = vi.fn();
    const continueWithClerk = vi.fn();

    const result = await handleAdminMiddleware(request, continueWithClerk, verifyAccess, () => {
      throw new AdminAccessModeError();
    });

    expect(verifyAccess).not.toHaveBeenCalled();
    expect(continueWithClerk).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});
