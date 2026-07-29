import type { UserRole } from "~/server/auth/role";

import { normalizeRuntimeHref } from "./runtime-state";

function requestedRuntimeHref(
  role: "artist" | "producer",
  requestedHref: string | null | undefined,
): string | null {
  if (!requestedHref) return null;
  return normalizeRuntimeHref(requestedHref, role);
}

export function runtimeLaunchHrefForRole(
  role: UserRole,
  requestedHref?: string | null,
): string {
  switch (role.kind) {
    case "artist":
      return requestedRuntimeHref("artist", requestedHref) ?? "/artist";
    case "producer-complete":
      return requestedRuntimeHref("producer", requestedHref) ?? "/dashboard";
    case "producer-incomplete":
    case "orphan":
      return "/onboarding";
    case "unauthenticated":
      return "/sign-in";
  }
}
