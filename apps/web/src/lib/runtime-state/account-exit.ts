import { invalidateRuntimeDraftFlushes } from "./drafts";
import {
  clearRuntimeStateForUser,
  getBrowserRuntimeStorage,
  type StorageLike,
} from "./runtime-state";

const accountPrivateWriteGenerations = new Map<string, number>();

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

/**
 * Synchronously removes one account's private continuity state. The browser
 * storage fallback lets root/public sign-out controls use the same privacy
 * boundary without requiring a RuntimeStateProvider.
 */
export function clearAccountPrivateRuntimeState(
  userId: string,
  storage: StorageLike | null = getBrowserRuntimeStorage(),
): number {
  invalidateRuntimeDraftFlushes();
  invalidateAccountPrivateWriteGeneration(userId);
  return storage ? clearRuntimeStateForUser(storage, userId) : 0;
}
