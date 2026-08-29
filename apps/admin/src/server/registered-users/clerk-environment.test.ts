import { describe, expect, it } from "vitest";

import {
  resolveAdminClerkDashboardUrl,
  resolveAdminClerkEnvironment,
  resolveAdminWebAppUrl,
} from "./clerk-environment";

// SK-288 — one Clerk account. The ADMIN_TEST_* twins and the
// live-must-differ-from-test comparisons are gone; every guard on the single
// live binding stays, including the sk_live_ prefix and the exact
// dashboard/web-app origins.

const valid = {
  ADMIN_LIVE_CLERK_DASHBOARD_URL:
    "https://dashboard.clerk.com/apps/app_live/instances/ins_live/users",
  ADMIN_LIVE_CLERK_INSTANCE_ID: "ins_live",
  ADMIN_LIVE_CLERK_SECRET_KEY: "sk_live_example",
  ADMIN_LIVE_WEB_APP_URL: "https://skitza.app",
};

describe("registered-user Clerk environment", () => {
  it("reads the explicit live binding", () => {
    expect(resolveAdminClerkEnvironment(valid)).toEqual({
      instanceId: "ins_live",
      secretKey: "sk_live_example",
    });
  });

  it("ignores leftover Test bindings instead of demanding them", () => {
    expect(
      resolveAdminClerkEnvironment({
        ...valid,
        ADMIN_TEST_CLERK_INSTANCE_ID: "ins_test",
        ADMIN_TEST_CLERK_SECRET_KEY: "sk_test_example",
      }),
    ).toEqual({ instanceId: "ins_live", secretKey: "sk_live_example" });
  });

  it("allows only a configured Clerk dashboard HTTPS destination", () => {
    expect(resolveAdminClerkDashboardUrl(valid)).toBe(valid.ADMIN_LIVE_CLERK_DASHBOARD_URL);
    expect(() =>
      resolveAdminClerkDashboardUrl({
        ...valid,
        ADMIN_LIVE_CLERK_DASHBOARD_URL: "https://evil.example/users",
      }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkDashboardUrl({
        ...valid,
        ADMIN_LIVE_CLERK_DASHBOARD_URL:
          "https://dashboard.clerk.com/apps/app_live/users?redirect=https://evil.example",
      }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkDashboardUrl({
        ...valid,
        ADMIN_LIVE_CLERK_DASHBOARD_URL:
          "https://dashboard.clerk.com/apps/app_live/instances/ins_other/users",
      }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkDashboardUrl({
        ...valid,
        ADMIN_LIVE_CLERK_DASHBOARD_URL:
          "https://dashboard.clerk.com/apps/app_live/instances/prefix_ins_live_suffix/users",
      }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
  });

  it("binds invitations to the HTTPS production web application origin", () => {
    expect(resolveAdminWebAppUrl(valid)).toBe("https://skitza.app");
    expect(() =>
      resolveAdminWebAppUrl({ ...valid, ADMIN_LIVE_WEB_APP_URL: "http://skitza.app" }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminWebAppUrl({ ...valid, ADMIN_LIVE_WEB_APP_URL: "https://skitza.app/sign-up" }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminWebAppUrl({ ...valid, ADMIN_LIVE_WEB_APP_URL: "https://lookalike.example" }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
  });

  it("fails closed for missing or malformed bindings", () => {
    expect(() =>
      resolveAdminClerkEnvironment({ ...valid, ADMIN_LIVE_CLERK_SECRET_KEY: undefined }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkEnvironment({ ...valid, ADMIN_LIVE_CLERK_INSTANCE_ID: undefined }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkEnvironment({ ...valid, ADMIN_LIVE_CLERK_SECRET_KEY: "wrong" }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    // A test-mode key must never be accepted where a live key belongs.
    expect(() =>
      resolveAdminClerkEnvironment({ ...valid, ADMIN_LIVE_CLERK_SECRET_KEY: "sk_test_swapped" }),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
  });
});
