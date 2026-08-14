import { describe, expect, it } from "vitest";

import {
  resolveAdminClerkDashboardUrl,
  resolveAdminClerkEnvironment,
  resolveAdminWebAppUrl,
} from "./clerk-environment";

const valid = {
  ADMIN_LIVE_CLERK_DASHBOARD_URL:
    "https://dashboard.clerk.com/apps/app_live/instances/ins_live/users",
  ADMIN_LIVE_CLERK_INSTANCE_ID: "ins_live",
  ADMIN_LIVE_CLERK_SECRET_KEY: "sk_live_example",
  ADMIN_LIVE_WEB_APP_URL: "https://skitza.app",
  ADMIN_TEST_CLERK_INSTANCE_ID: "ins_test",
  ADMIN_TEST_CLERK_SECRET_KEY: "sk_test_example",
  ADMIN_TEST_CLERK_DASHBOARD_URL:
    "https://dashboard.clerk.com/apps/app_test/instances/ins_test/users",
  ADMIN_TEST_WEB_APP_URL: "https://skitza-test.example",
};

describe("registered-user Clerk environment", () => {
  it("selects only the matching explicit environment binding", () => {
    expect(resolveAdminClerkEnvironment(valid, "test")).toEqual({
      instanceId: "ins_test",
      secretKey: "sk_test_example",
    });
    expect(resolveAdminClerkEnvironment(valid, "live")).toEqual({
      instanceId: "ins_live",
      secretKey: "sk_live_example",
    });
  });

  it("allows only a configured Clerk dashboard HTTPS destination", () => {
    expect(resolveAdminClerkDashboardUrl(valid, "test")).toBe(valid.ADMIN_TEST_CLERK_DASHBOARD_URL);
    expect(() =>
      resolveAdminClerkDashboardUrl(
        { ...valid, ADMIN_TEST_CLERK_DASHBOARD_URL: "https://evil.example/users" },
        "test",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkDashboardUrl(
        {
          ...valid,
          ADMIN_TEST_CLERK_DASHBOARD_URL:
            "https://dashboard.clerk.com/apps/app_test/users?redirect=https://evil.example",
        },
        "test",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkDashboardUrl(
        {
          ...valid,
          ADMIN_TEST_CLERK_DASHBOARD_URL:
            "https://dashboard.clerk.com/apps/app_test/instances/ins_live/users",
        },
        "test",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkDashboardUrl(
        {
          ...valid,
          ADMIN_TEST_CLERK_DASHBOARD_URL:
            "https://dashboard.clerk.com/apps/app_test/instances/prefix_ins_test_suffix/users",
        },
        "test",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkDashboardUrl(
        {
          ...valid,
          ADMIN_TEST_CLERK_INSTANCE_ID: "ins_live",
          ADMIN_TEST_CLERK_DASHBOARD_URL: valid.ADMIN_LIVE_CLERK_DASHBOARD_URL,
        },
        "test",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
  });

  it("binds each invitation to a distinct HTTPS web application origin", () => {
    expect(resolveAdminWebAppUrl(valid, "live")).toBe("https://skitza.app");
    expect(resolveAdminWebAppUrl(valid, "test")).toBe("https://skitza-test.example");
    expect(() =>
      resolveAdminWebAppUrl(
        { ...valid, ADMIN_TEST_WEB_APP_URL: "http://skitza-test.example" },
        "test",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminWebAppUrl(
        { ...valid, ADMIN_TEST_WEB_APP_URL: "https://skitza-test.example/sign-up" },
        "test",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminWebAppUrl(
        { ...valid, ADMIN_TEST_WEB_APP_URL: valid.ADMIN_LIVE_WEB_APP_URL },
        "test",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminWebAppUrl(
        { ...valid, ADMIN_LIVE_WEB_APP_URL: "https://lookalike.example" },
        "live",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
  });

  it("fails closed for missing, malformed, or colliding bindings", () => {
    expect(() =>
      resolveAdminClerkEnvironment({ ...valid, ADMIN_TEST_CLERK_SECRET_KEY: undefined }, "test"),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkEnvironment({ ...valid, ADMIN_TEST_CLERK_INSTANCE_ID: "ins_live" }, "test"),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkEnvironment({ ...valid, ADMIN_LIVE_CLERK_SECRET_KEY: "wrong" }, "live"),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
    expect(() =>
      resolveAdminClerkEnvironment(
        {
          ...valid,
          ADMIN_LIVE_CLERK_SECRET_KEY: "sk_test_swapped",
          ADMIN_TEST_CLERK_SECRET_KEY: "sk_live_swapped",
        },
        "live",
      ),
    ).toThrow("ADMIN_CLERK_ENVIRONMENT_INVALID");
  });
});
