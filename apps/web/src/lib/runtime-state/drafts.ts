import {
  readRuntimeState,
  removeRuntimeState,
  runtimeScope,
  writeRuntimeState,
  type ProducerDisplayNameDraft,
  type RuntimeRole,
  type RuntimeTextDraft,
  type StorageLike,
} from "./runtime-state";

export type RuntimeTextDraftSlot = "producer.song-comment-draft" | "artist.song-comment-draft";

const DISPLAY_NAME_DRAFT_ROUTE = "/dashboard/settings?section=profile";

let runtimeDraftFlushGeneration = 0;

export interface PendingRuntimeDraftFlush {
  readonly scopeKey: string;
  readonly generation: number;
  readonly write: () => boolean;
}

export interface RuntimeDraftLifecycleTarget {
  addEventListener(type: "pagehide", listener: () => void): void;
  removeEventListener(type: "pagehide", listener: () => void): void;
}

export function createRuntimeDraftFlush(
  scopeKey: string,
  write: () => boolean,
): PendingRuntimeDraftFlush {
  return {
    scopeKey,
    generation: runtimeDraftFlushGeneration,
    write,
  };
}

export function flushRuntimeDraftForScope(
  pending: PendingRuntimeDraftFlush | null,
  activeScopeKey: string | null,
): boolean {
  if (
    !pending ||
    !activeScopeKey ||
    pending.scopeKey !== activeScopeKey ||
    pending.generation !== runtimeDraftFlushGeneration
  ) {
    return false;
  }
  return pending.write();
}

export function flushRuntimeDraftOnScopeTransition(
  pending: PendingRuntimeDraftFlush | null,
  previousScopeKey: string | null,
  nextScopeKey: string | null,
): boolean {
  if (!previousScopeKey || previousScopeKey === nextScopeKey) return false;
  return flushRuntimeDraftForScope(pending, previousScopeKey);
}

export function invalidateRuntimeDraftFlushes(): void {
  runtimeDraftFlushGeneration += 1;
}

export function registerRuntimeDraftFlushLifecycle(
  target: RuntimeDraftLifecycleTarget,
  flush: () => void,
): () => void {
  const onPageHide = () => {
    flush();
  };
  target.addEventListener("pagehide", onPageHide);
  return () => {
    target.removeEventListener("pagehide", onPageHide);
    flush();
  };
}

export function readProducerDisplayNameDraft(
  storage: StorageLike,
  userId: string,
  producerId: string,
  now = Date.now(),
): ProducerDisplayNameDraft | null {
  const scope = runtimeScope(userId, "producer", producerId, DISPLAY_NAME_DRAFT_ROUTE);
  return scope
    ? readRuntimeState(storage, scope, "producer.settings.display-name-draft", now)
    : null;
}

export function writeProducerDisplayNameDraft(
  storage: StorageLike,
  userId: string,
  producerId: string,
  displayName: string,
  now = Date.now(),
): boolean {
  const scope = runtimeScope(userId, "producer", producerId, DISPLAY_NAME_DRAFT_ROUTE);
  return scope
    ? writeRuntimeState(
        storage,
        scope,
        "producer.settings.display-name-draft",
        { displayName },
        now,
      )
    : false;
}

export function clearProducerDisplayNameDraft(
  storage: StorageLike,
  userId: string,
  producerId: string,
): void {
  const scope = runtimeScope(userId, "producer", producerId, DISPLAY_NAME_DRAFT_ROUTE);
  if (scope) removeRuntimeState(storage, scope, "producer.settings.display-name-draft");
}

function roleForTextDraftSlot(slot: RuntimeTextDraftSlot): RuntimeRole {
  return slot === "producer.song-comment-draft" ? "producer" : "artist";
}

export function readRuntimeTextDraft(
  storage: StorageLike,
  input: {
    slot: RuntimeTextDraftSlot;
    userId: string;
    contextId: string;
    route: string;
    resourceId: string;
  },
  now = Date.now(),
): RuntimeTextDraft | null {
  const scope = runtimeScope(
    input.userId,
    roleForTextDraftSlot(input.slot),
    input.contextId,
    input.route,
  );
  if (!scope) return null;
  const draft = readRuntimeState(storage, scope, input.slot, now);
  return draft?.resourceId === input.resourceId ? draft : null;
}

export function writeRuntimeTextDraft(
  storage: StorageLike,
  input: {
    slot: RuntimeTextDraftSlot;
    userId: string;
    contextId: string;
    route: string;
    resourceId: string;
    body: string;
  },
  now = Date.now(),
): boolean {
  const scope = runtimeScope(
    input.userId,
    roleForTextDraftSlot(input.slot),
    input.contextId,
    input.route,
  );
  return scope
    ? writeRuntimeState(
        storage,
        scope,
        input.slot,
        { resourceId: input.resourceId, body: input.body },
        now,
      )
    : false;
}

export function clearRuntimeTextDraft(
  storage: StorageLike,
  input: {
    slot: RuntimeTextDraftSlot;
    userId: string;
    contextId: string;
    route: string;
  },
): void {
  const scope = runtimeScope(
    input.userId,
    roleForTextDraftSlot(input.slot),
    input.contextId,
    input.route,
  );
  if (scope) removeRuntimeState(storage, scope, input.slot);
}

export function clearRuntimeTextDraftForEmptyUserEdit(
  storage: StorageLike,
  input: {
    slot: RuntimeTextDraftSlot;
    userId: string;
    contextId: string;
    route: string;
    body: string;
  },
): boolean {
  if (input.body.trim().length > 0) return false;
  clearRuntimeTextDraft(storage, {
    slot: input.slot,
    userId: input.userId,
    contextId: input.contextId,
    route: input.route,
  });
  return true;
}
