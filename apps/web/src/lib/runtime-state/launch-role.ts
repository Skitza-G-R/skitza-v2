import { roleChooserHref } from "~/server/auth/post-sign-in";
import type {
  UserAccountMemberships,
  UserRole,
} from "~/server/auth/role";

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
      return "/sign-up";
  }
}

function signUpRuntimeHref(requestedHref: string | null): string {
  if (!requestedHref) return "/sign-up";
  return `/sign-up?${new URLSearchParams({
    redirect_url: requestedHref,
  }).toString()}`;
}

/**
 * Membership-aware cold-launch routing.
 *
 * Runtime restoration has a deliberately tighter route/query allowlist than
 * normal post-sign-in deep links. Normalize the saved target here before it
 * reaches either sign-in or the dual-role chooser so an installed app can
 * resume a safe screen without restoring live transactional state.
 */
export function runtimeLaunchHrefForMemberships(
  memberships: UserAccountMemberships,
  requestedHref?: string | null,
): string {
  const artistTarget = requestedRuntimeHref("artist", requestedHref);
  const producerTarget = requestedRuntimeHref("producer", requestedHref);
  const safeTarget = artistTarget ?? producerTarget;
  const { primaryRole } = memberships;
  const hasProducerAccount =
    primaryRole.kind === "producer-complete" ||
    primaryRole.kind === "producer-incomplete";

  if (primaryRole.kind === "unauthenticated") {
    return signUpRuntimeHref(safeTarget);
  }

  if (hasProducerAccount && memberships.hasArtistAccount) {
    return roleChooserHref(safeTarget);
  }

  if (memberships.hasArtistAccount && !hasProducerAccount) {
    return artistTarget ?? "/artist";
  }

  return runtimeLaunchHrefForRole(primaryRole, producerTarget);
}
