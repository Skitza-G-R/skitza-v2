import { notFound } from "next/navigation";

import type { AdminEnvironmentId } from "~/server/environment";

export function requireRouteEnvironment(value: string): AdminEnvironmentId {
  if (value === "live" || value === "test") return value;
  notFound();
}
