import { describe, expect, it } from "vitest";

import {
  AdminAccessModeError,
  requiredFounderClerkUserId,
  resolveAdminAccessMode,
} from "./access-mode";

describe("resolveAdminAccessMode", () => {
  it("defaults to cloudflare-access when unset or blank", () => {
    expect(resolveAdminAccessMode({})).toBe("cloudflare-access");
    expect(resolveAdminAccessMode({ ADMIN_ACCESS_MODE: "  " })).toBe("cloudflare-access");
  });

  it("accepts the two known modes", () => {
    expect(resolveAdminAccessMode({ ADMIN_ACCESS_MODE: "cloudflare-access" })).toBe(
      "cloudflare-access",
    );
    expect(resolveAdminAccessMode({ ADMIN_ACCESS_MODE: "vercel-protection" })).toBe(
      "vercel-protection",
    );
  });

  it("fails closed on unknown values", () => {
    expect(() => resolveAdminAccessMode({ ADMIN_ACCESS_MODE: "open" })).toThrow(
      AdminAccessModeError,
    );
    expect(() => resolveAdminAccessMode({ ADMIN_ACCESS_MODE: "VERCEL-PROTECTION" })).toThrow(
      AdminAccessModeError,
    );
  });
});

describe("requiredFounderClerkUserId", () => {
  it("returns a well-formed pinned user id", () => {
    expect(
      requiredFounderClerkUserId({
        ADMIN_FOUNDER_CLERK_USER_ID: "user_2abcDEF01234",
      }),
    ).toBe("user_2abcDEF01234");
  });

  it("rejects missing or malformed pins", () => {
    expect(() => requiredFounderClerkUserId({})).toThrow(AdminAccessModeError);
    expect(() =>
      requiredFounderClerkUserId({ ADMIN_FOUNDER_CLERK_USER_ID: "someone@example.com" }),
    ).toThrow(AdminAccessModeError);
    expect(() =>
      requiredFounderClerkUserId({ ADMIN_FOUNDER_CLERK_USER_ID: "user_" }),
    ).toThrow(AdminAccessModeError);
  });
});
