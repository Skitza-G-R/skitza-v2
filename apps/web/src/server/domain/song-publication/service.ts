import { createHash, randomUUID } from "node:crypto";

import {
  buildSongPublicPath,
  createSongPublicToken,
  hashSongPublicToken,
} from "./tokens";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_OPERATION_KEY_LENGTH = 200;

export type SongPublicAccessAction =
  | "link_published"
  | "link_reset"
  | "link_disabled"
  | "audio_deleted"
  | "portfolio_published"
  | "portfolio_unpublished";

export type SongPublicationTrackRecord = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  portfolioPublishedAt: Date | null;
}>;

export type SongPublicLinkRecord = Readonly<{
  id: string;
  trackId: string;
  purchaseId: string;
  producerId: string;
  tokenVersion: number;
  tokenHash: string;
  enabledAt: Date;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type SongPublicAccessAuditEvent = Readonly<{
  trackId: string;
  purchaseId: string;
  producerId: string;
  linkId: string | null;
  versionId: string | null;
  action: SongPublicAccessAction;
  sequence: number;
  tokenVersion: number | null;
  tokenHash: string | null;
  linkEnabled: boolean;
  portfolioPublished: boolean;
  remainingAudioCount: number;
  operationKey: string;
  operationDigest: string;
  changedByClerkUserId: string;
  changed: boolean;
  createdAt: Date;
}>;

/** The adapter must acquire one song-scoped write lock before returning this snapshot. */
export type SongPublicationSnapshot = Readonly<{
  track: SongPublicationTrackRecord;
  projectUpdatedAt: Date;
  link: SongPublicLinkRecord | null;
  remainingAudioCount: number;
  lastEventSequence: number;
  lastEventCreatedAt: Date | null;
}>;

export type SongPublicationAtomicScope = Readonly<{
  producerId: string;
  trackId: string;
}>;

export interface SongPublicationTransaction {
  loadSnapshot(): Promise<SongPublicationSnapshot | null>;
  findEventByOperationKey(operationKey: string): Promise<SongPublicAccessAuditEvent | null>;
  insertLink(input: SongPublicLinkRecord): Promise<SongPublicLinkRecord | null>;
  updateLink(input: {
    linkId: string;
    expectedTokenVersion: number;
    expectedDisabledAt: Date | null;
    next: SongPublicLinkRecord;
  }): Promise<SongPublicLinkRecord | null>;
  setPortfolioPublishedAt(input: {
    expectedPortfolioPublishedAt: Date | null;
    portfolioPublishedAt: Date | null;
    changedAt: Date;
  }): Promise<SongPublicationTrackRecord | null>;
  appendAuditEvent(event: SongPublicAccessAuditEvent): Promise<SongPublicAccessAuditEvent | null>;
}

/** `atomically` must roll back on error and serialize all writes for the scoped song. */
export interface SongPublicationRepository {
  atomically<T>(
    scope: SongPublicationAtomicScope,
    work: (transaction: SongPublicationTransaction) => Promise<T>,
  ): Promise<T>;
}

export type SongPublicationDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NO_STORED_AUDIO"
  | "LINK_NOT_LIVE"
  | "OPERATION_KEY_CONFLICT"
  | "CONCURRENT_CHANGE"
  | "INTEGRITY_ERROR";

export class SongPublicationDomainError extends Error {
  constructor(
    readonly code: SongPublicationDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SongPublicationDomainError";
  }
}

export type ProducerSongPublicationCommand = Readonly<{
  producerId: string;
  trackId: string;
  operationKey: string;
  changedByClerkUserId: string;
  occurredAt: Date;
}>;

export type SetPortfolioPublicCommand = ProducerSongPublicationCommand &
  Readonly<{ published: boolean }>;

export type SongPublicationOptions = Readonly<{
  tokenSecret: string;
  /** Injectable only so focused domain tests do not depend on random output. */
  createLinkId?: () => string;
}>;

export type SongPublicationState = Readonly<{
  trackId: string;
  purchaseId: string;
  producerId: string;
  linkId: string | null;
  linkEnabled: boolean;
  portfolioPublished: boolean;
  remainingAudioCount: number;
  tokenVersion: number | null;
  tokenHash: string | null;
  /** Never built for an absent or disabled link. */
  publicUrl: string | null;
}>;

export type SongPublicationMutationResult = Readonly<{
  state: SongPublicationState;
  event: SongPublicAccessAuditEvent;
  replayed: boolean;
}>;

type CommandSpec = Readonly<{
  action: Exclude<SongPublicAccessAction, "audio_deleted">;
  intent: Readonly<Record<string, boolean>>;
  mutate: (
    transaction: SongPublicationTransaction,
    snapshot: SongPublicationSnapshot,
    input: ProducerSongPublicationCommand,
    options: SongPublicationOptions,
  ) => Promise<Readonly<{ snapshot: SongPublicationSnapshot; changed: boolean }>>;
}>;

function domainError(code: SongPublicationDomainErrorCode, message: string): never {
  throw new SongPublicationDomainError(code, message);
}

function notFound(): never {
  domainError("NOT_FOUND", "The song publication target was not found");
}

function integrity(message: string): never {
  domainError("INTEGRITY_ERROR", message);
}

function requireIdentifier(value: string, label: string, maximum = 200): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value
  ) {
    domainError("INVALID_INPUT", `${label} is invalid`);
  }
  return value;
}

function requireDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    domainError("INVALID_INPUT", `${label} must be a valid date`);
  }
  return new Date(value);
}

function requireUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) integrity(`${label} is invalid`);
  return value;
}

function validStoredDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) integrity(`${label} is invalid`);
  return value;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function assertLinkRecord(link: SongPublicLinkRecord, track: SongPublicationTrackRecord): void {
  requireUuid(link.id, "The stored public link id");
  if (
    link.trackId !== track.id ||
    link.purchaseId !== track.purchaseId ||
    link.producerId !== track.producerId
  ) {
    integrity("The stored public link does not match its song owner");
  }
  if (!Number.isSafeInteger(link.tokenVersion) || link.tokenVersion <= 0) {
    integrity("The stored public link token version is invalid");
  }
  if (!HASH_PATTERN.test(link.tokenHash)) integrity("The stored public link token hash is invalid");
  validStoredDate(link.enabledAt, "The stored public link enabled time");
  validStoredDate(link.createdAt, "The stored public link creation time");
  validStoredDate(link.updatedAt, "The stored public link update time");
  if (link.disabledAt !== null) validStoredDate(link.disabledAt, "The stored public link disable time");
}

function ownedSnapshot(
  value: SongPublicationSnapshot | null,
  scope: SongPublicationAtomicScope,
): SongPublicationSnapshot {
  if (!value) notFound();
  const { track } = value;
  requireUuid(track.id, "The stored song id");
  requireUuid(track.purchaseId, "The stored purchase id");
  requireUuid(track.producerId, "The stored producer id");
  if (track.id !== scope.trackId || track.producerId !== scope.producerId) notFound();
  if (track.portfolioPublishedAt !== null) {
    validStoredDate(track.portfolioPublishedAt, "The stored portfolio publication time");
  }
  validStoredDate(value.projectUpdatedAt, "The stored song project update time");
  if (!Number.isSafeInteger(value.remainingAudioCount) || value.remainingAudioCount < 0) {
    integrity("The stored audio count is invalid");
  }
  if (!Number.isSafeInteger(value.lastEventSequence) || value.lastEventSequence < 0) {
    integrity("The public access event sequence is invalid");
  }
  if (value.lastEventCreatedAt !== null) {
    validStoredDate(value.lastEventCreatedAt, "The latest public access event time");
  }
  if ((value.lastEventSequence === 0) !== (value.lastEventCreatedAt === null)) {
    integrity("The public access event sequence and time do not match");
  }
  if (value.link) assertLinkRecord(value.link, track);
  return value;
}

/**
 * Request timestamps are captured before the song lock. Concurrent requests
 * may acquire that lock in a different order, so every committed state and
 * audit timestamp must advance from the latest locked value rather than move
 * backward to the request's earlier wall-clock time.
 */
function monotonicCommandInput(
  input: ProducerSongPublicationCommand,
  snapshot: SongPublicationSnapshot,
): ProducerSongPublicationCommand {
  const prior = [
    snapshot.projectUpdatedAt,
    snapshot.track.portfolioPublishedAt,
    snapshot.lastEventCreatedAt,
    snapshot.link?.enabledAt,
    snapshot.link?.disabledAt,
    snapshot.link?.createdAt,
    snapshot.link?.updatedAt,
  ];
  const occurredAtMs = prior.reduce(
    (latest, value) => (value ? Math.max(latest, value.getTime()) : latest),
    input.occurredAt.getTime(),
  );
  return { ...input, occurredAt: new Date(occurredAtMs) };
}

function requireStoredAudio(snapshot: SongPublicationSnapshot): void {
  if (snapshot.remainingAudioCount === 0) {
    domainError("NO_STORED_AUDIO", "A public song requires stored audio");
  }
}

export function songPublicationOperationDigest(input: Readonly<{
  action: Exclude<SongPublicAccessAction, "audio_deleted">;
  producerId: string;
  trackId: string;
  changedByClerkUserId: string;
  intent?: Readonly<Record<string, boolean>>;
}>): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        action: input.action,
        producerId: input.producerId,
        trackId: input.trackId,
        changedByClerkUserId: input.changedByClerkUserId,
        intent: input.intent ?? {},
      }),
      "utf8",
    )
    .digest("hex")}`;
}

function canonicalTokenForLink(
  link: SongPublicLinkRecord,
  tokenSecret: string,
): Readonly<{ token: string; tokenHash: string }> {
  const token = createSongPublicToken(tokenSecret, {
    linkId: link.id,
    tokenVersion: link.tokenVersion,
  });
  return { token, tokenHash: hashSongPublicToken(token) };
}

function stateFromSnapshot(
  snapshot: SongPublicationSnapshot,
  tokenSecret: string,
): SongPublicationState {
  const portfolioPublished = snapshot.track.portfolioPublishedAt !== null;
  if ((snapshot.link?.disabledAt === null || portfolioPublished) && snapshot.remainingAudioCount === 0) {
    integrity("Public song state exists without stored audio");
  }
  if (!snapshot.link) {
    return {
      trackId: snapshot.track.id,
      purchaseId: snapshot.track.purchaseId,
      producerId: snapshot.track.producerId,
      linkId: null,
      linkEnabled: false,
      portfolioPublished,
      remainingAudioCount: snapshot.remainingAudioCount,
      tokenVersion: null,
      tokenHash: null,
      publicUrl: null,
    };
  }

  const canonical = canonicalTokenForLink(snapshot.link, tokenSecret);
  if (canonical.tokenHash !== snapshot.link.tokenHash) {
    integrity("The stored public link token does not match its generation");
  }
  const linkEnabled = snapshot.link.disabledAt === null;
  return {
    trackId: snapshot.track.id,
    purchaseId: snapshot.track.purchaseId,
    producerId: snapshot.track.producerId,
    linkId: snapshot.link.id,
    linkEnabled,
    portfolioPublished,
    remainingAudioCount: snapshot.remainingAudioCount,
    tokenVersion: snapshot.link.tokenVersion,
    tokenHash: snapshot.link.tokenHash,
    publicUrl: linkEnabled ? buildSongPublicPath(canonical.token) : null,
  };
}

function auditEventFromState(
  state: SongPublicationState,
  input: ProducerSongPublicationCommand,
  action: Exclude<SongPublicAccessAction, "audio_deleted">,
  operationDigest: string,
  sequence: number,
  changed: boolean,
): SongPublicAccessAuditEvent {
  return {
    trackId: state.trackId,
    purchaseId: state.purchaseId,
    producerId: state.producerId,
    linkId: state.linkId,
    versionId: null,
    action,
    sequence,
    tokenVersion: state.tokenVersion,
    tokenHash: state.tokenHash,
    linkEnabled: state.linkEnabled,
    portfolioPublished: state.portfolioPublished,
    remainingAudioCount: state.remainingAudioCount,
    operationKey: input.operationKey,
    operationDigest,
    changedByClerkUserId: input.changedByClerkUserId,
    changed,
    createdAt: new Date(input.occurredAt),
  };
}

function assertAuditEvent(event: SongPublicAccessAuditEvent, snapshot: SongPublicationSnapshot): void {
  const actionIsValid = (
    [
      "link_published",
      "link_reset",
      "link_disabled",
      "audio_deleted",
      "portfolio_published",
      "portfolio_unpublished",
    ] satisfies readonly SongPublicAccessAction[]
  ).includes(event.action);
  const linkSnapshotIsValid =
    event.linkId === null
      ? event.tokenVersion === null && event.tokenHash === null && !event.linkEnabled
      : UUID_PATTERN.test(event.linkId) &&
        Number.isSafeInteger(event.tokenVersion) &&
        event.tokenVersion !== null &&
        event.tokenVersion > 0 &&
        event.tokenHash !== null &&
        HASH_PATTERN.test(event.tokenHash);
  if (
    event.trackId !== snapshot.track.id ||
    event.purchaseId !== snapshot.track.purchaseId ||
    event.producerId !== snapshot.track.producerId ||
    !actionIsValid ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence <= 0 ||
    !Number.isSafeInteger(event.remainingAudioCount) ||
    event.remainingAudioCount < 0 ||
    !linkSnapshotIsValid ||
    event.operationKey.length === 0 ||
    event.operationKey.trim() !== event.operationKey ||
    event.changedByClerkUserId.length === 0 ||
    event.changedByClerkUserId.trim() !== event.changedByClerkUserId ||
    typeof event.changed !== "boolean" ||
    !HASH_PATTERN.test(event.operationDigest) ||
    !(event.createdAt instanceof Date) ||
    Number.isNaN(event.createdAt.getTime())
  ) {
    integrity("The stored public access event is invalid");
  }
}

function sameAuditEvent(
  stored: SongPublicAccessAuditEvent,
  expected: SongPublicAccessAuditEvent,
): boolean {
  return (
    stored.trackId === expected.trackId &&
    stored.purchaseId === expected.purchaseId &&
    stored.producerId === expected.producerId &&
    stored.linkId === expected.linkId &&
    stored.versionId === expected.versionId &&
    stored.action === expected.action &&
    stored.sequence === expected.sequence &&
    stored.tokenVersion === expected.tokenVersion &&
    stored.tokenHash === expected.tokenHash &&
    stored.linkEnabled === expected.linkEnabled &&
    stored.portfolioPublished === expected.portfolioPublished &&
    stored.remainingAudioCount === expected.remainingAudioCount &&
    stored.operationKey === expected.operationKey &&
    stored.operationDigest === expected.operationDigest &&
    stored.changedByClerkUserId === expected.changedByClerkUserId &&
    stored.changed === expected.changed &&
    stored.createdAt.getTime() === expected.createdAt.getTime()
  );
}

function assertLinkWrite(
  stored: SongPublicLinkRecord | null,
  expected: SongPublicLinkRecord,
): SongPublicLinkRecord {
  if (!stored) domainError("CONCURRENT_CHANGE", "The public song state changed concurrently");
  if (
    stored.id !== expected.id ||
    stored.trackId !== expected.trackId ||
    stored.purchaseId !== expected.purchaseId ||
    stored.producerId !== expected.producerId ||
    stored.tokenVersion !== expected.tokenVersion ||
    stored.tokenHash !== expected.tokenHash ||
    !sameDate(stored.enabledAt, expected.enabledAt) ||
    !sameDate(stored.disabledAt, expected.disabledAt)
  ) {
    integrity("The public link write returned unexpected state");
  }
  return stored;
}

function withLink(
  snapshot: SongPublicationSnapshot,
  link: SongPublicLinkRecord,
): SongPublicationSnapshot {
  return { ...snapshot, link };
}

async function runCommand(
  repository: SongPublicationRepository,
  rawInput: ProducerSongPublicationCommand,
  options: SongPublicationOptions,
  spec: CommandSpec,
): Promise<SongPublicationMutationResult> {
  const input: ProducerSongPublicationCommand = {
    producerId: requireIdentifier(rawInput.producerId, "Producer id"),
    trackId: requireIdentifier(rawInput.trackId, "Song id"),
    operationKey: requireIdentifier(
      rawInput.operationKey,
      "Operation key",
      MAX_OPERATION_KEY_LENGTH,
    ),
    changedByClerkUserId: requireIdentifier(rawInput.changedByClerkUserId, "Actor id"),
    occurredAt: requireDate(rawInput.occurredAt, "Operation time"),
  };
  const scope = { producerId: input.producerId, trackId: input.trackId };
  const operationDigest = songPublicationOperationDigest({
    action: spec.action,
    producerId: input.producerId,
    trackId: input.trackId,
    changedByClerkUserId: input.changedByClerkUserId,
    intent: spec.intent,
  });

  return repository.atomically(scope, async (transaction) => {
    const initial = ownedSnapshot(await transaction.loadSnapshot(), scope);
    const existing = await transaction.findEventByOperationKey(input.operationKey);
    if (existing) {
      assertAuditEvent(existing, initial);
      if (
        existing.operationKey !== input.operationKey ||
        existing.operationDigest !== operationDigest ||
        existing.action !== spec.action
      ) {
        domainError(
          "OPERATION_KEY_CONFLICT",
          "This operation key already belongs to a different public song command",
        );
      }
      return {
        state: stateFromSnapshot(initial, options.tokenSecret),
        event: existing,
        replayed: true,
      };
    }

    const effectiveInput = monotonicCommandInput(input, initial);
    const mutation = await spec.mutate(transaction, initial, effectiveInput, options);
    const state = stateFromSnapshot(mutation.snapshot, options.tokenSecret);
    const sequence = initial.lastEventSequence + 1;
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      integrity("The next public access event sequence is invalid");
    }
    const expectedEvent = auditEventFromState(
      state,
      effectiveInput,
      spec.action,
      operationDigest,
      sequence,
      mutation.changed,
    );
    const storedEvent = await transaction.appendAuditEvent(expectedEvent);
    if (!storedEvent) {
      domainError("CONCURRENT_CHANGE", "The public song state changed concurrently");
    }
    assertAuditEvent(storedEvent, mutation.snapshot);
    if (!sameAuditEvent(storedEvent, expectedEvent)) {
      integrity("The public access event was not stored immutably");
    }
    return { state, event: storedEvent, replayed: false };
  });
}

async function publishMutation(
  transaction: SongPublicationTransaction,
  snapshot: SongPublicationSnapshot,
  input: ProducerSongPublicationCommand,
  options: SongPublicationOptions,
): Promise<Readonly<{ snapshot: SongPublicationSnapshot; changed: boolean }>> {
  requireStoredAudio(snapshot);
  if (!snapshot.link) {
    const linkId = options.createLinkId ? options.createLinkId() : randomUUID();
    requireUuid(linkId, "The generated public link id");
    const tokenVersion = 1;
    const token = createSongPublicToken(options.tokenSecret, { linkId, tokenVersion });
    const link: SongPublicLinkRecord = {
      id: linkId,
      trackId: snapshot.track.id,
      purchaseId: snapshot.track.purchaseId,
      producerId: snapshot.track.producerId,
      tokenVersion,
      tokenHash: hashSongPublicToken(token),
      enabledAt: new Date(input.occurredAt),
      disabledAt: null,
      createdAt: new Date(input.occurredAt),
      updatedAt: new Date(input.occurredAt),
    };
    return {
      snapshot: withLink(snapshot, assertLinkWrite(await transaction.insertLink(link), link)),
      changed: true,
    };
  }
  if (snapshot.link.disabledAt === null) return { snapshot, changed: false };

  const tokenVersion = snapshot.link.tokenVersion + 1;
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion <= 0) {
    integrity("The public link token generation cannot advance");
  }
  const token = createSongPublicToken(options.tokenSecret, {
    linkId: snapshot.link.id,
    tokenVersion,
  });
  const next: SongPublicLinkRecord = {
    ...snapshot.link,
    tokenVersion,
    tokenHash: hashSongPublicToken(token),
    enabledAt: new Date(input.occurredAt),
    disabledAt: null,
    updatedAt: new Date(input.occurredAt),
  };
  const stored = await transaction.updateLink({
    linkId: snapshot.link.id,
    expectedTokenVersion: snapshot.link.tokenVersion,
    expectedDisabledAt: snapshot.link.disabledAt,
    next,
  });
  return { snapshot: withLink(snapshot, assertLinkWrite(stored, next)), changed: true };
}

async function resetMutation(
  transaction: SongPublicationTransaction,
  snapshot: SongPublicationSnapshot,
  input: ProducerSongPublicationCommand,
  options: SongPublicationOptions,
): Promise<Readonly<{ snapshot: SongPublicationSnapshot; changed: boolean }>> {
  requireStoredAudio(snapshot);
  if (!snapshot.link || snapshot.link.disabledAt !== null) {
    domainError("LINK_NOT_LIVE", "The public song link is not live");
  }
  const tokenVersion = snapshot.link.tokenVersion + 1;
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion <= 0) {
    integrity("The public link token generation cannot advance");
  }
  const token = createSongPublicToken(options.tokenSecret, {
    linkId: snapshot.link.id,
    tokenVersion,
  });
  const next: SongPublicLinkRecord = {
    ...snapshot.link,
    tokenVersion,
    tokenHash: hashSongPublicToken(token),
    updatedAt: new Date(input.occurredAt),
  };
  const stored = await transaction.updateLink({
    linkId: snapshot.link.id,
    expectedTokenVersion: snapshot.link.tokenVersion,
    expectedDisabledAt: null,
    next,
  });
  return { snapshot: withLink(snapshot, assertLinkWrite(stored, next)), changed: true };
}

async function disableMutation(
  transaction: SongPublicationTransaction,
  snapshot: SongPublicationSnapshot,
  input: ProducerSongPublicationCommand,
): Promise<Readonly<{ snapshot: SongPublicationSnapshot; changed: boolean }>> {
  if (!snapshot.link) domainError("LINK_NOT_LIVE", "The public song link is not live");
  if (snapshot.link.disabledAt !== null) return { snapshot, changed: false };
  const next: SongPublicLinkRecord = {
    ...snapshot.link,
    disabledAt: new Date(input.occurredAt),
    updatedAt: new Date(input.occurredAt),
  };
  const stored = await transaction.updateLink({
    linkId: snapshot.link.id,
    expectedTokenVersion: snapshot.link.tokenVersion,
    expectedDisabledAt: null,
    next,
  });
  return { snapshot: withLink(snapshot, assertLinkWrite(stored, next)), changed: true };
}

function portfolioMutation(published: boolean): CommandSpec["mutate"] {
  return async (transaction, snapshot, input) => {
    if (published) requireStoredAudio(snapshot);
    const currentlyPublished = snapshot.track.portfolioPublishedAt !== null;
    if (currentlyPublished === published) return { snapshot, changed: false };
    const nextPublishedAt = published ? new Date(input.occurredAt) : null;
    const track = await transaction.setPortfolioPublishedAt({
      expectedPortfolioPublishedAt: snapshot.track.portfolioPublishedAt,
      portfolioPublishedAt: nextPublishedAt,
      changedAt: new Date(input.occurredAt),
    });
    if (!track) domainError("CONCURRENT_CHANGE", "The public song state changed concurrently");
    if (
      track.id !== snapshot.track.id ||
      track.purchaseId !== snapshot.track.purchaseId ||
      track.producerId !== snapshot.track.producerId ||
      !sameDate(track.portfolioPublishedAt, nextPublishedAt)
    ) {
      integrity("The portfolio publication write returned unexpected state");
    }
    return { snapshot: { ...snapshot, track }, changed: true };
  };
}

export function publishSongPublicLink(
  repository: SongPublicationRepository,
  input: ProducerSongPublicationCommand,
  options: SongPublicationOptions,
): Promise<SongPublicationMutationResult> {
  return runCommand(repository, input, options, {
    action: "link_published",
    intent: {},
    mutate: publishMutation,
  });
}

export function resetSongPublicLink(
  repository: SongPublicationRepository,
  input: ProducerSongPublicationCommand,
  options: SongPublicationOptions,
): Promise<SongPublicationMutationResult> {
  return runCommand(repository, input, options, {
    action: "link_reset",
    intent: {},
    mutate: resetMutation,
  });
}

export function disableSongPublicLink(
  repository: SongPublicationRepository,
  input: ProducerSongPublicationCommand,
  options: SongPublicationOptions,
): Promise<SongPublicationMutationResult> {
  return runCommand(repository, input, options, {
    action: "link_disabled",
    intent: {},
    mutate: disableMutation,
  });
}

export function setPortfolioPublic(
  repository: SongPublicationRepository,
  input: SetPortfolioPublicCommand,
  options: SongPublicationOptions,
): Promise<SongPublicationMutationResult> {
  if (typeof input.published !== "boolean") {
    domainError("INVALID_INPUT", "Portfolio publication state must be boolean");
  }
  return runCommand(repository, input, options, {
    action: input.published ? "portfolio_published" : "portfolio_unpublished",
    intent: { published: input.published },
    mutate: portfolioMutation(input.published),
  });
}
