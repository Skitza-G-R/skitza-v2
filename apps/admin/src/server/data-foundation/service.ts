import {
  canonicalFoundationDigest,
  safeFoundationMetadata,
  type FoundationEnvironment,
  type SafeFoundationMetadata,
} from "@skitza/db";

export const ADMIN_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

export type SensitiveRevealReason = "safety_issue" | "support_investigation";
export type SystemProblemState = "new" | "resolved" | "seen";
export type AdminSystemProblemState = SystemProblemState;

export type AdminDataFoundationErrorCode =
  | "IDEMPOTENCY_EXPIRED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "STATE_CONFLICT";

export class AdminDataFoundationError extends Error {
  readonly code: AdminDataFoundationErrorCode;

  constructor(code: AdminDataFoundationErrorCode) {
    super(code);
    this.name = "AdminDataFoundationError";
    this.code = code;
  }
}

type AdminWriteCommand = Readonly<{
  action: "sensitive_content.reveal" | "support_note.create" | "system_problem.update";
  actorClerkUserId: string;
  environment: FoundationEnvironment;
  occurredAt: Date;
  operationDigest: string;
  operationKey: string;
  safeAfterState: SafeFoundationMetadata | null;
  safeBeforeState: SafeFoundationMetadata | null;
}>;

export type AddSupportNoteCommand = AdminWriteCommand &
  Readonly<{
    action: "support_note.create";
    body: string;
    targetId: string;
    targetType: string;
  }>;

export type RecordSensitiveRevealCommand = AdminWriteCommand &
  Readonly<{
    action: "sensitive_content.reveal";
    contentKind: string;
    reason: SensitiveRevealReason;
    targetId: string;
    targetType: string;
  }>;

export type TransitionSystemProblemCommand = AdminWriteCommand &
  Readonly<{
    action: "system_problem.update";
    privateNote?: string | null;
    problemId: string;
    state: AdminSystemProblemState;
  }>;

export type AdminDataFoundationRepository = Readonly<{
  addSupportNote(
    command: AddSupportNoteCommand,
  ): Promise<Readonly<{ id: string; replayed: boolean }>>;
  purgeExpiredAdminHistory(input: { environment: FoundationEnvironment }): Promise<number>;
  recordSensitiveReveal(
    command: RecordSensitiveRevealCommand,
  ): Promise<Readonly<{ id: string; replayed: boolean }>>;
  transitionSystemProblem(command: TransitionSystemProblemCommand): Promise<
    Readonly<{
      id: string;
      replayed: boolean;
      state: SystemProblemState;
    }>
  >;
}>;

export type AddSupportNoteInput = Readonly<{
  actorClerkUserId: string;
  body: string;
  environment: FoundationEnvironment;
  operationKey: string;
  targetId: string;
  targetType: string;
}>;

export type RecordSensitiveRevealInput = Readonly<{
  actorClerkUserId: string;
  contentKind: string;
  environment: FoundationEnvironment;
  operationKey: string;
  reason: SensitiveRevealReason;
  targetId: string;
  targetType: string;
}>;

export type TransitionSystemProblemInput = Readonly<{
  actorClerkUserId: string;
  environment: FoundationEnvironment;
  operationKey: string;
  privateNote?: string | null;
  problemId: string;
  state: AdminSystemProblemState;
}>;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_KIND_PATTERN = /^[a-z][a-z0-9_.-]{0,99}$/;
const REVEAL_REASONS = new Set<SensitiveRevealReason>(["safety_issue", "support_investigation"]);
const PROBLEM_STATES = new Set<AdminSystemProblemState>(["new", "resolved", "seen"]);

function stop(code: AdminDataFoundationErrorCode): never {
  throw new AdminDataFoundationError(code);
}

function requiredIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) return stop("INVALID_INPUT");
  return value;
}

function requiredUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) return stop("INVALID_INPUT");
  return value.toLowerCase();
}

function requiredText(value: string, maxLength: number): string {
  if (value.length > maxLength || value.trim().length === 0 || value.includes("\u0000")) {
    return stop("INVALID_INPUT");
  }
  return value;
}

function exactEnvironment(value: string): FoundationEnvironment {
  if (value !== "live" && value !== "test") return stop("INVALID_INPUT");
  return value;
}

function requiredTimestamp(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return stop("INVALID_INPUT");
  }
  return value;
}

function digestIntent(
  action: AdminWriteCommand["action"],
  input: Readonly<Record<string, unknown>>,
): string {
  return canonicalFoundationDigest({ action, ...input });
}

function baseCommand(
  input: Readonly<{
    action: AdminWriteCommand["action"];
    actorClerkUserId: string;
    environment: FoundationEnvironment;
    intent: Readonly<Record<string, unknown>>;
    now: Date;
    operationKey: string;
    safeAfterState: SafeFoundationMetadata | null;
    safeBeforeState: SafeFoundationMetadata | null;
  }>,
): AdminWriteCommand {
  const environment = exactEnvironment(input.environment);
  const actorClerkUserId = requiredIdentifier(input.actorClerkUserId);
  const operationKey = requiredIdentifier(input.operationKey);
  const occurredAt = requiredTimestamp(input.now);
  return {
    action: input.action,
    actorClerkUserId,
    environment,
    occurredAt,
    operationDigest: digestIntent(input.action, {
      environment,
      actorClerkUserId,
      operationKey,
      ...input.intent,
    }),
    operationKey,
    safeAfterState: input.safeAfterState,
    safeBeforeState: input.safeBeforeState,
  };
}

export function isAdminHistoryExpired(occurredAt: Date, now: Date): boolean {
  return occurredAt.getTime() < now.getTime() - ADMIN_HISTORY_RETENTION_MS;
}

export function isAdminSystemProblemTransitionAllowed(
  current: SystemProblemState,
  requested: AdminSystemProblemState,
): boolean {
  switch (current) {
    case "new":
      return true;
    case "seen":
      return requested === "seen" || requested === "resolved";
    case "resolved":
      return requested === "resolved";
  }
}

export function createAdminDataFoundation(
  repository: AdminDataFoundationRepository,
  now: () => Date = () => new Date(),
) {
  async function purgeBeforeWrite(environment: FoundationEnvironment): Promise<void> {
    await repository.purgeExpiredAdminHistory({
      environment: exactEnvironment(environment),
    });
  }

  return Object.freeze({
    async addSupportNote(input: AddSupportNoteInput) {
      const environment = exactEnvironment(input.environment);
      const targetType = requiredIdentifier(input.targetType);
      const targetId = requiredIdentifier(input.targetId);
      const body = requiredText(input.body, 10_000);
      const safeAfterState = safeFoundationMetadata("admin_support_note", {
        noteCreated: true,
      });
      const command: AddSupportNoteCommand = {
        ...baseCommand({
          action: "support_note.create",
          actorClerkUserId: input.actorClerkUserId,
          environment,
          intent: { body, targetId, targetType },
          now: now(),
          operationKey: input.operationKey,
          safeAfterState,
          safeBeforeState: null,
        }),
        action: "support_note.create",
        body,
        targetId,
        targetType,
      };
      await purgeBeforeWrite(environment);
      return repository.addSupportNote(command);
    },

    async purgeExpiredAdminHistory(environment: FoundationEnvironment) {
      return repository.purgeExpiredAdminHistory({
        environment: exactEnvironment(environment),
      });
    },

    async recordSensitiveReveal(input: RecordSensitiveRevealInput) {
      const environment = exactEnvironment(input.environment);
      if (!REVEAL_REASONS.has(input.reason)) return stop("INVALID_INPUT");
      if (!CONTENT_KIND_PATTERN.test(input.contentKind)) {
        return stop("INVALID_INPUT");
      }
      const targetType = requiredIdentifier(input.targetType);
      const targetId = requiredIdentifier(input.targetId);
      const command: RecordSensitiveRevealCommand = {
        ...baseCommand({
          action: "sensitive_content.reveal",
          actorClerkUserId: input.actorClerkUserId,
          environment,
          intent: {
            contentKind: input.contentKind,
            reason: input.reason,
            targetId,
            targetType,
          },
          now: now(),
          operationKey: input.operationKey,
          safeAfterState: null,
          safeBeforeState: null,
        }),
        action: "sensitive_content.reveal",
        contentKind: input.contentKind,
        reason: input.reason,
        targetId,
        targetType,
      };
      await purgeBeforeWrite(environment);
      return repository.recordSensitiveReveal(command);
    },

    async transitionSystemProblem(input: TransitionSystemProblemInput) {
      const environment = exactEnvironment(input.environment);
      if (!PROBLEM_STATES.has(input.state)) return stop("INVALID_INPUT");
      const problemId = requiredUuid(input.problemId);
      const privateNote =
        input.privateNote === undefined
          ? undefined
          : input.privateNote === null
            ? null
            : requiredText(input.privateNote, 10_000);
      const privateNoteIntent: Readonly<{ privateNote?: string | null }> =
        privateNote === undefined ? {} : { privateNote };
      const safeAfterState = safeFoundationMetadata(
        "admin_system_problem",
        privateNote === undefined
          ? { state: input.state }
          : {
              hasPrivateNote: privateNote !== null,
              state: input.state,
            },
      );
      const command: TransitionSystemProblemCommand = {
        ...baseCommand({
          action: "system_problem.update",
          actorClerkUserId: input.actorClerkUserId,
          environment,
          intent: { ...privateNoteIntent, problemId, state: input.state },
          now: now(),
          operationKey: input.operationKey,
          safeAfterState,
          safeBeforeState: null,
        }),
        action: "system_problem.update",
        ...privateNoteIntent,
        problemId,
        state: input.state,
      };
      await purgeBeforeWrite(environment);
      return repository.transitionSystemProblem(command);
    },
  });
}
