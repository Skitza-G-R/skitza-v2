import { audioNotFoundResponse } from "~/server/domain/audio-delivery/route-errors";

/**
 * Retired by SK-98. Legacy portfolio rows copied one version's storage
 * identity and could therefore serve stale audio after a song changed. Keep
 * the old path as an explicit fail-closed tombstone so every previously
 * issued URL stops without consulting authentication, metadata, or storage.
 */
export function GET(): Response {
  return audioNotFoundResponse();
}
