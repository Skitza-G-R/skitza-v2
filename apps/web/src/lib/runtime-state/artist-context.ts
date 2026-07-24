import {
  ARTIST_CONTEXT_POINTER_CONTEXT_ID,
  readRuntimeState,
  runtimeScope,
  writeRuntimeState,
  type StorageLike,
} from "./runtime-state";

function artistContextPointerScope(userId: string) {
  return runtimeScope(
    userId,
    "artist",
    ARTIST_CONTEXT_POINTER_CONTEXT_ID,
    "/artist",
  );
}

export function resolveArtistRuntimeStudioContext(
  storage: StorageLike | null,
  userId: string,
  studioIds: readonly string[],
  requestedStudioId: string | null | undefined,
  now = Date.now(),
): string | null {
  const fallbackStudioId = studioIds[0] ?? null;

  if (requestedStudioId !== null && requestedStudioId !== undefined) {
    return studioIds.includes(requestedStudioId)
      ? requestedStudioId
      : fallbackStudioId;
  }
  if (!storage) return fallbackStudioId;

  const scope = artistContextPointerScope(userId);
  const pointer = scope
    ? readRuntimeState(storage, scope, "artist.last-studio-context", now)
    : null;
  return pointer && studioIds.includes(pointer.studioId)
    ? pointer.studioId
    : fallbackStudioId;
}

export function writeArtistRuntimeStudioContext(
  storage: StorageLike,
  userId: string,
  studioIds: readonly string[],
  studioId: string,
  now = Date.now(),
): boolean {
  if (!studioIds.includes(studioId)) return false;
  const scope = artistContextPointerScope(userId);
  return scope
    ? writeRuntimeState(
        storage,
        scope,
        "artist.last-studio-context",
        { studioId },
        now,
      )
    : false;
}
