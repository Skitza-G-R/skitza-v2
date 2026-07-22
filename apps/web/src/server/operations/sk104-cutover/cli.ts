import { pathToFileURL } from "node:url";

import {
  createExecutableSk104ProductionCutoverRunner,
  defaultSk104ExecutableRuntime,
} from "./index";
import {
  SK104_CUTOVER_ERROR_CODES,
  Sk104CutoverSafetyError,
  type Sk104CutoverErrorCode,
  type Sk104CutoverMode,
} from "./environment";
import type { Sk104ProductionCutoverRunner, Sk104SafeRunnerResult } from "./runner";
import {
  SK90_SAFETY_ERROR_CODES,
  Sk90ResetSafetyError,
  type Sk90SafetyErrorCode,
} from "../sk90-reset/errors";

const MODES = new Set<Sk104CutoverMode>([
  "inspect",
  "prepare-backup",
  "plan",
  "authorize-execute",
  "authorize-restore",
  "execute",
  "resume",
  "restore",
]);

const SAFE_SK104_MESSAGES: Readonly<Record<Sk104CutoverErrorCode, string>> = {
  SK104_AMBIENT_ENV_FORBIDDEN: "Generic connection environment is present; cutover stopped.",
  SK104_ENV_MISSING: "Required production-cutover configuration is missing.",
  SK104_ENV_INVALID: "Production-cutover configuration is invalid.",
  SK104_TARGET_INVALID: "The production target boundary is invalid.",
  SK104_CONTRACT_INVALID: "The production-cutover contract is invalid.",
  SK104_DIGEST_MISMATCH: "The production-cutover digest does not match its content.",
  SK104_APPROVAL_INVALID: "The production-cutover approval is invalid.",
  SK104_APPROVAL_EXPIRED: "The production-cutover approval is not currently valid.",
};

const SAFE_SK90_MESSAGES: Readonly<Record<Sk90SafetyErrorCode, string>> = Object.fromEntries(
  SK90_SAFETY_ERROR_CODES.map((code) => [code, new Sk90ResetSafetyError(code).message]),
) as Record<Sk90SafetyErrorCode, string>;

export type Sk104SafeCliError = Readonly<{
  code: Sk104CutoverErrorCode | Sk90SafetyErrorCode;
  message: string;
}>;

export type Sk104SafeCliEvent =
  | Readonly<{
      kind: "success";
      mode: Sk104CutoverMode;
      result: Sk104SafeRunnerResult;
    }>
  | Readonly<{ kind: "error"; error: Sk104SafeCliError }>;

export interface Sk104SafeCliReporter {
  emit(event: Sk104SafeCliEvent): void;
}

export type Sk104CliDependencies = Readonly<{
  createRunner(mode: Sk104CutoverMode): Promise<Pick<Sk104ProductionCutoverRunner, "run">>;
  reporter: Sk104SafeCliReporter;
}>;

export function parseSk104CutoverMode(arguments_: readonly string[]): Sk104CutoverMode | null {
  if (arguments_.length !== 1) return null;
  const candidate = arguments_[0];
  return typeof candidate === "string" && MODES.has(candidate as Sk104CutoverMode)
    ? (candidate as Sk104CutoverMode)
    : null;
}

function safeError(error: unknown): Sk104SafeCliError {
  if (error instanceof Sk104CutoverSafetyError) {
    return { code: error.code, message: SAFE_SK104_MESSAGES[error.code] };
  }
  if (error instanceof Sk90ResetSafetyError) {
    return { code: error.code, message: SAFE_SK90_MESSAGES[error.code] };
  }
  return {
    code: "UNEXPECTED_FAILURE",
    message: SAFE_SK90_MESSAGES.UNEXPECTED_FAILURE,
  };
}

export function createSk104SafeJsonReporter(write: (line: string) => void): Sk104SafeCliReporter {
  return {
    emit(event) {
      write(JSON.stringify(event));
    },
  };
}

/** Parse first; no environment, file, database, or storage work occurs for an invalid invocation. */
export async function runSk104CutoverCli(
  arguments_: readonly string[],
  dependencies: Sk104CliDependencies,
): Promise<number> {
  const mode = parseSk104CutoverMode(arguments_);
  if (mode === null) {
    dependencies.reporter.emit({
      kind: "error",
      error: safeError(new Sk90ResetSafetyError("PHASE_STATE_INVALID")),
    });
    return 2;
  }
  try {
    const runner = await dependencies.createRunner(mode);
    const result = await runner.run(mode);
    dependencies.reporter.emit({ kind: "success", mode, result });
    return 0;
  } catch (error) {
    dependencies.reporter.emit({ kind: "error", error: safeError(error) });
    return 1;
  }
}

export function runDefaultSk104CutoverCli(
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<number> {
  return runSk104CutoverCli(arguments_, {
    createRunner: (mode) =>
      createExecutableSk104ProductionCutoverRunner(mode, defaultSk104ExecutableRuntime()),
    reporter: createSk104SafeJsonReporter((line) => {
      process.stdout.write(`${line}\n`);
    }),
  });
}

const isMain =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  runDefaultSk104CutoverCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stdout.write(`${JSON.stringify({ kind: "error", error: safeError(undefined) })}\n`);
      process.exitCode = 1;
    });
}

export { SK104_CUTOVER_ERROR_CODES, SK90_SAFETY_ERROR_CODES };
