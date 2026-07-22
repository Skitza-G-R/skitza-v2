import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sha256Digest } from "../sk90-reset/canonical";
import { buildSk104ExecutionContext } from "./bundle";
import {
  initializeSk104DurableState,
  loadSk104DurableState,
  reauthorizeSk104DurableState,
  transitionSk104DurableState,
} from "./durable-state";

const HMAC_KEY = "sk104-durable-state-test-hmac-key-long-enough";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sk104-state-"));
  await chmod(root, 0o700);
  const stateDirectory = join(root, "state");
  const context = buildSk104ExecutionContext({
    runNonce: "n".repeat(32),
    stateDirectory,
    approvalLedgerDirectory: join(root, "ledger"),
    approvalFile: join(root, "approval.json"),
    releaseCommit: "a".repeat(40),
    hmacKey: HMAC_KEY,
  });
  return { context, stateDirectory };
}

describe("SK-104 durable state", () => {
  it("publishes an immutable HMAC revision chain and exact phases", async () => {
    const { context, stateDirectory } = await fixture();
    let state = await initializeSk104DurableState({
      directory: stateDirectory,
      context,
      manifestDigest: sha256Digest("manifest"),
      hmacKey: HMAC_KEY,
      currentTime: "2026-07-22T12:00:00.000Z",
    });
    state = await transitionSk104DurableState({
      directory: stateDirectory,
      context,
      hmacKey: HMAC_KEY,
      expectedStateDigest: state.stateDigest,
      nextPhase: "backup_prepared",
      currentTime: "2026-07-22T12:00:01.000Z",
    });
    state = await transitionSk104DurableState({
      directory: stateDirectory,
      context,
      hmacKey: HMAC_KEY,
      expectedStateDigest: state.stateDigest,
      nextPhase: "planned",
      planDigest: sha256Digest("plan"),
      restorePlanDigest: sha256Digest("restore-plan"),
      currentTime: "2026-07-22T12:00:02.000Z",
    });
    const retried = await initializeSk104DurableState({
      directory: stateDirectory,
      context,
      manifestDigest: sha256Digest("manifest"),
      hmacKey: HMAC_KEY,
      currentTime: "2026-07-22T12:00:03.000Z",
    });
    expect(
      (await loadSk104DurableState({ directory: stateDirectory, context, hmacKey: HMAC_KEY }))
        .phase,
    ).toBe("planned");
    expect(retried).toEqual(state);
    expect(state.revision).toBe(2);
  });

  it("accepts a fresh approval only for the same immutable plan", async () => {
    const { context, stateDirectory } = await fixture();
    let state = await initializeSk104DurableState({
      directory: stateDirectory,
      context,
      manifestDigest: sha256Digest("manifest"),
      hmacKey: HMAC_KEY,
      currentTime: "2026-07-22T12:00:00.000Z",
    });
    state = await transitionSk104DurableState({
      directory: stateDirectory,
      context,
      hmacKey: HMAC_KEY,
      expectedStateDigest: state.stateDigest,
      nextPhase: "backup_prepared",
      currentTime: "2026-07-22T12:00:01.000Z",
    });
    const planDigest = sha256Digest("plan");
    state = await transitionSk104DurableState({
      directory: stateDirectory,
      context,
      hmacKey: HMAC_KEY,
      expectedStateDigest: state.stateDigest,
      nextPhase: "planned",
      planDigest,
      restorePlanDigest: sha256Digest("restore-plan"),
      currentTime: "2026-07-22T12:00:02.000Z",
    });
    await expect(
      reauthorizeSk104DurableState({
        directory: stateDirectory,
        context,
        hmacKey: HMAC_KEY,
        expectedStateDigest: state.stateDigest,
        approvalDigest: sha256Digest("approval"),
        planDigest: sha256Digest("other-plan"),
        currentTime: "2026-07-22T12:00:03.000Z",
      }),
    ).rejects.toMatchObject({ code: "SK104_APPROVAL_INVALID" });
  });
});
