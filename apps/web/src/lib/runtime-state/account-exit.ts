import { invalidateRuntimeDraftFlushes } from "./drafts";
import {
  clearRuntimeStateForUser,
  getBrowserRuntimeStorage,
  type StorageLike,
} from "./runtime-state";

const accountPrivateWriteGenerations = new Map<string, number>();

export interface AccountPrivateRuntimeQueryTarget {
  readonly location: {
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
  };
  readonly history: {
    replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  };
}

export interface AccountPrivateWriteGeneration {
  readonly userId: string;
  readonly generation: number;
}

export function captureAccountPrivateWriteGeneration(
  userId: string,
): AccountPrivateWriteGeneration {
  return {
    userId,
    generation: accountPrivateWriteGenerations.get(userId) ?? 0,
  };
}

export function isAccountPrivateWriteGenerationCurrent(
  captured: AccountPrivateWriteGeneration,
): boolean {
  return (accountPrivateWriteGenerations.get(captured.userId) ?? 0) === captured.generation;
}

function invalidateAccountPrivateWriteGeneration(userId: string): void {
  accountPrivateWriteGenerations.set(
    userId,
    (accountPrivateWriteGenerations.get(userId) ?? 0) + 1,
  );
}

function getBrowserRuntimeQueryTarget(): AccountPrivateRuntimeQueryTarget | null {
  if (typeof window === "undefined") return null;
  const target = window as Partial<AccountPrivateRuntimeQueryTarget>;
  if (!target.location || !target.history) return null;
  return {
    location: target.location,
    history: target.history,
  };
}

export function clearAccountPrivateRuntimeQuery(
  target: AccountPrivateRuntimeQueryTarget | null = getBrowserRuntimeQueryTarget(),
): boolean {
  if (!target || target.location.pathname !== "/dashboard/store") return false;

  const params = new URLSearchParams(target.location.search);
  if (!params.has("filter") && !params.has("search")) return false;

  params.delete("filter");
  params.delete("search");
  const nextSearch = params.toString();
  const nextHref = `${target.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${
    target.location.hash
  }`;

  try {
    target.history.replaceState(null, "", nextHref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronously removes one account's private continuity state. The browser
 * storage fallback lets root/public sign-out controls use the same privacy
 * boundary without requiring a RuntimeStateProvider.
 */
export function clearAccountPrivateRuntimeState(
  userId: string,
  storage: StorageLike | null = getBrowserRuntimeStorage(),
  queryTarget: AccountPrivateRuntimeQueryTarget | null = getBrowserRuntimeQueryTarget(),
): number {
  invalidateRuntimeDraftFlushes();
  invalidateAccountPrivateWriteGeneration(userId);
  clearAccountPrivateRuntimeQuery(queryTarget);
  return storage ? clearRuntimeStateForUser(storage, userId) : 0;
}
