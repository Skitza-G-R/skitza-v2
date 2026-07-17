export const SK90_SAFETY_ERROR_CODES = [
  "AMBIENT_ENV_FORBIDDEN",
  "REHEARSAL_ENV_MISSING",
  "REHEARSAL_ENV_INVALID",
  "FINGERPRINT_INVALID",
  "TARGET_NOT_ISOLATED",
  "TARGET_POLICY_MISMATCH",
  "DATABASE_TARGET_FORBIDDEN",
  "DATABASE_TARGET_MISMATCH",
  "STORAGE_TARGET_FORBIDDEN",
  "STORAGE_TARGET_MISMATCH",
  "RESTORE_POINT_NOT_READY",
  "STORAGE_ISOLATION_NOT_PROVEN",
  "MANIFEST_INPUT_INVALID",
  "MANIFEST_DUPLICATE_ENTRY",
  "MANIFEST_DIGEST_MISMATCH",
  "ARTIFACT_BINDING_MISMATCH",
  "ARTIFACT_DIGEST_MISMATCH",
  "FRESH_TARGET_AUTHORIZATION_INVALID",
  "MOCK_EVIDENCE_COVERAGE_MISMATCH",
  "IDENTITY_NOT_APPROVED_TEST",
  "MONETARY_ROW_NOT_APPROVED_TEST",
  "PROVIDER_REFERENCE_NOT_APPROVED_TEST",
  "LIVE_PAYMENT_ACTIVITY",
  "STORAGE_OBJECT_MISSING",
  "STORAGE_OWNERSHIP_UNVERIFIED",
  "STORAGE_OBJECT_SHARED",
  "STORAGE_OBJECT_DRIFT",
  "LOCK_CONTRACT_INVALID",
  "FINAL_DRIFT_DETECTED",
  "POST_RESET_INTEGRITY_MISMATCH",
  "POST_RESET_INTEGRITY_REQUIRED",
  "QUARANTINE_PROOF_MISMATCH",
  "QUARANTINE_PROOF_REQUIRED",
  "PHASE_STATE_INVALID",
  "RESTORE_REQUIRED",
  "RESTORE_PROOF_MISMATCH",
  "UNEXPECTED_FAILURE",
] as const;

export type Sk90SafetyErrorCode = (typeof SK90_SAFETY_ERROR_CODES)[number];

const SAFE_MESSAGES: Record<Sk90SafetyErrorCode, string> = {
  AMBIENT_ENV_FORBIDDEN: "Generic connection environment is present; rehearsal stopped.",
  REHEARSAL_ENV_MISSING: "Required isolated-rehearsal configuration is missing.",
  REHEARSAL_ENV_INVALID: "Isolated-rehearsal configuration is invalid.",
  FINGERPRINT_INVALID: "A required sanitized fingerprint is invalid.",
  TARGET_NOT_ISOLATED: "The target is not approved as isolated non-production.",
  TARGET_POLICY_MISMATCH: "The target evidence does not match the pre-approved policy digest.",
  DATABASE_TARGET_FORBIDDEN: "The database target matches a forbidden project.",
  DATABASE_TARGET_MISMATCH: "The database target does not match the approved fingerprint.",
  STORAGE_TARGET_FORBIDDEN: "The storage target matches a forbidden namespace.",
  STORAGE_TARGET_MISMATCH: "The storage target does not match the approved fingerprint.",
  RESTORE_POINT_NOT_READY: "Required database and storage restore points are not ready.",
  STORAGE_ISOLATION_NOT_PROVEN: "Exclusive isolated storage control is not proven.",
  MANIFEST_INPUT_INVALID: "The private reset manifest input is invalid.",
  MANIFEST_DUPLICATE_ENTRY: "The private reset manifest contains a duplicate entry.",
  MANIFEST_DIGEST_MISMATCH: "The private reset manifest digest does not match its content.",
  ARTIFACT_BINDING_MISMATCH: "The reset artifact inputs do not share one reviewed boundary.",
  ARTIFACT_DIGEST_MISMATCH: "The reset artifact digest does not match its content.",
  FRESH_TARGET_AUTHORIZATION_INVALID:
    "The phase is not bound to the current approved target observation.",
  MOCK_EVIDENCE_COVERAGE_MISMATCH:
    "Identity, payment, or provider evidence does not cover the reviewed inventory.",
  IDENTITY_NOT_APPROVED_TEST: "A linked identity is not approved test data.",
  MONETARY_ROW_NOT_APPROVED_TEST: "A paid or confirmed row is not approved mock test data.",
  PROVIDER_REFERENCE_NOT_APPROVED_TEST: "A provider reference lacks approved test evidence.",
  LIVE_PAYMENT_ACTIVITY: "Live or external payment activity was detected.",
  STORAGE_OBJECT_MISSING: "A manifest-bound storage object is missing.",
  STORAGE_OWNERSHIP_UNVERIFIED: "Storage ownership could not be proven.",
  STORAGE_OBJECT_SHARED: "A reset object is also referenced by preserved data.",
  STORAGE_OBJECT_DRIFT: "Storage object content or existence drifted.",
  LOCK_CONTRACT_INVALID: "The final transaction lock contract is incomplete.",
  FINAL_DRIFT_DETECTED: "The final in-transaction inventory drifted from the reviewed manifest.",
  POST_RESET_INTEGRITY_MISMATCH:
    "Post-reset database or storage integrity differs from the approved artifact.",
  POST_RESET_INTEGRITY_REQUIRED:
    "Artifact-bound post-reset integrity proof is required before verification.",
  QUARANTINE_PROOF_MISMATCH:
    "Quarantine copies do not exactly match the artifact-bound reset objects.",
  QUARANTINE_PROOF_REQUIRED:
    "Verified artifact-bound quarantine proof is required before database reset.",
  PHASE_STATE_INVALID: "The reset phase journal and observed state do not agree.",
  RESTORE_REQUIRED: "A partial reset state requires database and storage restore.",
  RESTORE_PROOF_MISMATCH: "Restored database or storage evidence differs from baseline.",
  UNEXPECTED_FAILURE: "The reset safety check failed without exposing private details.",
};

export class Sk90ResetSafetyError extends Error {
  readonly code: Sk90SafetyErrorCode;

  constructor(code: Sk90SafetyErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "Sk90ResetSafetyError";
    this.code = code;
  }
}

export function stop(code: Sk90SafetyErrorCode): never {
  throw new Sk90ResetSafetyError(code);
}

export type SafeErrorReport = Readonly<{
  ok: false;
  code: Sk90SafetyErrorCode;
  message: string;
}>;

/**
 * Convert an exception into a report that is safe to print or attach to
 * sanitized rehearsal evidence. Unknown messages, causes, query details,
 * identifiers, URLs, and object keys are deliberately discarded.
 */
export function toSafeErrorReport(error: unknown): SafeErrorReport {
  const safeError =
    error instanceof Sk90ResetSafetyError ? error : new Sk90ResetSafetyError("UNEXPECTED_FAILURE");

  return {
    ok: false,
    code: safeError.code,
    message: SAFE_MESSAGES[safeError.code],
  };
}
