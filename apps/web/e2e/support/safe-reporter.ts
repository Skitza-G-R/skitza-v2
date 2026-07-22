import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { SK102_REPOSITORY_ROOT } from "../../src/server/operations/sk102-fixtures/contract";
import {
  assertSk102ConfinedLocalPath,
  prepareSk102ConfinedDirectory,
  sk102BrowserEvidenceDirectory,
} from "../../src/server/operations/sk102-fixtures/local-state";
import { E2E_SLOTS, type E2ESlot } from "./manifest";

type SafeResult = Readonly<{
  project: string;
  title: string;
  status: TestResult["status"];
  durationMs: number;
}>;

function currentSlot(): E2ESlot {
  const value = process.env.SKITZA_E2E_SLOT;
  if (typeof value === "string" && E2E_SLOTS.includes(value as E2ESlot)) {
    return value as E2ESlot;
  }
  throw new Error("Safe browser reporter requires an exact fixture slot.");
}

export function browserEvidenceEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.SKITZA_E2E_LIST_ONLY !== "1";
}

export async function writeSafeBrowserEvidence(
  repositoryRoot: string,
  slot: E2ESlot,
  status: FullResult["status"],
  results: readonly SafeResult[],
): Promise<void> {
  const outputDirectory = sk102BrowserEvidenceDirectory(repositoryRoot);
  await prepareSk102ConfinedDirectory(repositoryRoot, outputDirectory);
  const target = path.join(outputDirectory, `${slot}.json`);
  const temporary = `${target}.tmp`;
  await Promise.all([
    assertSk102ConfinedLocalPath(repositoryRoot, target),
    assertSk102ConfinedLocalPath(repositoryRoot, temporary),
  ]);
  await writeFile(
    temporary,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        slot,
        status,
        tests: results,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600, flag: "wx" },
  );
  await assertSk102ConfinedLocalPath(repositoryRoot, temporary);
  await rename(temporary, target);
  await assertSk102ConfinedLocalPath(repositoryRoot, target);
}

/**
 * Deliberately excludes URLs, errors, attachments, stdout, and test values.
 * Browser failures can carry cookies, upload URLs, emails, or provider IDs;
 * CI evidence records only static test titles and pass/fail state.
 */
export default class SafeBrowserReporter implements Reporter {
  private readonly results: SafeResult[] = [];

  onBegin(): void {
    const action = browserEvidenceEnabled() ? "run started" : "test discovery started";
    process.stdout.write(`SK-102 browser ${action} (${currentSlot()}).\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const entry: SafeResult = {
      project: test.parent.project()?.name ?? "unknown",
      title: test.titlePath().join(" > "),
      status: result.status,
      durationMs: result.duration,
    };
    this.results.push(entry);
    const label = result.status === "passed" ? "PASS" : "FAIL";
    process.stdout.write(`${label} ${entry.project}: ${entry.title}\n`);
  }

  onError(): void {
    process.stdout.write("FAIL browser runner error (details withheld).\n");
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!browserEvidenceEnabled()) return;
    const slot = currentSlot();
    await writeSafeBrowserEvidence(SK102_REPOSITORY_ROOT, slot, result.status, this.results);
  }
}
