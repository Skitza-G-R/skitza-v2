import type { JoinContinuationAction } from "~/server/auth/join-intent";
import { ProjectOwnershipDomainError } from "~/server/domain/project-ownership/service";

import { JoinContinuationError } from "./join-continuation";

export const JOIN_ACCOUNT_CONFLICT = "account-conflict";
export const JOIN_UNVERIFIED_EMAIL = "unverified-email";
export const JOIN_CONNECTION_PENDING = "connection-pending";

export type JoinRetryProblem = typeof JOIN_UNVERIFIED_EMAIL | typeof JOIN_CONNECTION_PENDING;

export function isJoinAccountConflict(error: unknown): error is ProjectOwnershipDomainError {
  return error instanceof ProjectOwnershipDomainError && error.code === "OWNER_CONFLICT";
}

export function joinAccountConflictHref(
  slug: string,
  action: JoinContinuationAction,
  offerId?: string,
): string {
  const query = new URLSearchParams({
    action,
    problem: JOIN_ACCOUNT_CONFLICT,
  });
  if (action === "offer" && offerId) query.set("offerId", offerId);
  return `/join/${encodeURIComponent(slug)}/continue?${query.toString()}`;
}

export function joinRetryProblem(error: unknown): JoinRetryProblem | null {
  if (!(error instanceof JoinContinuationError)) return null;
  if (error.code === "UNVERIFIED_EMAIL") return JOIN_UNVERIFIED_EMAIL;
  if (error.code === "CONNECTION_NOT_CONFIRMED") {
    return JOIN_CONNECTION_PENDING;
  }
  return null;
}

export function joinRetryHref(
  slug: string,
  action: JoinContinuationAction,
  problem: JoinRetryProblem,
  offerId?: string,
): string {
  const query = new URLSearchParams({ action, problem });
  if (action === "offer" && offerId) query.set("offerId", offerId);
  return `/join/${encodeURIComponent(slug)}/continue?${query.toString()}`;
}
