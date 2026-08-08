export type SongDeletionErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "DELETE_SONG_REQUIRED"
  | "INTEGRITY_ERROR";

export class SongDeletionError extends Error {
  constructor(
    readonly code: SongDeletionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SongDeletionError";
  }
}
