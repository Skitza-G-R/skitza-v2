import { createDb } from "@skitza/db";

import { resolveAdminEnvironment } from "~/server/environment";
import { resolveAdminClerkDashboardUrl } from "./clerk-environment";
import { createRegisteredUserRepository } from "./repository";

export function createRegisteredUserRuntime(
  selectedEnvironment: string | undefined,
) {
  const resolved = resolveAdminEnvironment(process.env, selectedEnvironment);
  return {
    environment: resolved.publicContext.id,
    providerDashboardUrl: resolveAdminClerkDashboardUrl(
      process.env,
      resolved.publicContext.id,
    ),
    repository: createRegisteredUserRepository(
      createDb(resolved.databaseUrl),
      resolved.publicContext.id,
    ),
  };
}
