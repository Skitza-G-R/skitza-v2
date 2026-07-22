import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { loadSk102EnvironmentFile } from "../src/server/operations/sk102-environment-file";
import { SK102_REPOSITORY_ROOT } from "../src/server/operations/sk102-fixtures/contract";
import {
  removeSk102AuthState,
  removeSk102BrowserEvidence,
  removeSk102BrowserTestResults,
} from "../src/server/operations/sk102-fixtures/local-state";
import { safePlaywrightArguments } from "./support/run-arguments";

const projects = [
  ["desktop", "chromium-desktop"],
  ["phone390", "chromium-390"],
  ["phone360", "chromium-360"],
] as const;

const playwrightArguments = safePlaywrightArguments(process.argv.slice(2));
const listOnly = playwrightArguments.length === 1;
const webRoot = path.resolve(SK102_REPOSITORY_ROOT, "apps", "web");

async function runProject(
  slot: (typeof projects)[number][0],
  project: (typeof projects)[number][1],
  leaseToken?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "corepack",
      [
        "pnpm",
        "exec",
        "playwright",
        "test",
        "--config",
        "playwright.config.ts",
        "--project",
        project,
        ...playwrightArguments,
      ],
      {
        cwd: webRoot,
        env: {
          ...process.env,
          SKITZA_E2E_SLOT: slot,
          SKITZA_E2E_LIST_ONLY: listOnly ? "1" : "0",
          ...(leaseToken ? { SKITZA_E2E_RUN_LEASE_TOKEN: leaseToken } : {}),
        },
        stdio: "inherit",
      },
    );
    child.once("error", () => {
      resolve(false);
    });
    child.once("close", (code) => {
      resolve(code === 0);
    });
  });
}

async function runProjects(leaseToken?: string): Promise<void> {
  let failed = false;
  for (const [slot, project] of projects) {
    if (!(await runProject(slot, project, leaseToken))) failed = true;
  }
  if (failed) throw new Error("SK102_BROWSER_PROJECT_FAILED");
}

async function main(): Promise<void> {
  if (process.env.SKITZA_E2E_RUN_LEASE_TOKEN !== undefined) {
    throw new Error("SK102_BROWSER_RUN_LEASE_AMBIENT_FORBIDDEN");
  }
  if (listOnly) {
    await runProjects();
    return;
  }
  loadSk102EnvironmentFile(SK102_REPOSITORY_ROOT);
  const leaseToken = randomUUID();
  const { withSk102BrowserRunLease } =
    await import("../src/server/operations/sk102-fixtures/workflow");
  await withSk102BrowserRunLease(leaseToken, async () => {
    await removeSk102AuthState(SK102_REPOSITORY_ROOT);
    await removeSk102BrowserEvidence(SK102_REPOSITORY_ROOT);
    await removeSk102BrowserTestResults(SK102_REPOSITORY_ROOT);
    await runProjects(leaseToken);
  });
}

main().catch(() => {
  console.error("SK102_BROWSER_RUN_FAILED");
  process.exitCode = 1;
});
