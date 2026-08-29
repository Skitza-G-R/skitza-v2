import { createDb } from "@skitza/db";

import { resolveAdminEnvironment } from "~/server/environment";
import { resolveAdminClerkDashboardUrl } from "./clerk-environment";
import { createRegisteredUserRepository } from "./repository";

export function createRegisteredUserRuntime() {
  const resolved = resolveAdminEnvironment(process.env);
  return {
    environment: resolved.publicContext.id,
    providerDashboardUrl: resolveAdminClerkDashboardUrl(process.env),
    repository: createRegisteredUserRepository(
      createDb(resolved.databaseUrl),
      resolved.publicContext.id,
    ),
  };
}
