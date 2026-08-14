import { z, type RefinementCtx } from "zod";

import {
  ACCOUNT_CLOSURE_TASKS,
  AccountClosureError,
  applyAccountClosureLegalHold,
  finishManualAccountClosureTask,
  openAccountClosureRequest,
  recoverStaleAccountClosureTask,
  releaseAccountClosureLegalHold,
  resumeAutomatedAccountClosure,
  startManualAccountClosureTask,
  verifyAccountClosureRequest,
  type AccountClosureAutomation,
  type AccountClosureRequestRecord,
  type AccountClosureStore,
  type AccountClosureTaskRecord,
} from "~/server/identity/account-closure";

import { AccountClosureOperatorSafetyError } from "./environment";

export const MANUAL_ACCOUNT_CLOSURE_TASKS = [
  "clerk_account_delete",
  "account_profile_deidentification",
  "storage_review_and_cleanup",
  "retained_record_review",
  "diagnostic_provider_cleanup",
  "backup_expiry_tracking",
] as const;

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const requestId = z.string().uuid();
const operationKey = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((value) => !value.includes("\u0000"));
const evidenceRef = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes("\u0000"));

const inspectCommand = z
  .object({
    command: z.literal("inspect"),
    requestId,
  })
  .strict();

const openCommand = z
  .object({
    command: z.literal("open"),
    clerkUserId: identifier,
    requesterEmail: z.string().trim().email().max(320),
    operationKey,
  })
  .strict();

const verifyCommand = z
  .object({
    command: z.literal("verify"),
    requestId,
    operationKey,
  })
  .strict();

const resumeAutomatedCommand = z
  .object({
    command: z.literal("resume-automated"),
    requestId,
    operationKey,
  })
  .strict();

const manualProviderIdentity = {
  clerkInstanceId: identifier.optional(),
  providerClerkUserId: identifier.optional(),
} as const;

function validateManualProviderIdentity(
  value: {
    kind: (typeof MANUAL_ACCOUNT_CLOSURE_TASKS)[number];
    clerkInstanceId?: string | undefined;
    providerClerkUserId?: string | undefined;
  },
  context: RefinementCtx,
): void {
  const providerFieldsPresent =
    value.clerkInstanceId !== undefined && value.providerClerkUserId !== undefined;
  if (
    (value.kind === "clerk_account_delete" && !providerFieldsPresent) ||
    (value.kind !== "clerk_account_delete" &&
      (value.clerkInstanceId !== undefined || value.providerClerkUserId !== undefined))
  ) {
    context.addIssue({ code: "custom", message: "invalid provider identity proof" });
  }
}

const startManualCommand = z
  .object({
    command: z.literal("start-manual"),
    requestId,
    kind: z.enum(MANUAL_ACCOUNT_CLOSURE_TASKS),
    operationKey,
    ...manualProviderIdentity,
  })
  .strict()
  .superRefine(validateManualProviderIdentity);

const finishManualCommand = z
  .object({
    command: z.literal("finish-manual"),
    requestId,
    kind: z.enum(MANUAL_ACCOUNT_CLOSURE_TASKS),
    attempt: z.number().int().positive(),
    operationKey,
    evidenceRef,
    outcome: z.enum(["succeeded", "not_applicable"]),
    ...manualProviderIdentity,
  })
  .strict()
  .superRefine(validateManualProviderIdentity);

const recoverStaleTaskCommand = z
  .object({
    command: z.literal("recover-stale-task"),
    requestId,
    kind: z.enum(ACCOUNT_CLOSURE_TASKS),
    operationKey,
    evidenceRef,
  })
  .strict();

const setLegalHoldCommand = z
  .object({
    command: z.literal("legal-hold"),
    action: z.literal("set"),
    requestId,
    operationKey,
    reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/),
  })
  .strict();

const releaseLegalHoldCommand = z
  .object({
    command: z.literal("legal-hold"),
    action: z.literal("release"),
    requestId,
    operationKey,
  })
  .strict();

const accountClosureCommand = z.union([
  inspectCommand,
  openCommand,
  verifyCommand,
  resumeAutomatedCommand,
  startManualCommand,
  finishManualCommand,
  recoverStaleTaskCommand,
  setLegalHoldCommand,
  releaseLegalHoldCommand,
]);

export type AccountClosureOperatorCommand = z.infer<typeof accountClosureCommand>;

export const ACCOUNT_CLOSURE_MAX_STDIN_BYTES = 16 * 1024;

export function parseAccountClosureOperatorCommand(
  serialized: string,
): AccountClosureOperatorCommand {
  if (Buffer.byteLength(serialized, "utf8") > ACCOUNT_CLOSURE_MAX_STDIN_BYTES) {
    throw new AccountClosureOperatorSafetyError("ACCOUNT_CLOSURE_INPUT_TOO_LARGE");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new AccountClosureOperatorSafetyError("ACCOUNT_CLOSURE_COMMAND_INVALID");
  }

  const result = accountClosureCommand.safeParse(parsed);
  if (!result.success) {
    throw new AccountClosureOperatorSafetyError("ACCOUNT_CLOSURE_COMMAND_INVALID");
  }
  return result.data;
}

type SafeRequest = Readonly<{
  id: string;
  status: AccountClosureRequestRecord["status"];
  closureStartedAt: string | null;
  accessRevokedAt: string | null;
  dueAt: string | null;
  legalHoldActive: boolean;
}>;

type SafeTask = Readonly<{
  kind: AccountClosureTaskRecord["kind"];
  status: AccountClosureTaskRecord["status"];
}>;

export type SafeAccountClosureSnapshot = Readonly<{
  request: SafeRequest;
  tasks: readonly SafeTask[];
}>;

export type SafeAccountClosureCommandResult =
  | Readonly<{ command: "inspect"; snapshot: SafeAccountClosureSnapshot }>
  | Readonly<{ command: "open"; snapshot: SafeAccountClosureSnapshot }>
  | Readonly<{ command: "verify"; snapshot: SafeAccountClosureSnapshot }>
  | Readonly<{
      command: "resume-automated";
      outcomes: readonly Readonly<{
        kind: string;
        status: string;
        errorCode?: string;
      }>[];
      snapshot: SafeAccountClosureSnapshot;
    }>
  | Readonly<{
      command: "start-manual";
      kind: (typeof MANUAL_ACCOUNT_CLOSURE_TASKS)[number];
      attempt: number;
      snapshot: SafeAccountClosureSnapshot;
    }>
  | Readonly<{ command: "finish-manual"; snapshot: SafeAccountClosureSnapshot }>
  | Readonly<{
      command: "recover-stale-task";
      snapshot: SafeAccountClosureSnapshot;
    }>
  | Readonly<{
      command: "legal-hold";
      action: "set" | "release";
      snapshot: SafeAccountClosureSnapshot;
    }>;

export type AccountClosureOperatorDependencies = Readonly<{
  store: AccountClosureStore;
  automation: AccountClosureAutomation;
  currentClerkInstanceId: string;
  resolveProviderClerkUserId: (
    input: Readonly<{
      canonicalClerkUserId: string;
      clerkInstanceId: string;
    }>,
  ) => Promise<string>;
}>;

function safeRequest(request: AccountClosureRequestRecord): SafeRequest {
  return {
    id: request.id,
    status: request.status,
    closureStartedAt: request.closureStartedAt?.toISOString() ?? null,
    accessRevokedAt: request.accessRevokedAt?.toISOString() ?? null,
    dueAt: request.dueAt?.toISOString() ?? null,
    legalHoldActive: request.legalHoldAt !== null && request.legalHoldReleasedAt === null,
  };
}

function safeTasks(tasks: readonly AccountClosureTaskRecord[]): readonly SafeTask[] {
  return [...tasks]
    .sort((left, right) => left.kind.localeCompare(right.kind))
    .map(({ kind, status }) => ({ kind, status }));
}

async function snapshot(
  store: AccountClosureStore,
  requestIdValue: string,
  knownRequest?: AccountClosureRequestRecord,
): Promise<SafeAccountClosureSnapshot> {
  const request = knownRequest ?? (await store.getRequest(requestIdValue));
  if (!request) throw new AccountClosureError("account_closure_not_found");
  const tasks = await store.getTasks(request.id);
  return { request: safeRequest(request), tasks: safeTasks(tasks) };
}

async function verifyManualProviderIdentity(
  dependencies: AccountClosureOperatorDependencies,
  command: Readonly<{
    requestId: string;
    kind: (typeof MANUAL_ACCOUNT_CLOSURE_TASKS)[number];
    clerkInstanceId?: string | undefined;
    providerClerkUserId?: string | undefined;
  }>,
): Promise<void> {
  if (command.kind !== "clerk_account_delete") return;
  if (command.clerkInstanceId !== dependencies.currentClerkInstanceId) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
  const request = await dependencies.store.getRequest(command.requestId);
  if (!request) throw new AccountClosureError("account_closure_not_found");
  const providerClerkUserId = await dependencies.resolveProviderClerkUserId({
    canonicalClerkUserId: request.clerkUserId,
    clerkInstanceId: dependencies.currentClerkInstanceId,
  });
  if (providerClerkUserId !== command.providerClerkUserId) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
}

export async function executeAccountClosureOperatorCommand(
  command: AccountClosureOperatorCommand,
  actorClerkUserId: string,
  dependencies: AccountClosureOperatorDependencies,
): Promise<SafeAccountClosureCommandResult> {
  if (command.command === "inspect") {
    return {
      command: "inspect",
      snapshot: await snapshot(dependencies.store, command.requestId),
    };
  }

  if (command.command === "open") {
    const request = await openAccountClosureRequest(dependencies.store, {
      clerkUserId: command.clerkUserId,
      requesterEmail: command.requesterEmail,
      actorClerkUserId,
      operationKey: command.operationKey,
    });
    return {
      command: "open",
      snapshot: await snapshot(dependencies.store, request.id, request),
    };
  }

  if (command.command === "verify") {
    const request = await verifyAccountClosureRequest(dependencies.store, {
      requestId: command.requestId,
      actorClerkUserId,
      operationKey: command.operationKey,
    });
    return {
      command: "verify",
      snapshot: await snapshot(dependencies.store, command.requestId, request),
    };
  }

  if (command.command === "resume-automated") {
    const outcomes = await resumeAutomatedAccountClosure(
      dependencies.store,
      dependencies.automation,
      {
        requestId: command.requestId,
        actorClerkUserId,
        operationKey: command.operationKey,
      },
    );
    return {
      command: "resume-automated",
      outcomes: outcomes.map(({ kind, status, errorCode }) => ({
        kind,
        status,
        ...(errorCode ? { errorCode } : {}),
      })),
      snapshot: await snapshot(dependencies.store, command.requestId),
    };
  }

  if (command.command === "start-manual") {
    await verifyManualProviderIdentity(dependencies, command);
    const claim = await startManualAccountClosureTask(dependencies.store, {
      requestId: command.requestId,
      kind: command.kind,
      actorClerkUserId,
      operationKey: command.operationKey,
    });
    return {
      command: "start-manual",
      kind: claim.kind as (typeof MANUAL_ACCOUNT_CLOSURE_TASKS)[number],
      attempt: claim.attempt,
      snapshot: await snapshot(dependencies.store, command.requestId),
    };
  }

  if (command.command === "finish-manual") {
    await verifyManualProviderIdentity(dependencies, command);
    await finishManualAccountClosureTask(dependencies.store, {
      requestId: command.requestId,
      kind: command.kind,
      attempt: command.attempt,
      actorClerkUserId,
      operationKey: command.operationKey,
      evidenceRef: command.evidenceRef,
      outcome: command.outcome,
    });
    return {
      command: "finish-manual",
      snapshot: await snapshot(dependencies.store, command.requestId),
    };
  }

  if (command.command === "recover-stale-task") {
    await recoverStaleAccountClosureTask(dependencies.store, {
      requestId: command.requestId,
      kind: command.kind,
      actorClerkUserId,
      operationKey: command.operationKey,
      evidenceRef: command.evidenceRef,
    });
    return {
      command: "recover-stale-task",
      snapshot: await snapshot(dependencies.store, command.requestId),
    };
  }

  if (command.action === "set") {
    await applyAccountClosureLegalHold(dependencies.store, {
      requestId: command.requestId,
      actorClerkUserId,
      operationKey: command.operationKey,
      reasonCode: command.reasonCode,
    });
  } else {
    await releaseAccountClosureLegalHold(dependencies.store, {
      requestId: command.requestId,
      actorClerkUserId,
      operationKey: command.operationKey,
    });
  }
  return {
    command: "legal-hold",
    action: command.action,
    snapshot: await snapshot(dependencies.store, command.requestId),
  };
}
