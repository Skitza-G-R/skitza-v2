import { createHash } from "node:crypto";

export const ACCOUNT_CLOSURE_TASKS = [
  "google_calendar_disconnect",
  "device_and_artist_preferences_cleanup",
  "clerk_account_delete",
  "public_and_capability_link_revoke",
  "account_profile_deidentification",
  "storage_review_and_cleanup",
  "retained_record_review",
  "diagnostic_provider_cleanup",
  "backup_expiry_tracking",
] as const;

export const AUTOMATED_ACCOUNT_CLOSURE_TASKS = [
  "google_calendar_disconnect",
  "device_and_artist_preferences_cleanup",
  "public_and_capability_link_revoke",
] as const;

// A live claim prevents concurrent provider/local work. An operator may
// deliberately recover a crashed claim only after this window and after
// checking the provider/case record described in the runbook.
export const ACCOUNT_CLOSURE_RUNNING_TASK_LEASE_MS = 15 * 60 * 1_000;

export type AccountClosureTaskKind = (typeof ACCOUNT_CLOSURE_TASKS)[number];
export type ManualAccountClosureTaskKind = Exclude<
  AccountClosureTaskKind,
  | "google_calendar_disconnect"
  | "device_and_artist_preferences_cleanup"
  | "public_and_capability_link_revoke"
>;
export type AccountClosureTaskStatus =
  | "pending"
  | "running"
  | "blocked"
  | "succeeded"
  | "not_applicable";

export type AccountClosureRequestRecord = Readonly<{
  id: string;
  clerkUserId: string;
  status: "requested" | "processing" | "blocked" | "completed" | "cancelled";
  closureStartedAt: Date | null;
  accessRevokedAt: Date | null;
  dueAt: Date | null;
  legalHoldAt: Date | null;
  legalHoldReleasedAt: Date | null;
}>;

export type AccountClosureTaskRecord = Readonly<{
  kind: AccountClosureTaskKind;
  status: AccountClosureTaskStatus;
}>;

export type ClaimedAccountClosureTask = Readonly<{
  attempt: number;
  kind: AccountClosureTaskKind;
  request: AccountClosureRequestRecord;
}>;

export type AccountClosureTaskOutcome = Readonly<{
  kind: AccountClosureTaskKind;
  status: "blocked" | "skipped" | "succeeded" | "not_applicable";
  errorCode?: string;
}>;

export interface AccountClosureStore {
  openRequest: (input: {
    clerkUserId: string;
    requesterEmailHash: string;
    actorClerkUserId: string;
    operationKey: string;
  }) => Promise<AccountClosureRequestRecord>;
  verifyAndBeginClosure: (input: {
    requestId: string;
    actorClerkUserId: string;
    operationKey: string;
  }) => Promise<AccountClosureRequestRecord>;
  getRequest: (requestId: string) => Promise<AccountClosureRequestRecord | null>;
  getTasks: (requestId: string) => Promise<readonly AccountClosureTaskRecord[]>;
  claimTask: (input: {
    requestId: string;
    kind: AccountClosureTaskKind;
    actorClerkUserId: string;
    operationKey: string;
  }) => Promise<ClaimedAccountClosureTask | null>;
  succeedTask: (input: {
    claim: ClaimedAccountClosureTask;
    actorClerkUserId: string;
    operationKey: string;
    evidenceRef: string;
  }) => Promise<void>;
  markTaskNotApplicable: (input: {
    claim: ClaimedAccountClosureTask;
    actorClerkUserId: string;
    operationKey: string;
    evidenceRef: string;
  }) => Promise<void>;
  blockTask: (input: {
    claim: ClaimedAccountClosureTask;
    actorClerkUserId: string;
    operationKey: string;
    errorCode: string;
  }) => Promise<void>;
  recoverStaleTask: (input: {
    requestId: string;
    kind: AccountClosureTaskKind;
    actorClerkUserId: string;
    operationKey: string;
    evidenceRef: string;
  }) => Promise<void>;
  resolveProducerId: (clerkUserId: string) => Promise<string | null>;
  hasGoogleCalendarConnection: (producerId: string) => Promise<boolean>;
  deleteDeviceAndArtistPreferences: (clerkUserId: string) => Promise<void>;
  revokePublicAndCapabilityLinks: (producerId: string) => Promise<boolean>;
  applyLegalHold: (input: {
    requestId: string;
    actorClerkUserId: string;
    operationKey: string;
    reasonCode: string;
  }) => Promise<void>;
  releaseLegalHold: (input: {
    requestId: string;
    actorClerkUserId: string;
    operationKey: string;
  }) => Promise<void>;
  completeIfReady: (input: {
    requestId: string;
    actorClerkUserId: string;
    operationKey: string;
  }) => Promise<boolean>;
}

export interface AccountClosureAutomation {
  disconnectGoogleCalendar: (producerId: string) => Promise<void>;
}

export class AccountClosureError extends Error {
  constructor(
    readonly code:
      | "account_closure_conflict"
      | "account_closure_invalid_input"
      | "account_closure_legal_hold"
      | "account_closure_not_found"
      | "account_closure_not_verified"
      | "account_closure_task_state",
  ) {
    super(code);
    this.name = "AccountClosureError";
  }
}

export class AccountClosureTaskError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AccountClosureTaskError";
  }
}

function requireIdentifier(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
  return value;
}

function requireOperationKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 180 || normalized.includes("\u0000")) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
  return normalized;
}

function requireEvidenceRef(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || normalized.includes("\u0000")) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
  return normalized;
}

export function accountClosureRequesterEmailHash(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    !normalized.includes("@") ||
    normalized.startsWith("@") ||
    normalized.endsWith("@")
  ) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

export function accountClosureOperationDigest(value: Readonly<Record<string, unknown>>): string {
  const normalized = JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, entry instanceof Date ? entry.toISOString() : entry]),
    ),
  );
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

export function isAccountClosureLegalHoldActive(
  request: Pick<AccountClosureRequestRecord, "legalHoldAt" | "legalHoldReleasedAt">,
): boolean {
  return request.legalHoldAt !== null && request.legalHoldReleasedAt === null;
}

export function isAccountClosureRunningTaskLeaseActive(
  startedAt: Date,
  attemptedAt: Date,
): boolean {
  const startedAtMs = startedAt.getTime();
  const attemptedAtMs = attemptedAt.getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(attemptedAtMs)) {
    throw new AccountClosureError("account_closure_task_state");
  }
  return attemptedAtMs < startedAtMs + ACCOUNT_CLOSURE_RUNNING_TASK_LEASE_MS;
}

export async function openAccountClosureRequest(
  store: AccountClosureStore,
  input: {
    clerkUserId: string;
    requesterEmail: string;
    actorClerkUserId: string;
    operationKey: string;
  },
): Promise<AccountClosureRequestRecord> {
  return store.openRequest({
    clerkUserId: requireIdentifier(input.clerkUserId),
    requesterEmailHash: accountClosureRequesterEmailHash(input.requesterEmail),
    actorClerkUserId: requireIdentifier(input.actorClerkUserId),
    operationKey: requireOperationKey(input.operationKey),
  });
}

export async function verifyAccountClosureRequest(
  store: AccountClosureStore,
  input: {
    requestId: string;
    actorClerkUserId: string;
    operationKey: string;
  },
): Promise<AccountClosureRequestRecord> {
  return store.verifyAndBeginClosure({
    requestId: input.requestId,
    actorClerkUserId: requireIdentifier(input.actorClerkUserId),
    operationKey: requireOperationKey(input.operationKey),
  });
}

function safeTaskErrorCode(error: unknown): string {
  if (
    (error instanceof AccountClosureTaskError || error instanceof AccountClosureError) &&
    /^[a-z][a-z0-9_.-]{0,99}$/.test(error.code)
  ) {
    return error.code;
  }
  return "unexpected_failure";
}

async function runClaimedTask(input: {
  store: AccountClosureStore;
  automation: AccountClosureAutomation;
  claim: ClaimedAccountClosureTask;
  actorClerkUserId: string;
  operationKey: string;
}): Promise<AccountClosureTaskOutcome> {
  const { claim } = input;
  try {
    if (claim.kind === "google_calendar_disconnect") {
      const producerId = await input.store.resolveProducerId(claim.request.clerkUserId);
      if (!producerId) {
        await input.store.markTaskNotApplicable({
          claim,
          actorClerkUserId: input.actorClerkUserId,
          operationKey: `${input.operationKey}:not-applicable`,
          evidenceRef: "not-applicable:artist-only-account",
        });
        return { kind: claim.kind, status: "not_applicable" };
      }
      if (!(await input.store.hasGoogleCalendarConnection(producerId))) {
        await input.store.markTaskNotApplicable({
          claim,
          actorClerkUserId: input.actorClerkUserId,
          operationKey: `${input.operationKey}:not-applicable`,
          evidenceRef: "not-applicable:no-google-connection",
        });
        return { kind: claim.kind, status: "not_applicable" };
      }
      await input.automation.disconnectGoogleCalendar(producerId);
      await input.store.succeedTask({
        claim,
        actorClerkUserId: input.actorClerkUserId,
        operationKey: `${input.operationKey}:succeeded`,
        evidenceRef: "local:google-calendar-disconnected",
      });
      return { kind: claim.kind, status: "succeeded" };
    }

    if (claim.kind === "device_and_artist_preferences_cleanup") {
      await input.store.deleteDeviceAndArtistPreferences(claim.request.clerkUserId);
      await input.store.succeedTask({
        claim,
        actorClerkUserId: input.actorClerkUserId,
        operationKey: `${input.operationKey}:succeeded`,
        evidenceRef: "local:device-and-artist-preferences-cleared",
      });
      return { kind: claim.kind, status: "succeeded" };
    }

    if (claim.kind === "public_and_capability_link_revoke") {
      const producerId = await input.store.resolveProducerId(claim.request.clerkUserId);
      if (!producerId) {
        await input.store.markTaskNotApplicable({
          claim,
          actorClerkUserId: input.actorClerkUserId,
          operationKey: `${input.operationKey}:not-applicable`,
          evidenceRef: "not-applicable:artist-only-account",
        });
        return { kind: claim.kind, status: "not_applicable" };
      }
      const capabilitiesExpired = await input.store.revokePublicAndCapabilityLinks(producerId);
      if (!capabilitiesExpired) {
        throw new AccountClosureTaskError("capability_expiry_pending");
      }
      await input.store.succeedTask({
        claim,
        actorClerkUserId: input.actorClerkUserId,
        operationKey: `${input.operationKey}:succeeded`,
        evidenceRef: "local:public-and-capability-links-revoked",
      });
      return { kind: claim.kind, status: "succeeded" };
    }

    throw new AccountClosureTaskError("manual_evidence_required");
  } catch (error) {
    const errorCode = safeTaskErrorCode(error);
    await input.store.blockTask({
      claim,
      actorClerkUserId: input.actorClerkUserId,
      operationKey: `${input.operationKey}:blocked`,
      errorCode,
    });
    return { kind: claim.kind, status: "blocked", errorCode };
  }
}

/**
 * Runs only safe local phases. Provider account deletion, full profile
 * de-identification, storage and diagnostic cleanup, retained-record review,
 * and backup-expiry tracking stay pending until an operator records evidence.
 */
export async function resumeAutomatedAccountClosure(
  store: AccountClosureStore,
  automation: AccountClosureAutomation,
  input: {
    requestId: string;
    actorClerkUserId: string;
    operationKey: string;
  },
): Promise<readonly AccountClosureTaskOutcome[]> {
  const actorClerkUserId = requireIdentifier(input.actorClerkUserId);
  const operationKey = requireOperationKey(input.operationKey);
  const outcomes: AccountClosureTaskOutcome[] = [];

  for (const kind of AUTOMATED_ACCOUNT_CLOSURE_TASKS) {
    const claim = await store.claimTask({
      requestId: input.requestId,
      kind,
      actorClerkUserId,
      operationKey: `${operationKey}:${kind}:start`,
    });
    if (!claim) {
      outcomes.push({ kind, status: "skipped" });
      continue;
    }
    outcomes.push(
      await runClaimedTask({
        store,
        automation,
        claim,
        actorClerkUserId,
        operationKey: `${operationKey}:${kind}`,
      }),
    );
  }

  await store.completeIfReady({
    requestId: input.requestId,
    actorClerkUserId,
    operationKey: `${operationKey}:complete`,
  });
  return outcomes;
}

const MANUAL_NOT_APPLICABLE_TASKS = new Set<ManualAccountClosureTaskKind>([
  "storage_review_and_cleanup",
  "diagnostic_provider_cleanup",
]);

/** Claims one manual phase before an operator performs any side effect. */
export async function startManualAccountClosureTask(
  store: AccountClosureStore,
  input: {
    requestId: string;
    kind: ManualAccountClosureTaskKind;
    actorClerkUserId: string;
    operationKey: string;
  },
): Promise<ClaimedAccountClosureTask> {
  const actorClerkUserId = requireIdentifier(input.actorClerkUserId);
  const operationKey = requireOperationKey(input.operationKey);
  const claim = await store.claimTask({
    requestId: input.requestId,
    kind: input.kind,
    actorClerkUserId,
    operationKey,
  });
  if (!claim) {
    throw new AccountClosureError("account_closure_task_state");
  }
  return claim;
}

/** Finishes only the exact manual claim returned by startManualAccountClosureTask. */
export async function finishManualAccountClosureTask(
  store: AccountClosureStore,
  input: {
    requestId: string;
    kind: ManualAccountClosureTaskKind;
    attempt: number;
    actorClerkUserId: string;
    operationKey: string;
    evidenceRef: string;
    outcome: "succeeded" | "not_applicable";
  },
): Promise<void> {
  const actorClerkUserId = requireIdentifier(input.actorClerkUserId);
  const operationKey = requireOperationKey(input.operationKey);
  const evidenceRef = requireEvidenceRef(input.evidenceRef);
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
  if (input.outcome === "not_applicable" && !MANUAL_NOT_APPLICABLE_TASKS.has(input.kind)) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
  const request = await store.getRequest(input.requestId);
  if (!request) throw new AccountClosureError("account_closure_not_found");
  const claim: ClaimedAccountClosureTask = {
    attempt: input.attempt,
    kind: input.kind,
    request,
  };

  if (input.outcome === "not_applicable") {
    await store.markTaskNotApplicable({
      claim,
      actorClerkUserId,
      operationKey,
      evidenceRef,
    });
  } else {
    await store.succeedTask({
      claim,
      actorClerkUserId,
      operationKey,
      evidenceRef,
    });
  }
  await store.completeIfReady({
    requestId: input.requestId,
    actorClerkUserId,
    operationKey: `${operationKey}:complete`,
  });
}

/**
 * Audits the deliberate recovery of a crashed task claim. This does not run
 * the task; it moves only an expired running claim to blocked so a later,
 * separately keyed resume can claim it.
 */
export async function recoverStaleAccountClosureTask(
  store: AccountClosureStore,
  input: {
    requestId: string;
    kind: AccountClosureTaskKind;
    actorClerkUserId: string;
    operationKey: string;
    evidenceRef: string;
  },
): Promise<void> {
  await store.recoverStaleTask({
    requestId: input.requestId,
    kind: input.kind,
    actorClerkUserId: requireIdentifier(input.actorClerkUserId),
    operationKey: requireOperationKey(input.operationKey),
    evidenceRef: requireEvidenceRef(input.evidenceRef),
  });
}

export async function applyAccountClosureLegalHold(
  store: AccountClosureStore,
  input: {
    requestId: string;
    actorClerkUserId: string;
    operationKey: string;
    reasonCode: string;
  },
): Promise<void> {
  const reasonCode = input.reasonCode.trim();
  if (!/^[a-z][a-z0-9_.-]{0,99}$/.test(reasonCode)) {
    throw new AccountClosureError("account_closure_invalid_input");
  }
  await store.applyLegalHold({
    requestId: input.requestId,
    actorClerkUserId: requireIdentifier(input.actorClerkUserId),
    operationKey: requireOperationKey(input.operationKey),
    reasonCode,
  });
}

export async function releaseAccountClosureLegalHold(
  store: AccountClosureStore,
  input: {
    requestId: string;
    actorClerkUserId: string;
    operationKey: string;
  },
): Promise<void> {
  const actorClerkUserId = requireIdentifier(input.actorClerkUserId);
  const operationKey = requireOperationKey(input.operationKey);
  await store.releaseLegalHold({
    requestId: input.requestId,
    actorClerkUserId,
    operationKey,
  });
  await store.completeIfReady({
    requestId: input.requestId,
    actorClerkUserId,
    operationKey: `${operationKey}:complete`,
  });
}
