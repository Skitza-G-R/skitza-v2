import { invalidateRuntimeDraftFlushes } from "./drafts";
import {
  clearRuntimeStateForUser,
  getBrowserRuntimeStorage,
  type StorageLike,
} from "./runtime-state";

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
  return storage ? clearRuntimeStateForUser(storage, userId) : 0;
}
