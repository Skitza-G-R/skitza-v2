import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../../operations/sk90-reset/canonical";
import {
  approvedPurchaseRealDbTarget,
  describePurchaseRealDbEndpoint,
  FORBIDDEN_PURCHASE_REAL_DB_AMBIENT_ENV,
  PURCHASE_REAL_DB_TEST_ENV,
} from "./purchase-real-db-target-gate";

const TARGET_URL = "postgresql://isolated.example.test/sk90_fixture?sslmode=require";
const OBSERVED_PROJECT_BRANCH = sha256Digest("observed isolated project and branch");
const FORBIDDEN_CANONICAL = sha256Digest("forbidden canonical project and main branch");
const FORBIDDEN_FROZEN = sha256Digest("forbidden frozen project and main branch");
const ENDPOINT = (() => {
  const descriptor = describePurchaseRealDbEndpoint(TARGET_URL);
  if (!descriptor) throw new Error("Synthetic endpoint fixture is invalid");
  return descriptor;
})();

function safeEnvironment(): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    [PURCHASE_REAL_DB_TEST_ENV.targetClass]: "isolated_nonproduction",
    [PURCHASE_REAL_DB_TEST_ENV.disposableConfirmation]: "isolated-disposable",
    [PURCHASE_REAL_DB_TEST_ENV.targetDatabaseUrl]: TARGET_URL,
    [PURCHASE_REAL_DB_TEST_ENV.observedProjectBranchFingerprint]:
      OBSERVED_PROJECT_BRANCH,
    [PURCHASE_REAL_DB_TEST_ENV.approvedProjectBranchFingerprint]:
      OBSERVED_PROJECT_BRANCH,
    [PURCHASE_REAL_DB_TEST_ENV.forbiddenProjectBranchFingerprints]:
      `${FORBIDDEN_CANONICAL},${FORBIDDEN_FROZEN}`,
    [PURCHASE_REAL_DB_TEST_ENV.approvedEndpointFingerprint]:
      ENDPOINT.endpointFingerprint,
  };
}

describe("SK-90 isolated purchase real-DB target gate", () => {
  it("binds independent project+branch evidence separately from the URL endpoint", () => {
    expect(approvedPurchaseRealDbTarget(safeEnvironment())).toEqual({
      targetDatabaseUrl: TARGET_URL,
      databaseName: "sk90_fixture",
      projectBranchFingerprint: OBSERVED_PROJECT_BRANCH,
      endpointFingerprint: ENDPOINT.endpointFingerprint,
    });
    expect(OBSERVED_PROJECT_BRANCH).not.toBe(ENDPOINT.endpointFingerprint);
  });

  it("requires exactly two distinct forbidden audited project+branch fingerprints", () => {
    const duplicate = safeEnvironment();
    duplicate[PURCHASE_REAL_DB_TEST_ENV.forbiddenProjectBranchFingerprints] =
      `${FORBIDDEN_CANONICAL},${FORBIDDEN_CANONICAL}`;
    expect(approvedPurchaseRealDbTarget(duplicate)).toBeNull();

    const missing = safeEnvironment();
    missing[PURCHASE_REAL_DB_TEST_ENV.forbiddenProjectBranchFingerprints] =
      FORBIDDEN_CANONICAL;
    expect(approvedPurchaseRealDbTarget(missing)).toBeNull();

    const extra = safeEnvironment();
    extra[PURCHASE_REAL_DB_TEST_ENV.forbiddenProjectBranchFingerprints] =
      `${FORBIDDEN_CANONICAL},${FORBIDDEN_FROZEN},${sha256Digest("unexpected third")}`;
    expect(approvedPurchaseRealDbTarget(extra)).toBeNull();
  });

  it("rejects missing, mismatched, malformed, or forbidden project+branch evidence", () => {
    for (const name of [
      PURCHASE_REAL_DB_TEST_ENV.observedProjectBranchFingerprint,
      PURCHASE_REAL_DB_TEST_ENV.approvedProjectBranchFingerprint,
      PURCHASE_REAL_DB_TEST_ENV.forbiddenProjectBranchFingerprints,
    ]) {
      const missing = safeEnvironment();
      missing[name] = undefined;
      expect(approvedPurchaseRealDbTarget(missing), name).toBeNull();
    }

    const mismatch = safeEnvironment();
    mismatch[PURCHASE_REAL_DB_TEST_ENV.approvedProjectBranchFingerprint] =
      sha256Digest("different approval");
    expect(approvedPurchaseRealDbTarget(mismatch)).toBeNull();

    const forbidden = safeEnvironment();
    forbidden[PURCHASE_REAL_DB_TEST_ENV.observedProjectBranchFingerprint] =
      FORBIDDEN_CANONICAL;
    forbidden[PURCHASE_REAL_DB_TEST_ENV.approvedProjectBranchFingerprint] =
      FORBIDDEN_CANONICAL;
    expect(approvedPurchaseRealDbTarget(forbidden)).toBeNull();

    const malformed = safeEnvironment();
    malformed[PURCHASE_REAL_DB_TEST_ENV.observedProjectBranchFingerprint] =
      "not-a-fingerprint";
    expect(approvedPurchaseRealDbTarget(malformed)).toBeNull();
  });

  it("requires a separately approved fingerprint for the sanitized URL endpoint", () => {
    const mismatch = safeEnvironment();
    mismatch[PURCHASE_REAL_DB_TEST_ENV.approvedEndpointFingerprint] =
      sha256Digest("different endpoint");
    expect(approvedPurchaseRealDbTarget(mismatch)).toBeNull();

    const differentUrl = safeEnvironment();
    differentUrl[PURCHASE_REAL_DB_TEST_ENV.targetDatabaseUrl] =
      "postgresql://other.example.test/sk90_fixture";
    expect(approvedPurchaseRealDbTarget(differentUrl)).toBeNull();

    const missing = safeEnvironment();
    missing[PURCHASE_REAL_DB_TEST_ENV.approvedEndpointFingerprint] = undefined;
    expect(approvedPurchaseRealDbTarget(missing)).toBeNull();
  });

  it("retains the test-only, isolated, disposable, and empty-ambient stops", () => {
    const wrongNodeEnv = safeEnvironment();
    wrongNodeEnv.NODE_ENV = "production";
    expect(approvedPurchaseRealDbTarget(wrongNodeEnv)).toBeNull();

    const wrongClass = safeEnvironment();
    wrongClass[PURCHASE_REAL_DB_TEST_ENV.targetClass] = "production";
    expect(approvedPurchaseRealDbTarget(wrongClass)).toBeNull();

    const notDisposable = safeEnvironment();
    notDisposable[PURCHASE_REAL_DB_TEST_ENV.disposableConfirmation] = "keep";
    expect(approvedPurchaseRealDbTarget(notDisposable)).toBeNull();

    for (const name of FORBIDDEN_PURCHASE_REAL_DB_AMBIENT_ENV) {
      const inherited = safeEnvironment();
      inherited[name] = "present";
      expect(approvedPurchaseRealDbTarget(inherited), name).toBeNull();
    }
  });

  it("rejects malformed database URLs without returning their contents", () => {
    for (const value of ["", "not-a-url", "https://example.test/db", "postgresql://host/"]) {
      const environment = safeEnvironment();
      environment[PURCHASE_REAL_DB_TEST_ENV.targetDatabaseUrl] = value;
      expect(approvedPurchaseRealDbTarget(environment)).toBeNull();
    }
  });
});
