import type { JoinIntentAction } from "~/server/auth/join-intent";
import { ProjectOwnershipDomainError } from "~/server/domain/project-ownership/service";

export const JOIN_ACCOUNT_CONFLICT = "account-conflict";

export function isJoinAccountConflict(error: unknown): error is ProjectOwnershipDomainError {
  return error instanceof ProjectOwnershipDomainError && error.code === "OWNER_CONFLICT";
}

export function joinAccountConflictHref(slug: string, action: JoinIntentAction): string {
  const query = new URLSearchParams({
    action,
    problem: JOIN_ACCOUNT_CONFLICT,
  });
  return `/join/${encodeURIComponent(slug)}/continue?${query.toString()}`;
}
