import type { AdminEnvironmentMap } from "~/server/environment";

// SK-288 — one Clerk account, one web app. The ADMIN_TEST_* twins are gone
// along with the Live/Test split; every check that guarded a single binding
// stays, only the live-versus-test comparisons went with them.

const SECRET_NAME = "ADMIN_LIVE_CLERK_SECRET_KEY";
const INSTANCE_NAME = "ADMIN_LIVE_CLERK_INSTANCE_ID";
const DASHBOARD_NAME = "ADMIN_LIVE_CLERK_DASHBOARD_URL";
const WEB_APP_NAME = "ADMIN_LIVE_WEB_APP_URL";

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
): Readonly<{ instanceId: string; secretKey: string }> {
  const secretKey = required(environment, SECRET_NAME);
  const instanceId = required(environment, INSTANCE_NAME);

  if (!/^sk_live_/.test(secretKey) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(instanceId)) {
    throw new AdminClerkEnvironmentError();
  }

  return { instanceId, secretKey };
}

export function resolveAdminClerkDashboardUrl(environment: AdminEnvironmentMap): string {
  const raw = required(environment, DASHBOARD_NAME);
  const instanceId = required(environment, INSTANCE_NAME);

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

  return parsed.toString();
}

export function resolveAdminWebAppUrl(environment: AdminEnvironmentMap): string {
  const raw = required(environment, WEB_APP_NAME);

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

  if (parsed.origin !== "https://skitza.app") throw new AdminClerkEnvironmentError();
  return parsed.origin;
}
