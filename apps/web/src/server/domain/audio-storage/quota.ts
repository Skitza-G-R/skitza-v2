import { sql, type Db } from "@skitza/db";

import {
  AUDIO_STORAGE_FULL_MESSAGE,
  PRODUCER_AUDIO_STORAGE_LIMIT_BYTES,
  PRODUCER_AUDIO_STORAGE_WARNING_BYTES,
} from "~/lib/audio/storage-limits";

export type AudioStorageQuotaDb = Pick<Db, "execute">;

export type ProducerAudioStorageQuota = Readonly<{
  usedBytes: number;
  reservedBytes: number;
  committedBytes: number;
  availableBytes: number;
  limitBytes: number;
  warningBytes: number;
  isAtOrAboveWarning: boolean;
  isFull: boolean;
}>;

export type AudioStorageQuotaErrorCode = "LIMIT_EXCEEDED";

export class AudioStorageQuotaError extends Error {
  constructor(
    readonly code: AudioStorageQuotaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AudioStorageQuotaError";
  }
}

function assertByteCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid producer audio ${label}`);
  }
  return value;
}

function readDatabaseByteCount(value: number | string | undefined, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return assertByteCount(parsed, label);
}

export function buildProducerAudioStorageQuota(
  input: Readonly<{
    usedBytes: number;
    reservedBytes: number;
  }>,
): ProducerAudioStorageQuota {
  const usedBytes = assertByteCount(input.usedBytes, "used byte count");
  const reservedBytes = assertByteCount(input.reservedBytes, "reserved byte count");
  const committedBytes = assertByteCount(usedBytes + reservedBytes, "committed byte count");
  return {
    usedBytes,
    reservedBytes,
    committedBytes,
    availableBytes: Math.max(0, PRODUCER_AUDIO_STORAGE_LIMIT_BYTES - committedBytes),
    limitBytes: PRODUCER_AUDIO_STORAGE_LIMIT_BYTES,
    warningBytes: PRODUCER_AUDIO_STORAGE_WARNING_BYTES,
    isAtOrAboveWarning: committedBytes >= PRODUCER_AUDIO_STORAGE_WARNING_BYTES,
    isFull: committedBytes >= PRODUCER_AUDIO_STORAGE_LIMIT_BYTES,
  };
}

export function producerAudioStorageAdvisoryLockKey(producerId: string): string {
  return `producer-audio-storage:${producerId}`;
}

/**
 * Shared first lock for every operation that adds or removes producer audio.
 * Project and purchase locks, when needed, must be taken only after this one.
 */
export async function lockProducerAudioStorageQuota(
  tx: AudioStorageQuotaDb,
  producerId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${producerAudioStorageAdvisoryLockKey(producerId)}, 0))`,
  );
}

/**
 * Reads completed storage and both durable reservation systems in one SQL
 * statement, so a completion transition cannot be observed half-before and
 * half-after. A logical audio tombstone still counts until R2 deletion has
 * been confirmed in audio_storage_deleted_at.
 */
export async function readProducerAudioStorageQuota(
  db: AudioStorageQuotaDb,
  producerId: string,
): Promise<ProducerAudioStorageQuota> {
  const result = await db.execute<{
    usedBytes: number | string;
    reservedBytes: number | string;
  }>(sql`
    select
      coalesce((
        select sum(tv."size_bytes")
        from "track_versions" tv
        where tv."producer_id" = ${producerId}
          and tv."size_bytes" is not null
          and tv."audio_storage_deleted_at" is null
      ), 0)::bigint as "usedBytes",
      (
        coalesce((
          select sum(tv."pending_audio_size_bytes")
          from "track_versions" tv
          where tv."producer_id" = ${producerId}
            and tv."pending_audio_size_bytes" is not null
        ), 0)
        + coalesce((
          select sum(fvi."audio_size_bytes")
          from "first_version_upload_intents" fvi
          where fvi."producer_id" = ${producerId}
            and fvi."staging_sealed_at" is null
        ), 0)
      )::bigint as "reservedBytes"
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Producer audio storage usage could not be read");
  return buildProducerAudioStorageQuota({
    usedBytes: readDatabaseByteCount(row.usedBytes, "used byte count"),
    reservedBytes: readDatabaseByteCount(row.reservedBytes, "reserved byte count"),
  });
}

/** Must be called while the producer audio-storage advisory lock is held. */
export async function assertProducerAudioStorageAvailable(
  tx: AudioStorageQuotaDb,
  producerId: string,
  requestedBytes: number,
): Promise<ProducerAudioStorageQuota> {
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0) {
    throw new Error("Invalid producer audio reservation byte count");
  }
  const quota = await readProducerAudioStorageQuota(tx, producerId);
  if (quota.committedBytes + requestedBytes > quota.limitBytes) {
    throw new AudioStorageQuotaError("LIMIT_EXCEEDED", AUDIO_STORAGE_FULL_MESSAGE);
  }
  return quota;
}
