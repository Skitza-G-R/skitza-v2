import type { AdminEnvironmentId, AdminEnvironmentMap } from "~/server/environment";

const SECRET_NAMES = {
  live: "ADMIN_LIVE_CLERK_SECRET_KEY",
  test: "ADMIN_TEST_CLERK_SECRET_KEY",
} as const;

const INSTANCE_NAMES = {
  live: "ADMIN_LIVE_CLERK_INSTANCE_ID",
  test: "ADMIN_TEST_CLERK_INSTANCE_ID",
} as const;

const DASHBOARD_NAMES = {
  live: "ADMIN_LIVE_CLERK_DASHBOARD_URL",
  test: "ADMIN_TEST_CLERK_DASHBOARD_URL",
} as const;

const WEB_APP_NAMES = {
  live: "ADMIN_LIVE_WEB_APP_URL",
  test: "ADMIN_TEST_WEB_APP_URL",
} as const;

export class AdminClerkEnvironmentError extends Error {
  constructor() {
    super("ADMIN_CLERK_ENVIRONMENT_INVALID");
    this.name = "AdminClerkEnvironmentError";
  }
}

function required(environment: AdminEnvironmentMap, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new AdminClerkEnvironmentError();
  return value;
}

export function resolveAdminClerkEnvironment(
  environment: AdminEnvironmentMap,
  selected: AdminEnvironmentId,
): Readonly<{ instanceId: string; secretKey: string }> {
  const liveSecret = required(environment, SECRET_NAMES.live);
  const testSecret = required(environment, SECRET_NAMES.test);
  const liveInstance = required(environment, INSTANCE_NAMES.live);
  const testInstance = required(environment, INSTANCE_NAMES.test);

  if (
    liveSecret === testSecret ||
    liveInstance === testInstance ||
    !/^sk_live_/.test(liveSecret) ||
    !/^sk_test_/.test(testSecret) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(liveInstance) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(testInstance)
  ) {
    throw new AdminClerkEnvironmentError();
  }

  return selected === "live"
    ? { instanceId: liveInstance, secretKey: liveSecret }
    : { instanceId: testInstance, secretKey: testSecret };
}

export function resolveAdminClerkDashboardUrl(
  environment: AdminEnvironmentMap,
  selected: AdminEnvironmentId,
): string {
  const dashboards = {} as Record<AdminEnvironmentId, string>;
  for (const environmentId of ["live", "test"] as const) {
    const raw = required(environment, DASHBOARD_NAMES[environmentId]);
    const instanceId = required(environment, INSTANCE_NAMES[environmentId]);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new AdminClerkEnvironmentError();
    }
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    if (
      parsed.origin !== "https://dashboard.clerk.com" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname.length > 500 ||
      !pathSegments.includes(instanceId)
    ) {
      throw new AdminClerkEnvironmentError();
    }
    dashboards[environmentId] = parsed.toString();
  }
  if (dashboards.live === dashboards.test) {
    throw new AdminClerkEnvironmentError();
  }
  return dashboards[selected];
}

export function resolveAdminWebAppUrl(
  environment: AdminEnvironmentMap,
  selected: AdminEnvironmentId,
): string {
  const urls = {} as Record<AdminEnvironmentId, string>;
  for (const environmentId of ["live", "test"] as const) {
    const raw = required(environment, WEB_APP_NAMES[environmentId]);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new AdminClerkEnvironmentError();
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new AdminClerkEnvironmentError();
    }
    urls[environmentId] = parsed.origin;
  }
  if (urls.live === urls.test) throw new AdminClerkEnvironmentError();
  if (urls.live !== "https://skitza.app") throw new AdminClerkEnvironmentError();
  return urls[selected];
}
